import https from "node:https";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createNativePageHttpsDriver } from "../experiments/metaInsightsNativeHttpsDriver.ts";
import { createIsolatedBatchHttpsExecutor, type SimulationHttpsRequest } from "../experiments/metaInsightsBatchHttpsExecutor.ts";
import { PILOT_NOW, PILOT_QUERY, PILOT_CREDENTIAL, pilotWire, pilotBatch, awaitPilotDispatch } from "./metaInsightsPilotTestFixtures.ts";
import type { RequestOptions } from "node:https";

const requestOptions: RequestOptions = { protocol: "https:", hostname: "graph.facebook.com", port: 443,
  servername: "graph.facebook.com", path: "/v26.0/", method: "POST", agent: false,
  rejectUnauthorized: true, minVersion: "TLSv1.2", maxHeaderSize: 16384,
  headers: { "content-type": "multipart/form-data; boundary=----test", "content-length": "32", "accept-encoding": "identity" } };
const execute = (wire: ReturnType<typeof pilotWire>, patch: Record<string, unknown> = {}) =>
  createIsolatedBatchHttpsExecutor({ simulationRequest: createNativePageHttpsDriver({ testRequest: wire.request }) as SimulationHttpsRequest })
    .execute(PILOT_QUERY, PILOT_CREDENTIAL, { mode: "simulation", now: PILOT_NOW, ...patch });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("guarded native HTTPS binding", () => {
  it("blocks the actual builtin before any call, regardless of env", () => {
    const builtin = vi.spyOn(https, "request").mockImplementation(() => { throw Error("must never connect"); });
    vi.stubEnv("META_INSIGHTS_PILOT_ENABLED", "true"); vi.stubEnv("META_ACCESS_TOKEN", "DO_NOT_READ");
    expect(() => createNativePageHttpsDriver()(requestOptions, () => {})).toThrowError(expect.objectContaining({ code: "real_execution_blocked" }));
    expect(builtin).not.toHaveBeenCalled();
  });
  it("delegates canonical TLS options and native multipart bytes only to an injected fake", async () => {
    const wire = pilotWire(); const report = await execute(wire);
    expect(report).toMatchObject({ outcome: "available", simulated: true, realMetaValidated: false, outerStatus: 200, innerStatus: 200 });
    expect(wire.options).toMatchObject({ hostname: "graph.facebook.com", port: 443, protocol: "https:",
      path: "/v26.0/", method: "POST", rejectUnauthorized: true, agent: false, servername: "graph.facebook.com" });
    const headers = wire.options.headers as Record<string, string>;
    const form = await new Response(new Uint8Array(wire.bytes).buffer, { headers: { "content-type": headers["content-type"] } }).formData();
    expect(form.get("access_token")).toBe("SYNTHETIC_PAGE_10C");
    expect(String(form.get("appsecret_proof"))).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(String(form.get("batch")))).toEqual([{ method: "GET", relative_url:
      "123456/insights?metric=page_media_view&period=day&since=1792454400&until=1792540800" }]);
    expect(wire.options.path).not.toMatch(/token|proof|\?/); expect(wire.calls).toBe(1);
  });
  it.each([
    { hostname: "evil.test" }, { protocol: "http:" }, { port: 80 }, { method: "GET" }, { method: "DELETE" },
    { path: "/v25.0/" }, { path: "/v26.0/?access_token=secret" }, { rejectUnauthorized: false },
    { servername: "evil.test" }, { agent: true }, { proxyEnv: {} }, { createConnection: () => {} },
    { headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "32", "accept-encoding": "identity" } },
    { headers: { "content-type": "multipart/form-data; boundary=abc", "content-length": "32769", "accept-encoding": "identity" } },
  ])("refuses unsafe options %j before invoking any dependency", patch => {
    const wire = pilotWire();
    expect(() => createNativePageHttpsDriver({ testRequest: wire.request })({ ...requestOptions, ...patch } as unknown as RequestOptions, () => {}))
      .toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(wire.calls).toBe(0);
  });
  it.each([
    { scenario: { errorCode: "ENOTFOUND" }, want: "provider_unavailable" },
    { scenario: { errorCode: "ECONNREFUSED" }, want: "provider_unavailable" },
    { scenario: { errorCode: "ERR_TLS_CERT_ALTNAME_INVALID" }, want: "tls_error" },
    { scenario: { abruptClose: true }, want: "provider_unavailable" },
    { scenario: { large: true }, want: "response_too_large" },
    { scenario: { status: 429, text: "" }, want: "rate_limited" },
    { scenario: { text: pilotBatch({ error: { code: 80001 } }, 400) }, want: "rate_limited" },
    { scenario: { text: pilotBatch({ error: { code: 190 } }, 400) }, want: "token_expired" },
    { scenario: { text: pilotBatch({ error: { code: 200 } }, 400) }, want: "permission_required" },
    { scenario: { text: "[null]" }, want: "incomplete_response" },
    { scenario: { text: "invalid json" }, want: "invalid_response" },
    { scenario: { status: 302, text: "" }, want: "redirect_blocked" },
  ])("handles native boundary scenario %j", async ({ scenario, want }) => {
    const wire = pilotWire(scenario); const result = await execute(wire);
    expect(result.outcome).toBe(want); expect(wire.calls).toBe(1);
    expect(wire.outgoing.destroyed).toBe(true); expect(JSON.stringify(result)).not.toMatch(/SENSITIVE|SYNTHETIC/);
  });
  it("destroys native-shaped IO at the explicit deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const wire = pilotWire({ hold: true }); const result = execute(wire, { timeoutMs: 20 }); await awaitPilotDispatch(wire, result);
    await vi.advanceTimersByTimeAsync(20);
    expect((await result).outcome).toBe("timeout"); expect(wire.outgoing.destroyed).toBe(true);
    await wire.closed; expect(vi.getTimerCount()).toBe(0);
  });
  it("destroys late responses after abort and does not reopen IO before close", async () => {
    const wire = pilotWire({ hold: true, noClose: true }); const abort = new AbortController();
    const result = execute(wire, { signal: abort.signal }); await awaitPilotDispatch(wire, result); abort.abort("SENSITIVE_ABORT");
    expect((await result).outcome).toBe("aborted"); wire.deliverLate();
    expect(wire.response?.destroyed).toBe(true);
    expect(() => wire.outgoing.emit("error", new Error("SENSITIVE_LATE"))).not.toThrow();
    wire.closeNow(); await wire.closed; expect(wire.calls).toBe(1);
  });
  it("sanitizes synchronous Node errors without logs or causes", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const adapter = createNativePageHttpsDriver({ testRequest: () => { throw Object.assign(new Error("SENSITIVE_SECRET"), { code: "ERR_TLS_PRIVATE_DETAIL" }); } });
    let thrown: unknown; try { adapter(requestOptions, () => {}); } catch (caught) { thrown = caught; }
    expect(thrown).toMatchObject({ code: "ERR_TLS_HANDSHAKE_FAILED" });
    expect(String(thrown)).not.toMatch(/SENSITIVE|PRIVATE_DETAIL/);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("imports the native binding inertly with Node22 and blocks builtin IO", () => {
    const script = `import https from "node:https"; https.request=()=>{throw Error("unexpected network")};
      const before=process.getActiveResourcesInfo().sort().join(",");
      const {createNativePageHttpsDriver}=await import("./server/experiments/metaInsightsNativeHttpsDriver.ts");
      try{createNativePageHttpsDriver()(${JSON.stringify(requestOptions)},()=>{})}catch(e){if(e.code!=="real_execution_blocked")throw e}
      await import("./server/experiments/metaInsightsPagePilot.ts");
      if(before!==process.getActiveResourcesInfo().sort().join(","))throw Error("active resource");`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
    expect(child.status).toBe(0); expect(child.stdout).toBe(""); expect(child.stderr).toBe("");
  });
});
