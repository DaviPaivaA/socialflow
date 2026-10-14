import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { publicationFixture, cipher, token } from "./publicationFixtures.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { PostgresPublicationOperationsRepository } from "../src/publicationOperationsRepository.ts";
import { PostgresSocialAccountsRepository } from "../src/postgresSocialAccountsRepository.ts";
import { PostgresMediaAssetsRepository } from "../src/mediaAssetsRepository.ts";
import { MediaAssetsService } from "../src/mediaAssetsService.ts";
import { MetaMediaSigner } from "../src/metaMediaSigner.ts";
import { InstagramPublishingService } from "../src/instagramPublishingService.ts";
import { FacebookPublishingService } from "../src/facebookPublishingService.ts";
import { MetaPublishingDispatcher } from "../src/publishingService.ts";
import type { LeasedPublicationOperation } from "../src/publicationOperationsRepository.ts";
import { MetaPublishingClientError } from "../src/metaPublishingClient.ts";
import { asyncPublishingStubs } from "./metaPublishingClientStub.ts";

describe("Meta provider services isolated PostgreSQL/storage", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>; let root: string;
  beforeAll(async () => { fixture = await publicationFixture(); root = await mkdtemp(join(tmpdir(), "meta-steps-")); });
  afterAll(async () => { await fixture?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  async function setup(kind: LeasedPublicationOperation["kind"] = "instagram_image", sizeBytes = 8, videoBytes = 262144000, testFixture = fixture) {
    const post = await testFixture.post(1, new Date(Date.now() - 1000)); const target = post.publications[0]; const assetId = randomUUID();
    const image = kind === "instagram_image"; const bytes = Buffer.alloc(sizeBytes);
    (image ? Buffer.from([255,216,255,224,1,2,3,4]) : Buffer.from([0,0,0,20,102,116,121,112])).copy(bytes);
    const key = `${post.tenantId}/${assetId}.${image ? "jpg" : "mp4"}`;
    const mediaRepository = new PostgresMediaAssetsRepository(testFixture.pool);
    await mediaRepository.create({ tenantId: post.tenantId, authorUserId: post.authorUserId }, { id: assetId, mediaType: image ? "image" : "video",
      mimeType: image ? "image/jpeg" : "video/mp4", originalFilename: "media", sizeBytes, storageKey: key, sha256: createHash("sha256").update(bytes).digest("hex") });
    await mkdir(join(root, post.tenantId)); await writeFile(join(root, key), bytes);
    await testFixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, assetId]);
    if (kind !== "facebook_reel") {
      await testFixture.pool.query("UPDATE social_accounts SET account_type='instagram_business',metadata=$1 WHERE tenant_id=$2 AND id=$3", [JSON.stringify({ tasks: ["MANAGE"], pageId: "100" }), post.tenantId, target.socialAccountId]);
      await testFixture.pool.query("UPDATE oauth_connections SET scopes=$1 WHERE tenant_id=$2 AND id=$3", [["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"], post.tenantId, post.connectionId]);
    }
    const repository = new PostgresPostPublicationsRepository(testFixture.pool);
    let instant = new Date(); await repository.claimPost(post.tenantId, post.postId, instant);
    const operations = new PostgresPublicationOperationsRepository(testFixture.pool); const accounts = new PostgresSocialAccountsRepository(testFixture.pool);
    const media = new MediaAssetsService(mediaRepository, root, { imageBytes: Math.min(8000000, videoBytes), videoBytes });
    const client = { ...asyncPublishingStubs(), publishText: vi.fn().mockResolvedValue({ providerPostId: "100_900" }), publishPhoto: vi.fn(),
      createInstagramContainer: vi.fn().mockResolvedValue({ containerId: "200" }), getInstagramContainerStatus: vi.fn().mockResolvedValue({ status: "FINISHED" }),
      publishInstagramContainer: vi.fn().mockResolvedValue({ providerPostId: "300" }), startFacebookReel: vi.fn().mockResolvedValue({ videoId: "200" }),
      uploadFacebookReel: vi.fn(async input => { for await (const chunk of input.source) expect(chunk).toBeInstanceOf(Buffer); }),
      finishFacebookReel: vi.fn().mockResolvedValue(undefined), getFacebookReelStatus: vi.fn().mockResolvedValue({ uploadingPhase: "complete", processingPhase: "not_started", publishingPhase: "not_started", published: false, uploadedBytes: 8, videoStatus: "upload_complete" }) };
    const config = { publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 9), ttlSeconds: 3600 };
    const deps = { repository, accounts, cipher, media, client, operations, now: () => instant };
    const instagram = new InstagramPublishingService({ ...deps, signer: new MetaMediaSigner(config), config });
    const facebook = new FacebookPublishingService(repository, accounts, cipher, media, client, () => instant, operations);
    const dispatcher = new MetaPublishingDispatcher(deps, { instagram, facebook }, operations);
    async function lease() {
      const value = await operations.claimAction({ tenantId: target.tenantId, publicationId: target.id, now: instant });
      if (!value) throw new Error("Expected isolated operation lease"); return value;
    }
    async function row() { return (await testFixture.pool.query("SELECT * FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2", [target.tenantId, target.id])).rows[0]; }
    async function due() {
      await testFixture.pool.query("UPDATE publication_operations SET lease_token=NULL,lease_expires_at=NULL,next_action_at=clock_timestamp() WHERE tenant_id=$1 AND publication_id=$2", [target.tenantId, target.id]); instant = new Date();
    }
    async function advance() { instant = new Date(); await dispatcher.advance({ target, operation: await lease() }); }
    return { post, target, assetId, repository, operations, accounts, media, client, deps, instagram, facebook, dispatcher, lease, row, due, advance,
      setTime: (value: Date) => { instant = value; }, destination: async () => (await repository.listForPost(post.tenantId, post.postId))[0] };
  }
  it.each([
    ["instagram_image", 2_000_000, true], ["instagram_image", 8_000_000, true],
    ["instagram_image", 8_000_001, false], ["instagram_reel", 2_000_000, false],
  ] as const)("keeps image publication independent of the lower video ceiling: %s/%i", async (kind, size, accepted) => {
    const s = await setup(kind, size, 1_000_000); await s.advance();
    expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(accepted ? 1 : 0);
    if (accepted) expect(await s.row()).toMatchObject({ stage: "created", external_id: "200" });
    else expect(await s.destination()).toMatchObject({ status: "failed", errorCode: "media_unavailable", providerPostId: null });
  });
  it.each(["instagram_image", "instagram_reel"] as const)("persists complete %s flow and exact private delivery binding", async kind => {
    const s = await setup(kind); await s.advance(); const created = await s.row();
    expect(created).toMatchObject({ stage: "created", external_id: "200", poll_count: 0, lease_token: null });
    const url = new URL(s.client.createInstagramContainer.mock.calls[0][0].media.url);
    const payload = JSON.parse(Buffer.from(url.searchParams.get("ticket")!.split(".")[0], "base64url").toString());
    expect(created.delivery_issued_at.getTime()).toBe(payload.issuedAt * 1000); expect(created.delivery_expires_at.getTime()).toBe(payload.expiresAt * 1000);
    await s.due(); await s.advance(); expect((await s.row()).stage).toBe("processing");
    await s.due(); await s.advance(); expect((await s.row())).toMatchObject({ stage: "ready", poll_count: 1 });
    await s.advance(); expect(await s.destination()).toMatchObject({ status: "published", providerPostId: "300" });
    expect((await s.row()).stage).toBe("succeeded"); expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1); expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await s.destination())).not.toMatch(/ticket|private-page-token|container|external_id/);
  });
  it("persists FB start/upload/finish/status and finishes before processing starts", async () => {
    const s = await setup("facebook_reel"); await s.advance(); await s.due(); await s.advance();
    expect((await s.row()).stage).toBe("processing"); await s.due(); await s.advance(); expect((await s.row()).stage).toBe("ready");
    await s.advance(); expect((await s.row()).stage).toBe("verifying");
    s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "complete", processingPhase: "complete", publishingPhase: "complete", published: true, uploadedBytes: 8, videoStatus: "ready" });
    await s.due(); await s.advance(); expect(await s.destination()).toMatchObject({ status: "published", providerPostId: "200" });
    expect(s.client.startFacebookReel).toHaveBeenCalledTimes(1); expect(s.client.uploadFacebookReel).toHaveBeenCalledTimes(1); expect(s.client.finishFacebookReel).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["instagram_image", "processing"], ["instagram_reel", "publishing"], ["instagram_image", "verifying"],
    ["facebook_reel", "uploading"], ["facebook_reel", "processing"], ["facebook_reel", "publishing"], ["facebook_reel", "verifying"],
  ] as const)("keeps %s/%s GET cadence after crash without result checkpoint and restart at 31 seconds", async (kind, stage) => {
    const s = await setup(kind);
    await fixture.pool.query(`UPDATE publication_operations SET stage=$3,external_id='200',next_action_at=clock_timestamp()
      WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id, stage]);
    s.client.getInstagramContainerStatus.mockResolvedValue({ status: "IN_PROGRESS" });
    s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "in_progress", processingPhase: "not_started", publishingPhase: "not_started", published: false, uploadedBytes: 0, videoStatus: "processing" });
    const status = kind === "facebook_reel" ? s.client.getFacebookReelStatus : s.client.getInstagramContainerStatus;
    const lostCheckpoint = vi.spyOn(s.operations, "checkpoint").mockRejectedValueOnce(new Error("crash after GET before result checkpoint"));
    await expect(s.advance()).rejects.toMatchObject({ name: "PublicationOperationalError" });
    lostCheckpoint.mockRestore();
    expect(status).toHaveBeenCalledTimes(1);
    const reserved = await s.row();
    expect(reserved).toMatchObject({ stage, external_id: "200", poll_count: 1 });
    expect(reserved.lease_expires_at.getTime() - reserved.updated_at.getTime()).toBe(30000);

    // Translate the operation's whole timeline: real DB clock sees exactly 31 s elapsed,
    // preserving CHECKs and the gap between the lease and next permitted GET.
    async function elapse(seconds: number) {
      await fixture.pool.query(`UPDATE publication_operations SET
        created_at=created_at-($3 * interval '1 second'),updated_at=updated_at-($3 * interval '1 second'),
        stage_started_at=stage_started_at-($3 * interval '1 second'),deadline_at=deadline_at-($3 * interval '1 second'),
        lease_expires_at=lease_expires_at-($3 * interval '1 second'),next_action_at=next_action_at-($3 * interval '1 second')
        WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id, seconds]);
      s.setTime(new Date());
    }
    await elapse(31);
    const restartedOperations = new PostgresPublicationOperationsRepository(fixture.pool);
    const dependencies = { ...s.deps, operations: restartedOperations };
    const restarted = kind === "facebook_reel"
      ? new FacebookPublishingService(s.repository, s.accounts, cipher, s.media, s.client, dependencies.now, restartedOperations)
      : new InstagramPublishingService({ ...dependencies, signer: new MetaMediaSigner({ publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 9), ttlSeconds: 3600 }),
        config: { publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 9), ttlSeconds: 3600 } });
    const reclaim = () => restartedOperations.claimAction({ tenantId: s.target.tenantId, publicationId: s.target.id, now: new Date() });
    const early = await reclaim();
    if (early) await restarted.advance({ target: s.target, operation: early });
    expect(status).toHaveBeenCalledTimes(1);
    expect(early).toBeNull();
    expect(await reclaim()).toBeNull(); // no busy-loop lease acquisition while waiting
    expect(await Promise.all([reclaim(), reclaim(), reclaim()])).toEqual([null, null, null]);
    expect(reserved.next_action_at.getTime() - reserved.updated_at.getTime()).toBe(60000);
    expect((await s.row()).poll_count).toBe(1);

    await elapse(29.001);
    const contenders = await Promise.all([reclaim(), reclaim()]);
    expect(contenders.filter(Boolean)).toHaveLength(1);
    const resumed = contenders.find(value => value !== null)!;
    await restarted.advance({ target: s.target, operation: resumed });
    expect(status).toHaveBeenCalledTimes(2);
    expect((await s.row())).toMatchObject({ stage: stage === "publishing" ? "verifying" : stage, poll_count: 2, external_id: "200", lease_token: null });
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.startFacebookReel).not.toHaveBeenCalled(); expect(s.client.uploadFacebookReel).not.toHaveBeenCalled(); expect(s.client.finishFacebookReel).not.toHaveBeenCalled();
  });
  it.each(["instagram_image", "facebook_reel"] as const)("keeps the reserved GET floor across ready, publish intent and crash: %s", async kind => {
    const isolated = await publicationFixture();
    try {
      const s = await setup(kind, 8, 262144000, isolated);
      await isolated.pool.query("UPDATE publication_operations SET stage='processing',external_id='200',next_action_at=clock_timestamp() WHERE tenant_id=$1 AND publication_id=$2", [s.target.tenantId, s.target.id]);
      await s.advance();
      const ready = await s.row(); expect(ready).toMatchObject({ stage: "ready", poll_count: 1, lease_token: null });
      const deadline = ready.deadline_at.getTime();
      // Real SQL claim must allow the ready POST immediately, despite a future GET floor.
      const readyLease = (await s.operations.claimDueActions(new Date(), 1))[0];
      expect(readyLease?.stage).toBe("ready");
      const checkpoint = s.operations.checkpoint.bind(s.operations);
      const crash = kind === "instagram_image"
        ? vi.spyOn(s.operations, "complete").mockRejectedValueOnce(new Error("crash after publish before completion"))
        : vi.spyOn(s.operations, "checkpoint").mockImplementation(async input => {
          if (input.expectedStage === "publishing") throw new Error("crash after finish before verification checkpoint");
          return checkpoint(input);
        });
      try { await expect(s.dispatcher.advance({ target: s.target, operation: readyLease })).rejects.toMatchObject({ name: "PublicationOperationalError" }); }
      finally { crash.mockRestore(); }
      expect(await s.row()).toMatchObject({ stage: "publishing", external_id: "200", poll_count: 1 });
      const status = kind === "facebook_reel" ? s.client.getFacebookReelStatus : s.client.getInstagramContainerStatus;
      const publish = kind === "facebook_reel" ? s.client.finishFacebookReel : s.client.publishInstagramContainer;
      expect(status).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(1);
      expect((await s.row()).deadline_at.getTime()).toBe(deadline);
      async function elapse(seconds: number) {
        await isolated.pool.query(`UPDATE publication_operations SET
          created_at=created_at-($3 * interval '1 second'),updated_at=updated_at-($3 * interval '1 second'),
          stage_started_at=stage_started_at-($3 * interval '1 second'),deadline_at=deadline_at-($3 * interval '1 second'),
          lease_expires_at=lease_expires_at-($3 * interval '1 second'),next_action_at=next_action_at-($3 * interval '1 second')
          WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id, seconds]);
        s.setTime(new Date());
      }
      const operations = new PostgresPublicationOperationsRepository(isolated.pool);
      const config = { publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 9), ttlSeconds: 3600 };
      const dependencies = { ...s.deps, operations };
      const restarted = kind === "facebook_reel"
        ? new FacebookPublishingService(s.repository, s.accounts, cipher, s.media, s.client, dependencies.now, operations)
        : new InstagramPublishingService({ ...dependencies, signer: new MetaMediaSigner(config), config });
      const reclaim = () => operations.claimAction({ tenantId: s.target.tenantId, publicationId: s.target.id, now: new Date() });
      await elapse(31);
      const early = await reclaim(); if (early) await restarted.advance({ target: s.target, operation: early });
      expect(status).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(1);
      expect(early).toBeNull(); expect(await operations.claimDueActions(new Date(), 1)).toEqual([]);
      expect((await s.row()).poll_count).toBe(1);
      await elapse(29.1);
      s.client.getInstagramContainerStatus.mockResolvedValue({ status: "PUBLISHED" });
      s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "complete", processingPhase: "complete", publishingPhase: "complete", published: true, uploadedBytes: 8, videoStatus: "ready" });
      const recovered = await reclaim(); expect(recovered?.stage).toBe("publishing");
      await restarted.advance({ target: s.target, operation: recovered });
      expect(status).toHaveBeenCalledTimes(2); expect(publish).toHaveBeenCalledTimes(1);
      expect(await s.destination()).toMatchObject({ status: "published", providerPostId: kind === "facebook_reel" ? "200" : null });
      expect(await s.row()).toMatchObject({ stage: "succeeded", poll_count: 2 });
      expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect(s.client.startFacebookReel).not.toHaveBeenCalled();
      expect(s.client.uploadFacebookReel).not.toHaveBeenCalled();
    } finally { await isolated.close(); }
  });
  it("does not mutate tenant B when target and operation belong to different tenants", async () => {
    const a = await setup(); const b = await setup(); const lease = await b.lease();
    await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [a.post.tenantId, a.post.authorUserId]);
    await expect(a.dispatcher.advance({ target: a.target, operation: lease })).rejects.toMatchObject({ name: "PublicationOperationalError" });
    expect((await b.row()).stage).toBe("prepared"); expect((await b.destination()).status).toBe("publishing");
  });
  it.each(["creating", "uploading", "publishing"] as const)("response lost before %s result persistence never repeats mutation", async stage => {
    const s = await setup(stage === "uploading" ? "facebook_reel" : "instagram_image");
    if (stage !== "creating") { await s.advance(); await s.due(); }
    if (stage === "publishing") { await s.advance(); await s.due(); await s.advance(); }
    const checkpoint = vi.spyOn(s.operations, "checkpoint"); const complete = vi.spyOn(s.operations, "complete");
    if (stage === "publishing") complete.mockRejectedValueOnce(new Error("after-media-id-private"));
    else checkpoint.mockImplementationOnce(async input => {
      const ok = await PostgresPublicationOperationsRepository.prototype.checkpoint.call(s.operations, input); return ok;
    }).mockRejectedValueOnce(new Error("after-provider-private"));
    await expect(s.advance()).rejects.toMatchObject({ name: "PublicationOperationalError" });
    expect((await s.row()).stage).toBe(stage); expect((await s.destination()).status).toBe("publishing");
    checkpoint.mockRestore(); complete.mockRestore(); await s.due();
    if (stage === "creating") {
      const lease = await s.lease(); s.setTime(new Date(lease.stageStartedAt.getTime() + 600000));
      await s.instagram.advance({ target: s.target, operation: lease }); expect((await s.destination()).errorCode).toBe("publication_state_unknown");
      expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
    } else if (stage === "uploading") {
      await s.advance(); expect((await s.row()).stage).toBe("processing"); expect(s.client.uploadFacebookReel).toHaveBeenCalledTimes(1); expect(s.client.getFacebookReelStatus.mock.calls[0][0].videoId).toBe("200");
    } else {
      s.client.getInstagramContainerStatus.mockResolvedValue({ status: "PUBLISHED" }); await s.advance();
      expect(await s.destination()).toMatchObject({ status: "published", providerPostId: null }); expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(1);
    }
  });
  it.each(["prepared", "publishing"] as const)("does not substitute another member for removed persisted author in %s", async stage => {
    const s = await setup(); const other = await setup();
    if (stage === "publishing") {
      await s.advance(); await s.due(); await s.advance(); await s.due(); await s.advance();
      s.client.publishInstagramContainer.mockRejectedValue(new MetaPublishingClientError("meta_timeout", "publish_instagram_container", { outcome: "unknown" })); await s.advance(); await s.due();
    }
    await fixture.pool.query("INSERT INTO tenant_members (tenant_id,user_id,role) VALUES ($1,$2,'owner')", [s.post.tenantId, other.post.authorUserId]);
    await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [s.post.tenantId, s.post.authorUserId]);
    await s.advance(); expect(await s.destination()).toMatchObject({ status: "failed", errorCode: stage === "prepared" ? "publication_author_unavailable" : "publication_state_unknown" });
    expect(s.client.getInstagramContainerStatus).toHaveBeenCalledTimes(stage === "prepared" ? 0 : 1);
    expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(stage === "prepared" ? 0 : 1);
  });
  it.each(["expired-token", "elapsed-budget", "aborted"])("does not emit after intent CAS wait crosses %s", async loss => {
    const s = await setup(); const lease = await s.lease(); const controller = new AbortController();
    if (loss === "expired-token") await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at=clock_timestamp()+interval '10 seconds' WHERE tenant_id=$1 AND social_account_id=$2", [s.target.tenantId, s.target.socialAccountId]);
    vi.spyOn(s.operations, "checkpoint").mockImplementationOnce(async input => {
      const ok = await PostgresPublicationOperationsRepository.prototype.checkpoint.call(s.operations, input);
      if (loss === "aborted") controller.abort(); else s.setTime(new Date(Date.now() + (loss === "expired-token" ? 11000 : 301000)));
      return ok;
    });
    await s.instagram.advance({ target: s.target, operation: lease, signal: controller.signal });
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect((await s.row()).stage).toBe("creating");
  });
  it("lease stolen while hashing closes late file and suppresses provider effects", async () => {
    const s = await setup(); const lease = await s.lease(); const verified = await s.media.openPublishingFile({ tenantId: s.post.tenantId, authorUserId: s.post.authorUserId }, s.assetId);
    let resolve!: (value: typeof verified) => void;
    vi.spyOn(s.media, "openPublishingFile").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = s.instagram.advance({ target: s.target, operation: lease }); await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await fixture.pool.query("UPDATE publication_operations SET lease_token=$1 WHERE tenant_id=$2 AND publication_id=$3", [randomUUID(), s.target.tenantId, s.target.id]);
    resolve(verified); await pending;
    expect(verified.handle.fd).toBe(-1); expect((await s.row()).stage).toBe("prepared"); expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
  });
  it.each(["budget", "deadline", "expired-lease"])("pending hash crossing %s closes its handle without persisting intent", async loss => {
    const s = await setup(); const lease = await s.lease();
    const verified = await s.media.openPublishingFile({ tenantId: s.post.tenantId, authorUserId: s.post.authorUserId }, s.assetId);
    let resolve!: (value: typeof verified) => void;
    vi.spyOn(s.media, "openPublishingFile").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = s.instagram.advance({ target: s.target, operation: lease });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    try {
      if (loss === "expired-lease") await fixture.pool.query("UPDATE publication_operations SET lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE tenant_id=$1 AND publication_id=$2", [s.target.tenantId, s.target.id]);
      else s.setTime(new Date(loss === "budget" ? Date.now() + 300001 : lease.deadlineAt.getTime() + 1));
      resolve(verified); await pending;
      expect(verified.handle.fd).toBe(-1); expect((await s.row()).stage).toBe("prepared");
      expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    } finally { resolve(verified); await pending; await verified.close(); }
  });
  it("a 299-second hash persists intent, renews the Graph lease and emits once", async () => {
    const s = await setup(); const lease = await s.lease();
    expect(lease.leaseExpiresAt.getTime() - Date.now()).toBeGreaterThan(329000);
    const verified = await s.media.openPublishingFile({ tenantId: s.post.tenantId, authorUserId: s.post.authorUserId }, s.assetId);
    let resolve!: (value: typeof verified) => void;
    vi.spyOn(s.media, "openPublishingFile").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    s.client.createInstagramContainer.mockImplementationOnce(async () => {
      const intent = await s.row(); expect(intent.stage).toBe("creating");
      expect(intent.lease_token).toBe(lease.leaseToken);
      expect(intent.lease_expires_at.getTime() - Date.now()).toBeGreaterThan(29000);
      expect(intent.lease_expires_at.getTime() - Date.now()).toBeLessThanOrEqual(30000);
      return { containerId: "200" };
    });
    const pending = s.instagram.advance({ target: s.target, operation: lease });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); s.setTime(new Date(Date.now() + 299000));
    resolve(verified); await pending;
    expect(verified.handle.fd).toBe(-1); expect((await s.row())).toMatchObject({ stage: "created", external_id: "200" });
    expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
  });
  it.each(["scope", "task", "token", "author"])("revalidates current %s after pending hash before intent", async loss => {
    const s = await setup(); const lease = await s.lease();
    const verified = await s.media.openPublishingFile({ tenantId: s.post.tenantId, authorUserId: s.post.authorUserId }, s.assetId);
    let resolve!: (value: typeof verified) => void;
    vi.spyOn(s.media, "openPublishingFile").mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = s.instagram.advance({ target: s.target, operation: lease });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (loss === "scope") await fixture.pool.query("UPDATE oauth_connections SET scopes='{}' WHERE tenant_id=$1 AND id=$2", [s.post.tenantId, s.post.connectionId]);
    if (loss === "task") await fixture.pool.query("UPDATE social_accounts SET metadata='{}' WHERE tenant_id=$1 AND id=$2", [s.target.tenantId, s.target.socialAccountId]);
    if (loss === "token") await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND social_account_id=$2", [s.target.tenantId, s.target.socialAccountId]);
    if (loss === "author") await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [s.post.tenantId, s.post.authorUserId]);
    resolve(verified); await pending;
    expect(verified.handle.fd).toBe(-1); expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    expect(await s.destination()).toMatchObject({ status: "failed", errorCode: loss === "author" ? "publication_author_unavailable" : loss === "token" ? "meta_token_invalid" : "meta_permission_denied" });
  });
  it("changed same-size file fails before mutation with safe public error", async () => {
    const s = await setup(); await writeFile(join(root, s.post.tenantId, `${s.assetId}.jpg`), Buffer.from([255,216,255,224,5,6,7,8]));
    await s.advance(); expect(await s.destination()).toMatchObject({ status: "failed", errorCode: "media_unavailable" });
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect(JSON.stringify(await s.destination())).not.toMatch(new RegExp(`${root}|${token}`));
  });
});
