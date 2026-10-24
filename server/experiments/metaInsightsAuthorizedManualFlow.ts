import type { SimulationHttpsRequest } from "./metaInsightsBatchHttpsExecutor.ts";
import https from "node:https";
import { ProtectedInputError, readSyntheticCredentials, type TestTerminal } from "./metaInsightsProtectedInput.ts";
import { canonicalizeSyntheticAuthorization, createSyntheticApprovalVerifier, syntheticAuthorizationHash,
  type SyntheticAuthorizationRequest, type SyntheticAuthorizationContext, type SyntheticTrustEntry } from "./metaInsightsExternalAuthorization.ts";
import { createDurableSyntheticAdmission } from "./metaInsightsDurableAdmission.ts";
import { createSimulationConsent, preparePagePilot, runPreparedPagePilot } from "./metaInsightsPagePilot.ts";

export type SyntheticManualReport = Readonly<{
  state: "READY_FOR_AUTHORIZATION" | "BLOCKED"; outcome: string;
  realExecutionAuthorized: false; realCredentialsAccepted: false; realMetaValidated: false;
  syntheticApprovalValidated: boolean; syntheticRequestsDispatched: number;
  metaPrerequisites: readonly Readonly<{ id: string; status: "not_verified" }>[];
}>;
export type SyntheticManualOptions = {
  mode?: string; testTerminal?: TestTerminal; testRequest?: SimulationHttpsRequest;
  signal?: AbortSignal; inputTimeoutMs?: number; simulationTimeoutMs?: number;
};
export function createSyntheticAuthorizedManualFlow(configuration: {
  trust: readonly SyntheticTrustEntry[]; receiptDirectory: string;
  currentContext: () => SyntheticAuthorizationContext; now?: () => number;
}) {
  const verify = createSyntheticApprovalVerifier(configuration.trust);
  const admission = createDurableSyntheticAdmission(configuration.receiptDirectory);
  const clock = configuration.now ?? Date.now;
  const currentContext = configuration.currentContext;
  return { async run(input: unknown, approval: unknown, options: SyntheticManualOptions = {}): Promise<SyntheticManualReport> {
    let validated = false; let dispatched = 0;
    let prerequisites: SyntheticManualReport["metaPrerequisites"] = Object.freeze([]);
    const result = (outcome: string, ready = false): SyntheticManualReport => Object.freeze({
      state: ready ? "READY_FOR_AUTHORIZATION" : "BLOCKED", outcome, realExecutionAuthorized: false,
      realCredentialsAccepted: false, realMetaValidated: false, syntheticApprovalValidated: validated,
      syntheticRequestsDispatched: dispatched, metaPrerequisites: prerequisites,
    });
    // There is NO real-mode binding, env/TTY bypass, or way to upgrade synthetic keys to real authority.
    if (options.mode !== "simulation" || typeof options.testRequest !== "function" || options.testRequest === https.request) {
      return result("real_execution_blocked");
    }
    // Capture caller dependencies/options before any await; DI is trusted code, not a sandbox.
    const terminal = options.testTerminal, driver = options.testRequest, signal = options.signal;
    const inputTimeoutMs = options.inputTimeoutMs;
    const timeoutMs = options.simulationTimeoutMs ?? 10000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) return result("invalid_options");
    let request: SyntheticAuthorizationRequest;
    try { request = canonicalizeSyntheticAuthorization(input, clock()); }
    catch { return result("invalid_request"); }
    if (!verify(request, approval)) return result("approval_required_or_invalid");
    validated = true;
    const revalidate = (): boolean => {
      try {
        canonicalizeSyntheticAuthorization(request, clock());
        const context = currentContext();
        return context.environment === "synthetic" && context.tenantId === request.tenantId &&
          context.operatorAlias === request.operatorAlias && context.requestedByAlias === request.requestedByAlias &&
          context.approvedCodeSha256 === request.approvedCodeSha256;
      } catch { return false; }
    };
    if (!revalidate()) return result("context_invalidated");
    const reservation = admission.reserve(request.runId, syntheticAuthorizationHash(request));
    if (reservation !== "reserved") return result(reservation);
    // Reservation is durable BEFORE any await, input, credential or execution. Never rolled back.
    if (signal?.aborted) return result("aborted");
    if (!revalidate()) return result("context_invalidated");
    try {
      const plan = preparePagePilot({ operation: request.operation, assetAlias: "synthetic_page", operatorAlias: request.operatorAlias }, clock());
      prerequisites = Object.freeze(plan.prerequisites.map(item => Object.freeze({ id: item.id, status: "not_verified" as const })));
      const credential = await readSyntheticCredentials({ mode: "simulation", testTerminal: terminal,
        timeoutMs: inputTimeoutMs, signal, revalidate });
      if (!revalidate()) return result("context_invalidated");
      if (signal?.aborted) return result("aborted");
      const consent = createSimulationConsent(plan, { operatorAlias: request.operatorAlias,
        approvedFingerprint: plan.fingerprint, acknowledgement: "SIMULATION_ONLY" }, clock());
      // 10C invokes this wrapper only after async multipart encoding: revalidate at that boundary too.
      const guardedDriver: SimulationHttpsRequest = (requestOptions, callback) => {
        if (!revalidate() || signal?.aborted) throw new Error("synthetic_context_invalidated");
        if (dispatched >= 1) throw new Error("synthetic_budget_exhausted");
        dispatched++;
        return driver(requestOptions, callback);
      };
      const report = await runPreparedPagePilot(plan, consent, { mode: "simulation", now: clock(),
        testRequest: guardedDriver, credentials: () => credential, signal, timeoutMs });
      if (!revalidate()) return result("context_invalidated");
      if (signal?.aborted) return result("aborted");
      return result(report.outcome, report.outcome === "available" || report.outcome === "not_available");
    } catch (error) {
      if (error instanceof ProtectedInputError) return result(error.code);
      return result("synthetic_preparation_failed");
    }
  } };
}
