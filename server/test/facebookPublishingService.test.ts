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
import { asyncPublishingStubs } from "./metaPublishingClientStub.ts";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import type { LeasedPublicationOperation } from "../src/publicationOperationsRepository.ts";

const publication = { id: "destination", tenantId: "tenant", postId: "post", socialAccountId: "account" };
function setup() {
  const repository = { findPostForPublication: vi.fn().mockResolvedValue({ authorUserId: "persisted-author", caption: "Message", mediaAssetIds: [] }), markPublished: vi.fn().mockResolvedValue(undefined) };
  const accounts = { findById: vi.fn().mockResolvedValue({ provider: "facebook", providerAccountId: "100", status: "connected", disconnectedAt: null }), findMetaPublishingCredential: vi.fn().mockResolvedValue({ provider: "facebook", accessTokenEncrypted: cipher.encryptSecret(token), providerAccountId: "100", scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"], tasks: ["CREATE_CONTENT"], tokenExpiresAt: null }) };
  const provider = { ...asyncPublishingStubs(), publishText: vi.fn().mockResolvedValue({ providerPostId: "100_200" }), publishPhoto: vi.fn().mockResolvedValue({ providerPostId: "100_300" }) };
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
  it.each(["publish_text", "publish_photo"] as const)("keeps unknown %s outcome operational instead of inventing definitive failure", async requestName => {
    const s = setup();
    if (requestName === "publish_photo") s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
    s.provider[requestName === "publish_text" ? "publishText" : "publishPhoto"].mockRejectedValue(new MetaPublishingClientError("meta_timeout", requestName, { outcome: "unknown" }));
    await expect(s.service.publish(publication)).rejects.toBeInstanceOf(PublicationOperationalError);
    expect(s.repository.markPublished).not.toHaveBeenCalled();
  });
  it("uses persisted tenant-scoped author for scheduler input and decrypts only on publish", async () => {
    const s = setup(); expect(s.decrypt.decryptSecret).not.toHaveBeenCalled();
    await s.service.publish({ ...publication, authorUserId: "forged" } as typeof publication);
    expect(s.repository.findPostForPublication).toHaveBeenCalledWith("tenant", "post");
    expect(s.accounts.findMetaPublishingCredential).toHaveBeenCalledWith({ tenantId: "tenant", authorUserId: "persisted-author" }, "account");
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
  it.each([
    ["account", "meta_page_unavailable"], ["membership", "publication_author_unavailable"],
    ["scopes", "meta_permission_denied"], ["token", "meta_token_invalid"],
  ])("blocks legacy photo when %s is lost during pending media I/O", async (loss, code) => {
    const s = setup(); let instant = now;
    s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
    const credential = await s.accounts.findMetaPublishingCredential();
    if (loss === "token") s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...credential, tokenExpiresAt: new Date(now.getTime() + 1000).toISOString() });
    let resolve!: (content: { source: Blob; mimeType: string; sizeBytes: number }) => void;
    s.media.getPublishingContent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    s.service = new FacebookPublishingService(s.repository, s.accounts, s.decrypt, s.media, s.provider, () => instant);
    const pending = s.service.publish(publication).then(() => null, error => error);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (loss === "account") s.accounts.findById.mockResolvedValue(null);
    if (loss === "membership") s.accounts.findById.mockRejectedValue(new InvalidSocialAccountsContextError());
    if (loss === "scopes") s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...credential, scopes: [] });
    if (loss === "token") instant = new Date(now.getTime() + 1001);
    resolve({ source: new Blob(["verified"]), mimeType: "image/jpeg", sizeBytes: 8 });
    expect(await pending).toMatchObject({ name: "PublicationError", code });
    expect(s.provider.publishText).not.toHaveBeenCalled(); expect(s.provider.publishPhoto).not.toHaveBeenCalled();
    expect(s.repository.markPublished).not.toHaveBeenCalled(); expect(s.decrypt.decryptSecret).not.toHaveBeenCalled();
  });
  it("uses the current rotated credential after pending legacy photo I/O", async () => {
    const s = setup();
    s.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Image", mediaAssetIds: ["image"] });
    const credential = await s.accounts.findMetaPublishingCredential();
    const source = new Blob(["verified"]);
    let resolve!: (content: { source: Blob; mimeType: string; sizeBytes: number }) => void;
    s.media.getPublishingContent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = s.service.publish(publication);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...credential, accessTokenEncrypted: cipher.encryptSecret("rotated-page-token") });
    resolve({ source, mimeType: "image/jpeg", sizeBytes: 8 }); await pending;
    expect(s.provider.publishPhoto).toHaveBeenCalledExactlyOnceWith({ pageId: "100", accessToken: "rotated-page-token", message: "Image", source, mimeType: "image/jpeg" });
    expect(s.provider.publishText).not.toHaveBeenCalled();
  });
  it("hides absent or cross-tenant posts", async () => { const s = setup(); s.repository.findPostForPublication.mockResolvedValue(null); await fails(s, "publication_unavailable"); expect(s.accounts.findById).not.toHaveBeenCalled(); });
  it("rejects revoked author membership safely", async () => { const s = setup(); s.accounts.findById.mockRejectedValue(new InvalidSocialAccountsContextError()); await fails(s, "publication_author_unavailable"); expect(s.decrypt.decryptSecret).not.toHaveBeenCalled(); });
  it.each([null, { provider: "facebook", status: "revoked" }, { provider: "instagram", status: "connected" }])("rejects unavailable Page %j", async account => { const s = setup(); s.accounts.findById.mockResolvedValue(account); await fails(s, "meta_page_unavailable"); });
  it.each([null, { accessTokenEncrypted: null }, { tokenExpiresAt: now.toISOString() }, { tokenExpiresAt: "bad" }, { accessTokenEncrypted: "corrupted-secret" }])("rejects missing/expired/broken credential %j", async change => {
    const s = setup(); const original = await s.accounts.findMetaPublishingCredential(); s.accounts.findMetaPublishingCredential.mockResolvedValue(change === null ? null : { ...original, ...change }); await fails(s, "meta_token_invalid");
  });
  it.each([{ tasks: [] }, { tasks: null }, { tasks: "CREATE_CONTENT" }, { tasks: ["MANAGE"] }, { scopes: [] }])("rejects permission/task failure %j", async change => { const s = setup(); const original = await s.accounts.findMetaPublishingCredential(); s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...original, ...change }); await fails(s, "meta_permission_denied"); expect(s.decrypt.decryptSecret).not.toHaveBeenCalled(); });
  it("rejects a mismatched Instagram credential before decrypt or dispatch", async () => {
    const s = setup();
    const original = await s.accounts.findMetaPublishingCredential();
    s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...original, provider: "instagram" });
    await fails(s, "meta_page_unavailable");
    expect(s.decrypt.decryptSecret).not.toHaveBeenCalled();
  });
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

describe("Facebook Reel persisted steps", () => {
  async function setupReel(stage: LeasedPublicationOperation["stage"]) {
    const base = setup(); const root = await mkdtemp(join(tmpdir(), "fb-reel-"));
    await writeFile(join(root, "video.mp4"), "verified"); const handle = await open(join(root, "video.mp4"), "r");
    const target = { id: randomUUID(), postId: randomUUID(), tenantId: randomUUID(), socialAccountId: randomUUID() };
    const operation: LeasedPublicationOperation = { tenantId: target.tenantId, publicationId: target.id, mediaAssetId: randomUUID(), kind: "facebook_reel", stage,
      providerAccountId: "100", graphApiVersion: "v26.0", externalId: stage === "prepared" || stage === "creating" ? null : "200",
      leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + 330000), nextActionAt: now, deadlineAt: new Date(now.getTime() + 1800000),
      stageStartedAt: now, pollCount: 0, deliveryIssuedAt: null, deliveryExpiresAt: null, createdAt: now, updatedAt: now };
    const state = { ...operation }; let result: unknown;
    const operations = { checkpoint: vi.fn(async input => { if (input.expectedStage !== state.stage) return false;
      Object.assign(state, { stage: input.nextStage, nextActionAt: input.nextActionAt }, input.externalId ? { externalId: input.externalId } : {}); return true; }),
      complete: vi.fn(async input => { result = input.result; state.stage = input.result.status === "published" ? "succeeded" : input.result.unknown ? "unknown" : "failed"; return true; }),
      reserveStatusPoll: vi.fn(async () => { state.pollCount++; return true; }) };
    base.repository.findPostForPublication.mockResolvedValue({ authorUserId: "persisted-author", caption: "Reel", mediaAssetIds: [operation.mediaAssetId] });
    const close = vi.fn(() => handle.close()); const media = { ...base.media, openPublishingFile: vi.fn().mockResolvedValue({ handle, mimeType: "video/mp4", sizeBytes: 8, close }) };
    const client = { ...base.provider, startFacebookReel: vi.fn().mockResolvedValue({ videoId: "200" }), uploadFacebookReel: vi.fn().mockResolvedValue(undefined),
      finishFacebookReel: vi.fn().mockResolvedValue(undefined), getFacebookReelStatus: vi.fn().mockResolvedValue({ uploadingPhase: "complete", processingPhase: "not_started", publishingPhase: "not_started", published: false, uploadedBytes: 8, videoStatus: "upload_complete" }) };
    const service = new FacebookPublishingService(base.repository, base.accounts, cipher, media, client, () => now, operations);
    return { ...base, root, handle, target, operation, state, operations, media, client, close, service, result: () => result,
      step: () => service.advance({ target, operation }), cleanup: async () => { await handle.close(); await rm(root, { recursive: true, force: true }); } };
  }
  it.each(["prepared", "created", "ready"] as const)("performs one %s mutation behind intention and closes file", async stage => {
    const s = await setupReel(stage);
    try {
      if (stage === "created") s.client.uploadFacebookReel.mockImplementation(async input => {
        expect(s.state.stage).toBe("uploading"); const bytes = []; for await (const chunk of input.source) bytes.push(chunk);
        expect(Buffer.concat(bytes).toString()).toBe("verified");
      });
      await s.step();
      expect(s.state.stage).toBe(stage === "prepared" ? "created" : stage === "created" ? "processing" : "verifying");
      expect(s.close).toHaveBeenCalledTimes(1); expect(s.handle.fd).toBe(-1);
      expect(s.client.startFacebookReel).toHaveBeenCalledTimes(stage === "prepared" ? 1 : 0);
      expect(s.client.uploadFacebookReel).toHaveBeenCalledTimes(stage === "created" ? 1 : 0);
      expect(s.client.finishFacebookReel).toHaveBeenCalledTimes(stage === "ready" ? 1 : 0);
    } finally { await s.cleanup(); }
  });
  it("confirms upload and allows finish before processing has started", async () => {
    const s = await setupReel("processing"); try { await s.step(); expect(s.state.stage).toBe("ready"); expect(s.state.pollCount).toBe(1);
      expect(s.client.finishFacebookReel).not.toHaveBeenCalled(); } finally { await s.cleanup(); }
  });
  it("recovers crash during uploading by status of same ID without sending bytes", async () => {
    const s = await setupReel("uploading"); try { await s.step(); expect(s.state.stage).toBe("processing");
      expect(s.client.uploadFacebookReel).not.toHaveBeenCalled(); expect(s.client.getFacebookReelStatus).toHaveBeenCalledExactlyOnceWith({ graphApiVersion: "v26.0", accessToken: token, videoId: "200" });
    } finally { await s.cleanup(); }
  });
  it("partial upload without ongoing progress fails instead of resending", async () => {
    const s = await setupReel("uploading"); try {
      s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "not_started", processingPhase: "not_started", publishingPhase: "not_started", published: false, uploadedBytes: 3, videoStatus: "upload_failed" });
      await s.step(); expect(s.state.stage).toBe("failed"); expect(s.client.uploadFacebookReel).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });
  it.each(["publishing", "verifying"] as const)("confirms %s via official published flag without repeated finish", async stage => {
    const s = await setupReel(stage); try {
      s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "complete", processingPhase: "complete", publishingPhase: "complete", published: true, uploadedBytes: 8, videoStatus: "ready" });
      await s.step(); expect(s.result()).toEqual({ status: "published", providerPostId: "200" }); expect(s.client.finishFacebookReel).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });
  it("changed file aborts before start", async () => {
    const s = await setupReel("prepared"); try { s.media.openPublishingFile.mockRejectedValue(new Error("hash mismatch")); await s.step();
      expect(s.result()).toMatchObject({ code: "media_unavailable", unknown: false }); expect(s.client.startFacebookReel).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });
  it("unknown upload destroys its stream without owning the descriptor", async () => {
    const s = await setupReel("created"); try { s.client.uploadFacebookReel.mockImplementation(async input => { input.source.destroy();
      expect(s.handle.fd).not.toBe(-1); throw new MetaPublishingClientError("meta_timeout", "upload_facebook_reel", { outcome: "unknown" }); });
      await s.step(); expect(s.state.stage).toBe("uploading"); expect(s.close).toHaveBeenCalledTimes(1); expect(s.handle.fd).toBe(-1);
    } finally { await s.cleanup(); }
  });
});
