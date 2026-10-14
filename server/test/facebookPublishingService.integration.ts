import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaAssetsService } from "../src/mediaAssetsService.ts";
import { PostgresMediaAssetsRepository } from "../src/mediaAssetsRepository.ts";
import { PublicationCoordinator } from "../src/publicationCoordinator.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FacebookPublishingService } from "../src/facebookPublishingService.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { PostgresSocialAccountsRepository } from "../src/postgresSocialAccountsRepository.ts";
import { cipher, now, publicationFixture } from "./publicationFixtures.ts";
import { asyncPublishingStubs } from "./metaPublishingClientStub.ts";
import { MetaPublishingClientError } from "../src/metaPublishingClient.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Facebook publication author and credentials (PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  beforeAll(async () => { fixture = await publicationFixture(); });
  afterAll(async () => { await fixture?.close(); });
  function setup() {
    const provider = { ...asyncPublishingStubs(), publishText: vi.fn().mockResolvedValue({ providerPostId: "100_200" }), publishPhoto: vi.fn() };
    const repository = new PostgresPostPublicationsRepository(fixture.pool);
    const service = new FacebookPublishingService(repository, new PostgresSocialAccountsRepository(fixture.pool), cipher, { getPublishingContent: vi.fn() }, provider, () => now);
    return { service, repository, provider };
  }
  it.each(["text", "photo"] as const)("ambiguous legacy %s terminates unknown in stale sweep without retry", async kind => {
    const s = setup(); const post = await fixture.post();
    let service = s.service;
    if (kind === "photo") {
      const id = randomUUID(); const mediaRepository = new PostgresMediaAssetsRepository(fixture.pool);
      await mediaRepository.create({ tenantId: post.tenantId, authorUserId: post.authorUserId }, { id, mediaType: "image", mimeType: "image/jpeg", originalFilename: "image.jpg", sizeBytes: 8, sha256: "a".repeat(64), storageKey: `${post.tenantId}/${id}.jpg` });
      await fixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, id]);
      service = new FacebookPublishingService(s.repository, new PostgresSocialAccountsRepository(fixture.pool), cipher,
        { getPublishingContent: vi.fn().mockResolvedValue({ source: new Blob(["verified"]), mimeType: "image/jpeg", sizeBytes: 8 }) }, s.provider, () => now);
    }
    const mutation = kind === "text" ? s.provider.publishText : s.provider.publishPhoto;
    mutation.mockRejectedValue(new MetaPublishingClientError("meta_timeout", kind === "text" ? "publish_text" : "publish_photo", { outcome: "unknown" }));
    const coordinator = new PublicationCoordinator(s.repository, service, { now: () => now });
    await coordinator.publishDueBatch(now); await coordinator.publishDueBatch(now);
    expect((await s.repository.listForPost(post.tenantId, post.postId))[0].status).toBe("publishing");
    await coordinator.failStale(new Date(now.getTime() + 601000));
    expect((await s.repository.listForPost(post.tenantId, post.postId))[0]).toMatchObject({ status: "failed", errorCode: "publication_state_unknown" });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect((await fixture.pool.query("SELECT 1 FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2", [post.tenantId, post.publications[0].id])).rowCount).toBe(0);
  });
  it.each(["same size", "different size"])("terminally fails changed scheduled media (%s) without provider calls", async mode => {
    const root = await mkdtemp(join(tmpdir(), "publication-integrity-"));
    try {
      const post = await fixture.post();
      const id = randomUUID();
      const bytes = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
      const mediaRepository = new PostgresMediaAssetsRepository(fixture.pool);
      await mediaRepository.create({ tenantId: post.tenantId, authorUserId: post.authorUserId }, { id, mediaType: "image", mimeType: "image/jpeg", originalFilename: "image.jpg", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storageKey: `${post.tenantId}/${id}.jpg` });
      await fixture.pool.query("INSERT INTO post_media (tenant_id, post_id, media_asset_id, position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, id]);
      await mkdir(join(root, post.tenantId));
      await writeFile(join(root, post.tenantId, `${id}.jpg`), mode === "same size" ? Buffer.from([255,216,255,224,5,6,7,8]) : Buffer.concat([bytes, Buffer.from([9])]));
      const s = setup();
      const media = new MediaAssetsService(mediaRepository, root, { imageBytes: 4000000, videoBytes: 4000000 });
      const service = new FacebookPublishingService(s.repository, new PostgresSocialAccountsRepository(fixture.pool), cipher, media, s.provider, () => now);
      await new PublicationCoordinator(s.repository, service, { now: () => now }).publishPostNow(post.tenantId, post.postId);
      const [destination] = await s.repository.listForPost(post.tenantId, post.postId);
      expect(destination).toMatchObject({ status: "failed", errorCode: "media_unavailable" });
      expect(JSON.stringify(destination)).not.toContain(root);
      expect(s.provider.publishText).not.toHaveBeenCalled();
      expect(s.provider.publishPhoto).not.toHaveBeenCalled();
      expect(await s.repository.claimPost(post.tenantId, post.postId, now)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each([
    ["account", "meta_page_unavailable"], ["membership", "publication_author_unavailable"],
    ["scopes", "meta_permission_denied"], ["task", "meta_permission_denied"], ["token", "meta_token_invalid"],
    ["rotated-token", null],
  ] as const)("revalidates persisted %s after pending legacy photo I/O", async (change, code) => {
    const s = setup(); const post = await fixture.post(); const target = post.publications[0]; const assetId = randomUUID();
    const mediaRepository = new PostgresMediaAssetsRepository(fixture.pool);
    await mediaRepository.create({ tenantId: post.tenantId, authorUserId: post.authorUserId }, { id: assetId, mediaType: "image", mimeType: "image/jpeg", originalFilename: "image.jpg", sizeBytes: 8, sha256: "a".repeat(64), storageKey: `${post.tenantId}/${assetId}.jpg` });
    await fixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, assetId]);
    const other = await fixture.post();
    if (change === "membership") await fixture.pool.query("INSERT INTO tenant_members (tenant_id,user_id,role) VALUES ($1,$2,'owner')", [post.tenantId, other.authorUserId]);
    let instant = now;
    if (change === "token") await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at=$1 WHERE tenant_id=$2 AND social_account_id=$3", [new Date(now.getTime() + 1000), target.tenantId, target.socialAccountId]);
    await s.repository.claimPost(post.tenantId, post.postId, now);
    let resolve!: (content: { source: Blob; mimeType: string; sizeBytes: number }) => void;
    const media = { getPublishingContent: vi.fn(() => new Promise<{ source: Blob; mimeType: string; sizeBytes: number }>(done => { resolve = done; })) };
    s.provider.publishPhoto.mockResolvedValue({ providerPostId: "100_300" });
    const service = new FacebookPublishingService(s.repository, new PostgresSocialAccountsRepository(fixture.pool), cipher, media, s.provider, () => instant);
    const pending = service.publish(target).then(() => null, error => error);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const source = new Blob(["verified"]);
    try {
      if (change === "account") await fixture.pool.query("UPDATE social_accounts SET is_active=false,disconnected_at=$1 WHERE tenant_id=$2 AND id=$3", [now, target.tenantId, target.socialAccountId]);
      if (change === "membership") await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [post.tenantId, post.authorUserId]);
      if (change === "scopes") await fixture.pool.query("UPDATE oauth_connections SET scopes='{}' WHERE tenant_id=$1 AND id=$2", [post.tenantId, post.connectionId]);
      if (change === "task") await fixture.pool.query("UPDATE social_accounts SET metadata='{}' WHERE tenant_id=$1 AND id=$2", [target.tenantId, target.socialAccountId]);
      if (change === "token") instant = new Date(now.getTime() + 1001);
      if (change === "rotated-token") await fixture.pool.query("UPDATE social_account_credentials SET access_token_encrypted=$1 WHERE tenant_id=$2 AND social_account_id=$3", [Buffer.from(cipher.encryptSecret("rotated-page-token")), target.tenantId, target.socialAccountId]);
      resolve({ source, mimeType: "image/jpeg", sizeBytes: 8 });
      const result = await pending;
      if (code) {
        expect(result).toMatchObject({ name: "PublicationError", code });
        expect(s.provider.publishPhoto).not.toHaveBeenCalled();
        expect((await s.repository.listForPost(post.tenantId, post.postId))[0]).toMatchObject({ status: "publishing", providerPostId: null });
      } else {
        expect(result).toBeNull();
        expect(s.provider.publishPhoto).toHaveBeenCalledExactlyOnceWith({ pageId: "100", accessToken: "rotated-page-token", message: "Message", source, mimeType: "image/jpeg" });
        expect((await s.repository.listForPost(post.tenantId, post.postId))[0]).toMatchObject({ status: "published", providerPostId: "100_300" });
      }
      expect(s.provider.publishText).not.toHaveBeenCalled();
      expect((await s.repository.listForPost(other.tenantId, other.postId))[0]).toMatchObject({ status: "scheduled", providerPostId: null });
      expect((await fixture.pool.query("SELECT 1 FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2", [target.tenantId, target.id])).rowCount).toBe(0);
    } finally { resolve({ source, mimeType: "image/jpeg", sizeBytes: 8 }); await pending; }
  });
  it("publishes scheduler claim with persisted author, rejects removed membership even when another member exists", async () => {
    const s = setup(); const post = await fixture.post();
    await s.repository.claimPost(post.tenantId, post.postId, now);
    await s.service.publish(post.publications[0]);
    expect((await s.repository.listForPost(post.tenantId, post.postId))[0].status).toBe("published");
    const revoked = await fixture.post(); const other = await fixture.post();
    await fixture.pool.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [revoked.tenantId, other.authorUserId]);
    await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [revoked.tenantId, revoked.authorUserId]);
    await s.repository.claimPost(revoked.tenantId, revoked.postId, now);
    await expect(s.service.publish(revoked.publications[0])).rejects.toMatchObject({ code: "publication_author_unavailable" });
    expect(s.provider.publishText).toHaveBeenCalledTimes(1);
    expect((await s.repository.listForPost(revoked.tenantId, revoked.postId))[0].status).toBe("publishing");
  });
  it("hides foreign posts/accounts identically to nonexistent records", async () => {
    const s = setup(); const a = await fixture.post(); const b = await fixture.post();
    await expect(s.service.publish({ ...a.publications[0], postId: b.postId })).rejects.toMatchObject({ code: "publication_unavailable" });
    await expect(s.service.publish({ ...a.publications[0], socialAccountId: b.publications[0].socialAccountId })).rejects.toMatchObject({ code: "meta_page_unavailable" });
    expect(s.provider.publishText).not.toHaveBeenCalled();
  });
  it.each([{}, { tasks: "CREATE_CONTENT" }, { tasks: [7] }])("denies malformed/missing persisted task metadata %j", async metadata => {
    const s = setup(); const post = await fixture.post();
    await fixture.pool.query("UPDATE social_accounts SET metadata=$1 WHERE id=$2", [JSON.stringify(metadata), post.publications[0].socialAccountId]);
    await expect(s.service.publish(post.publications[0])).rejects.toMatchObject({ code: "meta_permission_denied" });
    expect(s.provider.publishText).not.toHaveBeenCalled();
  });
  it("rejects expired persisted token", async () => {
    const s = setup(); const post = await fixture.post();
    await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at=$1 WHERE social_account_id=$2", [now, post.publications[0].socialAccountId]);
    await expect(s.service.publish(post.publications[0])).rejects.toMatchObject({ code: "meta_token_invalid" });
    expect(s.provider.publishText).not.toHaveBeenCalled();
  });
});
