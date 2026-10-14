import { randomUUID } from "node:crypto";
import { open, mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InstagramPublishingService } from "../src/instagramPublishingService.ts";
import { MetaMediaSigner } from "../src/metaMediaSigner.ts";
import { MetaPublishingClientError } from "../src/metaPublishingClient.ts";
import type { LeasedPublicationOperation } from "../src/publicationOperationsRepository.ts";
import { InvalidSocialAccountsContextError } from "../src/postgresSocialAccountsRepository.ts";
import { cipher, token } from "./publicationFixtures.ts";
import { asyncPublishingStubs } from "./metaPublishingClientStub.ts";

function setup(stage: LeasedPublicationOperation["stage"] = "prepared") {
  let instant = new Date("2027-08-13T13:00:00.123Z");
  const target = { id: randomUUID(), tenantId: randomUUID(), postId: randomUUID(), socialAccountId: randomUUID() };
  const operation: LeasedPublicationOperation = { tenantId: target.tenantId, publicationId: target.id, mediaAssetId: randomUUID(),
    kind: "instagram_image", stage, providerAccountId: "100", graphApiVersion: "v26.0", externalId: stage === "prepared" || stage === "creating" ? null : "200",
    leaseToken: randomUUID(), leaseExpiresAt: new Date(instant.getTime() + 330000), nextActionAt: instant,
    deadlineAt: new Date(instant.getTime() + 1800000), stageStartedAt: instant, pollCount: 0,
    deliveryIssuedAt: null, deliveryExpiresAt: null, createdAt: instant, updatedAt: instant };
  const state = { ...operation };
  let result: unknown = null;
  const operations = {
    checkpoint: vi.fn(async (input) => {
      if (input.expectedStage !== state.stage || state.leaseExpiresAt.getTime() <= instant.getTime()) return false;
      Object.assign(state, { stage: input.nextStage, nextActionAt: input.nextActionAt }, input.externalId ? { externalId: input.externalId } : {},
        input.delivery ? { deliveryIssuedAt: input.delivery.issuedAt, deliveryExpiresAt: input.delivery.expiresAt } : {});
      return true;
    }),
    reserveStatusPoll: vi.fn(async () => { state.pollCount++; return true; }),
    complete: vi.fn(async (input) => { result = input.result; state.stage = input.result.status === "published" ? "succeeded" : input.result.unknown ? "unknown" : "failed"; return true; }),
  };
  const repository = { findPostForPublication: vi.fn().mockResolvedValue({ authorUserId: "persisted-author", caption: "Caption", mediaAssetIds: [operation.mediaAssetId] }), markPublished: vi.fn() };
  const accounts = { findById: vi.fn().mockResolvedValue({ provider: "instagram", providerAccountId: "100", status: "connected", disconnectedAt: null }),
    findMetaPublishingCredential: vi.fn().mockResolvedValue({ provider: "instagram", providerAccountId: "100", accessTokenEncrypted: cipher.encryptSecret(token),
      scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"], tasks: ["MANAGE"], tokenExpiresAt: null }) };
  const close = vi.fn().mockResolvedValue(undefined);
  const media = { openPublishingFile: vi.fn().mockResolvedValue({ handle: {}, mimeType: "image/jpeg", sizeBytes: 8, close }) };
  const client = { ...asyncPublishingStubs(), publishText: vi.fn(), publishPhoto: vi.fn(),
    createInstagramContainer: vi.fn().mockResolvedValue({ containerId: "200" }),
    getInstagramContainerStatus: vi.fn().mockResolvedValue({ status: "IN_PROGRESS" }),
    publishInstagramContainer: vi.fn().mockResolvedValue({ providerPostId: "300" }) };
  const config = { publicOrigin: "https://media.example.test", signingKey: Buffer.alloc(32, 8), ttlSeconds: 3600 };
  const service = new InstagramPublishingService({ repository, accounts, cipher, media, client, operations, now: () => instant, signer: new MetaMediaSigner(config), config });
  return { target, operation, state, operations, repository, accounts, media, client, close, service, config,
    result: () => result, setTime: (value: Date) => { instant = value; }, step: () => service.advance({ target, operation }) };
}

describe("Instagram persisted publishing steps", () => {
  it.each(["publishingService", "metaPublishingContext", "instagramPublishingService", "facebookPublishingService"])("%s can execute through Node native strip-only parsing", async module => {
    const source = await readFile(new URL(`../src/${module}.ts`, import.meta.url), "utf8");
    expect(() => stripTypeScriptTypes(source, { mode: "strip" })).not.toThrow();
  });
  it.each(["instagram_image", "instagram_reel"] as const)("creates %s once after durable intent with exact-second private delivery", async kind => {
    const s = setup(); s.operation.kind = kind; s.state.kind = kind;
    if (kind === "instagram_reel") s.media.openPublishingFile.mockResolvedValue({ handle: {}, mimeType: "video/mp4", sizeBytes: 8, close: s.close });
    s.client.createInstagramContainer.mockImplementation(async input => {
      expect(s.state.stage).toBe("creating");
      expect(s.state.deliveryIssuedAt?.getTime()).toBe(1818162000000);
      const url = new URL(input.media.url); const claims = new MetaMediaSigner(s.config).verify(s.operation.mediaAssetId, url.searchParams.get("ticket")!, new Date("2027-08-13T13:00:00.123Z"));
      expect(claims).toMatchObject({ publicationId: s.target.id, issuedAt: 1818162000, expiresAt: 1818165600 });
      return { containerId: "200" };
    });
    await s.step();
    expect(s.state).toMatchObject({ stage: "created", externalId: "200" });
    expect(s.client.createInstagramContainer).toHaveBeenCalledExactlyOnceWith({ graphApiVersion: "v26.0", accountId: "100", accessToken: token, caption: "Caption", media: { kind: kind === "instagram_image" ? "image" : "reel", url: expect.stringContaining("https://media.example.test/meta-media/") } });
    expect(JSON.stringify(s.state)).not.toContain("ticket="); expect(s.close).toHaveBeenCalledTimes(1);
    await s.service.advance({ target: s.target, operation: { ...s.state } });
    expect(s.state.stage).toBe("processing"); expect(s.client.createInstagramContainer).toHaveBeenCalledTimes(1);
  });
  it.each(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED"])("interprets %s without publishing during status step", async status => {
    const s = setup("processing"); s.client.getInstagramContainerStatus.mockResolvedValue({ status }); await s.step();
    expect(s.state.stage).toBe(status === "FINISHED" ? "ready" : status === "IN_PROGRESS" ? "processing" : "failed");
    expect(s.state.pollCount).toBe(1); expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
    if (status === "IN_PROGRESS") expect(s.state.nextActionAt?.getTime()).toBe(new Date("2027-08-13T13:01:00.123Z").getTime());
  });
  it("FINISHED checkpoint permits one publish and preserves returned media ID", async () => {
    const s = setup("ready"); s.client.publishInstagramContainer.mockImplementation(async () => { expect(s.state.stage).toBe("publishing"); return { providerPostId: "300" }; });
    await s.step(); expect(s.result()).toEqual({ status: "published", providerPostId: "300" });
    expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(1); expect(s.close).toHaveBeenCalledTimes(1);
  });
  it("permits publishing after the thirtieth status poll already confirmed FINISHED", async () => {
    const s = setup("ready"); s.operation.pollCount = 30; await s.step();
    expect(s.result()).toEqual({ status: "published", providerPostId: "300" });
    expect(s.client.publishInstagramContainer).toHaveBeenCalledTimes(1);
  });
  it.each(["processing", "verifying"] as const)("poll limit terminalizes %s without a thirty-first GET", async stage => {
    const s = setup(stage); s.operation.pollCount = 30; await s.step();
    expect(s.result()).toMatchObject({ status: "failed", code: stage === "processing" ? "meta_processing_timeout" : "publication_state_unknown" });
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });
  it.each(["deadline", "token", "abort"])("status reservation wait crossing %s cannot emit a GET", async loss => {
    const s = setup("processing"); const controller = new AbortController();
    if (loss === "token") {
      const credential = await s.accounts.findMetaPublishingCredential();
      s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...credential, tokenExpiresAt: "2027-08-13T13:00:10Z" });
    }
    s.operations.reserveStatusPoll.mockImplementationOnce(async () => {
      if (loss === "abort") controller.abort();
      else s.setTime(new Date(loss === "deadline" ? "2027-08-13T13:30:01Z" : "2027-08-13T13:00:11Z"));
      return true;
    });
    await s.service.advance({ target: s.target, operation: s.operation, signal: controller.signal });
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });
  it.each(["publishing", "verifying"] as const)("recovers %s PUBLISHED as published/null without re-publish", async stage => {
    const s = setup(stage); s.client.getInstagramContainerStatus.mockResolvedValue({ status: "PUBLISHED" }); await s.step();
    expect(s.result()).toEqual({ status: "published", providerPostId: null }); expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
  });
  it("FINISHED after publish intent is only polled, never republished", async () => {
    const s = setup("publishing"); s.client.getInstagramContainerStatus.mockResolvedValue({ status: "FINISHED" }); await s.step();
    expect(s.state.stage).toBe("verifying"); expect(s.client.publishInstagramContainer).not.toHaveBeenCalled();
  });
  it.each(["prepared", "publishing"] as const)("removed author in %s produces the appropriate certainty", async stage => {
    const s = setup(stage); s.accounts.findById.mockRejectedValue(new InvalidSocialAccountsContextError()); await s.step();
    expect(s.result()).toMatchObject({ status: "failed", unknown: stage === "publishing", code: stage === "publishing" ? "publication_state_unknown" : "publication_author_unavailable" });
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });
  it.each([{ scopes: [] }, { tasks: [] }, { tokenExpiresAt: "2027-08-13T13:00:00.000Z" }])("blocks revoked authorization %j", async change => {
    const s = setup(); const credential = await s.accounts.findMetaPublishingCredential(); s.accounts.findMetaPublishingCredential.mockResolvedValue({ ...credential, ...change }); await s.step();
    expect(s.state.stage).toBe("failed"); expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
  });
  it.each(["creating", "publishing", "processing"] as const)("resolves expired %s locally with no network", async stage => {
    const s = setup(stage); s.operation.deadlineAt = new Date("2027-08-13T12:59:00Z"); await s.step();
    expect(s.result()).toMatchObject({ status: "failed", code: stage === "processing" ? "meta_processing_timeout" : "publication_state_unknown" });
    expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled(); expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
  });
  it("does not recreate an ambiguous create, closing after ten minutes", async () => {
    const s = setup("creating"); await s.step(); expect(s.result()).toBeNull();
    s.setTime(new Date("2027-08-13T13:10:00.123Z")); await s.step();
    expect(s.state.stage).toBe("unknown"); expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
  });
  it("unknown publish outcome retains ID for status recovery", async () => {
    const s = setup("ready"); s.client.publishInstagramContainer.mockRejectedValue(new MetaPublishingClientError("meta_timeout", "publish_instagram_container", { outcome: "unknown" })); await s.step();
    expect(s.state).toMatchObject({ stage: "verifying", externalId: "200" }); expect(s.result()).toBeNull();
  });
  it("persistence failure after external success remains operational, not provider failure", async () => {
    const s = setup(); s.operations.checkpoint.mockImplementation(async input => { if (input.nextStage === "created") throw new Error("private-db-error"); s.state.stage = input.nextStage; return true; });
    await expect(s.step()).rejects.toMatchObject({ name: "PublicationOperationalError" }); expect(s.state.stage).toBe("creating"); expect(s.result()).toBeNull();
  });
  it.each(["deadline", "lease", "authorization"])("late preparation closes owned handle without effects after %s lost", async loss => {
    const s = setup(); let resolve!: (value: unknown) => void;
    s.media.openPublishingFile.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = s.step(); await vi.waitFor(() => expect(s.media.openPublishingFile).toHaveBeenCalledTimes(1));
    if (loss === "deadline") s.setTime(new Date("2027-08-13T13:05:01Z"));
    if (loss === "lease") s.state.leaseExpiresAt = new Date("2027-08-13T12:00:00Z");
    if (loss === "authorization") s.accounts.findById.mockRejectedValue(new InvalidSocialAccountsContextError());
    resolve({ handle: {}, mimeType: "image/jpeg", sizeBytes: 8, close: s.close }); await pending;
    expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect(s.close).toHaveBeenCalledTimes(1);
  });
  it("closes a real late descriptor after cancellation and forwards abort to preparation", async () => {
    const s = setup(); const root = await mkdtemp(join(tmpdir(), "ig-preparation-"));
    try {
      await writeFile(join(root, "media.jpg"), "verified"); const handle = await open(join(root, "media.jpg"), "r");
      let resolve!: (value: unknown) => void; let signal!: AbortSignal;
      s.media.openPublishingFile.mockImplementation((_context, _id, inputSignal) => { signal = inputSignal; return new Promise(done => { resolve = done; }); });
      const controller = new AbortController(); const pending = s.service.advance({ target: s.target, operation: s.operation, signal: controller.signal });
      await vi.waitFor(() => expect(s.media.openPublishingFile).toHaveBeenCalledTimes(1)); controller.abort();
      expect(signal.aborted).toBe(true); resolve({ handle, mimeType: "image/jpeg", sizeBytes: 8, close: () => handle.close() }); await pending;
      expect(handle.fd).toBe(-1); expect(s.client.createInstagramContainer).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("a failed intent CAS prevents external creation", async () => {
    const s = setup(); s.operations.checkpoint.mockResolvedValue(false); await s.step(); expect(s.client.createInstagramContainer).not.toHaveBeenCalled(); expect(s.close).toHaveBeenCalledTimes(1);
  });
  it("a failed reservation prevents status GET", async () => {
    const s = setup("processing"); s.operations.reserveStatusPoll.mockResolvedValue(false); await s.step(); expect(s.client.getInstagramContainerStatus).not.toHaveBeenCalled();
  });
});
