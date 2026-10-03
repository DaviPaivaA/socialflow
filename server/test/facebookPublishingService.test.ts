import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FacebookPublishingService } from "../src/facebookPublishingService.ts";
import { PublicationError, PublicationOperationalError } from "../src/publicationErrors.ts";
import { MetaPublishingClientError } from "../src/metaPublishingClient.ts";
import { InvalidSocialAccountsContextError } from "../src/postgresSocialAccountsRepository.ts";
import { MediaAssetsService } from "../src/mediaAssetsService.ts";
import { cipher, now, token } from "./publicationFixtures.ts";

const publication = { id: "destination", tenantId: "tenant", postId: "post", socialAccountId: "account" };
function setup() {
  const repository = { findPostForPublication: vi.fn().mockResolvedValue({ authorUserId: "persisted-author", caption: "Message", mediaAssetIds: [] }), markPublished: vi.fn().mockResolvedValue(undefined) };
  const accounts = { findById: vi.fn().mockResolvedValue({ provider: "facebook", status: "connected", disconnectedAt: null }), findFacebookPublishingCredential: vi.fn().mockResolvedValue({ accessTokenEncrypted: cipher.encryptSecret(token), providerAccountId: "100", scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"], tasks: ["CREATE_CONTENT"], tokenExpiresAt: null }) };
  const provider = { publishText: vi.fn().mockResolvedValue({ providerPostId: "100_200" }), publishPhoto: vi.fn().mockResolvedValue({ providerPostId: "100_300" }) };
  const media = { getPublishingContent: vi.fn().mockResolvedValue({ source: new Blob(["verified"], { type: "image/jpeg" }), mimeType: "image/jpeg", sizeBytes: 8 }) };
  const decrypt = { decryptSecret: vi.fn((value: string) => cipher.decryptSecret(value)) };
  const service = new FacebookPublishingService(repository, accounts, decrypt, media, provider, () => now);
  return { repository, accounts, provider, media, decrypt, service };
}
async function fails(s: ReturnType<typeof setup>, code: string) {
  await expect(s.service.publish(publication)).rejects.toMatchObject({ name: "PublicationError", code });
  expect(s.provider.publishText).not.toHaveBeenCalled();
  expect(s.provider.publishPhoto).not.toHaveBeenCalled();
  expect(s.repository.markPublished).not.toHaveBeenCalled();
}
describe("FacebookPublishingService", () => {
  it("uses persisted tenant-scoped author for scheduler input and decrypts only on publish", async () => {
    const s = setup(); expect(s.decrypt.decryptSecret).not.toHaveBeenCalled();
    await s.service.publish({ ...publication, authorUserId: "forged" } as typeof publication);
    expect(s.repository.findPostForPublication).toHaveBeenCalledWith("tenant", "post");
    expect(s.accounts.findFacebookPublishingCredential).toHaveBeenCalledWith({ tenantId: "tenant", authorUserId: "persisted-author" }, "account");
    expect(s.provider.publishText).toHaveBeenCalledExactlyOnceWith({ pageId: "100", accessToken: token, message: "Message" });
    expect(s.repository.markPublished).toHaveBeenCalledWith({ id: "destination", tenantId: "tenant", providerPostId: "100_200", publishedAt: now });
  });
  it("publishes local photo through safe media service", async () => {
    const s = setup(); s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
    await s.service.publish(publication);
    expect(s.media.getPublishingContent).toHaveBeenCalledWith({ tenantId: "tenant", authorUserId: "persisted-author" }, "image");
    expect(s.provider.publishPhoto).toHaveBeenCalledWith({ pageId: "100", accessToken: token, message: "Image", source: expect.any(Blob), mimeType: "image/jpeg" });
    expect(s.provider.publishText).not.toHaveBeenCalled();
  });
  it("hides absent or cross-tenant posts", async () => { const s = setup(); s.repository.findPostForPublication.mockResolvedValue(null); await fails(s, "publication_unavailable"); expect(s.accounts.findById).not.toHaveBeenCalled(); });
  it("rejects revoked author membership safely", async () => { const s = setup(); s.accounts.findById.mockRejectedValue(new InvalidSocialAccountsContextError()); await fails(s, "publication_author_unavailable"); expect(s.decrypt.decryptSecret).not.toHaveBeenCalled(); });
  it.each([null, { provider: "facebook", status: "revoked" }, { provider: "instagram", status: "connected" }])("rejects unavailable Page %j", async account => { const s = setup(); s.accounts.findById.mockResolvedValue(account); await fails(s, "meta_page_unavailable"); });
  it.each([null, { accessTokenEncrypted: null }, { tokenExpiresAt: now.toISOString() }, { tokenExpiresAt: "bad" }, { accessTokenEncrypted: "corrupted-secret" }])("rejects missing/expired/broken credential %j", async change => {
    const s = setup(); const original = await s.accounts.findFacebookPublishingCredential(); s.accounts.findFacebookPublishingCredential.mockResolvedValue(change === null ? null : { ...original, ...change }); await fails(s, "meta_token_invalid");
  });
  it.each([{ tasks: [] }, { tasks: null }, { tasks: "CREATE_CONTENT" }, { scopes: [] }])("rejects permission/task failure %j", async change => { const s = setup(); const original = await s.accounts.findFacebookPublishingCredential(); s.accounts.findFacebookPublishingCredential.mockResolvedValue({ ...original, ...change }); await fails(s, "meta_permission_denied"); });
  it.each(["invalid_response", "meta_invalid_request", "meta_permission_denied", "meta_token_invalid", "meta_page_unavailable", "meta_rate_limited", "meta_provider_error", "meta_timeout", "media_unavailable"] as const)("normalizes provider %s", async kind => {
    const s = setup(); s.provider.publishText.mockRejectedValue(new MetaPublishingClientError(kind, "publish_text"));
    await expect(s.service.publish(publication)).rejects.toMatchObject({ code: kind === "invalid_response" ? "meta_provider_error" : kind });
    expect(s.repository.markPublished).not.toHaveBeenCalled();
  });
  it("keeps operational persistence failure distinct after provider success and strips secrets", async () => {
    const s = setup(); s.repository.markPublished.mockRejectedValue(new Error("token /private/path ciphertext raw-response"));
    const error = await s.service.publish(publication).catch(error => error);
    expect(error).toBeInstanceOf(PublicationOperationalError); expect(error).not.toBeInstanceOf(PublicationError);
    expect(String(error)).not.toMatch(/token|private|ciphertext|raw-response/);
  });
  it("uploads the verified snapshot even if the file is replaced before provider dispatch", async () => {
    const root = await mkdtemp(join(tmpdir(), "publishing-snapshot-"));
    try {
      await mkdir(join(root, "tenant"));
      const path = join(root, "tenant", "image.jpg");
      const original = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
      await writeFile(path, original);
      const stored = { id: "image", mediaType: "image" as const, mimeType: "image/jpeg", sizeBytes: original.length, sha256: createHash("sha256").update(original).digest("hex"), storageKey: "tenant/image.jpg" };
      const media = new MediaAssetsService({ findStoredById: vi.fn().mockResolvedValue(stored), create: vi.fn(), findById: vi.fn(), list: vi.fn() }, root, { imageBytes: 4000000, videoBytes: 4000000 });
      const s = setup();
      s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
      s.provider.publishPhoto.mockImplementation(async ({ source }: { source: Blob }) => {
        await writeFile(path, Buffer.from([255,216,255,224,5,6,7,8]));
        expect(new Uint8Array(await source.arrayBuffer())).toEqual(new Uint8Array(original));
        return { providerPostId: "100_300" };
      });
      s.service = new FacebookPublishingService(s.repository, s.accounts, s.decrypt, media, s.provider, () => now);
      await s.service.publish(publication);
      expect(s.provider.publishPhoto).toHaveBeenCalledTimes(1);
      expect(s.provider.publishText).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(["different size", "same size"])("rejects replaced media with %s bytes before any provider call", async mode => {
    const root = await mkdtemp(join(tmpdir(), "publishing-integrity-"));
    try {
      await mkdir(join(root, "tenant"));
      const original = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
      const replacement = mode === "same size" ? Buffer.from([255, 216, 255, 224, 5, 6, 7, 8]) : Buffer.concat([original, Buffer.from([9])]);
      await writeFile(join(root, "tenant", "image.jpg"), replacement);
      const stored = { id: "image", mediaType: "image" as const, mimeType: "image/jpeg", sizeBytes: original.length, sha256: createHash("sha256").update(original).digest("hex"), storageKey: "tenant/image.jpg" };
      const media = new MediaAssetsService({ findStoredById: vi.fn().mockResolvedValue(stored), create: vi.fn(), findById: vi.fn(), list: vi.fn() }, root, { imageBytes: 4000000, videoBytes: 4000000 });
      const s = setup();
      s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
      s.service = new FacebookPublishingService(s.repository, s.accounts, s.decrypt, media, s.provider, () => now);
      const error = await s.service.publish(publication).catch(error => error);
      expect(error).toMatchObject({ name: "PublicationError", code: "media_unavailable" });
      expect(String(error) + JSON.stringify(error)).not.toMatch(new RegExp(`${root}|${token}|${stored.sha256}`));
      expect(s.provider.publishText).not.toHaveBeenCalled();
      expect(s.provider.publishPhoto).not.toHaveBeenCalled();
      expect(s.repository.markPublished).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(["missing", "unsafe", "symlink", "deleted"])("never falls back to text for %s scheduled image using real safe media resolution", async mode => {
    const root = await mkdtemp(join(tmpdir(), "publishing-media-"));
    try {
      await mkdir(join(root, "tenant")); await mkdir(join(root, "other-tenant")); await writeFile(join(root, "other-tenant", "outside.jpg"), "image");
      if (mode === "symlink") await symlink(join(root, "other-tenant", "outside.jpg"), join(root, "tenant", "image.jpg"));
      const stored = { id: "image", mediaType: "image" as const, mimeType: "image/jpeg", sizeBytes: 5, storageKey: mode === "unsafe" ? "../outside.jpg" : "tenant/image.jpg" };
      const media = new MediaAssetsService({ findStoredById: vi.fn().mockResolvedValue(mode === "deleted" ? null : stored), create: vi.fn(), findById: vi.fn(), list: vi.fn() }, root, { imageBytes: 4000000, videoBytes: 4000000 });
      const s = setup(); s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
      s.service = new FacebookPublishingService(s.repository, s.accounts, s.decrypt, media, s.provider, () => now);
      await fails(s, "media_unavailable");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
