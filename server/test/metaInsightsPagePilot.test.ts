import { afterEach, describe, expect, it, vi } from "vitest";
import https from "node:https";
import { preparePagePilot, createSimulationConsent, runPreparedPagePilot } from "../experiments/metaInsightsPagePilot.ts";
import { PILOT_NOW, PILOT_QUERY, PILOT_CREDENTIAL, pilotWire, awaitPilotDispatch } from "./metaInsightsPilotTestFixtures.ts";

const input = { operation: PILOT_QUERY, assetAlias: "page_test_a", operatorAlias: "operator_test" };
const prepare = () => preparePagePilot(input, PILOT_NOW);
const consentFor = (plan: ReturnType<typeof prepare>) => createSimulationConsent(plan, {
  operatorAlias: "operator_test", approvedFingerprint: plan.fingerprint, acknowledgement: "SIMULATION_ONLY",
}, PILOT_NOW);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("prepared Page pilot admission", () => {
  it("binds an immutable non-secret plan to the exact Page, operator, purpose and one-read budget", () => {
    const plan = prepare();
    expect(plan.operation).toEqual(PILOT_QUERY);
    expect(plan).toMatchObject({ assetAlias: "page_test_a", operatorAlias: "operator_test",
      purpose: "validate_facebook_page_insights_batch_read", externalRequestBudget: 1, retries: 0,
      timeoutMs: 10000, maxRequestBytes: 32768, maxResponseBytes: 1048576, expiresAt: PILOT_NOW + 300000 });
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.operation)).toBe(true);
    expect(plan.prerequisites.every(item => item.status === "not_verified")).toBe(true);
    expect(plan.prerequisites.some(item => item.id === "read_insights_grant")).toBe(true);
    expect(plan.prerequisites.some(item => item.id === "page_analyze_task")).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/SYNTHETIC|appSecret|appsecret_proof/);
  });
  it.each([{ pageId: "evil.test" }, { metric: "likes" }, { method: "POST" }, { operations: [{}, {}] }])("rejects an invalid or mutating plan %j", patch => {
      expect(() => preparePagePilot({ ...input, operation: { ...PILOT_QUERY, ...patch } } as unknown as typeof input, PILOT_NOW))
        .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    });
  it("does not treat local grant flags as verified Meta evidence", () => {
    expect(() => preparePagePilot({ ...input, read_insights: true } as typeof input, PILOT_NOW))
      .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
  });
  it.each([undefined, 123, "", "operator name\n"])("rejects malformed aliases %s", alias => {
    expect(() => preparePagePilot({ ...input, assetAlias: alias } as unknown as typeof input, PILOT_NOW))
      .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
  });
  it.each([
    { operatorAlias: "different" }, { approvedFingerprint: "0".repeat(64) }, { acknowledgement: "ALLOW_REAL" },
  ])("rejects consent that does not bind to this operation %j", patch => {
    const plan = prepare();
    expect(() => createSimulationConsent(plan, { operatorAlias: "operator_test", approvedFingerprint: plan.fingerprint,
      acknowledgement: "SIMULATION_ONLY", ...patch }, PILOT_NOW)).toThrowError(expect.objectContaining({ code: "consent_mismatch" }));
  });
  it("requires issued consent before even reading in-memory credentials", async () => {
    const plan = prepare(); const credentials = vi.fn(() => PILOT_CREDENTIAL); const wire = pilotWire();
    expect(await runPreparedPagePilot(plan, undefined, { mode: "simulation", credentials, testRequest: wire.request, now: PILOT_NOW }))
      .toMatchObject({ outcome: "consent_required", metaPrerequisitesVerified: false });
    expect(credentials).not.toHaveBeenCalled(); expect(wire.calls).toBe(0);
  });
  it("refuses forged consent, even with matching public fields", async () => {
    const plan = prepare(); const issued = consentFor(plan); const credentials = vi.fn(() => PILOT_CREDENTIAL);
    expect((await runPreparedPagePilot(plan, { ...issued }, { mode: "simulation", credentials,
      testRequest: pilotWire().request, now: PILOT_NOW })).outcome).toBe("consent_required");
    expect(credentials).not.toHaveBeenCalled();
  });
  it("does not reuse consent for another Page or another prepared plan", async () => {
    const plan = prepare(); const consent = consentFor(plan); const other = preparePagePilot({ ...input,
      operation: { ...PILOT_QUERY, pageId: "987654" } }, PILOT_NOW);
    const credentials = vi.fn(() => PILOT_CREDENTIAL);
    expect((await runPreparedPagePilot(other, consent, { mode: "simulation", credentials,
      testRequest: pilotWire().request, now: PILOT_NOW })).outcome).toBe("consent_mismatch");
    expect(credentials).not.toHaveBeenCalled(); expect(other.fingerprint).not.toBe(plan.fingerprint);
  });
  it("rejects expired consent before reading credentials", async () => {
    const plan = prepare(); const consent = consentFor(plan); const credentials = vi.fn(() => PILOT_CREDENTIAL);
    expect((await runPreparedPagePilot(plan, consent, { mode: "simulation", credentials,
      testRequest: pilotWire().request, now: PILOT_NOW + 300000 })).outcome).toBe("consent_expired");
    expect(credentials).not.toHaveBeenCalled();
  });
  it("runs one synthetic operation and never calls its grant/task evidence verified", async () => {
    const plan = prepare(); const consent = consentFor(plan); const wire = pilotWire();
    const credentials = vi.fn(() => PILOT_CREDENTIAL);
    const result = await runPreparedPagePilot(plan, consent, { mode: "simulation", testRequest: wire.request, credentials, now: PILOT_NOW });
    expect(result).toMatchObject({ outcome: "available", simulated: true, realMetaValidated: false,
      consentValidated: true, metaPrerequisitesVerified: false, outerStatus: 200, innerStatus: 200 });
    expect(wire.calls).toBe(1); expect(credentials).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|appSecret|access_token|appsecret_proof|123456/);
    expect((await runPreparedPagePilot(plan, consent, { mode: "simulation", testRequest: wire.request, credentials, now: PILOT_NOW })).outcome)
      .toBe("consent_used");
    expect(wire.calls).toBe(1); expect(credentials).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "real", "pilot", "dry_run"])("blocks mode %s before credentials or native IO", async mode => {
    vi.stubEnv("META_INSIGHTS_PILOT_ENABLED", "true"); vi.stubEnv("META_ACCESS_TOKEN", "DO_NOT_READ");
    const builtin = vi.spyOn(https, "request").mockImplementation(() => { throw Error("must not connect"); });
    const plan = prepare(); const credentials = vi.fn(() => PILOT_CREDENTIAL);
    expect((await runPreparedPagePilot(plan, consentFor(plan), { mode, credentials, now: PILOT_NOW })).outcome)
      .toBe("real_execution_blocked");
    expect(credentials).not.toHaveBeenCalled(); expect(builtin).not.toHaveBeenCalled();
  });
  it("blocks a missing test driver even when consent and credentials exist", async () => {
    const plan = prepare(); const credentials = vi.fn(() => PILOT_CREDENTIAL);
    expect((await runPreparedPagePilot(plan, consentFor(plan), { mode: "simulation", credentials, now: PILOT_NOW })).outcome)
      .toBe("real_execution_blocked");
    expect(credentials).not.toHaveBeenCalled();
  });
  it("handles missing credentials without HTTP or a raw error", async () => {
    const plan = prepare(); const wire = pilotWire();
    expect((await runPreparedPagePilot(plan, consentFor(plan), { mode: "simulation", testRequest: wire.request, now: PILOT_NOW })).outcome)
      .toBe("credentials_unavailable");
    expect(wire.calls).toBe(0);
  });
  it("sanitizes a credential-source exception without logging secret material", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}); const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const plan = prepare(); const wire = pilotWire();
    const result = await runPreparedPagePilot(plan, consentFor(plan), { mode: "simulation", testRequest: wire.request, now: PILOT_NOW,
      credentials: () => { throw Error("SENSITIVE_TOKEN_AND_SECRET"); } });
    expect(result.outcome).toBe("credentials_unavailable"); expect(JSON.stringify(result)).not.toContain("SENSITIVE");
    expect(wire.calls).toBe(0); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("rechecks abort after reading an in-memory credential", async () => {
    const plan = prepare(); const abort = new AbortController(); const wire = pilotWire();
    expect((await runPreparedPagePilot(plan, consentFor(plan), { mode: "simulation", testRequest: wire.request, now: PILOT_NOW,
      signal: abort.signal, credentials: () => { abort.abort("SENSITIVE_ABORT"); return PILOT_CREDENTIAL; } })).outcome).toBe("aborted");
    expect(wire.calls).toBe(0);
  });
  it("does not issue another request under a second consent for the same plan", async () => {
    const plan = prepare(); const first = consentFor(plan); const second = consentFor(plan);
    const wire = pilotWire(); const credentials = vi.fn(() => PILOT_CREDENTIAL);
    expect((await runPreparedPagePilot(plan, first, { mode: "simulation", testRequest: wire.request, credentials, now: PILOT_NOW })).outcome)
      .toBe("available");
    expect((await runPreparedPagePilot(plan, second, { mode: "simulation", testRequest: wire.request, credentials, now: PILOT_NOW })).outcome)
      .toBe("consent_used");
    expect(wire.calls).toBe(1); expect(credentials).toHaveBeenCalledTimes(1);
  });
  it("does not admit a second consent while the first request remains pending", async () => {
    const plan = prepare(); const first = consentFor(plan); const second = consentFor(plan);
    const wire = pilotWire({ hold: true }); const abort = new AbortController();
    const credentials = vi.fn(() => PILOT_CREDENTIAL);
    const pending = runPreparedPagePilot(plan, first, { mode: "simulation", testRequest: wire.request,
      credentials, now: PILOT_NOW, signal: abort.signal });
    try {
      await awaitPilotDispatch(wire, pending);
      expect((await runPreparedPagePilot(plan, second, { mode: "simulation", testRequest: wire.request,
        credentials, now: PILOT_NOW })).outcome).toBe("consent_used");
      expect(credentials).toHaveBeenCalledTimes(1); expect(wire.calls).toBe(1);
    } finally { abort.abort(); await pending; await wire.closed; }
    expect((await pending).outcome).toBe("aborted");
  });
});
