import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicationFixture, cipher } from "./publicationFixtures.ts";
import { asyncPublishingStubs } from "./metaPublishingClientStub.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { PostgresPublicationOperationsRepository } from "../src/publicationOperationsRepository.ts";
import { PostgresSocialAccountsRepository } from "../src/postgresSocialAccountsRepository.ts";
import { PostgresMediaAssetsRepository } from "../src/mediaAssetsRepository.ts";
import { MediaAssetsService } from "../src/mediaAssetsService.ts";
import { MetaMediaSigner } from "../src/metaMediaSigner.ts";
import { InstagramPublishingService } from "../src/instagramPublishingService.ts";
import { FacebookPublishingService } from "../src/facebookPublishingService.ts";
import { MetaPublishingDispatcher, type PublishingStep } from "../src/publishingService.ts";
import { PublicationCoordinator } from "../src/publicationCoordinator.ts";
import type { PublicationOperationKind, PublicationOperationStage } from "../src/publicationOperationsRepository.ts";
import { createApiServer } from "../src/app.ts";
import { MetaPublishingClientError } from "../src/metaPublishingClient.ts";
import { PublicationScheduler } from "../src/publicationScheduler.ts";

describe("coordinator restart and concurrent recovery (isolated PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>; let root: string;
  beforeEach(async () => { fixture = await publicationFixture(); root = await mkdtemp(join(tmpdir(), "meta-resume-")); });
  afterEach(async () => { await fixture?.close(); if (root) await rm(root, { recursive: true, force: true }); });

  async function setup(kind: PublicationOperationKind = "instagram_image", destinationCount = 1) {
    const post = await fixture.post(destinationCount, new Date(Date.now() - 1000)); const target = post.publications[0];
    const assetId = randomUUID(); const image = kind === "instagram_image";
    const bytes = image ? Buffer.from([255,216,255,224,1,2,3,4]) : Buffer.from([0,0,0,20,102,116,121,112]);
    const key = `${post.tenantId}/${assetId}.${image ? "jpg" : "mp4"}`;
    const mediaRepository = new PostgresMediaAssetsRepository(fixture.pool);
    await mediaRepository.create({ tenantId: post.tenantId, authorUserId: post.authorUserId }, {
      id: assetId, mediaType: image ? "image" : "video", mimeType: image ? "image/jpeg" : "video/mp4",
      originalFilename: "media", sizeBytes: bytes.length, storageKey: key, sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    await mkdir(join(root, post.tenantId)); await writeFile(join(root, key), bytes);
    await fixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, assetId]);
    if (kind !== "facebook_reel") {
      await fixture.pool.query("UPDATE social_accounts SET account_type='instagram_business',metadata=$1 WHERE tenant_id=$2", [JSON.stringify({ tasks: ["MANAGE"], pageId: "100" }), post.tenantId]);
      await fixture.pool.query("UPDATE oauth_connections SET scopes=$1 WHERE tenant_id=$2 AND id=$3", [["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"], post.tenantId, post.connectionId]);
    }
    const repository = new PostgresPostPublicationsRepository(fixture.pool, "v25.0");
    const operations = new PostgresPublicationOperationsRepository(fixture.pool);
    const accounts = new PostgresSocialAccountsRepository(fixture.pool);
    const media = new MediaAssetsService(mediaRepository, root, { imageBytes: 8000000, videoBytes: 262144000 });
    const client = { ...asyncPublishingStubs(), publishText: vi.fn().mockResolvedValue({ providerPostId: "100_900" }), publishPhoto: vi.fn(),
      createInstagramContainer: vi.fn().mockResolvedValue({ containerId: "200" }), getInstagramContainerStatus: vi.fn().mockResolvedValue({ status: "FINISHED" }),
      publishInstagramContainer: vi.fn().mockResolvedValue({ providerPostId: "300" }), startFacebookReel: vi.fn().mockResolvedValue({ videoId: "200" }),
      uploadFacebookReel: vi.fn(async input => { for await (const chunk of input.source) expect(chunk).toBeInstanceOf(Buffer); }),
      finishFacebookReel: vi.fn().mockResolvedValue(undefined), getFacebookReelStatus: vi.fn().mockResolvedValue({ uploadingPhase: "complete", processingPhase: "not_started", publishingPhase: "not_started", published: false, uploadedBytes: 8, videoStatus: "upload_complete" }) };
    const config = { publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 9), ttlSeconds: 3600 };
    function coordinator(selectedOperations = operations) {
      const dependencies = { repository, accounts, cipher, media, client, operations: selectedOperations };
      const instagram = new InstagramPublishingService({ ...dependencies, signer: new MetaMediaSigner(config), config });
      const facebook = new FacebookPublishingService(repository, accounts, cipher, media, client, undefined, selectedOperations);
      const dispatcher = new MetaPublishingDispatcher(dependencies, { instagram, facebook }, selectedOperations);
      return new PublicationCoordinator(repository, dispatcher, { operations: selectedOperations, waitTimeoutMs: 0 });
    }
    async function prepared() { await repository.claimPost(post.tenantId, post.postId, new Date()); }
    async function stage(value: PublicationOperationStage) {
      await prepared();
      await fixture.pool.query(`UPDATE publication_operations SET stage=$3,external_id=CASE WHEN $3='creating' THEN NULL ELSE '200' END,
        lease_token=NULL,lease_expires_at=NULL,next_action_at=clock_timestamp() WHERE tenant_id=$1 AND publication_id=$2`, [target.tenantId, target.id, value]);
    }
    async function row() { return (await fixture.pool.query("SELECT * FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2", [target.tenantId, target.id])).rows[0]; }
    async function due() { await fixture.pool.query("UPDATE publication_operations SET lease_token=NULL,lease_expires_at=NULL,next_action_at=clock_timestamp() WHERE tenant_id=$1 AND publication_id=$2", [target.tenantId, target.id]); }
    async function run(runner = coordinator()) { await runner.publishDueBatch(new Date()); await runner.whenIdle(); }
    return { post, target, repository, operations, media, client, coordinator, prepared, stage, row, due, run,
      destination: async () => (await repository.listForPost(post.tenantId, post.postId))[0] };
  }

  function api(s: Awaited<ReturnType<typeof setup>>, capability = true) {
    return createApiServer({ pool: fixture.pool, corsOrigin: "http://localhost:5173",
      authRateLimit: { maxAttempts: 1000, windowMs: 60000 }, sessionCookie: { maxAgeSeconds: 3600, sameSite: "Lax", secure: false },
      sessionTtlSeconds: 3600, socialTokenCipher: cipher, mediaStoragePath: root, metaPublishingClient: s.client,
      metaOAuth: { enabled: true, appId: "100", appSecret: "fixture-secret", graphApiVersion: "v25.0", redirectUri: "https://app.example.test/oauth/callback", stateTtlSeconds: 600 },
      ...(capability ? { metaMedia: { publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 9), ttlSeconds: 3600 } } : {}),
    });
  }

  it.each([[3, 2], [2, 3]])("alternates classes with %i scheduled and %i resumable destinations, falling back when empty", async (newCount, readyCount) => {
    const scheduled = [];
    for (let i = 0; i < newCount; i++) scheduled.push(await fixture.post(1, new Date(Date.now() - 1000)));
    const resumable = [];
    for (let i = 0; i < readyCount; i++) { const s = await setup(); await s.stage("ready"); resumable.push(s); }
    const s = resumable[0]; const seen: string[] = [];
    const identifiers: string[] = [];
    const commonDue = new Date(Date.now() - 1000);
    await fixture.pool.query("UPDATE posts SET scheduled_for=$1", [commonDue]);
    await fixture.pool.query("UPDATE publication_operations SET next_action_at=$1", [commonDue]);
    let release!: () => void; let pending = new Promise<void>(resolve => { release = resolve; });
    const runner = new PublicationCoordinator(s.repository, { advance: async ({ target, operation }: PublishingStep) => {
      seen.push(operation ? "operation" : "scheduled"); identifiers.push(`${target.tenantId}:${target.id}`); await pending;
      if (operation) await s.operations.complete({ lease: operation, now: new Date(), result: { status: "failed", code: "meta_processing_timeout", message: "Tempo esgotado", unknown: false } });
      else await s.repository.markPublished({ ...target, providerPostId: "100_900", publishedAt: new Date() });
    } }, { operations: s.operations });
    await runner.publishDueBatch(new Date());
    try { expect(seen).toEqual(["scheduled", "operation"]); }
    finally { release(); pending = Promise.resolve(); }
    if (typeof runner.whenIdle === "function") await runner.whenIdle();
    for (let i = 0; i < 3; i++) { await runner.publishDueBatch(new Date()); await runner.whenIdle(); }
    expect(seen).toEqual(newCount === 3 ? ["scheduled", "operation", "scheduled", "operation", "scheduled"] : ["scheduled", "operation", "scheduled", "operation", "operation"]);
    expect(identifiers.filter((_, index) => seen[index] === "scheduled")).toEqual(scheduled.map(post => `${post.tenantId}:${post.publications[0].id}`).sort());
    expect(identifiers.filter((_, index) => seen[index] === "operation")).toEqual(resumable.map(item => `${item.target.tenantId}:${item.target.id}`).sort());
  });

  it.each(["processing", "publishing", "creating"] as const)("sweeps %s deadline independently of a future poll floor without provider requests", async stage => {
    const s = await setup(); await s.stage(stage);
    await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '31 minutes',
      stage_started_at=statement_timestamp()-interval '31 minutes',deadline_at=clock_timestamp()-interval '1 second',
      updated_at=clock_timestamp(),next_action_at=clock_timestamp()+interval '59 seconds' WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
    await s.coordinator().failStale(new Date());
    expect(await s.destination()).toMatchObject({ status: "failed", errorCode: stage === "processing" ? "meta_processing_timeout" : "publication_state_unknown" });
    expect((await s.row()).stage).toBe(stage === "processing" ? "failed" : "unknown");
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
  });

  it("never sends legacy when an operation exists but another owner acquired its lease", async () => {
    const s = await setup();
    const claimDue = s.repository.claimDue.bind(s.repository);
    vi.spyOn(s.repository, "claimDue").mockImplementationOnce(async (at, limit) => {
      const targets = await claimDue(at, limit);
      await s.operations.claimAction({ tenantId: s.target.tenantId, publicationId: s.target.id, now: new Date() });
      return targets;
    });
    await s.run();
    expect(await s.destination()).toMatchObject({ status: "publishing", errorCode: null });
    expect((await s.row()).stage).toBe("prepared");
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.publishPhoto).not.toHaveBeenCalled();
    expect(s.client.publishText).not.toHaveBeenCalled();
  });

  it("does not block a second destination when another process wins the first operation lease", async () => {
    const s = await setup("instagram_image", 2);
    const claimPost = s.repository.claimPost.bind(s.repository);
    let foreignId: string | undefined;
    vi.spyOn(s.repository, "claimPost").mockImplementationOnce(async (tenantId, postId, at, limit) => {
      const targets = await claimPost(tenantId, postId, at, limit); foreignId = targets[0].id;
      await s.operations.claimAction({ tenantId, publicationId: foreignId, now: new Date() });
      return targets;
    });
    const runner = s.coordinator();
    await runner.publishPostNow(s.target.tenantId, s.target.postId); await runner.whenIdle();
    const destinations = await s.repository.listForPost(s.target.tenantId, s.target.postId);
    expect(destinations.find(row => row.id !== foreignId)?.status).toBe("publishing");
    expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
    expect(s.client.publishPhoto).not.toHaveBeenCalled();
  });

  it("sweeps a future poll-floor deadline while both action slots are occupied", async () => {
    const s = await setup(); await s.stage("processing");
    await fixture.post(2, new Date(Date.now() - 1000));
    await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '31 minutes',
      stage_started_at=statement_timestamp()-interval '31 minutes',deadline_at=clock_timestamp()-interval '1 second',
      updated_at=clock_timestamp(),next_action_at=clock_timestamp()+interval '59 seconds' WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    let actions = 0;
    const runner = new PublicationCoordinator(s.repository, { advance: async () => { actions++; await pending; } }, { operations: s.operations });
    try {
      await runner.publishDueBatch(new Date());
      expect(actions).toBe(2);
      await runner.failStale(new Date());
      expect(await s.destination()).toMatchObject({ status: "failed", errorCode: "meta_processing_timeout" });
      expect(actions).toBe(2);
      expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
    } finally { release(); await runner.whenIdle(); }
  });

  it("does not steal a valid lease at deadline and fences its late response after expiry", async () => {
    const s = await setup(); await s.stage("publishing");
    await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '31 minutes',
      stage_started_at=statement_timestamp()-interval '31 minutes',deadline_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
    const lease = (await s.operations.claimAction({ tenantId: s.target.tenantId, publicationId: s.target.id, now: new Date() }))!;
    expect(lease).not.toBeNull();
    await s.coordinator().failStale(new Date());
    expect(await s.row()).toMatchObject({ stage: "publishing", lease_token: lease.leaseToken });
    expect((await s.destination()).status).toBe("publishing");
    await fixture.pool.query("UPDATE publication_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND publication_id=$2", [s.target.tenantId, s.target.id]);
    await s.coordinator().failStale(new Date());
    expect(await s.destination()).toMatchObject({ status: "failed", errorCode: "publication_state_unknown" });
    expect(await s.operations.complete({ lease, now: new Date(), result: { status: "published", providerPostId: "late-300" } })).toBe(false);
    expect((await s.destination()).providerPostId).toBeNull();
  });

  it("keeps known processing beyond ten minutes and terminates creating at its conservative ten-minute limit", async () => {
    const processing = await setup(); await processing.stage("processing");
    const creating = await setup(); await creating.stage("creating");
    for (const s of [processing, creating]) await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '11 minutes',
      stage_started_at=statement_timestamp()-interval '11 minutes',updated_at=clock_timestamp(),deadline_at=clock_timestamp()+interval '19 minutes',
      next_action_at=clock_timestamp()+interval '59 seconds' WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
    await fixture.pool.query("UPDATE post_publications SET started_at=clock_timestamp()-interval '11 minutes'");
    await processing.coordinator().failStale(new Date());
    expect((await processing.destination()).status).toBe("publishing");
    expect(await creating.destination()).toMatchObject({ status: "failed", errorCode: "publication_state_unknown" });
  });

  it("wires the actual provider dispatcher and configured Graph version in the API", async () => {
    const s = await setup();
    const server = api(s);
    try {
      await server.publicationCoordinator.publishDueBatch(new Date());
      await server.publicationScheduler.whenIdle();
      expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
      expect(s.client.createInstagramContainer.mock.calls[0][0]).toMatchObject({ graphApiVersion: "v25.0", accountId: "100" });
      expect(await s.row()).toMatchObject({ graph_api_version: "v25.0", external_id: "200" });
    } finally { server.publicationScheduler.stop(); await server.publicationScheduler.whenIdle(); }
  });

  it("runs independent API instances against now versus scheduler without duplicating container creation", async () => {
    const s = await setup(); const first = api(s); const second = api(s);
    let release!: () => void;
    s.client.createInstagramContainer.mockReturnValue(new Promise(resolve => { release = () => resolve({ containerId: "200" }); }));
    const response = first.publicationCoordinator.publishPostNow(s.target.tenantId, s.target.postId);
    try {
      await vi.waitFor(() => expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1));
      await second.publicationScheduler.tick();
      const snapshot = await response;
      expect(snapshot.publications[0]).toMatchObject({ status: "publishing", providerPostId: null });
      expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
      release(); await Promise.all([first.publicationScheduler.whenIdle(), second.publicationScheduler.whenIdle()]);
      expect((await s.row()).external_id).toBe("200");
    } finally {
      release(); await response;
      first.publicationScheduler.stop(); second.publicationScheduler.stop();
      await Promise.all([first.publicationScheduler.whenIdle(), second.publicationScheduler.whenIdle()]);
    }
  });

  it.each(["prepared", "creating", "verifying"] as const)("settles persisted %s safely if capability configuration is removed before restart", async stage => {
    const s = await setup();
    if (stage === "prepared") await s.prepared(); else await s.stage(stage);
    const server = api(s, false);
    try {
      await server.publicationCoordinator.publishDueBatch(new Date()); await server.publicationScheduler.whenIdle();
      await server.publicationCoordinator.publishDueBatch(new Date()); await server.publicationScheduler.whenIdle();
      expect(await s.destination()).toMatchObject({ status: "failed", errorCode: stage === "prepared" ? "media_unavailable" : "publication_state_unknown" });
      expect(await s.row()).toMatchObject({ stage: stage === "prepared" ? "failed" : "unknown",
        external_id: stage === "verifying" ? "200" : null });
      expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
      expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
      expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
    } finally { server.publicationScheduler.stop(); await server.publicationScheduler.whenIdle(); }
  });

  it.each(["instagram_image", "instagram_reel", "facebook_reel"] as const)("resumes persisted %s checkpoints in fresh coordinators without duplicating mutations", async kind => {
    const s = await setup(kind); await s.prepared();
    for (let step = 0; step < 5; step++) {
      await s.due();
      await s.run(s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool)));
    }
    if (kind === "facebook_reel") {
      s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "complete", processingPhase: "complete", publishingPhase: "complete", published: true, uploadedBytes: 8, videoStatus: "ready" });
      await s.due(); await s.run();
      expect(s.client.startFacebookReel).toHaveBeenCalledTimes(1);
      expect(s.client.uploadFacebookReel).toHaveBeenCalledTimes(1);
      expect(s.client.finishFacebookReel).toHaveBeenCalledTimes(1);
    } else {
      expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
      expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(1);
    }
    expect(await s.destination()).toMatchObject({ status: "published", providerPostId: kind === "facebook_reel" ? "200" : "300" });
    expect(await s.row()).toMatchObject({ stage: "succeeded", external_id: "200", graph_api_version: "v25.0" });
  });

  it.each(["created", "uploading", "publishing"] as const)("recovers a crashed Facebook %s step using the persisted video ID only", async stage => {
    const s = await setup("facebook_reel"); await s.stage(stage);
    if (stage === "publishing") s.client.getFacebookReelStatus.mockResolvedValue({ uploadingPhase: "complete", processingPhase: "complete", publishingPhase: "complete", published: true, uploadedBytes: 8, videoStatus: "ready" });
    await s.run();
    expect(s.client.startFacebookReel).not.toHaveBeenCalled();
    expect(s.client.uploadFacebookReel).toHaveBeenCalledTimes(stage === "created" ? 1 : 0);
    if (stage === "publishing") {
      expect(s.client.finishFacebookReel).not.toHaveBeenCalled();
      expect(await s.destination()).toMatchObject({ status: "published", providerPostId: "200" });
    } else expect(await s.row()).toMatchObject({ external_id: "200" });
  });

  it("never recreates a creating operation even without an external ID before its ten-minute sweep", async () => {
    const s = await setup(); await s.stage("creating");
    await s.run(); await s.run();
    expect((await s.row()).stage).toBe("creating");
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });

  it("reconciles Instagram publishing through PUBLISHED, preserving a nullable public media ID", async () => {
    const s = await setup(); await s.stage("publishing");
    s.client.getInstagramContainerStatus.mockResolvedValue({ status: "PUBLISHED" });
    await s.run();
    expect(await s.destination()).toMatchObject({ status: "published", providerPostId: null });
    expect(await s.row()).toMatchObject({ stage: "succeeded", external_id: "200" });
    expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
  });

  it.each(["prepared", "creating", "created", "ready", "publishing"] as const)("revalidates the original author after restart at %s without substituting an identity", async stage => {
    const s = await setup(); await s.stage(stage);
    await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [s.post.tenantId, s.post.authorUserId]);
    await s.run();
    const unknown = stage === "creating" || stage === "publishing";
    expect(await s.destination()).toMatchObject({ status: "failed", errorCode: unknown ? "publication_state_unknown" : "publication_author_unavailable", providerPostId: null });
    expect(await s.row()).toMatchObject({ stage: unknown ? "unknown" : "failed", external_id: stage === "creating" ? null : "200" });
    await s.run(s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool)));
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });

  it.each(["prepared", "creating", "created", "ready", "verifying"] as const)("rejects an expired token after restart at %s without alternative credential queries", async stage => {
    const s = await setup(); await s.stage(stage);
    await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND social_account_id=$2", [s.target.tenantId, s.target.socialAccountId]);
    await s.run();
    const unknown = stage === "creating" || stage === "verifying";
    expect(await s.destination()).toMatchObject({ status: "failed", errorCode: unknown ? "publication_state_unknown" : "meta_token_invalid", providerPostId: null });
    expect(await s.row()).toMatchObject({ stage: unknown ? "unknown" : "failed", external_id: stage === "creating" ? null : "200" });
    await s.run(s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool)));
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });

  it("does not repeat a publish after its uncertain response and restart", async () => {
    const s = await setup(); await s.stage("ready");
    s.client.publishInstagramContainer.mockRejectedValue(new MetaPublishingClientError("meta_timeout", "publish_instagram_container", { outcome: "unknown" }));
    await s.run(); expect((await s.row()).stage).toBe("verifying");
    s.client.getInstagramContainerStatus.mockResolvedValue({ status: "FINISHED" });
    await s.due(); await s.run(s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool)));
    expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(1);
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    expect((await s.destination()).status).toBe("publishing");
    s.client.getInstagramContainerStatus.mockResolvedValue({ status: "PUBLISHED" });
    await s.due(); await s.run();
    expect(await s.destination()).toMatchObject({ status: "published", providerPostId: null });
  });

  it("shares PostgreSQL claims between immediate and scheduler executors without holding locks over a Meta promise", async () => {
    const s = await setup();
    let release!: () => void; const pending = new Promise<{ containerId: string }>(resolve => { release = () => resolve({ containerId: "200" }); });
    s.client.createInstagramContainer.mockReturnValue(pending);
    const immediate = s.coordinator(); const scheduler = s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool));
    try {
      await Promise.all([immediate.publishPostNow(s.target.tenantId, s.target.postId), scheduler.publishDueBatch(new Date())]);
      await vi.waitFor(() => expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1));
      const otherConnection = await fixture.pool.connect();
      try {
        await otherConnection.query("BEGIN"); await otherConnection.query("SET LOCAL lock_timeout='100ms'");
        const operation = await otherConnection.query("SELECT stage FROM publication_operations WHERE tenant_id=$1 AND publication_id=$2 FOR UPDATE", [s.target.tenantId, s.target.id]);
        expect(operation.rows[0].stage).toBe("creating");
        await otherConnection.query("UPDATE posts SET title='read-and-write-while-Meta-pending' WHERE tenant_id=$1 AND id=$2", [s.target.tenantId, s.target.postId]);
        await otherConnection.query("COMMIT");
      } catch (error) { await otherConnection.query("ROLLBACK"); throw error; }
      finally { otherConnection.release(); }
      await scheduler.publishDueBatch(new Date());
      expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
    } finally { release(); await Promise.all([immediate.whenIdle(), scheduler.whenIdle()]); }
    expect((await s.row()).external_id).toBe("200");
    expect((await s.repository.findPostForPublication(s.target.tenantId, s.target.postId))?.title).toBe("read-and-write-while-Meta-pending");
  });

  it.each(["processing", "verifying"] as const)("preserves the minute cadence and thirty-poll ceiling for %s across restart", async stage => {
    const s = await setup(); await s.stage(stage);
    s.client.getInstagramContainerStatus.mockResolvedValue({ status: "IN_PROGRESS" });
    await s.run();
    const first = await s.row();
    expect(first.poll_count).toBe(1);
    expect(first.next_action_at.getTime() - first.updated_at.getTime()).toBeGreaterThan(59000);
    async function elapse(seconds: number) {
      await fixture.pool.query(`UPDATE publication_operations SET created_at=created_at-($3*interval '1 second'),
        stage_started_at=stage_started_at-($3*interval '1 second'),updated_at=updated_at-($3*interval '1 second'),
        deadline_at=deadline_at-($3*interval '1 second'),next_action_at=next_action_at-($3*interval '1 second')
        WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id, seconds]);
    }
    await elapse(31);
    await s.run(s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool)));
    expect(s.client.getInstagramContainerStatus).toHaveBeenCalledTimes(1);
    expect((await s.row()).poll_count).toBe(1);
    await elapse(29.1); await s.run();
    expect(s.client.getInstagramContainerStatus).toHaveBeenCalledTimes(2);
    expect((await s.row()).poll_count).toBe(2);
    await fixture.pool.query("UPDATE publication_operations SET poll_count=30,next_action_at=clock_timestamp()+interval '59 seconds' WHERE tenant_id=$1 AND publication_id=$2", [s.target.tenantId, s.target.id]);
    await s.coordinator().failStale(new Date());
    expect(await s.destination()).toMatchObject({ status: "failed", errorCode: stage === "processing" ? "meta_processing_timeout" : "publication_state_unknown" });
    expect(s.client.getInstagramContainerStatus).toHaveBeenCalledTimes(2);
  });

  it("ignores a late create response after its lease expired and another instance recovered creating", async () => {
    const s = await setup();
    let release!: () => void;
    s.client.createInstagramContainer.mockReturnValue(new Promise(resolve => { release = () => resolve({ containerId: "200" }); }));
    const first = s.coordinator(); const second = s.coordinator(new PostgresPublicationOperationsRepository(fixture.pool));
    try {
      await first.publishDueBatch(new Date());
      await vi.waitFor(() => expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1));
      await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '1 second',
        stage_started_at=statement_timestamp()-interval '1 second',updated_at=clock_timestamp(),
        lease_expires_at=clock_timestamp()-interval '1 millisecond' WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
      await second.publishDueBatch(new Date()); await second.whenIdle();
      release(); await first.whenIdle();
      expect(await s.row()).toMatchObject({ stage: "creating", external_id: null });
      expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
      await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '11 minutes',
        stage_started_at=statement_timestamp()-interval '11 minutes',updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
        WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
      await second.failStale(new Date());
      expect(await s.destination()).toMatchObject({ status: "failed", errorCode: "publication_state_unknown" });
    } finally { release(); await Promise.all([first.whenIdle(), second.whenIdle()]); }
  });

  it("continues fifteen-second scheduler ticks during pending actions and sweeps deadlines with no extra dispatch", async () => {
    const s = await setup(); await s.stage("processing");
    await fixture.post(2, new Date(Date.now() - 1000));
    await fixture.pool.query(`UPDATE publication_operations SET created_at=statement_timestamp()-interval '29 minutes',
      stage_started_at=statement_timestamp()-interval '29 minutes',updated_at=clock_timestamp(),deadline_at=clock_timestamp()+interval '10 seconds',
      next_action_at=clock_timestamp()+interval '59 seconds' WHERE tenant_id=$1 AND publication_id=$2`, [s.target.tenantId, s.target.id]);
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    let actions = 0; let instant = new Date();
    const coordinator = new PublicationCoordinator(s.repository, { advance: async () => { actions++; await pending; } }, { operations: s.operations });
    const scheduler = new PublicationScheduler({ coordinator, now: () => instant });
    try {
      await scheduler.tick(); expect(actions).toBe(2);
      instant = new Date(instant.getTime() + 15000);
      await scheduler.tick();
      expect(await s.destination()).toMatchObject({ status: "failed", errorCode: "meta_processing_timeout" });
      expect(actions).toBe(2);
      let idle = false; const drained = scheduler.whenIdle().then(() => { idle = true; });
      expect(idle).toBe(false); release(); await drained;
    } finally { release(); scheduler.stop(); await scheduler.whenIdle(); }
  });

  it("aborts preparation on stop and never emits a create after the file owner returns", async () => {
    const s = await setup();
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const open = s.media.openPublishingFile.bind(s.media);
    const preparing = vi.spyOn(s.media, "openPublishingFile").mockImplementation(async (...args) => { await pending; return open(...args); });
    const runner = s.coordinator();
    try {
      await runner.publishDueBatch(new Date());
      await vi.waitFor(() => expect(preparing).toHaveBeenCalledTimes(1));
      const signal = preparing.mock.calls[0][2]!;
      expect(signal.aborted).toBe(false);
      runner.stop();
      expect(signal.aborted).toBe(true);
      release(); await runner.whenIdle();
      expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
      expect(await s.row()).toMatchObject({ stage: "prepared", external_id: null });
    } finally { release(); runner.stop(); await runner.whenIdle(); }
  });
});
