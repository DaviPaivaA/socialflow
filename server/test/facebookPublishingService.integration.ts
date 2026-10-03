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

describe.skipIf(!process.env.TEST_DATABASE_URL)("Facebook publication author and credentials (PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  beforeAll(async () => { fixture = await publicationFixture(); });
  afterAll(async () => { await fixture?.close(); });
  function setup() {
    const provider = { publishText: vi.fn().mockResolvedValue({ providerPostId: "100_200" }), publishPhoto: vi.fn() };
    const repository = new PostgresPostPublicationsRepository(fixture.pool);
    const service = new FacebookPublishingService(repository, new PostgresSocialAccountsRepository(fixture.pool), cipher, { getPublishingContent: vi.fn() }, provider, () => now);
    return { service, repository, provider };
  }
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
