import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiServer } from "../src/app.ts";
import { MetaMediaSigner } from "../src/metaMediaSigner.ts";
import { MediaAssetsService } from "../src/mediaAssetsService.ts";
import { PostgresMediaAssetsRepository } from "../src/mediaAssetsRepository.ts";
import { PostgresPublicationOperationsRepository } from "../src/publicationOperationsRepository.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { PostgresSocialAccountsRepository } from "../src/postgresSocialAccountsRepository.ts";
import * as deliveryModule from "../src/metaMediaDeliveryService.ts";
import * as contentModule from "../src/mediaContent.ts";
import { cipher, publicationFixture } from "./publicationFixtures.ts";

const config = { publicOrigin: "https://media.example.com", signingKey: Buffer.alloc(32, 31), ttlSeconds: 3600 };
const signer = new MetaMediaSigner(config);
const bytes = Buffer.alloc(300, 0x61);
const scopes = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"];
// No skip: these security gates require the isolated PostgreSQL fixture.
describe("Meta media delivery (HTTP, PostgreSQL and filesystem)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  let root: string; let server: ReturnType<typeof createApiServer>; let origin: string;
  const logged: unknown[] = [];
  beforeAll(async () => {
    fixture = await publicationFixture(); root = await mkdtemp(join(tmpdir(), "socialflow-meta-media-"));
    server = createApiServer({ authRateLimit: { maxAttempts: 20, windowMs: 60000 }, corsOrigin: "https://app.example.com", pool: fixture.pool,
      sessionCookie: { maxAgeSeconds: 3600, sameSite: "Lax", secure: false }, sessionTtlSeconds: 3600, socialTokenCipher: cipher,
      mediaStoragePath: root, metaMedia: config, logger: { error: (...args) => { logged.push(args); } } });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await fixture?.close(); if (root) await rm(root, { recursive: true, force: true });
  });
  async function target(kind: "instagram_image" | "instagram_reel" | "facebook_reel" = "instagram_image") {
    const at = new Date(Math.floor(Date.now() / 1000) * 1000);
    const post = await fixture.post(1, at);
    if (kind !== "facebook_reel") {
      await fixture.pool.query("UPDATE social_accounts SET account_type='instagram_business' WHERE id=$1", [post.publications[0].socialAccountId]);
      await fixture.pool.query("UPDATE oauth_connections SET scopes=$2 WHERE id=$1", [post.connectionId, scopes]);
    }
    const assetId = randomUUID(); const extension = kind === "instagram_image" ? "jpg" : "mp4";
    await mkdir(join(root, post.tenantId));
    const path = join(root, post.tenantId, `${assetId}.${extension}`); await writeFile(path, bytes);
    await fixture.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,original_filename,media_type,mime_type,size_bytes,sha256)
      VALUES ($1,$2,$3,$4,'media',$5,$6,300,$7)`, [assetId, post.tenantId, post.authorUserId, `${post.tenantId}/${assetId}.${extension}`, extension === "jpg" ? "image" : "video", extension === "jpg" ? "image/jpeg" : "video/mp4", createHash("sha256").update(bytes).digest("hex")]);
    await fixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, assetId]);
    await new PostgresPostPublicationsRepository(fixture.pool).claimPost(post.tenantId, post.postId, at);
    const publicationId = post.publications[0].id;
    if (kind !== "facebook_reel") await fixture.pool.query("UPDATE publication_operations SET delivery_issued_at=$2,delivery_expires_at=$3 WHERE publication_id=$1", [publicationId, at, new Date(at.getTime() + 3600000)]);
    const claims = { v: 1 as const, publicationId, assetId, issuedAt: at.getTime() / 1000, expiresAt: at.getTime() / 1000 + 3600 };
    const url = new URL(signer.createUrl(claims));
    return { ...post, publicationId, assetId, claims, path, ticket: url.searchParams.get("ticket")!, url: `${origin}${url.pathname}${url.search}` };
  }
  async function notFound(url: string) {
    const response = await fetch(url); expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "media_asset_not_found", message: "A mídia não foi encontrada." } });
  }
  function media() { return new MediaAssetsService(new PostgresMediaAssetsRepository(fixture.pool), root, { imageBytes: 8000000, videoBytes: 262144000 }); }
  function service(files: Pick<MediaAssetsService, "openPublishingFile"> = media(), clock = () => new Date()) {
    return new deliveryModule.MetaMediaDeliveryService(signer, new PostgresPublicationOperationsRepository(fixture.pool), new PostgresSocialAccountsRepository(fixture.pool), files, clock);
  }
  it.each(["instagram_image", "instagram_reel"] as const)("separates JPEG and MP4 limits for real-file opener and signed delivery: %s", async kind => {
    const input = await target(kind); const content = Buffer.alloc(2_000_000, 0x61);
    await writeFile(input.path, content);
    await fixture.pool.query("UPDATE media_assets SET size_bytes=$2,sha256=$3 WHERE id=$1", [input.assetId, content.length, createHash("sha256").update(content).digest("hex")]);
    // Existing upload survived a restart with smaller, parser-valid equal upload limits.
    const files = new MediaAssetsService(new PostgresMediaAssetsRepository(fixture.pool), root, { imageBytes: 1_000_000, videoBytes: 1_000_000 });
    const openFile = () => files.openPublishingFile({ tenantId: input.tenantId, authorUserId: input.authorUserId }, input.assetId);
    const deliver = () => service(files).open(input.assetId, input.ticket, new Date());
    if (kind === "instagram_reel") {
      await expect(openFile()).rejects.toMatchObject({ code: "media_content_unavailable" });
      await expect(deliver()).rejects.toMatchObject({ code: "media_content_unavailable" });
      return;
    }
    for (const openContent of [openFile, deliver]) {
      const opened = await openContent();
      try {
        expect(opened).toMatchObject({ mimeType: "image/jpeg", sizeBytes: 2_000_000 });
        const actual = await opened.handle.readFile(); expect(actual).toEqual(content);
      } finally { await opened.close(); }
      expect(opened.handle.fd).toBe(-1);
    }
    await writeFile(input.path, Buffer.alloc(2_000_000, 0x62));
    await expect(openFile()).rejects.toMatchObject({ code: "media_content_unavailable" });
    await expect(deliver()).rejects.toMatchObject({ code: "media_content_unavailable" });
  });
  it("allows repeatable cookie-free GET and HEAD without CORS credentials, even with a foreign Origin", async () => {
    const input = await target();
    for (const method of ["GET", "HEAD", "GET"]) {
      const response = await fetch(input.url, { method, headers: { Origin: "https://foreign.example.com" } });
      expect(response.status).toBe(200); expect(await response.text()).toBe(method === "HEAD" ? "" : "a".repeat(300));
      expect(response.headers.get("content-length")).toBe("300"); expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
    const row = (await fixture.pool.query("SELECT delivery_issued_at,delivery_expires_at FROM publication_operations WHERE publication_id=$1", [input.publicationId])).rows[0];
    expect(row.delivery_issued_at.getTime()).toBe(input.claims.issuedAt * 1000); expect(row.delivery_expires_at.getTime()).toBe(input.claims.expiresAt * 1000);
    expect((await fetch(`${origin}/media-assets/${input.assetId}/content`)).status).toBe(401);
    expect((await fetch(`${origin}/posts`, { method: "POST", headers: { Origin: "https://foreign.example.com" } })).status).toBe(403);
  });
  it("allows MANAGE-only Instagram Page metadata with all required scopes", async () => {
    const input = await target();
    await fixture.pool.query("UPDATE social_accounts SET metadata=$2::jsonb WHERE id=$1", [input.publications[0].socialAccountId, JSON.stringify({ pageId: "456", tasks: ["MANAGE"] })]);
    const response = await fetch(input.url);
    expect(response.status).toBe(200); expect(await response.text()).toBe("a".repeat(300));
  });
  it.each([
    ["bytes=0-99", 206, 100, "bytes 0-99/300"], ["bytes=100-", 206, 200, "bytes 100-299/300"],
    ["bytes=-100", 206, 100, "bytes 200-299/300"], ["bytes=-999", 206, 300, "bytes 0-299/300"],
    ["bytes=-0", 416, 0, "bytes */300"], ["bytes=0-1,3-4", 416, 0, "bytes */300"],
  ])("reuses Range parser for %s", async (range, status, length, contentRange) => {
    const input = await target(); const response = await fetch(input.url, { headers: { Range: range as string } });
    expect(response.status).toBe(status); expect((await response.arrayBuffer()).byteLength).toBe(length); expect(response.headers.get("content-range")).toBe(contentRange);
  });
  it("binds both IDs and rejects duplicate/extra query parameters without caller tenant authority", async () => {
    const first = await target(); const other = await target();
    await notFound(first.url.replace(first.assetId, other.assetId));
    for (const suffix of [`&tenantId=${other.tenantId}`, `&ticket=${first.ticket}`, "&extra=1"]) await notFound(first.url + suffix);
    await notFound(`${origin}/meta-media/${randomUUID()}?ticket=${first.ticket}`);
    await notFound(first.url.replace(first.ticket, "invalid"));
  });
  it.each(["issued", "expires", "facebook", "expired"])("rejects a signed capability with mismatched persisted binding: %s", async variant => {
    const input = await target(variant === "facebook" ? "facebook_reel" : "instagram_image");
    const claims = { ...input.claims };
    if (variant === "issued") { claims.issuedAt++; claims.expiresAt++; }
    if (variant === "expires") claims.expiresAt++;
    if (variant === "expired") { claims.issuedAt -= 7200; claims.expiresAt -= 7200; }
    const url = new URL(signer.createUrl(claims)); await notFound(`${origin}${url.pathname}${url.search}`);
  });
  it.each(["terminal", "destination", "membership", "inactive_author", "revoked", "expired_account", "inactive_account", "credential", "scopes", "tasks", "token_expired", "deleted", "unbound", "provider_changed", "deadline"])("returns the same 404 after persisted authorization changes: %s", async change => {
    const input = await target();
    const queries: Record<string, [string, unknown[]]> = {
      terminal: ["UPDATE publication_operations SET stage='failed' WHERE publication_id=$1", [input.publicationId]],
      destination: ["UPDATE post_publications SET status='cancelled' WHERE id=$1", [input.publicationId]],
      membership: ["DELETE FROM tenant_members WHERE tenant_id=$1", [input.tenantId]],
      inactive_author: ["UPDATE users SET is_active=false WHERE id=$1", [input.authorUserId]],
      revoked: ["UPDATE oauth_connections SET status='revoked',revoked_at=clock_timestamp(),access_token_encrypted=NULL,refresh_token_encrypted=NULL WHERE id=$1", [input.connectionId]],
      expired_account: ["UPDATE oauth_connections SET status='expired' WHERE id=$1", [input.connectionId]],
      inactive_account: ["UPDATE social_accounts SET is_active=false WHERE id=$1", [input.publications[0].socialAccountId]],
      credential: ["DELETE FROM social_account_credentials WHERE social_account_id=$1", [input.publications[0].socialAccountId]],
      scopes: ["UPDATE oauth_connections SET scopes='{}' WHERE id=$1", [input.connectionId]],
      tasks: ["UPDATE social_accounts SET metadata='{}' WHERE id=$1", [input.publications[0].socialAccountId]],
      token_expired: ["UPDATE social_account_credentials SET access_token_expires_at=clock_timestamp()-interval '1 second' WHERE social_account_id=$1", [input.publications[0].socialAccountId]],
      deleted: ["UPDATE media_assets SET deleted_at=clock_timestamp() WHERE id=$1", [input.assetId]],
      unbound: ["DELETE FROM post_media WHERE media_asset_id=$1", [input.assetId]],
      provider_changed: ["UPDATE social_accounts SET external_account_id='999' WHERE id=$1", [input.publications[0].socialAccountId]],
      deadline: ["UPDATE publication_operations SET deadline_at=created_at+interval '1 second' WHERE publication_id=$1", [input.publicationId]],
    };
    if (change === "deadline") await fixture.pool.query("UPDATE publication_operations SET created_at=created_at-interval '1 hour' WHERE publication_id=$1", [input.publicationId]);
    await fixture.pool.query(...queries[change]); await notFound(input.url);
  });
  it.each(["missing", "hash", "size", "outside_root", "outside_tenant"])("returns a generic path-free storage error: %s", async change => {
    const input = await target();
    if (change === "missing") await rm(input.path);
    if (change === "hash") await writeFile(input.path, Buffer.alloc(300, 0x62));
    if (change === "size") await writeFile(input.path, "short");
    if (change.startsWith("outside")) {
      const outside = change === "outside_root" ? join(root, "..", `${randomUUID()}.jpg`) : (await target()).path;
      try { if (change === "outside_root") await writeFile(outside, bytes); await rm(input.path); await symlink(outside, input.path);
        const response = await fetch(input.url); expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: { code: "media_content_unavailable", message: "Não foi possível acessar o conteúdo da mídia." } });
      } finally { if (change === "outside_root") await rm(outside, { force: true }); }
      return;
    }
    const response = await fetch(input.url); expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "media_content_unavailable", message: "Não foi possível acessar o conteúdo da mídia." } });
    expect(JSON.stringify(logged)).not.toContain(input.ticket); expect(JSON.stringify(logged)).not.toContain(input.path);
  });
  it.each(["issued", "expires", "both"])("does not round fractional persisted delivery timestamps to authorize a different ticket: %s", async change => {
    const input = await target();
    await fixture.pool.query(`UPDATE publication_operations SET
      delivery_issued_at=delivery_issued_at+($2 * interval '1 millisecond'),
      delivery_expires_at=delivery_expires_at+($3 * interval '1 millisecond') WHERE publication_id=$1`, [input.publicationId, change === "expires" ? 0 : 123, change === "issued" ? 0 : 123]);
    await notFound(input.url);
  });
  it.each(["ticket", "deadline", "membership", "terminal"])("rechecks current clock and binding after hashing: %s", async change => {
    const input = await target(); const files = media(); const original = files.openPublishingFile.bind(files); let opened: FileHandle | undefined;
    let current = new Date();
    files.openPublishingFile = async (...args) => {
      const result = await original(...args); opened = result.handle;
      if (change === "ticket") current = new Date(input.claims.expiresAt * 1000);
      if (change === "deadline") current = new Date(Date.now() + 1801000);
      if (change === "membership") await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1", [input.tenantId]);
      if (change === "terminal") await fixture.pool.query("UPDATE publication_operations SET stage='failed' WHERE publication_id=$1", [input.publicationId]);
      return result;
    };
    await expect(service(files, () => current).open(input.assetId, input.ticket, new Date())).rejects.toMatchObject({ status: 404, code: "media_asset_not_found" });
    expect(opened).toBeDefined(); expect(opened!.fd).toBe(-1);
  });
  it("streams from the verified handle even if the pathname is replaced", async () => {
    const input = await target(); const content = await service().open(input.assetId, input.ticket, new Date());
    const moved = `${input.path}.old`; await rename(input.path, moved); await writeFile(input.path, Buffer.alloc(300, 0x62));
    const chunks: Buffer[] = [];
    const output = Object.assign(new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } }), { statusCode: 0, setHeader() {} }) as unknown as ServerResponse;
    try { await contentModule.sendOpenMediaContent({ method: "GET", headers: {} } as IncomingMessage, output, content); }
    finally { await content.close(); }
    expect(Buffer.concat(chunks)).toEqual(bytes); expect(content.handle.fd).toBe(-1);
  });
  it("closes a prepared handle if the client cancels before streaming", async () => {
    const input = await target(); const files = media(); const original = files.openPublishingFile.bind(files); const controller = new AbortController(); let handle: FileHandle | undefined;
    files.openPublishingFile = async (...args) => { const result = await original(...args); handle = result.handle; controller.abort(); return result; };
    await expect(service(files).open(input.assetId, input.ticket, new Date(), controller.signal)).rejects.toThrow();
    expect(handle?.fd).toBe(-1);
  });
  it.each(["client", "budget", "expiry"])("cancels the actual file service while its PostgreSQL metadata SELECT is blocked: %s", async change => {
    const input = await target(); const repository = new PostgresMediaAssetsRepository(fixture.pool);
    const original = repository.findStoredById.bind(repository); const lock = await fixture.pool.connect();
    let ready!: () => void; const blockedLookup = new Promise<void>(resolve => { ready = resolve; });
    let lookupFinished!: () => void; const lookupSettled = new Promise<void>(resolve => { lookupFinished = resolve; });
    // Delay only the real repository SELECT, not openPublishingFile or an abort-aware file wrapper.
    repository.findStoredById = async (...args) => {
      await lock.query("BEGIN"); await lock.query("LOCK TABLE media_assets IN ACCESS EXCLUSIVE MODE");
      const lookup = original(...args); ready();
      try { return await lookup; } finally { lookupFinished(); }
    };
    const files = new MediaAssetsService(repository, root, { imageBytes: 8000000, videoBytes: 262144000 });
    const controller = new AbortController(); let outcome: "pending" | "opened" | "rejected" = "pending";
    const at = change === "expiry" ? new Date(input.claims.expiresAt * 1000 - 500) : new Date();
    if (change === "expiry") await fixture.pool.query("UPDATE publication_operations SET deadline_at=created_at+interval '2 hours' WHERE publication_id=$1", [input.publicationId]);
    if (change !== "client") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = (change === "client"
      ? files.openPublishingFile({ tenantId: input.tenantId, authorUserId: input.authorUserId }, input.assetId, controller.signal)
      : service(files, () => at).open(input.assetId, input.ticket, at)
    ).then(async content => { outcome = "opened"; await content.close(); return null; }, error => { outcome = "rejected"; return error; });
    try {
      await blockedLookup;
      await vi.waitFor(async () => {
        const waiting = await fixture.pool.query("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation='media_assets'::regclass AND NOT granted) AS blocked");
        expect(waiting.rows[0].blocked).toBe(true);
      });
      if (change === "client") {
        controller.abort();
        await Promise.race([pending, new Promise<void>(resolve => setTimeout(resolve, 100))]);
      } else await vi.advanceTimersByTimeAsync(change === "expiry" ? 500 : 300000);
      // Assert before unlocking: cancellation must not wait for the physical PG query to finish.
      expect(outcome).toBe("rejected");
      expect(await pending).toMatchObject({ status: change === "expiry" ? 404 : 500, code: change === "expiry" ? "media_asset_not_found" : "media_content_unavailable" });
    } finally {
      controller.abort(); await lock.query("ROLLBACK"); lock.release();
      await lookupSettled; await pending; if (change !== "client") vi.useRealTimers();
    }
    // The old metadata completion cannot restart the cancelled continuation or return an open handle.
    expect(outcome).toBe("rejected");
  });
  it("stops the actual incremental hash on cancellation and closes its descriptor", async () => {
    const input = await target("instagram_reel");
    const video = Buffer.alloc(256 * 1024, 0x61); await writeFile(input.path, video);
    await fixture.pool.query("UPDATE media_assets SET size_bytes=$2,sha256=$3 WHERE id=$1", [input.assetId, video.length, createHash("sha256").update(video).digest("hex")]);
    const sample = await open(input.path, "r"); const prototype = Object.getPrototypeOf(sample); const original = prototype.read;
    await sample.close(); const controller = new AbortController(); let descriptor: (() => number) | undefined; let reads = 0;
    const interception = vi.spyOn(prototype, "read").mockImplementation(async function(this: FileHandle, ...args: unknown[]) {
      descriptor = () => this.fd; reads++; const result = await original.apply(this, args); controller.abort(); return result;
    });
    try {
      await expect(media().openPublishingFile({ tenantId: input.tenantId, authorUserId: input.authorUserId }, input.assetId, controller.signal)).rejects.toThrow();
      expect(reads).toBe(1); expect(descriptor?.()).toBe(-1);
    } finally { interception.mockRestore(); }
  });
  it("owns and closes the HTTP handle on HEAD and client stream abort", async () => {
    const input = await target("instagram_reel"); const video = Buffer.alloc(4 * 1024 * 1024, 0x61); await writeFile(input.path, video);
    await fixture.pool.query("UPDATE media_assets SET size_bytes=$2,sha256=$3 WHERE id=$1", [input.assetId, video.length, createHash("sha256").update(video).digest("hex")]);
    const original = MediaAssetsService.prototype.openPublishingFile; const captured: FileHandle[] = [];
    const interception = vi.spyOn(MediaAssetsService.prototype, "openPublishingFile").mockImplementation(async function(this: MediaAssetsService, ...args) {
      const content = await original.apply(this, args); captured.push(content.handle); return content;
    });
    try {
      expect((await fetch(input.url, { method: "HEAD", headers: { Origin: "https://app.example.com" } })).headers.get("access-control-allow-credentials")).toBeNull();
      await vi.waitFor(() => { expect(captured[0].fd).toBe(-1); });
      const controller = new AbortController(); const response = await fetch(input.url, { signal: controller.signal });
      const reader = response.body!.getReader(); expect((await reader.read()).value?.byteLength).toBeGreaterThan(0); controller.abort();
      await vi.waitFor(() => { expect(captured[1].fd).toBe(-1); });
    } finally { interception.mockRestore(); }
  });
  it("expires a streaming transfer and leaves descriptor ownership to the opener", async () => {
    const input = await target(); const content = await service().open(input.assetId, input.ticket, new Date());
    let written = 0;
    const output = Object.assign(new Writable({ write(chunk) { written += chunk.length; } }), { statusCode: 0, setHeader() {} }) as unknown as ServerResponse;
    try {
      await expect(contentModule.sendOpenMediaContent({ method: "GET", headers: {} } as IncomingMessage, output, content, new Date(Date.now() + 30))).rejects.toThrow();
      expect(written).toBe(300); expect(content.handle.fd).not.toBe(-1); expect(output.destroyed).toBe(true);
    } finally { await content.close(); }
    expect(content.handle.fd).toBe(-1);
  });
  it("returns 404 without success headers or bytes when already expired at the sender boundary", async () => {
    const input = await target(); const content = await service().open(input.assetId, input.ticket, new Date());
    const headers: string[] = []; let written = 0;
    const output = Object.assign(new Writable({ write(chunk, _encoding, callback) { written += chunk.length; callback(); } }), { statusCode: 0, setHeader(name: string) { headers.push(name); } }) as unknown as ServerResponse;
    try { await expect(contentModule.sendOpenMediaContent({ method: "GET", headers: {} } as IncomingMessage, output, content, new Date(Date.now() - 1))).rejects.toMatchObject({ status: 404, code: "media_asset_not_found" }); }
    finally { await content.close(); }
    expect(headers).toEqual([]); expect(written).toBe(0); expect(content.handle.fd).toBe(-1);
  });
  it.each(["timeout", "expiry"])("bounds preparation even while a real-file reader remains pending: %s", async change => {
    const input = await target(); const actualFiles = media(); const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    let ready!: () => void;
    const preparationStarted = new Promise<void>(resolve => { ready = resolve; });
    const files = {
      async openPublishingFile(context: Parameters<MediaAssetsService["openPublishingFile"]>[0], id: string, signal?: AbortSignal) {
        const content = await actualFiles.openPublishingFile(context, id, signal);
        try {
          observedSignal = signal;
          ready();
          await new Promise<void>((resolve, reject) => { signal!.addEventListener("abort", () => { reject(signal!.reason); }, { once: true }); controller.signal.addEventListener("abort", () => { resolve(); }, { once: true }); });
          return content;
        } catch (error) { await content.close(); throw error; }
      },
    };
    const at = change === "expiry" ? new Date(input.claims.expiresAt * 1000 - 500) : new Date();
    if (change === "expiry") await fixture.pool.query("UPDATE publication_operations SET deadline_at=created_at+interval '2 hours' WHERE publication_id=$1", [input.publicationId]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = service(files, () => at).open(input.assetId, input.ticket, at);
      const assertion = expect(pending).rejects.toMatchObject({ status: change === "expiry" ? 404 : 500, code: change === "expiry" ? "media_asset_not_found" : "media_content_unavailable" });
      // Await the actual I/O boundary, not an arbitrary number of event-loop turns.
      await preparationStarted;
      expect(observedSignal).toBeDefined();
      await vi.advanceTimersByTimeAsync(change === "expiry" ? 500 : 300000); await assertion;
      expect(observedSignal?.aborted).toBe(true);
    } finally { controller.abort(); vi.useRealTimers(); }
  });
  it.each(["timeout", "expiry"])("counts authorization I/O toward the preparation deadline: %s", async change => {
    const input = await target(); const repository = new PostgresPublicationOperationsRepository(fixture.pool); const original = repository.findDeliveryBinding.bind(repository);
    let release!: () => void; let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const reached = new Promise<void>(resolve => { started = resolve; });
    repository.findDeliveryBinding = async (...args) => { const binding = await original(...args); started(); await gate; return binding; };
    const at = change === "expiry" ? new Date(input.claims.expiresAt * 1000 - 500) : new Date();
    if (change === "expiry") await fixture.pool.query("UPDATE publication_operations SET deadline_at=created_at+interval '2 hours' WHERE publication_id=$1", [input.publicationId]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const instance = new deliveryModule.MetaMediaDeliveryService(signer, repository, new PostgresSocialAccountsRepository(fixture.pool), media(), () => at);
      // Close a wrongly returned handle as well, so this RED test cannot leak descriptors.
      const pending = instance.open(input.assetId, input.ticket, at).then(async content => { await content.close(); return content; });
      const assertion = expect(pending).rejects.toMatchObject({ status: change === "expiry" ? 404 : 500, code: change === "expiry" ? "media_asset_not_found" : "media_content_unavailable" });
      await reached; await vi.advanceTimersByTimeAsync(change === "expiry" ? 500 : 300000); release(); await assertion;
    } finally { release(); vi.useRealTimers(); }
  });
  it("does not use a captured pre-query time to authorize a token that expired during the final lookup", async () => {
    const input = await target(); let current = new Date(); const expires = new Date(current.getTime() + 1000);
    await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at=$2 WHERE social_account_id=$1", [input.publications[0].socialAccountId, expires]);
    const accounts = new PostgresSocialAccountsRepository(fixture.pool); const original = accounts.findMetaPublishingCredential.bind(accounts); let lookups = 0;
    accounts.findMetaPublishingCredential = async (...args) => { const credential = await original(...args); if (++lookups === 2) current = expires; return credential; };
    const instance = new deliveryModule.MetaMediaDeliveryService(signer, new PostgresPublicationOperationsRepository(fixture.pool), accounts, media(), () => current);
    await expect(instance.open(input.assetId, input.ticket, current).then(async content => { await content.close(); return content; })).rejects.toMatchObject({ status: 404, code: "media_asset_not_found" });
  });
  it("never authorizes other methods or provides a ticket-generation endpoint", async () => {
    const input = await target();
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) expect((await fetch(input.url, { method })).status).toBe(405);
    expect((await fetch(`${origin}/meta-media`)).status).toBe(404);
  });
  it("keeps requests with a valid signature but no matching publication inaccessible", async () => {
    const input = await target(); const url = new URL(signer.createUrl({ ...input.claims, publicationId: randomUUID() }));
    await notFound(`${origin}${url.pathname}${url.search}`);
  });
});
