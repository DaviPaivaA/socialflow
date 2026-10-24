import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, fsyncSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import https from "node:https";
import { canonicalizeSyntheticAuthorization, createSyntheticApprovalVerifier, syntheticApprovalMessage,
  syntheticAuthorizationHash, type SyntheticAuthorizationRequest, type SyntheticAuthorizationContext,
  type SyntheticTrustEntry } from "../experiments/metaInsightsExternalAuthorization.ts";
import { createDurableSyntheticAdmission } from "../experiments/metaInsightsDurableAdmission.ts";
import { createSyntheticAuthorizedManualFlow } from "../experiments/metaInsightsAuthorizedManualFlow.ts";
import { fakeProtectedTerminal, syntheticInput } from "./metaInsightsProtectedInputFixtures.ts";
import { PILOT_NOW, PILOT_QUERY, pilotBatch, pilotWire } from "./metaInsightsPilotTestFixtures.ts";

// Fault only the durability syscall; real private directories, wx creation and receipt writes remain in use.
vi.mock("node:fs", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, fsyncSync: vi.fn(real.fsyncSync) };
});

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const directory = () => { const path = mkdtempSync(join(tmpdir(), "socialflow-10e-")); directories.push(path); return path; };
const runId = "c5e138ea-6a09-4201-a763-c56d77b48b62";
const tenantId = "233b87c1-7c01-4d08-bf1f-a78dc3dd4787";
const codeHash = "a".repeat(64);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const trust: readonly SyntheticTrustEntry[] = [{ environment: "synthetic", operatorAlias: "reviewer", keyId: "synthetic-test-key", publicKey }];
function claims(): SyntheticAuthorizationRequest {
  return { domain: "socialflow.meta-insights.synthetic.authorization.v1", environment: "synthetic", runId,
    operatorAlias: "reviewer", requestedByAlias: "executor", tenantId, operation: { ...PILOT_QUERY },
    purpose: "validate_facebook_page_insights_batch_read", approvedCodeSha256: codeHash,
    issuedAt: PILOT_NOW, expiresAt: PILOT_NOW + 300000,
    limits: { externalRequests: 1, retries: 0, redirects: 0, pagination: 0, automaticMonetarySpend: false,
      timeoutMs: 10000, maxRequestBytes: 32768, maxResponseBytes: 1048576 } };
}
// Independent encoding fixture: these literals are the signed protocol, not production hash/message helpers.
function approval(request = claims(), signingKey = privateKey) {
  const requestSha256 = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const message = Buffer.from(`socialflow.meta-insights.synthetic.approval.v1\n${requestSha256}`, "utf8");
  return { domain: "socialflow.meta-insights.synthetic.approval.v1", keyId: "synthetic-test-key", requestSha256,
    signature: sign(null, message, signingKey).toString("base64") };
}
function context(): SyntheticAuthorizationContext {
  return { environment: "synthetic", tenantId, operatorAlias: "reviewer", requestedByAlias: "executor", approvedCodeSha256: codeHash };
}
function setup(settings: { trust?: readonly SyntheticTrustEntry[]; now?: () => number;
  currentContext?: () => SyntheticAuthorizationContext; receiptDirectory?: string } = {}) {
  const receiptDirectory = settings.receiptDirectory ?? directory();
  return { receiptDirectory, flow: createSyntheticAuthorizedManualFlow({ trust, now: () => PILOT_NOW,
    currentContext: context, ...settings, receiptDirectory }) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("strict synthetic signed claims", () => {
  it("copies/freeze claims, hashes canonical bytes independently and verifies trusted Ed25519 approval", () => {
    const raw = claims(); const request = canonicalizeSyntheticAuthorization(raw, PILOT_NOW);
    expect(request).not.toBe(raw); expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.operation)).toBe(true); expect(Object.isFrozen(request.limits)).toBe(true);
    expect(syntheticAuthorizationHash(request)).toBe(approval(raw).requestSha256);
    expect(Buffer.from(syntheticApprovalMessage(request)).toString()).toBe(
      `socialflow.meta-insights.synthetic.approval.v1\n${approval(raw).requestSha256}`);
    expect(createSyntheticApprovalVerifier(trust)(request, approval(raw))).toBe(true);
  });
  it("normalizes property order without accepting unknown or executable properties", () => {
    const raw = claims(); const reordered = Object.fromEntries(Object.entries(raw).reverse());
    expect(canonicalizeSyntheticAuthorization(reordered, PILOT_NOW)).toEqual(raw);
    for (const value of [{ ...raw, host: "evil.invalid" }, { ...raw, [Symbol("hidden")]: true },
      Object.create(raw), { ...raw, get runId() { throw Error("SECRET_GETTER"); } }]) {
      expect(() => canonicalizeSyntheticAuthorization(value, PILOT_NOW)).toThrow();
    }
  });
  it.each([
    ["environment", "real"], ["domain", "socialflow.meta-insights.real.authorization.v1"],
    ["tenantId", "not-a-uuid"], ["runId", "../../run"], ["operatorAlias", "executor"],
    ["approvedCodeSha256", "bad"], ["expiresAt", PILOT_NOW], ["expiresAt", PILOT_NOW + 300001],
    ["issuedAt", PILOT_NOW + 1], ["purpose", "write_posts"],
  ])("rejects malformed/self-approved %s", (key, value) => {
    expect(() => canonicalizeSyntheticAuthorization({ ...claims(), [key]: value }, PILOT_NOW)).toThrow();
  });
  it.each([
    ["pageId", "00123"], ["pageId", "123/insights"], ["metric", "page_impressions"],
    ["period", "week"], ["graphApiVersion", "v25.0"], ["since", PILOT_QUERY.since + 1],
    ["until", PILOT_QUERY.since], ["host", "evil.invalid"],
  ])("rejects malformed operation %s", (key, value) => {
    expect(() => canonicalizeSyntheticAuthorization({ ...claims(), operation: { ...PILOT_QUERY, [key]: value } }, PILOT_NOW)).toThrow();
  });
  it.each([
    ["externalRequests", 2], ["retries", 1], ["redirects", 1], ["pagination", 1], ["automaticMonetarySpend", true],
    ["timeoutMs", 10001], ["maxRequestBytes", 32769], ["maxResponseBytes", 1048577], ["unapproved", 0],
  ])("rejects relaxed/unknown limit %s", (key, value) => {
    expect(() => canonicalizeSyntheticAuthorization({ ...claims(), limits: { ...claims().limits, [key]: value } }, PILOT_NOW)).toThrow();
  });
  it("fails closed without independently provisioned trust or with a private/non-Ed25519 trusted key", () => {
    const request = claims();
    expect(createSyntheticApprovalVerifier([])(request, approval())).toBe(false);
    for (const key of [privateKey, generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey]) {
      expect(() => createSyntheticApprovalVerifier([{ ...trust[0]!, publicKey: key }])).toThrow();
    }
  });
  it("does not trust a key from the envelope, wrong signer, malformed base64, or missing approval", () => {
    const verify = createSyntheticApprovalVerifier(trust);
    const other = generateKeyPairSync("ed25519");
    for (const envelope of [undefined, {}, { ...approval(), publicKey: other.publicKey }, approval(claims(), other.privateKey),
      { ...approval(), signature: "!not-base64!" }, { ...approval(), keyId: "attacker" },
      { ...approval(), domain: "socialflow.meta-insights.real.approval.v1" }]) expect(verify(claims(), envelope)).toBe(false);
  });
  it.each(["tenantId", "runId", "operatorAlias", "requestedByAlias", "approvedCodeSha256", "expiresAt", "operation", "limits", "environment"])(
    "signature cannot survive changed %s", key => {
      const raw = claims(); const changes: Record<string, unknown> = {
        tenantId: "a01ffac4-6eb2-4a78-8256-69f95cb0ca8a", runId: "8918521d-020c-45b3-86df-a030b0fbdaf6",
        operatorAlias: "other", requestedByAlias: "other", approvedCodeSha256: "b".repeat(64), expiresAt: PILOT_NOW + 200000,
        operation: { ...PILOT_QUERY, pageId: "9999" }, limits: { ...raw.limits, externalRequests: 2 }, environment: "real",
      };
      expect(createSyntheticApprovalVerifier(trust)({ ...raw, [key]: changes[key] }, approval(raw))).toBe(false);
    });
});

describe("durable one-shot admission", () => {
  it("persists metadata only, privately, and blocks reconstructed run IDs even with a changed hash", () => {
    const path = directory(); const store = createDurableSyntheticAdmission(path);
    expect(store.reserve(runId, codeHash)).toBe("reserved");
    expect(createDurableSyntheticAdmission(path).reserve(runId, "b".repeat(64))).toBe("replay");
    const files = readdirSync(path); expect(files).toEqual([`${runId}.json`]);
    const receipt = join(path, files[0]!); expect(lstatSync(receipt).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({ schema: "synthetic-admission-v1", runId, requestSha256: codeHash });
  });
  it("fails closed on missing/insecure/symlink storage and malformed run IDs", () => {
    const path = directory(); chmodSync(path, 0o755);
    expect(createDurableSyntheticAdmission(path).reserve(runId, codeHash)).toBe("storage_unavailable");
    const privatePath = directory(); const link = join(privatePath, "link"); symlinkSync(privatePath, link);
    for (const candidate of [join(privatePath, "missing"), link, "."]) {
      expect(createDurableSyntheticAdmission(candidate).reserve(runId, codeHash)).toBe("storage_unavailable");
    }
    expect(createDurableSyntheticAdmission(privatePath).reserve("../../evil", codeHash)).toBe("storage_unavailable");
    expect(readdirSync(privatePath)).toEqual(["link"]);
  });
  it("atomically admits exactly one process against the same persistent directory", async () => {
    const path = directory();
    const source = `import {createDurableSyntheticAdmission} from ${JSON.stringify(new URL("../experiments/metaInsightsDurableAdmission.ts", import.meta.url).href)}; process.stdout.write(createDurableSyntheticAdmission(process.argv[1]).reserve(${JSON.stringify(runId)}, ${JSON.stringify(codeHash)}));`;
    const child = () => new Promise<string>((resolve, reject) => {
      const processChild = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source, path],
        { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; processChild.stdout.on("data", data => { stdout += String(data); });
      processChild.on("error", reject); processChild.on("close", code => code === 0 ? resolve(stdout) : reject(Error("child_failed")));
    });
    expect((await Promise.all([child(), child(), child()])).sort()).toEqual(["replay", "replay", "reserved"]);
  });
  it("uncertain persistence burns the receipt and cannot prompt or execute, even after reconstruction", async () => {
    const { flow, receiptDirectory } = setup(); const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    vi.mocked(fsyncSync).mockImplementationOnce(() => { throw Error("SENSITIVE_FSYNC_FAILURE"); });
    const report = await flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request });
    expect(report.outcome).toBe("storage_unavailable"); expect(wire.calls).toBe(0); expect(terminal.writes).toEqual([]);
    expect(readdirSync(receiptDirectory)).toEqual([`${runId}.json`]);
    expect((await setup({ receiptDirectory }).flow.run(claims(), approval(), {
      mode: "simulation", testTerminal: terminal, testRequest: wire.request,
    })).outcome).toBe("replay");
    expect(JSON.stringify(report)).not.toContain("SENSITIVE_FSYNC_FAILURE");
  });
  it("rejects a symlink or nonprivate existing receipt rather than treating it as trusted storage", () => {
    const path = directory(); const link = join(path, `${runId}.json`); symlinkSync("absent", link);
    expect(createDurableSyntheticAdmission(path).reserve(runId, codeHash)).toBe("storage_unavailable");
    const privatePath = directory(); const store = createDurableSyntheticAdmission(privatePath);
    expect(store.reserve(runId, codeHash)).toBe("reserved"); chmodSync(join(privatePath, `${runId}.json`), 0o644);
    expect(store.reserve(runId, codeHash)).toBe("storage_unavailable");
  });
});

describe("manual synthetic integration through 10C / 10D public interfaces", () => {
  it("valid independent approval permits only synthetic manual flow and leaves every Meta prerequisite unverified", async () => {
    const { flow, receiptDirectory } = setup(); const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request });
    expect(readdirSync(receiptDirectory)).toHaveLength(1); // Reservation must occur before the first await/prompt.
    terminal.send(syntheticInput);
    const report = await result;
    expect(report).toMatchObject({ state: "READY_FOR_AUTHORIZATION", outcome: "available", syntheticApprovalValidated: true,
      realExecutionAuthorized: false, realCredentialsAccepted: false, realMetaValidated: false, syntheticRequestsDispatched: 1 });
    expect(wire.calls).toBe(1); expect(wire.options.hostname).toBe("graph.facebook.com");
    expect(wire.options.path).toBe("/v26.0/");
    expect(report.metaPrerequisites.map(item => item.id)).toContain("read_insights_grant");
    expect(report.metaPrerequisites.map(item => item.id)).toContain("pages_read_engagement_grant");
    expect(report.metaPrerequisites.map(item => item.id)).toContain("pages_show_list_grant");
    expect(report.metaPrerequisites.every(item => item.status === "not_verified")).toBe(true);
    const serialized = JSON.stringify(report);
    for (const secret of ["SYNTHETIC_PAGE_10D", "SYNTHETIC_SECRET_10D", "access_token", "appsecret_proof", "signature", "EXECUTION AUTHORIZED"]) {
      expect(serialized).not.toContain(secret);
    }
  });
  it.each([undefined, "real", "simulation"])("cannot get real input/network without signed approval, mode=%s", async mode => {
    const { flow } = setup(); const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const report = await flow.run(claims(), undefined, { mode, testTerminal: terminal, testRequest: wire.request });
    expect(report.state).toBe("BLOCKED"); expect(wire.calls).toBe(0); expect(terminal.writes).toEqual([]);
  });
  it("never admits real mode, empty trust, absent terminal, or absent injected transport", async () => {
    for (const kind of ["real", "trust", "tty", "transport"]) {
      const { flow } = setup({ trust: kind === "trust" ? [] : trust }); const terminal = fakeProtectedTerminal(); const wire = pilotWire();
      const report = await flow.run(claims(), approval(), { mode: kind === "real" ? "real" : "simulation",
        testTerminal: kind === "tty" ? undefined : terminal, testRequest: kind === "transport" ? undefined : wire.request });
      expect(report.state).toBe("BLOCKED"); expect(wire.calls).toBe(0); expect(terminal.writes).toEqual([]);
    }
  });
  it("rejects the builtin https binding before input rather than disguising it behind the guarded driver", async () => {
    // Replace the builtin with a safe wire solely to prove the identity gate without any network attempt.
    const wire = pilotWire(); const native = vi.spyOn(https, "request").mockImplementation(wire.request as typeof https.request);
    try {
      const terminal = fakeProtectedTerminal(); const { flow } = setup();
      const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: https.request });
      terminal.send(syntheticInput); const report = await result;
      expect(report.outcome).toBe("real_execution_blocked"); expect(terminal.writes).toEqual([]); expect(wire.calls).toBe(0);
    } finally { native.mockRestore(); }
  });
  it("reserves before input; competing and reconstructed flows cannot prompt again", async () => {
    const { flow, receiptDirectory } = setup(); const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request });
    const second = fakeProtectedTerminal();
    const replay = await setup({ receiptDirectory }).flow.run(claims(), approval(), { mode: "simulation", testTerminal: second, testRequest: wire.request });
    expect(replay.outcome).toBe("replay"); expect(second.writes).toEqual([]);
    terminal.send("\u0003"); expect((await result).outcome).toBe("aborted");
    expect((await flow.run(claims(), approval(), { mode: "simulation", testTerminal: second, testRequest: wire.request })).outcome).toBe("replay");
    expect(wire.calls).toBe(0);
  });
  it.each(["expired", "context", "code", "environment", "error", "abort"])("consumes run irreversibly after %s during input await", async failure => {
    let now = PILOT_NOW; let current = context(); const controller = new AbortController();
    const { flow, receiptDirectory } = setup({ now: () => now, currentContext: () => current });
    const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request, signal: controller.signal });
    if (failure === "expired") now += 300000;
    if (failure === "context") current = { ...current, tenantId: "a01ffac4-6eb2-4a78-8256-69f95cb0ca8a" };
    if (failure === "code") current = { ...current, approvedCodeSha256: "b".repeat(64) };
    if (failure === "environment") current = { ...current, environment: "real" as "synthetic" };
    if (failure === "error") {
      expect(terminal.input.listenerCount("error")).toBeGreaterThan(0);
      terminal.input.emit("error", Error("SENSITIVE_INPUT_ERROR"));
    }
    else if (failure === "abort") controller.abort(); else terminal.send(syntheticInput);
    const report = await result; expect(report.state).toBe("BLOCKED"); expect(wire.calls).toBe(0);
    expect(JSON.stringify(report)).not.toContain("SENSITIVE_INPUT_ERROR");
    const other = fakeProtectedTerminal();
    expect((await setup({ receiptDirectory }).flow.run(claims(), approval(), { mode: "simulation", testTerminal: other, testRequest: wire.request })).outcome).toBe("replay");
    expect(other.writes).toEqual([]);
  });
  it("does not let caller mutation modify claims or limits while waiting", async () => {
    const raw = claims(); const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const result = setup().flow.run(raw, approval(raw), { mode: "simulation", testTerminal: terminal, testRequest: wire.request });
    Object.assign(raw.operation, { pageId: "9999" }); Object.assign(raw.limits, { externalRequests: 2 });
    terminal.send(syntheticInput); expect((await result).outcome).toBe("available");
    expect(wire.bytes.toString()).toContain("123456/insights"); expect(wire.bytes.toString()).not.toContain("9999/insights");
  });
  it("revalidates context after async encoding before reaching the injected driver", async () => {
    let current = context(); const { flow, receiptDirectory } = setup({ currentContext: () => current });
    const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const original = Request.prototype.arrayBuffer;
    const encoding = vi.spyOn(Request.prototype, "arrayBuffer").mockImplementation(async function (this: Request) {
      const result = await original.call(this);
      current = { ...current, approvedCodeSha256: "b".repeat(64) };
      return result;
    });
    try {
      const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request });
      terminal.send(syntheticInput); const report = await result;
      expect(report.outcome).toBe("context_invalidated"); expect(wire.calls).toBe(0); expect(report.syntheticRequestsDispatched).toBe(0);
      expect(readdirSync(receiptDirectory)).toEqual([`${runId}.json`]);
    } finally { encoding.mockRestore(); }
  });
  it("revalidates after execution await without returning readiness on expiry or reusing budget", async () => {
    let now = PILOT_NOW; const { flow } = setup({ now: () => now });
    const terminal = fakeProtectedTerminal(); const wire = pilotWire();
    const driver: typeof wire.request = (options, callback) => wire.request(options, response => {
      now += 300000; callback(response);
    });
    const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: driver });
    terminal.send(syntheticInput); const report = await result;
    expect(report.outcome).toBe("context_invalidated"); expect(report.state).toBe("BLOCKED"); expect(wire.calls).toBe(1);
  });
  it.each([
    ["429", { status: 429 }, "rate_limited"],
    ["80001", { text: pilotBatch({ error: { code: 80001, message: "SENSITIVE_META_BODY" } }, 400) }, "rate_limited"],
    ["internal", { errorCode: "EINTERNAL" }, "provider_unavailable"],
    ["timeout", { hold: true }, "timeout"],
  ] as const)("classifies simulated %s without retries, raw errors or renewable budget", async (_name, scenario, outcome) => {
    const { flow } = setup(); const terminal = fakeProtectedTerminal(); const wire = pilotWire(scenario);
    const result = flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request, simulationTimeoutMs: 10 });
    terminal.send(syntheticInput); const report = await result;
    expect(report.outcome).toBe(outcome); expect(wire.calls).toBe(1);
    expect(report.realExecutionAuthorized).toBe(false); expect(JSON.stringify(report)).not.toContain("SENSITIVE");
    expect((await flow.run(claims(), approval(), { mode: "simulation", testTerminal: terminal, testRequest: wire.request })).outcome).toBe("replay");
  });
  it("independent run grants do not share or renew another grant's budget", async () => {
    const { flow } = setup();
    for (const id of [runId, "8918521d-020c-45b3-86df-a030b0fbdaf6"]) {
      const request = { ...claims(), runId: id }; const terminal = fakeProtectedTerminal(); const wire = pilotWire();
      const result = flow.run(request, approval(request), { mode: "simulation", testTerminal: terminal, testRequest: wire.request });
      terminal.send(syntheticInput); expect((await result).outcome).toBe("available"); await flush();
    }
  });
});
