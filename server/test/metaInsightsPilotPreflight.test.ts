import https from "node:https";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePagePilot } from "../experiments/metaInsightsPagePilot.ts";
import { preparePilotPreflight, consentToPreflight, runPilotPreflight } from "../experiments/metaInsightsPilotPreflight.ts";
import { PILOT_NOW, PILOT_QUERY } from "./metaInsightsPilotTestFixtures.ts";
import { fakeProtectedTerminal, syntheticInput } from "./metaInsightsProtectedInputFixtures.ts";

const selection = { pageId: "123456", metric: "page_media_view", graphApiVersion: "v26.0", operation: "GET" };
const prepare = () => {
  const plan = preparePagePilot({ operation: PILOT_QUERY, operatorAlias: "operator_test", assetAlias: "page_test" }, PILOT_NOW);
  return preparePilotPreflight(plan, selection, PILOT_NOW);
};
const consentFor = (preflight: ReturnType<typeof prepare>) => consentToPreflight(preflight, {
  operatorAlias: "operator_test", approvedFingerprint: preflight.plan.fingerprint, acknowledgement: "SYNTHETIC_INPUT_ONLY",
}, PILOT_NOW);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("Page preflight cannot authorize execution", () => {
  it("finishes PREPARED with external gates still unverified and no secrets in report", async () => {
    const preflight = prepare(); const terminal = fakeProtectedTerminal();
    const network = vi.spyOn(https, "request").mockImplementation(() => { throw Error("unexpected network"); });
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("unexpected network"));
    const persist = vi.spyOn(fs, "writeFileSync").mockImplementation(() => { throw Error("unexpected persistence"); });
    const pending = runPilotPreflight(preflight, consentFor(preflight), { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW });
    terminal.send(syntheticInput); const report = await pending;
    expect(report).toMatchObject({ state: "PREPARED", outcome: "prepared", realExecutionAuthorized: false,
      realCredentialsAccepted: false, realMetaValidated: false, requestsExecuted: 0 });
    expect(report.externalChecks.every(item => item.status === "not_verified")).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/SYNTHETIC_|access_token|appsecret_proof|appSecret|123456|EXECUTION AUTHORIZED/);
    expect(network).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled();
    expect(terminal.input.isRaw).toBe(false);
  });
  it.each([{ pageId: "987654" }, { metric: "page_video_views" }, { graphApiVersion: "v25.0" }, { operation: "POST" }])("rejects a mismatched selection %j", patch => {
    const plan = prepare().plan;
    expect(() => preparePilotPreflight(plan, { ...selection, ...patch }, PILOT_NOW)).toThrowError(expect.objectContaining({ code: "invalid_plan" }));
  });
  it("rejects a copied plan even if public fields match", () => {
    expect(() => preparePilotPreflight({ ...prepare().plan }, selection, PILOT_NOW)).toThrowError(expect.objectContaining({ code: "invalid_plan" }));
  });
  it("refuses consent copied from public metadata", async () => {
    const preflight = prepare(); const terminal = fakeProtectedTerminal();
    expect((await runPilotPreflight(preflight, { ...consentFor(preflight) }, { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW })).outcome)
      .toBe("consent_required"); expect(terminal.writes).toEqual([]);
  });
  it("consumes a valid consent even when paired with another Page", async () => {
    const original = prepare(); const consent = consentFor(original);
    const plan = preparePagePilot({ operation: { ...PILOT_QUERY, pageId: "987654" }, operatorAlias: "operator_test", assetAlias: "other" }, PILOT_NOW);
    const other = preparePilotPreflight(plan, { ...selection, pageId: "987654" }, PILOT_NOW);
    const terminal = fakeProtectedTerminal();
    expect((await runPilotPreflight(other, consent, { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW })).outcome).toBe("consent_mismatch");
    expect((await runPilotPreflight(original, consent, { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW })).outcome).toBe("consent_used");
    expect(terminal.writes).toEqual([]);
  });
  it.each(["error", "abort", "expiry"])("does not reuse consent after %s, including clock rollback", async failure => {
    const preflight = prepare(); const consent = consentFor(preflight); const terminal = fakeProtectedTerminal();
    const abort = new AbortController(); if (failure === "abort") abort.abort();
    const pending = runPilotPreflight(preflight, consent, { mode: "simulation", testTerminal: terminal,
      signal: abort.signal, now: () => failure === "expiry" ? PILOT_NOW + 300000 : PILOT_NOW });
    if (failure === "error") terminal.input.emit("error", Error("SENSITIVE_READ"));
    const result = await pending;
    expect(result.outcome).toBe(failure === "expiry" ? "consent_expired" : failure === "abort" ? "aborted" : "input_failed");
    expect((await runPilotPreflight(preflight, consent, { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW })).outcome).toBe("consent_used");
  });
  it("consumes the plan atomically before an asynchronous read, across two consents", async () => {
    const preflight = prepare(); const first = consentFor(preflight); const second = consentFor(preflight);
    const terminal = fakeProtectedTerminal(); const pending = runPilotPreflight(preflight, first, { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW });
    expect((await runPilotPreflight(preflight, second, { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW })).outcome).toBe("consent_used");
    terminal.send(syntheticInput); expect((await pending).state).toBe("PREPARED");
    expect(terminal.writes.filter(s=>s === "Token sintético: ")).toHaveLength(1);
  });
  it("rechecks expiry after the token wait, before requesting App Secret", async () => {
    const preflight = prepare(); let now = PILOT_NOW; const terminal = fakeProtectedTerminal();
    const pending = runPilotPreflight(preflight, consentFor(preflight), { mode: "simulation", testTerminal: terminal, now: () => now });
    now += 300000; terminal.send("SYNTHETIC_PAGE_10D\r");
    expect((await pending).outcome).toBe("consent_expired");
    expect(terminal.writes.join("")).not.toContain("App Secret"); expect(terminal.input.isRaw).toBe(false);
  });
  it("rechecks expiry after the secret wait", async () => {
    const preflight = prepare(); let now = PILOT_NOW; const terminal = fakeProtectedTerminal();
    const pending = runPilotPreflight(preflight, consentFor(preflight), { mode: "simulation", testTerminal: terminal, now: () => now });
    terminal.send("SYNTHETIC_PAGE_10D\r"); now += 300000; terminal.send("SYNTHETIC_SECRET_10D\r");
    expect((await pending).outcome).toBe("consent_expired"); expect(terminal.input.isRaw).toBe(false);
  });
  it("revalidates after terminal restoration before returning PREPARED", async () => {
    const preflight = prepare(); let now = PILOT_NOW; const terminal = fakeProtectedTerminal();
    const restore = terminal.input.setRawMode;
    terminal.input.setRawMode = value => { restore(value); if (!value) now += 300000; };
    const pending = runPilotPreflight(preflight, consentFor(preflight), { mode: "simulation", testTerminal: terminal, now: () => now });
    terminal.send(syntheticInput); expect((await pending).outcome).toBe("consent_expired");
    expect(terminal.input.isRaw).toBe(false);
  });
  it("cannot reset an attempted plan by preparing it again or minting consent", async () => {
    const preflight = prepare(); const terminal = fakeProtectedTerminal({ tty: false });
    expect((await runPilotPreflight(preflight, consentFor(preflight), { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW })).outcome).toBe("tty_required");
    const again = preparePilotPreflight(preflight.plan, selection, PILOT_NOW);
    expect(() => consentToPreflight(again, { operatorAlias: "operator_test", approvedFingerprint: again.plan.fingerprint,
      acknowledgement: "SYNTHETIC_INPUT_ONLY" }, PILOT_NOW)).toThrowError(expect.objectContaining({ code: "consent_used" }));
    expect(terminal.writes).toEqual([]);
  });
  it("does not allow mutation of the approved Page, metric or operation during input", async () => {
    const preflight = prepare(); const terminal = fakeProtectedTerminal();
    const pending = runPilotPreflight(preflight, consentFor(preflight), { mode: "simulation", testTerminal: terminal, now: () => PILOT_NOW });
    expect(Reflect.set(preflight.plan.operation, "pageId", "987654")).toBe(false);
    expect(Reflect.set(preflight.plan.operation, "metric", "page_video_views")).toBe(false);
    expect(Reflect.set(preflight, "selection", { ...selection, operation: "POST" })).toBe(false);
    terminal.send(syntheticInput); expect((await pending).state).toBe("PREPARED");
  });
  it.each([undefined, "real", "EXECUTION AUTHORIZED"])("never accepts execution mode %s even with env set", async mode => {
    vi.stubEnv("META_INSIGHTS_PILOT_ENABLED", "true"); vi.stubEnv("META_ACCESS_TOKEN", "DO_NOT_READ");
    const preflight = prepare(); const terminal = fakeProtectedTerminal();
    const result = await runPilotPreflight(preflight, consentFor(preflight), { mode, testTerminal: terminal, now: () => PILOT_NOW });
    expect(result).toMatchObject({ state: "BLOCKED", outcome: "real_execution_blocked", requestsExecuted: 0 });
    expect(terminal.writes).toEqual([]);
  });
  it("imports inertly using Node22 without file writes, reads of env secrets or network calls", () => {
    const script = `import https from 'node:https';import fs from 'node:fs';
      https.request=()=>{throw Error('network')};fs.writeFileSync=()=>{throw Error('persist')};
      const before=process.getActiveResourcesInfo().sort().join(',');
      await import('./server/experiments/metaInsightsProtectedInput.ts');
      const {runPilotPreflight}=await import('./server/experiments/metaInsightsPilotPreflight.ts');
      const report=await runPilotPreflight(undefined,undefined);
      if(report.outcome!=='real_execution_blocked')throw Error('real mode');
      if(before!==process.getActiveResourcesInfo().sort().join(','))throw Error('active resource');`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
    expect(child.status).toBe(0); expect(child.stdout).toBe(""); expect(child.stderr).toBe("");
  });
});
