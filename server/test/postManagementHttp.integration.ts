import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isPostDetail } from "../../shared/postManagementContract.ts";
import { createApiServer } from "../src/app.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";
import { postManagementFixture } from "./postManagementFixtures.ts";

const ORIGIN = "http://localhost:5173";

async function fixture() {
  const f = await postManagementFixture();
  const provider = {
    publishText: vi.fn(), publishPhoto: vi.fn(), createInstagramContainer: vi.fn(),
    getInstagramContainerStatus: vi.fn(), publishInstagramContainer: vi.fn(),
    startFacebookReel: vi.fn(), uploadFacebookReel: vi.fn(), getFacebookReelStatus: vi.fn(), finishFacebookReel: vi.fn(),
  };
  const timer = vi.fn();
  const server = createApiServer({
    pool: f.pool, corsOrigin: ORIGIN, authRateLimit: { maxAttempts: 100, windowMs: 60_000 },
    sessionCookie: { maxAgeSeconds: 3600, sameSite: "Lax", secure: false }, sessionTtlSeconds: 3600,
    socialTokenCipher: new SocialTokenCipher(Buffer.alloc(32, 7)), logger: { error: vi.fn() },
    metaPublishingClient: provider, publicationSchedulerOptions: { setInterval: timer, clearInterval: vi.fn() },
  });
  const publishNow = vi.spyOn(server.publicationCoordinator, "publishPostNow");
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const base = `http://127.0.0.1:${address.port}`;
    async function request(id: string, method = "GET", actor = f.author, body?: unknown, origin: string | null = ORIGIN) {
      const response = await fetch(`${base}/posts/${id}`, {
        method, headers: { ...(actor ? { Cookie: `socialflow_session=${actor.token}` } : {}),
          ...(origin === null ? {} : { Origin: origin }), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect.soft(response.headers.get("cache-control")).toBe("no-store");
      return response;
    }
    return { ...f, provider, publishNow, server, base, request, async close() {
      try {
        expect(publishNow).not.toHaveBeenCalled();
        for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled();
        expect(timer).not.toHaveBeenCalled();
      } finally {
        server.publicationScheduler.stop(); await server.publicationScheduler.whenIdle();
        try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
        finally { publishNow.mockRestore(); await f.close(); }
      }
    } };
  } catch (error) { publishNow.mockRestore(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); await f.close(); throw error; }
}

describe("scheduled post management HTTP (exclusive PostgreSQL)", () => {
  it.each(["author", "member", "administrator", "owner"] as const)("GET returns safe detail and current %s permissions", async role => {
    const f = await fixture();
    try {
      const p = await f.post();
      const response = await f.request(p.postId, "GET", f[role]);
      expect(response.status).toBe(200);
      const detail = await response.json();
      expect(isPostDetail(detail)).toBe(true);
      expect(detail).toMatchObject({ post: { id: p.postId, authorUserId: f.author.context.user.id }, permissions: {
        canEditSchedule: role !== "member", canCancelSchedule: role !== "member",
      } });
      expect(JSON.stringify(detail)).not.toMatch(/token|metadata|storage|secret|path/i);
    } finally { await f.close(); }
  });

  it.each(["author", "administrator", "owner"] as const)("PATCH and DELETE authorize %s without changing author or publishing", async role => {
    const f = await fixture();
    try {
      const p = await f.post(); await f.eligible();
      const patch = await f.request(p.postId, "PATCH", f[role], { title: null, caption: "Edited" });
      expect(patch.status).toBe(200);
      const detail = await patch.json(); expect(isPostDetail(detail)).toBe(true);
      expect(detail).toMatchObject({ post: { title: null, caption: "Edited", authorUserId: f.author.context.user.id }, publications: [{ id: p.publications[0]!.id }] });
      for (let index = 0; index < 2; index++) {
        const cancelled = await f.request(p.postId, "DELETE", f[role]);
        expect(cancelled.status).toBe(204); expect(await cancelled.text()).toBe("");
        expect(cancelled.headers.get("content-type")).toBeNull();
      }
    } finally { await f.close(); }
  });

  it.each(["GET", "PATCH", "DELETE"])("%s gives the same 404 for foreign and unknown UUIDs", async method => {
    const f = await fixture();
    try {
      const p = await f.post({ tenantId: f.foreign.context.tenant.id, authorUserId: f.foreign.context.user.id });
      const results = [];
      for (const id of [p.postId, randomUUID()]) {
        const response = await f.request(id, method, f.owner, method === "PATCH" ? { title: "No" } : undefined);
        expect(response.status).toBe(404); results.push(await response.json());
      }
      expect(results[0]).toEqual({ error: { code: "post_not_found", message: "A publicação não foi encontrada." } });
      expect(results[1]).toEqual(results[0]);
    } finally { await f.close(); }
  });

  it.each(["GET", "PATCH", "DELETE"])("%s requires cookie and validates UUID before store use", async method => {
    const f = await fixture();
    try {
      const p = await f.post();
      const body = method === "PATCH" ? { caption: "Changed" } : undefined;
      const anonymous = await fetch(`${f.base}/posts/${p.postId}`, { method, headers: { Origin: ORIGIN, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect(anonymous.status).toBe(401); expect(anonymous.headers.get("cache-control")).toBe("no-store");
      const malformed = await f.request("not-a-uuid", method, f.author, body);
      expect(malformed.status).toBe(400); expect(await malformed.json()).toMatchObject({ error: { code: "invalid_post_id" } });
    } finally { await f.close(); }
  });

  it.each(["PATCH", "DELETE"])("%s rejects unauthorized member even when already cancelled", async method => {
    const f = await fixture();
    try {
      const p = await f.post();
      for (const cancelled of [false, true]) {
        if (cancelled) { await f.pool.query("UPDATE posts SET status='cancelled' WHERE id=$1", [p.postId]); await f.pool.query("UPDATE post_publications SET status='cancelled' WHERE post_id=$1", [p.postId]); }
        const response = await f.request(p.postId, method, f.member, method === "PATCH" ? { caption: "No" } : undefined);
        expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "post_forbidden" } });
      }
    } finally { await f.close(); }
  });

  it.each(["author", "member", "administrator", "owner"] as const)("published never becomes cancelled for %s", async role => {
    const f = await fixture();
    try {
      const p = await f.post(); await f.pool.query("UPDATE posts SET status='published',published_at=now() WHERE id=$1", [p.postId]);
      for (const method of ["PATCH", "DELETE"]) {
        const response = await f.request(p.postId, method, f[role], method === "PATCH" ? { caption: "No" } : undefined);
        expect(response.status).toBe(role === "member" ? 403 : 409);
        expect(await response.json()).toMatchObject({ error: { code: role === "member" ? "post_forbidden" : method === "PATCH" ? "post_not_editable" : "post_not_cancellable" } });
      }
      expect((await f.pool.query("SELECT status FROM posts WHERE id=$1", [p.postId])).rows[0].status).toBe("published");
    } finally { await f.close(); }
  });

  it.each([{}, { title: " " }, { socialAccountIds: [] }, { mediaAssetIds: ["bad"] },
    { tenantId: randomUUID() }, { authorUserId: randomUUID() }, { role: "owner" }, { status: "published" }, { publicationMode: "now" }])("rejects invalid/authority PATCH %j", async body => {
    const f = await fixture();
    try {
      const p = await f.post();
      const response = await f.request(p.postId, "PATCH", f.author, body);
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "invalid_post", fields: Object.keys(body).length ? Object.keys(body) : ["body"] } });
      expect((await f.pool.query("SELECT caption,status FROM posts WHERE id=$1", [p.postId])).rows[0]).toEqual({ caption: "Scheduled message", status: "scheduled" });
    } finally { await f.close(); }
  });

  it("maps transaction-level nonfuture dates to invalid_post with scheduledFor fields", async () => {
    const f = await fixture();
    try {
      const p = await f.post(); await f.eligible();
      const response = await f.request(p.postId, "PATCH", f.author, { scheduledFor: "2020-01-01T00:00:00.000Z" });
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: { code: "invalid_post", fields: ["scheduledFor"] } });
    } finally { await f.close(); }
  });

  it("GET list excludes cancelled but detail retains it", async () => {
    const f = await fixture();
    try {
      const p = await f.post(); expect((await f.request(p.postId, "DELETE")).status).toBe(204);
      const list = await fetch(`${f.base}/posts`, { headers: { Cookie: `socialflow_session=${f.author.token}`, Origin: ORIGIN } });
      expect(list.status).toBe(200); expect(await list.json()).toEqual([]);
      const detail = await f.request(p.postId); expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ post: { status: "cancelled" }, permissions: { canEditSchedule: false, canCancelSchedule: false } });
    } finally { await f.close(); }
  });

  it("preserves CORS, no-store, mutation Origin enforcement and resource Allow", async () => {
    const f = await fixture();
    try {
      const p = await f.post();
      for (const method of ["PATCH", "DELETE"]) for (const origin of [null, "https://evil.example"]) {
        const response = await f.request(p.postId, method, f.author, method === "PATCH" ? { caption: "No" } : undefined, origin);
        expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
      }
      const options = await f.request(p.postId, "OPTIONS"); expect(options.status).toBe(204);
      expect(options.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(options.headers.get("access-control-allow-credentials")).toBe("true");
      const invalidMethod = await f.request(p.postId, "POST", f.author, {});
      expect(invalidMethod.status).toBe(405); expect(invalidMethod.headers.get("allow")).toBe("GET, PATCH, DELETE, OPTIONS");
    } finally { await f.close(); }
  });
});
