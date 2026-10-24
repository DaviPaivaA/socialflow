import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isInsightsResponse } from "../../shared/insightsContract.ts";
import { createApiServer } from "../src/app.ts";
import type { AuthContext } from "../src/authService.ts";
import { InsightsService } from "../src/insightsService.ts";
import { MetaInsightsClientError, type InsightsTransport } from "../src/metaInsightsClient.ts";
import { cipher } from "./publicationFixtures.ts";
import { deferred, insightsPgFixture } from "./insightsFixtures.ts";

const ORIGIN = "http://localhost:5173";
const namespace = "/insights";
type Setup = Awaited<ReturnType<Awaited<ReturnType<typeof insightsPgFixture>>["setup"]>>;
let rangeForTest: string | undefined;
function accountRange(): string {
  if (rangeForTest === undefined) {
    const today = new Date(Date.now()); today.setUTCHours(0, 0, 0, 0);
    const until = new Date(today.getTime() - 86_400_000);
    const since = new Date(until.getTime() - 86_400_000);
    rangeForTest = new URLSearchParams({ since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) }).toString();
  }
  return rangeForTest;
}

describe("Meta Insights HTTP with exclusive PostgreSQL and real authorization", () => {
  let f: Awaited<ReturnType<typeof insightsPgFixture>>;
  const servers: ReturnType<typeof createApiServer>[] = [];
  beforeAll(async () => { f = await insightsPgFixture(); });
  beforeEach(() => { rangeForTest = undefined; });
  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.publicationScheduler.stop();
      await server.publicationScheduler.whenIdle();
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => { await f?.close(); });

  // Vitest transpilation must not hide syntax unsupported by the production
  // Node22 strip-only runtime. The child receives no inherited credentials.
  it("imports HTTP and app natively without environment secrets or runtime side effects", () => {
    const script = `
      import assert from "node:assert/strict";
      import net from "node:net";
      import http from "node:http";
      import https from "node:https";
      import timers from "node:timers";
      import { syncBuiltinESMExports } from "node:module";
      assert.deepEqual({ ...process.env }, { NODE_ENV: "test" });
      const attempts = { connection: 0, http: 0, listen: 0, timer: 0 };
      const deny = kind => () => { attempts[kind]++; throw new Error("Forbidden import side effect: " + kind); };
      net.Socket.prototype.connect = deny("connection");
      net.Server.prototype.listen = deny("listen");
      http.request = http.get = https.request = https.get = deny("http");
      globalThis.fetch = deny("http");
      for (const key of ["setTimeout", "setInterval", "setImmediate"]) globalThis[key] = timers[key] = deny("timer");
      syncBuiltinESMExports();
      await import("./server/src/insightsHttp.ts");
      await import("./server/src/app.ts");
      assert.deepEqual(attempts, { connection: 0, http: 0, listen: 0, timer: 0 });
      console.log(JSON.stringify({ node: process.version, attempts }));
    `;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(), env: { NODE_ENV: "test" }, encoding: "utf8", timeout: 10_000,
    });
    expect(JSON.parse(output)).toEqual({ node: process.version, attempts: { connection: 0, http: 0, listen: 0, timer: 0 } });
  });

  // Auth fixtures intentionally expose contexts, not raw cookies. Bind a fresh opaque
  // token to precisely that reader's real session; never bypass PostgresAuthService.
  async function cookie(context: AuthContext) {
    const raw = randomBytes(32).toString("base64url");
    await f.pool.query("UPDATE auth_sessions SET token_hash=$1 WHERE id=$2", [createHash("sha256").update(raw).digest("hex"), context.sessionId]);
    return `socialflow_session=${raw}`;
  }
  function path(a: Setup, instagram = false, publication = false) {
    return `${namespace}/${instagram ? "instagram" : "facebook"}/${publication ? "publications" : "accounts"}/${publication ? a.publicationId : a.socialAccountId}${publication ? "" : `?${accountRange()}`}`;
  }
  async function start(transport?: InsightsTransport) {
    const logger = { error: vi.fn() };
    const scheduler = vi.fn();
    const publishing = {
      publishText: vi.fn(), publishPhoto: vi.fn(), createInstagramContainer: vi.fn(),
      getInstagramContainerStatus: vi.fn(), publishInstagramContainer: vi.fn(),
      startFacebookReel: vi.fn(), uploadFacebookReel: vi.fn(), getFacebookReelStatus: vi.fn(), finishFacebookReel: vi.fn(),
    };
    const oauth = { buildAuthorizationUrl: vi.fn(), exchangeCode: vi.fn(), exchangeForLongLivedToken: vi.fn(),
      getIdentity: vi.fn(), getInstagramAccount: vi.fn(), getPermissions: vi.fn(), listPages: vi.fn() };
    const options = {
      pool: f.pool, corsOrigin: ORIGIN, authRateLimit: { maxAttempts: 100, windowMs: 60_000 },
      sessionCookie: { maxAgeSeconds: 3600, sameSite: "Lax" as const, secure: false }, sessionTtlSeconds: 3600,
      socialTokenCipher: cipher, logger, metaPublishingClient: publishing, metaOAuthClient: oauth,
      publicationSchedulerOptions: { setInterval: scheduler, clearInterval: vi.fn() },
      ...(transport ? { insightsTransportForTests: transport } : {}),
    };
    const server = createApiServer(options);
    servers.push(server);
    const publish = vi.spyOn(server.publicationCoordinator, "publishPostNow");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No ephemeral HTTP address");
    const base = `http://127.0.0.1:${address.port}`;
    const fetchLocal = globalThis.fetch;
    async function get(target: string, session?: string, method = "GET", origin: string | null = ORIGIN) {
      return fetchLocal(`${base}${target}`, { method, headers: {
        ...(session ? { Cookie: session } : {}), ...(origin === null ? {} : { Origin: origin }),
      } });
    }
    function noEffects() {
      expect(publish).not.toHaveBeenCalled(); expect(scheduler).not.toHaveBeenCalled();
      for (const method of Object.values(publishing)) expect(method).not.toHaveBeenCalled();
      for (const method of Object.values(oauth)) expect(method).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    }
    return { server, base, get, noEffects, logger };
  }
  async function error(response: Response, status: number, code: string) {
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.error.code).toBe(code); expect(typeof body.error.message).toBe("string");
    expect(JSON.stringify(body)).not.toMatch(/private|secret|access_token|graph\.facebook|SELECT|stack|cipher/i);
    return body;
  }
  function zeroTransport(): InsightsTransport {
    return async descriptor => ({ status: 200, body: { data: [{
      name: descriptor.parameters.metric.split(",")[0],
      period: descriptor.scope === "instagram_media" ? "lifetime" : descriptor.parameters.period,
      ...(descriptor.scope === "instagram_account" && descriptor.parameters.metric_type === "total_value"
        ? { total_value: { value: 0 } }
        : { values: [{ value: 0, end_time: "2026-10-19T00:00:00+0000" }] }),
    }] } });
  }
  async function bounded<T>(promise: Promise<T>, ms = 1200): Promise<T | "limit"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<"limit">(resolve => { timer = setTimeout(() => resolve("limit"), ms); })]); }
    finally { clearTimeout(timer); }
  }

  it("keeps the default IG account fixture eligible in a future calendar without fake timers", async () => {
    const a = await f.setup(true); const session = await cookie(a.context);
    const futureYear = new Date(Date.now()).getUTCFullYear() + 5;
    const futureNow = Date.parse(`${futureYear}-04-05T12:00:00Z`);
    // PG authentication uses its own real clock. Extend only this proof's local
    // session so the service's future clock tests the range, not session expiry.
    await f.pool.query("UPDATE auth_sessions SET expires_at=$1 WHERE id=$2", [new Date(futureNow + 3_600_000), a.context.sessionId]);
    const clock = vi.spyOn(Date, "now").mockReturnValue(futureNow);
    const entered = deferred<boolean>(); const release = deferred<void>();
    const wire = vi.fn<InsightsTransport>(async (descriptor, credential, signal) => {
      entered.resolve(true); await release.promise;
      return zeroTransport()(descriptor, credential, signal);
    });
    const h = await start(wire); const target = path(a, true); const pending = h.get(target, session);
    try {
      expect(await bounded(Promise.race([entered.promise, pending.then(response => response.status)]))).toBe(true);
      release.resolve();
      const response = await pending; expect(response.status).toBe(200); expect(isInsightsResponse(await response.json())).toBe(true);
      // Hand-selected UTC days preceding the future instant, independent of the
      // fixture's window builder and of production's epoch conversion.
      expect(wire.mock.calls[0][0].parameters).toMatchObject({
        since: Date.parse(`${futureYear}-04-03T00:00:00Z`) / 1000,
        until: Date.parse(`${futureYear}-04-04T00:00:00Z`) / 1000,
      });
      h.noEffects();
      // Advancing only Date.now must not change the fixture mid-test, even when
      // the later path construction falls on the next UTC day.
      clock.mockReturnValue(futureNow + 86_400_000);
      expect(path(a, true)).toBe(target);
    } finally { release.resolve(); await pending.catch(() => undefined); }
  });

  // Catches missing routes, scalar/default fake output and cross-scope parameter loss.
  it.each([
    [false, false, "facebook_page", "page_media_view", "day"],
    [false, true, "facebook_post", "post_media_view", "lifetime"],
    [true, false, "instagram_account", "views", "day"],
    [true, true, "instagram_media", "views", "lifetime"],
  ] as const)("returns exact points DTO for %s/%s (%s), preserves real zero", async (ig, publication, scope, metric, period) => {
    const a = await f.setup(ig, ig ? "instagram_image" : "text");
    const wire = vi.fn(zeroTransport()); const h = await start(wire);
    const target = path(a, ig, publication);
    const requestedDates = new URL(target, "http://localhost").searchParams;
    const response = await h.get(target, await cookie(a.context), "GET", null);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = await response.json(); expect(isInsightsResponse(body)).toBe(true);
    expect(body).toEqual({ scope, period, graphApiVersion: "v26.0", fetchedAt: expect.any(String),
      metrics: [{ name: metric, status: "available", points: [{ value: 0, endTime: scope === "instagram_account" ? null : "2026-10-19T00:00:00+0000" }] }] });
    expect(wire.mock.calls[0][0]).toMatchObject({ scope, objectId: publication ? (ig ? "444" : "100_444") : (ig ? "200" : "100"),
      parameters: { metric, ...(publication ? {} : {
        since: Date.parse(`${requestedDates.get("since")}T00:00:00Z`) / 1000,
        until: Date.parse(`${requestedDates.get("until")}T00:00:00Z`) / 1000,
      }) } });
    expect(wire.mock.calls[0][1]).toMatchObject({ tokenKind: ig ? "user" : "page", accessToken: ig ? "user-token" : "private-page-token" });
    expect(JSON.stringify(body)).not.toMatch(/token|secret|objectId|providerPostId|socialAccountId|total_value/); h.noEffects();
  });

  it("preserves absence and partial availability without fabricating zero", async () => {
    const a = await f.setup(); const h = await start(zeroTransport());
    const response = await h.get(`${path(a)}&metrics=page_media_view,page_video_views`, await cookie(a.context));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ metrics: [
      { name: "page_media_view", status: "available", points: [{ value: 0 }] },
      { name: "page_video_views", status: "not_available", points: [{ value: null, endTime: null }] },
    ] }); h.noEffects();
  });
  it.each(["owner", "admin", "member"])("lets %s read another author's publication even after author removal", async role => {
    const a = await f.setup(); const other = await f.post();
    const ctx = await f.reader(a.tenantId, other.authorUserId, role);
    await f.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [a.tenantId, a.authorUserId]);
    const h = await start(zeroTransport()); const response = await h.get(path(a, false, true), await cookie(ctx));
    expect(response.status).toBe(200); expect(isInsightsResponse(await response.json())).toBe(true); h.noEffects();
  });
  it.each(["none", "invalid", "expired", "revoked"])("requires real %s session before UUID/query validation", async state => {
    const a = await f.setup(); const session = state === "none" ? undefined : state === "invalid" ? "socialflow_session=invalid" : await cookie(a.context);
    if (state === "expired") await f.pool.query("UPDATE auth_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE id=$1", [a.context.sessionId]);
    if (state === "revoked") await f.pool.query("DELETE FROM auth_sessions WHERE id=$1", [a.context.sessionId]);
    const wire = vi.fn(zeroTransport()); const h = await start(wire);
    await error(await h.get("/insights/facebook/accounts/bad?token=secret", session), 401, "unauthorized");
    expect(wire).not.toHaveBeenCalled(); h.noEffects();
  });
  it.each(["100", "100_444", "bad", "00000000-0000-0000-0000-00000000000g"])("rejects invalid local UUID %s without decrypting", async id => {
    const a = await f.setup(); const h = await start(zeroTransport()); const decrypt = vi.spyOn(cipher, "decryptSecret");
    await error(await h.get(`/insights/facebook/accounts/${id}?${accountRange()}`, await cookie(a.context)), 400, "invalid_insights_id");
    expect(decrypt).not.toHaveBeenCalled(); h.noEffects();
  });
  it.each([false, true])("hides foreign and unknown resources identically (publication=%s)", async publication => {
    const a = await f.setup(); const b = await f.setup(); const h = await start(zeroTransport()); const session = await cookie(a.context);
    const first = await error(await h.get(path(b, false, publication), session), 404, "insights_not_found");
    const unknown = path(b, false, publication).replace(publication ? b.publicationId : b.socialAccountId, randomUUID());
    expect(await error(await h.get(unknown, session), 404, "insights_not_found")).toEqual(first);
    if (publication) await error(await h.get(path(a, false, true).replace(a.publicationId, a.postId), session), 404, "insights_not_found");
    h.noEffects();
  });
  // Each row catches a validation branch that otherwise reaches decrypt/provider.
  it.each([
    "", "since=2026-10-01", "until=2026-10-19", "since=&until=2026-10-19",
    "since=2026-02-30&until=2026-03-02", "since=2026-2-01&until=2026-03-02",
    "since=2026-10-01T00:00:00Z&until=2026-10-19", "since=%202026-10-01&until=2026-10-19",
    "since=1970-01-01&until=1970-01-02", "since=2026-10-19&until=2026-10-19",
    "since=2026-10-20&until=2026-10-19", "since=2099-01-01&until=2099-01-02",
    "since=2020-01-01&until=2020-01-02", "since=2026-01-01&until=2026-10-19",
    `${accountRange()}&metrics=`, `${accountRange()}&metrics=page_media_view,`, `${accountRange()}&metrics=,page_media_view`,
    `${accountRange()}&metrics=page_media_view,page_media_view`, `${accountRange()}&metrics=%20page_media_view`,
    `${accountRange()}&metrics=views`, `${accountRange()}&metrics=page_media_view&metrics=page_video_views`,
    `${accountRange()}&metr%69cs=page_media_view&metrics=page_video_views`,
    `${accountRange()}&since=2026-10-02`, `${accountRange()}&period=day&period=week`, `${accountRange()}&period=`,
    `${accountRange()}&period=lifetime`, `${accountRange()}&metricType=total_value`,
    ...["tenantId", "userId", "membershipId", "sessionId", "role", "url", "host", "token", "access_token", "graphApiVersion", "objectId", "socialAccountId", "publicationId", "unknown"].map(key => `${accountRange()}&${key}=secret`),
  ])("rejects account syntax/authority query %s before decrypt and Graph", async query => {
    const a = await f.setup(); const wire = vi.fn(zeroTransport()); const h = await start(wire); const decrypt = vi.spyOn(cipher, "decryptSecret");
    await error(await h.get(`${path(a).split("?")[0]}?${query}`, await cookie(a.context)), 400, "invalid_insights_query");
    expect(decrypt).not.toHaveBeenCalled(); expect(wire).not.toHaveBeenCalled(); h.noEffects();
  });
  it.each(["since=2026-10-01", "until=2026-10-19", "metricType=total_value", "period=day", "metrics=post_media_view,post_media_view", "metrics=post_media_view,post_reactions_like_total,post_reactions_love_total,post_reactions_wow_total,post_reactions_haha_total"])("rejects publication query %s", async query => {
    const a = await f.setup(); const wire = vi.fn(zeroTransport()); const h = await start(wire); const decrypt = vi.spyOn(cipher, "decryptSecret");
    await error(await h.get(`${path(a, false, true)}?${query}`, await cookie(a.context)), 400, "invalid_insights_query");
    expect(decrypt).not.toHaveBeenCalled(); expect(wire).not.toHaveBeenCalled(); h.noEffects();
  });
  it.each(["metricType=unknown", "metricType=time_series", "metricType=time_series&metrics=reach,views", "metricType=", "metrics=page_media_view", "since=2026-06-01&until=2026-06-02"])("rejects IG account query %s", async query => {
    const a = await f.setup(true); const wire = vi.fn(zeroTransport()); const h = await start(wire); const decrypt = vi.spyOn(cipher, "decryptSecret");
    const q = query.startsWith("since=") ? query : `${accountRange()}&${query}`;
    await error(await h.get(`${path(a, true).split("?")[0]}?${q}`, await cookie(a.context)), 400, "invalid_insights_query");
    expect(decrypt).not.toHaveBeenCalled(); expect(wire).not.toHaveBeenCalled(); h.noEffects();
  });
  it("accepts IG reach time_series and FB week selection", async () => {
    const ig = await f.setup(true); const fb = await f.setup(); const wire = vi.fn(zeroTransport()); const h = await start(wire);
    for (const [a, target] of [[ig, `${path(ig, true)}&metrics=reach&metricType=time_series`], [fb, `${path(fb)}&period=week`]] as const) {
      const response = await h.get(target, await cookie(a.context)); expect(response.status).toBe(200); expect(isInsightsResponse(await response.json())).toBe(true);
    }
    expect(wire.mock.calls[0][0].parameters).toMatchObject({ metric: "reach", metric_type: "time_series", period: "day" });
    expect(wire.mock.calls[1][0].parameters.period).toBe("week"); h.noEffects();
  });

  it.each([
    ["grants", 409, "meta_insights_permission_required"], ["partial-grants", 409, "meta_insights_permission_required"],
    ["disconnected", 409, "meta_insights_permission_required"], ["token-expired", 409, "meta_insights_token_expired"],
    ["ig-proof", 409, "meta_insights_unsupported_object"], ["ig-link", 409, "meta_insights_permission_required"],
    ["media", 409, "meta_insights_unsupported_object"], ["wrong-account", 409, "meta_insights_unsupported_object"],
  ] as const)("rejects %s evidence without decrypt/Graph or credential mutation", async (state, status, code) => {
    const ig = state.startsWith("ig-"); const a = await f.setup(ig, ig ? "instagram_image" : "photo");
    if (state === "grants") await f.pool.query("UPDATE oauth_connections SET scopes='{}' WHERE id=$1", [a.connectionId]);
    if (state === "partial-grants") await f.pool.query("UPDATE oauth_connections SET scopes=ARRAY['read_insights'] WHERE id=$1", [a.connectionId]);
    if (state === "disconnected") await f.pool.query("UPDATE social_accounts SET is_active=false,disconnected_at=now() WHERE id=$1", [a.socialAccountId]);
    if (state === "token-expired") await f.pool.query("UPDATE social_account_credentials SET access_token_expires_at=now()-interval '1 second' WHERE social_account_id=$1", [a.socialAccountId]);
    if (state === "ig-proof") await f.pool.query("UPDATE publication_operations SET stage='unknown' WHERE publication_id=$1", [a.publicationId]);
    if (state === "ig-link") await f.pool.query("UPDATE social_accounts SET metadata='{}' WHERE id=$1", [a.socialAccountId]);
    if (state === "media") await f.pool.query("UPDATE media_assets SET deleted_at=now() WHERE tenant_id=$1", [a.tenantId]);
    const before = (await f.pool.query("SELECT access_token_encrypted,status,scopes FROM oauth_connections WHERE id=$1", [a.connectionId])).rows;
    const wire = vi.fn(zeroTransport()); const h = await start(wire); const decrypt = vi.spyOn(cipher, "decryptSecret");
    await error(await h.get(path(a, state === "wrong-account" ? true : ig, state === "ig-proof" || state === "media"), await cookie(a.context)), status, code);
    expect(decrypt).not.toHaveBeenCalled(); expect(wire).not.toHaveBeenCalled();
    expect((await f.pool.query("SELECT access_token_encrypted,status,scopes FROM oauth_connections WHERE id=$1", [a.connectionId])).rows).toEqual(before); h.noEffects();
  });
  it.each([
    ["quota", 429, 429, "meta_insights_rate_limited", { error: { code: 4, message: "private Graph token secret" } }],
    ["Page quota 80001", 400, 429, "meta_insights_rate_limited", { error: { code: 80001, message: "private Graph token secret" } }],
    ["permission", 400, 409, "meta_insights_permission_required", { error: { code: 200, message: "private Graph token secret" } }],
    ["expired", 400, 409, "meta_insights_token_expired", { error: { code: 190, message: "private Graph token secret" } }],
    ["invalid-query", 400, 400, "invalid_insights_query", { error: { code: 100, message: "private Graph token secret" } }],
    ["transient", 503, 503, "meta_insights_provider_unavailable", { error: { is_transient: true, message: "private Graph token secret" } }],
  ] as const)("maps Graph %s (provider HTTP %s) to HTTP %s with code %s", async (_name, providerStatus, status, code, body) => {
    const a = await f.setup(); const h = await start(async () => ({ status: providerStatus, body }));
    const response = await h.get(path(a), await cookie(a.context)); expect(response.headers.get("retry-after")).toBeNull();
    await error(response, status, code);
    h.noEffects();
  });
  // These are characterizations of the approved core's sanitization policy,
  // not claims that an adapter exception is a trusted service error.
  it.each(["unsupported_object", "aborted"] as const)("sanitizes unexpected typed transport throw %s as provider unavailable", async code => {
    const a = await f.setup();
    const hostile = Object.assign(new MetaInsightsClientError(code), { message: "private credential secret", cause: "private provider raw exception" });
    const h = await start(async () => { throw hostile; });
    await error(await h.get(path(a), await cookie(a.context)), 503, "meta_insights_provider_unavailable"); h.noEffects();
  });
  it("returns a sanitized real client timeout while the HTTP connection remains usable", async () => {
    const a = await f.setup(); const entered = deferred<boolean>();
    const h = await start(async () => { entered.resolve(true); return new Promise(() => {}); });
    const pending = h.get(path(a), await cookie(a.context));
    expect(await bounded(Promise.race([entered.promise, pending.then(() => false)]))).toBe(true);
    await error(await pending, 503, "meta_insights_timeout"); h.noEffects();
  });
  it.each(["throw", "invalid-body"])("maps unexpected %s to sanitized 503 without raw logs", async state => {
    const a = await f.setup(); const h = await start(async () => {
      if (state === "throw") throw new Error("private SELECT access_token secret");
      return { status: 200, body: { data: [{ name: "page_media_view", period: "day", values: [{ value: -1 }] }] } };
    });
    await error(await h.get(path(a), await cookie(a.context)), 503, "meta_insights_provider_unavailable"); h.noEffects();
  });
  it("defaults to blocked transport with no fetch/HTTPS/Meta or publication side effects", async () => {
    const a = await f.setup(); const h = await start();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network must not run"));
    const httpsSpy = vi.spyOn(https, "request").mockImplementation(() => { throw new Error("Network must not run"); });
    await error(await h.get(path(a), await cookie(a.context)), 503, "meta_insights_not_enabled");
    expect(fetchSpy).not.toHaveBeenCalled(); expect(httpsSpy).not.toHaveBeenCalled(); h.noEffects();
  });
  it("refuses the test transport outside NODE_ENV=test", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(start(zeroTransport())).rejects.toThrow(/test/i);
  });
  it.each(["/insights", "/insights/", "/insights/tiktok/accounts/id", "/insights/facebook/media/id", "/insights/instagram/accounts/id/media", "/insights/facebook/accounts/id/extra"])("keeps unknown path %s at 404 with namespace headers", async target => {
    const h = await start(zeroTransport()); const response = await h.get(target);
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff"); h.noEffects();
  });
  it("preserves CORS/OPTIONS/cookies and namespace headers even on Origin rejection", async () => {
    const a = await f.setup(); const h = await start(zeroTransport()); const session = await cookie(a.context);
    const options = await h.get(path(a), undefined, "OPTIONS"); expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(options.headers.get("access-control-allow-credentials")).toBe("true"); expect(options.headers.get("vary")).toBe("Origin");
    expect(options.headers.get("cache-control")).toBe("no-store"); expect(options.headers.get("x-content-type-options")).toBe("nosniff");
    for (const method of ["GET", "POST"]) {
      await error(await h.get(path(a), session, method, "https://evil.example"), 403, "origin_not_allowed");
    }
    await error(await h.get(path(a), session, "POST", null), 403, "origin_not_allowed"); h.noEffects();
  });
  it.each(["HEAD", "POST", "PATCH", "DELETE", "PUT"])("rejects method %s with resource Allow", async method => {
    const a = await f.setup(); const h = await start(zeroTransport());
    const response = await h.get(path(a), await cookie(a.context), method); expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, OPTIONS"); expect(response.headers.get("cache-control")).toBe("no-store"); h.noEffects();
  });

  // Real SQL changes while the provider is pending exercise the service's final
  // authorization reload through HTTP; bounded entry waits expose missing routing.
  it.each(["success", "error"] as const)("revalidates SQL mutations before releasing provider %s", async outcome => {
    for (const change of ["session", "membership", "workspace", "disconnect", "rotation"] as const) {
      const a = await f.setup(); const session = await cookie(a.context);
      const entered = deferred<boolean>(); const release = deferred<void>();
      const h = await start(async () => { entered.resolve(true); await release.promise;
        if (outcome === "error") throw new Error("private provider credential");
        return zeroTransport()({ scope: "facebook_page", parameters: { metric: "page_media_view", period: "day" } } as Parameters<InsightsTransport>[0], {} as Parameters<InsightsTransport>[1], new AbortController().signal);
      });
      const pending = h.get(path(a), session);
      try {
        expect(await bounded(Promise.race([entered.promise, pending.then(() => false)]))).toBe(true);
        if (change === "session") await f.pool.query("DELETE FROM auth_sessions WHERE id=$1", [a.context.sessionId]);
        if (change === "membership") await f.pool.query("DELETE FROM tenant_members WHERE id=$1", [a.context.membershipId]);
        if (change === "workspace") { const other = await f.setup(); await f.pool.query("UPDATE auth_sessions SET membership_id=$1 WHERE id=$2", [other.context.membershipId, a.context.sessionId]); }
        if (change === "disconnect") await f.pool.query("UPDATE social_accounts SET is_active=false,disconnected_at=now() WHERE id=$1", [a.socialAccountId]);
        if (change === "rotation") await f.pool.query("UPDATE social_account_credentials SET access_token_encrypted=$1 WHERE social_account_id=$2", [Buffer.from(cipher.encryptSecret("rotated-token")), a.socialAccountId]);
        release.resolve();
        await error(await pending, change === "disconnect" ? 409 : change === "rotation" ? 503 : 401,
          change === "disconnect" ? "meta_insights_permission_required" : change === "rotation" ? "meta_insights_provider_unavailable" : "unauthorized"); h.noEffects();
      } finally { release.resolve(); await pending.catch(() => undefined); }
    }
  });
  it("keeps reversed FB/IG and tenant completions isolated with Page vs User credentials", async () => {
    const fb = await f.setup(); const ig = await f.setup(true); const gates = [deferred<void>(), deferred<void>()]; const entered = [deferred<boolean>(), deferred<boolean>()];
    const wire = vi.fn<InsightsTransport>(async (descriptor, credential) => {
      const index = descriptor.scope === "facebook_page" ? 0 : 1;
      if (credential.tokenKind !== (index ? "user" : "page") || credential.accessToken !== (index ? "user-token" : "private-page-token")) throw new Error("Credential cross-over");
      entered[index].resolve(true); await gates[index].promise;
      return { status: 200, body: { data: [{ name: index ? "views" : "page_media_view", period: "day", ...(index ? { total_value: { value: 22 } } : { values: [{ value: 11, end_time: "2026-10-19T00:00:00+0000" }] }) }] } };
    });
    const h = await start(wire); const first = h.get(path(fb), await cookie(fb.context)); const second = h.get(path(ig, true), await cookie(ig.context));
    try {
      expect(await bounded(Promise.race([Promise.all(entered.map(x => x.promise)), Promise.all([first, second]).then(() => false)]))).toEqual([true, true]);
      gates[1].resolve(); const b = await second; expect(b.status).toBe(200); expect(await b.json()).toMatchObject({ scope: "instagram_account", metrics: [{ points: [{ value: 22 }] }] });
      gates[0].resolve(); const a = await first; expect(a.status).toBe(200); expect(await a.json()).toMatchObject({ scope: "facebook_page", metrics: [{ points: [{ value: 11 }] }] }); h.noEffects();
    } finally { gates.forEach(x => x.resolve()); await Promise.allSettled([first, second]); }
  });
  it.each([
    ["lookup", false], ["provider", false], ["reload", false], ["lookup", true], ["reload", true],
  ] as const)("aborts abandoned HTTP during %s (late SQL rejection=%s) without late response/log", async (phase, lateReject) => {
    const a = await f.setup(); const session = await cookie(a.context); const entered = deferred<boolean>(); const release = deferred<void>(); const aborted = deferred<boolean>();
    let reads = 0; let signal: AbortSignal | undefined;
    const serviceQuery = vi.spyOn(InsightsService.prototype, "query");
    const original = f.pool.query.bind(f.pool);
    if (phase !== "provider") {
      // Preserve real SQL and results; only hold delivery of the selected read.
      vi.spyOn(f.pool, "query").mockImplementation((async (...args: Parameters<typeof original>) => {
        const sql = args[0]; const result = await original(...args);
        if (typeof sql === "string" && sql.includes("WITH reader AS MATERIALIZED") && ++reads === (phase === "lookup" ? 1 : 2)) {
          entered.resolve(true); await release.promise;
          if (lateReject) throw new Error("private late SQL credential error");
        }
        return result;
      }) as typeof f.pool.query);
    }
    const wire = vi.fn<InsightsTransport>(async (descriptor, credential, incoming) => {
      signal = incoming; incoming.addEventListener("abort", () => aborted.resolve(true), { once: true });
      if (phase === "provider") { entered.resolve(true); await release.promise; throw new Error("private late Graph rejection"); }
      return zeroTransport()(descriptor, credential, incoming);
    });
    const h = await start(wire); let delivered = false;
    let incomingRequest: IncomingMessage | undefined; let outgoingResponse: ServerResponse | undefined;
    let responseEnd: ReturnType<typeof vi.spyOn> | undefined;
    h.server.prependOnceListener("request", (request, response) => {
      incomingRequest = request; outgoingResponse = response; responseEnd = vi.spyOn(response, "end");
    });
    const client = httpRequest(`${h.base}${path(a)}`, { headers: { Cookie: session } }, response => { delivered = true; response.resume(); });
    const closed = new Promise<void>(resolve => { client.on("error", () => resolve()); client.on("close", () => resolve()); }); client.end();
    try {
      expect(await bounded(Promise.race([entered.promise, closed.then(() => false)]))).toBe(true);
      const serviceSignal = serviceQuery.mock.calls[0]?.[2]?.signal;
      expect(serviceSignal).toBeInstanceOf(AbortSignal);
      const serviceAborted = new Promise<boolean>(resolve => {
        if (serviceSignal!.aborted) resolve(true);
        else serviceSignal!.addEventListener("abort", () => resolve(true), { once: true });
      });
      client.destroy(); await closed;
      expect(await bounded(serviceAborted)).toBe(true);
      if (phase === "provider") expect(await bounded(aborted.promise)).toBe(true);
      release.resolve();
      await Promise.allSettled(serviceQuery.mock.results.map(result => result.value));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(delivered).toBe(false); if (phase === "lookup") expect(wire).not.toHaveBeenCalled();
      expect(responseEnd).not.toHaveBeenCalled();
      expect(incomingRequest?.listenerCount("aborted")).toBe(0);
      expect(outgoingResponse?.listenerCount("close")).toBe(0);
      if (phase === "provider") expect(signal?.aborted).toBe(true); h.noEffects();
    } finally { client.destroy(); release.resolve(); await closed; }
  });
});
