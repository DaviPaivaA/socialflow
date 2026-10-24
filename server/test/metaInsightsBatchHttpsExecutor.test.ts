import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsolatedBatchHttpsExecutor } from "../experiments/metaInsightsBatchHttpsExecutor.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const query = { pageId: "123456", graphApiVersion: "v26.0", metric: "page_media_view", period: "day",
  since: 1792454400, until: 1792540800 } as const;
const credential = { tokenKind: "page", accessToken: "SYNTHETIC_PAGE_10B_+&=", appSecret: "SYNTHETIC_SECRET_10B" } as const;
const data = { data: [{ name: "page_media_view", period: "day", values: [
  { value: 0, end_time: "2026-10-21T00:00:00+0000" },
] }] };
const batch = (body: unknown = data, code = 200) => JSON.stringify([{ code, headers: [], body: JSON.stringify(body) }]);
type Driver = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
type Scenario = { status?: number; text?: string; headers?: Record<string, string>; authorized?: boolean;
  errorCode?: string; holdHeaders?: boolean; holdBody?: boolean; noClose?: boolean; chunks?: Uint8Array[] };

// Only the external Node IO boundary is faked. Event ordering, streams and multipart are real.
function fixture(scenario: Scenario = {}) {
  let start!: () => void;
  let closed!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const finished = new Promise<void>(resolve => { closed = resolve; });
  let wireOptions: RequestOptions | undefined;
  let wireBody: Buffer | undefined;
  let incoming: PassThrough | undefined;
  let responseCallback: ((response: IncomingMessage) => void) | undefined;
  let requestObject: EventEmitter & { destroyed: boolean; end: (body: Buffer) => void; destroy: () => void };
  const request: Driver = vi.fn((options, callback) => {
    wireOptions = options;
    responseCallback = callback;
    requestObject = Object.assign(new EventEmitter(), {
      destroyed: false,
      end(body: Buffer) {
        wireBody = Buffer.from(body);
        queueMicrotask(() => {
          start();
          if (requestObject.destroyed || scenario.holdHeaders) return;
          if (scenario.errorCode) {
            requestObject.emit("error", Object.assign(new Error("SENSITIVE_TRANSPORT_ERROR"), { code: scenario.errorCode }));
            return;
          }
          incoming = Object.assign(new PassThrough(), {
            statusCode: scenario.status ?? 200, headers: scenario.headers ?? {},
            socket: { encrypted: true, authorized: scenario.authorized !== false },
          });
          callback(incoming as unknown as IncomingMessage);
          if (scenario.holdBody) return;
          for (const chunk of scenario.chunks ?? [Buffer.from(scenario.text ?? batch())]) incoming.write(chunk);
          incoming.end();
        });
      },
      destroy() {
        if (requestObject.destroyed) return;
        requestObject.destroyed = true;
        if (!scenario.noClose) queueMicrotask(() => { requestObject.emit("close"); closed(); });
      },
    });
    return requestObject as unknown as ClientRequest;
  });
  return { request, started, finished,
    get options() { return wireOptions!; }, get body() { return wireBody!; },
    get response() { return incoming; }, get outgoing() { return requestObject; },
    closeNow() { requestObject.emit("close"); closed(); },
    deliverLateResponse() {
      incoming = Object.assign(new PassThrough(), { statusCode: 200, headers: {},
        socket: { encrypted: true, authorized: true } });
      responseCallback!(incoming as unknown as IncomingMessage);
    },
  };
}
const run = (f: ReturnType<typeof fixture>, patch: Record<string, unknown> = {}) =>
  createIsolatedBatchHttpsExecutor({ simulationRequest: f.request })
    .execute(query, credential, { mode: "simulation", now: NOW, ...patch });
async function entered(f: ReturnType<typeof fixture>, pending: Promise<unknown>) {
  // Missing behavior fails immediately in RED instead of timing out waiting for a never-entered fake.
  await Promise.race([f.started, pending.then(() => { throw Error("driver_not_started"); }, () => { throw Error("driver_not_started"); })]);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("isolated Batch HTTPS executor", () => {
  it("builds a bounded HTTPS multipart POST with verified TLS and exactly one GET", async () => {
    const f = fixture();
    const report = await run(f);
    expect(report.outcome).toBe("available");
    expect(report).toMatchObject({ simulated: true, realMetaValidated: false, family: "facebook_page",
      graphApiVersion: "v26.0", method: "POST", localValidation: "passed", outerStatus: 200,
      innerStatus: 200, errorCategory: null, blockedReason: "real_pilot_not_authorized" });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(f.options).toMatchObject({ protocol: "https:", hostname: "graph.facebook.com", port: 443,
      servername: "graph.facebook.com", path: "/v26.0/", method: "POST", agent: false,
      rejectUnauthorized: true, minVersion: "TLSv1.2", maxHeaderSize: 16384 });
    expect(f.options).not.toHaveProperty("checkServerIdentity");
    expect(f.options).not.toHaveProperty("createConnection");
    expect(f.options.path).not.toMatch(/access_token|appsecret_proof|SYNTHETIC|\?/);
    const headers = f.options.headers as Record<string, string>;
    expect(headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    expect(headers["content-length"]).toBe(String(f.body.length));
    expect(headers["accept-encoding"]).toBe("identity");
    expect(f.body.length).toBeLessThanOrEqual(32768);
    const form = await new Response(new Uint8Array(f.body).buffer, { headers: { "content-type": headers["content-type"] } }).formData();
    expect(form.get("access_token")).toBe("SYNTHETIC_PAGE_10B_+&=");
    expect(form.get("appsecret_proof")).toBe("994c840ec0bac2f62a18446bcbd07217c0205d22d001ad99447df084ec879f65");
    expect(JSON.parse(String(form.get("batch")))).toEqual([{ method: "GET", relative_url:
      "123456/insights?metric=page_media_view&period=day&since=1792454400&until=1792540800" }]);
    expect([...form.keys()].sort()).toEqual(["access_token", "appsecret_proof", "batch"]);
    expect(f.request).toHaveBeenCalledTimes(1);
    await f.finished;
    expect(f.outgoing.destroyed).toBe(true);
    expect(f.response?.destroyed).toBe(true);
  });

  it("requires an explicit simulation driver and ignores ambient activation", async () => {
    vi.stubEnv("META_INSIGHTS_PILOT_ENABLED", "true"); vi.stubEnv("META_ACCESS_TOKEN", "DO_NOT_READ");
    const result = await createIsolatedBatchHttpsExecutor().execute(query, credential, { mode: "simulation", now: NOW });
    expect(result).toMatchObject({ outcome: "transport_blocked", simulated: false,
      realMetaValidated: false, blockedReason: "simulation_driver_required" });
  });

  it.each([undefined, "dry_run", "pilot", "real"])("does not dispatch in mode %s", async mode => {
    const f = fixture();
    expect((await run(f, { mode })).outcome).toBe("pilot_not_authorized");
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    { pageId: "https://evil.test/1" }, { pageId: "../1" }, { graphApiVersion: "v25.0" },
    { host: "evil.test" }, { url: "http://graph.facebook.com/" }, { method: "POST" },
    { operations: [{ method: "POST", relative_url: "123/feed" }] },
    { operations: [{ method: "GET" }, { method: "GET" }] }, { metric: "post_media_view" },
    { period: "lifetime" }, { since: 1.5 }, { until: query.since },
  ])("rejects unapproved operation %j without dispatch", async patch => {
    const f = fixture();
    const result = await createIsolatedBatchHttpsExecutor({ simulationRequest: f.request })
      .execute({ ...query, ...patch } as unknown as typeof query, credential, { mode: "simulation", now: NOW });
    expect(result.outcome).toBe("invalid_query");
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([
    { tokenKind: "user" }, { accessToken: "REAL_LOOKING_FORBIDDEN" }, { appSecret: "NOT_SYNTHETIC" },
    { accessToken: "SYNTHETIC_token\r\ninjected" }, { accessToken: "SYNTHETIC_" + "a".repeat(8193) },
    { appSecret: "SYNTHETIC_" + "a".repeat(1025) },
  ])("rejects non-synthetic/wrong-token credentials %j", async patch => {
    const f = fixture();
    const result = await createIsolatedBatchHttpsExecutor({ simulationRequest: f.request })
      .execute(query, { ...credential, ...patch } as unknown as typeof credential, { mode: "simulation", now: NOW });
    expect(result.outcome).toBe("invalid_credential");
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each([[80001, "rate_limited"], [4, "rate_limited"], [17, "rate_limited"], [32, "rate_limited"],
    [613, "rate_limited"], [190, "token_expired"], [200, "permission_required"], [2, "provider_unavailable"],
    ["80001", "provider_unavailable"]])("classifies inner Graph %s without retry", async (code, outcome) => {
    const f = fixture({ text: batch({ error: { code, message: "SENSITIVE" } }, 400) });
    const result = await run(f);
    expect(result).toMatchObject({ outcome, errorCategory: outcome, outerStatus: 200, innerStatus: 400 });
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it("preserves external429 with an empty body and closes IO", async () => {
    const f = fixture({ status: 429, text: "" });
    expect(await run(f)).toMatchObject({ outcome: "rate_limited", outerStatus: 429, innerStatus: null });
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.response?.destroyed).toBe(true);
  });
  it.each([
    { text: "[null]", want: "incomplete_response" }, { text: "[]", want: "incomplete_response" },
    { text: "", want: "invalid_response" }, { text: "invalid", want: "invalid_response" },
    { text: JSON.stringify([{ code: 200, body: "{}" }, null]), want: "incomplete_response" },
    { text: batch({ data: [] }), want: "not_available" },
    { text: batch({ ...data, paging: { next: "https://evil.test/?access_token=NEVER_FOLLOW" } }), want: "incomplete_response" },
  ])("handles response %j without inventing data", async ({ text, want }) => {
    const f = fixture({ text });
    const result = await run(f);
    expect(result.outcome).toBe(want); expect(f.request).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|NEVER_FOLLOW|SYNTHETIC/);
  });
  it.each([301, 302, 303, 307, 308])("never follows redirect%i", async status => {
    const f = fixture({ status, headers: { location: "https://evil.test/" } });
    expect((await run(f)).outcome).toBe("redirect_blocked");
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.response?.destroyed).toBe(true);
  });
  it.each(["gzip", "br", "compress"])("refuses encoding %s", async encoding => {
    const f = fixture({ headers: { "Content-Encoding": encoding } });
    expect((await run(f)).outcome).toBe("invalid_response");
    expect(f.response?.destroyed).toBe(true);
  });
  it("rejects streamed overflow before concatenating the whole body", async () => {
    const f = fixture({ chunks: [Buffer.alloc(600000), Buffer.alloc(600000), Buffer.alloc(600000)] });
    expect(await run(f)).toMatchObject({ outcome: "response_too_large", outerStatus: 200 });
    expect(f.response?.destroyed).toBe(true); expect(f.outgoing.destroyed).toBe(true);
  });
  it("rejects excessive advertised length without trusting response metadata", async () => {
    const f = fixture({ headers: { "content-length": "1048577" } });
    expect((await run(f)).outcome).toBe("response_too_large");
    expect(f.response?.destroyed).toBe(true);
  });
  it.each(["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT"])("sanitizes TLS %s and does not retry", async errorCode => {
      const f = fixture({ errorCode }); const result = await run(f);
      expect(result.outcome).toBe("tls_error"); expect(f.request).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain("SENSITIVE"); expect(f.outgoing.destroyed).toBe(true);
    });
  it("refuses an unauthorized TLS socket despite a successful HTTP status", async () => {
    const f = fixture({ authorized: false });
    expect((await run(f)).outcome).toBe("tls_error");
  });
  it("refuses all reuse of an already dispatched one-shot executor", async () => {
    const f = fixture(); const executor = createIsolatedBatchHttpsExecutor({ simulationRequest: f.request });
    await executor.execute(query, credential, { mode: "simulation", now: NOW });
    const result = await executor.execute(query, credential, { mode: "simulation", now: NOW });
    expect(result.outcome).toBe("pilot_already_attempted"); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("rejects parallel work across executor instances until the first IO closes", async () => {
    const first = fixture({ holdHeaders: true }); const abort = new AbortController();
    const pending = run(first, { signal: abort.signal }); await entered(first, pending);
    const other = fixture(); expect((await run(other)).outcome).toBe("operation_in_progress");
    expect(other.request).not.toHaveBeenCalled(); abort.abort("SECRET_ABORT");
    expect((await pending).outcome).toBe("aborted"); await first.finished;
  });
  it("keeps the process gate closed when a fake has not emitted close after abort", async () => {
    const first = fixture({ holdHeaders: true, noClose: true }); const abort = new AbortController();
    const pending = run(first, { signal: abort.signal }); await entered(first, pending); abort.abort();
    expect((await pending).outcome).toBe("aborted");
    expect(() => first.outgoing.emit("error", new Error("SENSITIVE_LATE_ERROR"))).not.toThrow();
    const second = fixture(); expect((await run(second)).outcome).toBe("operation_in_progress");
    first.closeNow(); await first.finished;
    expect((await run(fixture())).outcome).toBe("available");
  });
  it("destroys a response delivered after abort, observes errors and waits for request close", async () => {
    const f = fixture({ holdHeaders: true, noClose: true }); const abort = new AbortController();
    const pending = run(f, { signal: abort.signal }); await entered(f, pending); abort.abort();
    const result = await pending;
    expect(result.outcome).toBe("aborted");
    f.deliverLateResponse();
    expect(f.response?.destroyed).toBe(true);
    expect(f.response?.listenerCount("data")).toBe(0);
    expect(() => f.response!.emit("error", new Error("SENSITIVE_LATE_RESPONSE"))).not.toThrow();
    expect(() => f.outgoing.emit("error", new Error("SENSITIVE_LATE_REQUEST"))).not.toThrow();
    expect((await run(fixture())).outcome).toBe("operation_in_progress");
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    f.closeNow(); await f.finished;
    expect((await run(fixture())).outcome).toBe("available");
  });
  it.each(["headers", "body"])("deadline destroys %s IO and clears timers", async stage => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture(stage === "headers" ? { holdHeaders: true } : { holdBody: true });
    const pending = run(f, { timeoutMs: 20 }); await entered(f, pending);
    await vi.advanceTimersByTimeAsync(20);
    expect((await pending).outcome).toBe("timeout"); await f.finished;
    expect(f.outgoing.destroyed).toBe(true); if (f.response) expect(f.response.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not dispatch an already-aborted request", async () => {
    const f = fixture(); const abort = new AbortController(); abort.abort("SENSITIVE_ABORT");
    expect((await run(f, { signal: abort.signal })).outcome).toBe("aborted");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("aborts body IO without exposing reason or returning delayed data", async () => {
    const f = fixture({ holdBody: true }); const abort = new AbortController();
    const pending = run(f, { signal: abort.signal }); await entered(f, pending);
    abort.abort("SENSITIVE_REASON");
    const result = await pending;
    expect(result).toMatchObject({ outcome: "aborted", outerStatus: 200 });
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    expect(f.response?.destroyed).toBe(true); expect(f.outgoing.destroyed).toBe(true); await f.finished;
  });
  it("sanitizes response stream errors and closes all IO", async () => {
    const f = fixture({ holdBody: true }); const pending = run(f); await entered(f, pending);
    f.response!.emit("error", new Error("SENSITIVE_STREAM_ERROR"));
    const result = await pending;
    expect(result).toMatchObject({ outcome: "provider_unavailable", outerStatus: 200 });
    expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    expect(f.response?.destroyed).toBe(true); expect(f.outgoing.destroyed).toBe(true); await f.finished;
  });
  it("rejects a truncated response even when the advertised length was within the cap", async () => {
    const f = fixture({ headers: { "content-length": "1000" }, text: "[]" });
    expect((await run(f)).outcome).toBe("invalid_response");
    expect(f.response?.destroyed).toBe(true);
  });
  it("refuses configuration overrides that could weaken TLS or select another host", async () => {
    const f = fixture();
    const configuration = { simulationRequest: f.request, hostname: "evil.test", rejectUnauthorized: false };
    expect((await createIsolatedBatchHttpsExecutor(configuration).execute(query, credential,
      { mode: "simulation", now: NOW })).outcome).toBe("invalid_query");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("sanitizes synchronous IO exceptions and never logs credentials", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const simulationRequest: Driver = () => { throw new Error(credential.accessToken + credential.appSecret); };
    const result = await createIsolatedBatchHttpsExecutor({ simulationRequest })
      .execute(query, credential, { mode: "simulation", now: NOW });
    expect(result.outcome).toBe("provider_unavailable"); expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|appsecret|access_token/);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
  });
  it("imports inertly and leaves the existing CLI network-free under Node22", () => {
    const script = `import https from "node:https"; import {syncBuiltinESMExports} from "node:module";
      https.request=()=>{throw Error("unexpected HTTPS")};syncBuiltinESMExports();
      globalThis.fetch=()=>{throw Error("unexpected fetch")};
      const before=process.getActiveResourcesInfo().sort().join(",");
      const {createIsolatedBatchHttpsExecutor}=await import("./server/experiments/metaInsightsBatchHttpsExecutor.ts");
      const result=await createIsolatedBatchHttpsExecutor().execute(${JSON.stringify(query)},${JSON.stringify(credential)},{mode:"simulation",now:${NOW}});
      if(result.outcome!=="transport_blocked")throw Error("default not blocked");
      await import("./server/experiments/metaInsightsBatchDryRun.ts");
      if(before!==process.getActiveResourcesInfo().sort().join(","))throw Error("resources changed");`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
    expect(child.status).toBe(0); expect(child.stdout).toBe(""); expect(child.stderr).toBe("");
  });
});
