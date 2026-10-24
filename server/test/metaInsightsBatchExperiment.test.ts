import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  buildSyntheticBatchRequest, calculateProof, runBatchExperiment, verifyProof,
} from "../experiments/metaInsightsBatchExperiment.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const query = {
  pageId: "123456", graphApiVersion: "v26.0", metric: "page_media_view", period: "day",
  since: 1792454400, until: 1792540800,
} as const;
const value = { data: [{ name: "page_media_view", period: "day", values: [
  { value: 0, end_time: "2026-10-21T00:00:00+0000" },
] }] };
const batch = (body: unknown = value, code = 200) => [{ code, headers: [], body: JSON.stringify(body) }];
const stream = (text: string) => (async function* () { yield Buffer.from(text); })();
const response = (body: unknown = batch(), status = 200) => ({ status, body: stream(JSON.stringify(body)) });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("isolated synthetic Batch experiment", () => {
  // Wrong key/message order or non-HMAC hashing must fail the independent RFC4231 vector.
  it("computes RFC4231 HMAC-SHA256 and rejects a wrong proof", () => {
    const proof = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
    expect(calculateProof("what do ya want for nothing?", "Jefe")).toBe(proof);
    expect(verifyProof("what do ya want for nothing?", "Jefe", proof)).toBe(true);
    expect(verifyProof("what do ya want for nothing?", "Jefe", "0".repeat(64))).toBe(false);
    expect(verifyProof("what do ya want for nothing?", "Jefe", "short")).toBe(false);
  });

  // A host override, token in relative_url, write method or incorrect encoding breaks this boundary.
  it("builds one encoded GET with synthetic credentials only in the external multipart", () => {
    const request = buildSyntheticBatchRequest(query, NOW);
    expect(request.url).toBe("https://graph.facebook.com/v26.0/");
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.headers).toEqual({ "accept-encoding": "identity" });
    expect(request.body).toBeInstanceOf(FormData);
    expect([...request.body.keys()].sort()).toEqual(["access_token", "appsecret_proof", "batch"]);
    expect(request.body.get("access_token")).toBe("SYNTHETIC_PAGE_TOKEN_10A_+&=");
    const proof = request.body.get("appsecret_proof");
    expect(typeof proof).toBe("string");
    expect(verifyProof("SYNTHETIC_PAGE_TOKEN_10A_+&=", "SYNTHETIC_APP_SECRET_10A", String(proof))).toBe(true);
    const operations = JSON.parse(String(request.body.get("batch")));
    expect(operations).toEqual([{ method: "GET", relative_url:
      "123456/insights?metric=page_media_view&period=day&since=1792454400&until=1792540800" }]);
    expect(JSON.stringify(operations)).not.toContain("SYNTHETIC");
    expect(JSON.stringify(operations)).not.toContain(String(proof));
    // Native serialization must encode reserved characters in a multipart field as data, not query syntax.
    expect(new Request(request.url, { method: "POST", body: request.body }).headers.get("content-type"))
      .toMatch(/^multipart\/form-data; boundary=/);
  });

  it.each([
    { pageId: "https://evil.test/1" }, { pageId: "../123" }, { pageId: "123?access_token=bad" },
    { pageId: "1_2" }, { pageId: "" }, { metric: "bad" }, { period: "lifetime" },
    { graphApiVersion: "v25.0" }, { since: 1 }, { until: query.since }, { since: 1.5 },
    { until: NOW / 1000 + 1 }, { host: "evil.test" }, { token: "secret" },
    { access_token: "secret" }, { appsecret_proof: "secret" }, { scope: "instagram_account" },
  ])("refuses invalid or unapproved operation %j before HTTP", async (patch) => {
    const http = vi.fn(async () => response());
    const report = await runBatchExperiment({ ...query, ...patch } as unknown as typeof query, { now: NOW, http });
    expect(report.outcome).toBe("invalid_query");
    expect(http).not.toHaveBeenCalled();
  });

  it("runs dry by default without global fetch and reports zero as available", async () => {
    const fetch = vi.fn(() => { throw new Error("unexpected network"); });
    vi.stubGlobal("fetch", fetch);
    const report = await runBatchExperiment(query, { now: NOW });
    expect(report).toEqual({ mode: "dry_run", simulated: true, realMetaValidated: false,
      family: "facebook_page", graphApiVersion: "v26.0", metric: "page_media_view",
      outcome: "available", outerStatus: 200, innerStatus: 200 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a valid empty result unavailable rather than fabricating zero", async () => {
    expect((await runBatchExperiment(query, { now: NOW, http: async () => response(batch({ data: [] })) })).outcome)
      .toBe("not_available");
  });

  it.each([4, 17, 32, 613, 80001])("classifies inner Graph %i as rate limit without retry", async (code) => {
    const http = vi.fn(async () => response(batch({ error: { code, message: "untrusted" } }, 400)));
    const result = await runBatchExperiment(query, { now: NOW, http });
    expect(result.outcome).toBe("rate_limited");
    expect(result.outerStatus).toBe(200);
    expect(result.innerStatus).toBe(400);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([
    [190, "token_expired"], [200, "permission_required"], [100, "invalid_query"],
    [2, "provider_unavailable"], ["80001", "provider_unavailable"], [null, "provider_unavailable"],
  ])("classifies validated Graph %s, not message substrings", async (code, outcome) => {
    const result = await runBatchExperiment(query, { now: NOW,
      http: async () => response(batch({ error: { code, message: "80001" } }, 400)) });
    expect(result.outcome).toBe(outcome);
  });

  it.each([400, 401, 403, 429, 500])("does not confuse outer HTTP %i with inner success", async (status) => {
    const result = await runBatchExperiment(query, { now: NOW, http: async () => response({}, status) });
    expect(result.outcome).toBe(status === 429 ? "rate_limited" : "provider_unavailable");
    expect(result.outerStatus).toBe(status);
    expect(result.innerStatus).toBeNull();
  });

  it("preserves an outer structured Graph error", async () => {
    expect((await runBatchExperiment(query, { now: NOW,
      http: async () => response({ error: { code: 80001 } }, 400) })).outcome).toBe("rate_limited");
  });

  it.each([{ body: [null] }, { body: [] }, { body: [...batch(), ...batch()] }])("refuses incomplete batch %j", async ({ body }) => {
    expect((await runBatchExperiment(query, { now: NOW, http: async () => response(body) })).outcome)
      .toBe("incomplete_response");
  });

  it.each([
    { body: [{ code: "200", body: "{}" }] }, { body: [{ code: 200, body: {} }] },
    { body: [{ code: 200, body: "invalid json" }] },
    { body: [{ code: 200, body: JSON.stringify({ data: [{ name: "page_media_view", period: "day", values: [{ value: -1 }] }] }) }] },
  ])("refuses malformed inner response %j", async ({ body }) => {
    expect((await runBatchExperiment(query, { now: NOW, http: async () => response(body) })).outcome)
      .toBe("invalid_response");
  });

  it("rejects invalid outer JSON without exposing it", async () => {
    const result = await runBatchExperiment(query, { now: NOW,
      http: async () => ({ status: 200, body: stream("secret invalid json") }) });
    expect(result.outcome).toBe("invalid_response");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("refuses pagination rather than following a credential-bearing next URL", async () => {
    const http = vi.fn(async () => response(batch({ ...value, paging: { next: "https://evil.test/?access_token=secret" } })));
    const report = await runBatchExperiment(query, { now: NOW, http });
    expect(report.outcome).toBe("incomplete_response");
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 303, 307, 308])("refuses redirect HTTP %i without reissuing", async (status) => {
    const http = vi.fn(async () => ({ status, headers: { location: "https://evil.test/" }, body: stream("") }));
    expect((await runBatchExperiment(query, { now: NOW, http })).outcome).toBe("redirect_blocked");
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("bounds streamed response bytes and closes the iterator on excess", async () => {
    let closed = false;
    let reads = 0;
    const body = (async function* () { try {
      for (let i = 0; i < 4; i++) { reads++; yield Buffer.alloc(600_000); }
    } finally { closed = true; } })();
    const result = await runBatchExperiment(query, { now: NOW, http: async () => ({ status: 200, body }) });
    expect(result.outcome).toBe("response_too_large");
    expect(reads).toBe(2);
    expect(closed).toBe(true);
  });

  it("rejects compressed responses in this identity-only probe", async () => {
    expect((await runBatchExperiment(query, { now: NOW, http: async () => ({
      ...response(), headers: { "content-encoding": "gzip" },
    }) })).outcome).toBe("invalid_response");
  });

  it("preserves HTTP429 quota even when no JSON body can be parsed", async () => {
    const http = vi.fn(async () => ({ status: 429, body: stream("") }));
    const result = await runBatchExperiment(query, { now: NOW, http });
    expect(result.outcome).toBe("rate_limited");
    expect(result.outerStatus).toBe(429);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("preserves inner HTTP429 quota even when its body is HTML", async () => {
    const http = vi.fn(async () => response([{ code: 429, headers: [], body: "<html>quota</html>" }]));
    const result = await runBatchExperiment(query, { now: NOW, http });
    expect(result.outcome).toBe("rate_limited");
    expect(result.outerStatus).toBe(200);
    expect(result.innerStatus).toBe(429);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("rejects compression regardless of header capitalization", async () => {
    const result = await runBatchExperiment(query, { now: NOW, http: async () => ({
      ...response(), headers: { "Content-Encoding": "gzip" },
    }) });
    expect(result.outcome).toBe("invalid_response");
  });

  it("classifies invalid UTF8 as malformed input instead of a provider outage", async () => {
    const result = await runBatchExperiment(query, { now: NOW, http: async () => ({
      status: 200, body: (async function* () { yield Buffer.from([0xc3, 0x28]); })(),
    }) });
    expect(result.outcome).toBe("invalid_response");
  });

  it("covers waiting for headers with timeout, aborts the fake and cleans its deadline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const http = vi.fn((_request, active: AbortSignal) => { signal = active; return new Promise<never>(() => {}); });
    const pending = runBatchExperiment(query, { now: NOW, http, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).outcome).toBe("timeout");
    expect(signal?.aborted).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("covers hanging body reads with timeout", async () => {
    vi.useFakeTimers();
    const pending = runBatchExperiment(query, { now: NOW, timeoutMs: 10, http: async () => ({
      status: 200, body: (async function* () { await new Promise(() => {}); yield Buffer.from("[]"); })(),
    }) });
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).outcome).toBe("timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors abort before dispatch with no calls", async () => {
    const abort = new AbortController(); abort.abort("secret reason");
    const http = vi.fn(async () => response());
    expect((await runBatchExperiment(query, { now: NOW, signal: abort.signal, http })).outcome).toBe("aborted");
    expect(http).not.toHaveBeenCalled();
  });

  it("rejects late completion after abort without exposing its reason", async () => {
    const abort = new AbortController();
    let release!: (result: ReturnType<typeof response>) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = runBatchExperiment(query, { now: NOW, signal: abort.signal,
      http: async () => { entered(); return new Promise(resolve => { release = resolve; }); } });
    await started; abort.abort("SENSITIVE_ABORT_REASON");
    const result = await pending;
    expect(result.outcome).toBe("aborted");
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    release(response());
    await Promise.resolve();
  });

  it("never logs payloads or echoes transport exceptions", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await runBatchExperiment(query, { now: NOW, http: async request => {
      throw new Error(String(request.body.get("access_token")) + String(request.body.get("appsecret_proof")));
    } });
    expect(result.outcome).toBe("provider_unavailable");
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|access_token|appsecret_proof/);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });

  it.each(["pilot", "real", "unexpected"])("refuses mode %s even with environment enabled", async mode => {
    vi.stubEnv("META_INSIGHTS_PILOT_ENABLED", "true");
    vi.stubEnv("META_ACCESS_TOKEN", "must-not-be-read");
    const http = vi.fn(async () => response());
    expect((await runBatchExperiment(query, { mode, now: NOW, http })).outcome).toBe("pilot_not_authorized");
    expect(http).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("imports inertly with Node22 without HTTP, DB, output or persistent timers", () => {
    const script = `globalThis.fetch=()=>{throw Error("network")};
      const {request}=await import("node:https");
      const before=process.getActiveResourcesInfo().sort().join(",");
      await import("./server/experiments/metaInsightsBatchExperiment.ts");
      await import("./server/experiments/metaInsightsBatchDryRun.ts");
      if(before!==process.getActiveResourcesInfo().sort().join(","))throw Error("resources changed");
      void request;`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
    expect(child.status).toBe(0);
    expect(child.stdout).toBe(""); expect(child.stderr).toBe("");
  });
});
