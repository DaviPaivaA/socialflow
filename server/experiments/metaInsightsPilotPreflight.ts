// PREPARED is metadata, never execution authority. No network or persistence dependencies.
import { buildSyntheticBatchRequest } from "./metaInsightsBatchExperiment.ts";
import { createSimulationConsent, type PreparedPagePilot } from "./metaInsightsPagePilot.ts";
import { ProtectedInputError, readSyntheticCredentials, type TestTerminal } from "./metaInsightsProtectedInput.ts";

type Selection = Readonly<{ pageId: string; metric: string; graphApiVersion: string; operation: string }>;
export type PilotPreflight = Readonly<{ plan: PreparedPagePilot; selection: Selection }>;
type Consent = Readonly<{ simulationOnly: true; fingerprint: string; operatorAlias: string }>;
type Context = { preflight: PilotPreflight; snapshot: string; attempted: boolean };
const contexts = new WeakMap<PilotPreflight, Context>();
const byPlan = new WeakMap<PreparedPagePilot, PilotPreflight>();
const consents = new WeakMap<Consent, { context: Context; used: boolean }>();
type PreflightCode = "invalid_plan" | "consent_required" | "consent_mismatch" | "consent_expired" | "consent_used";
class PreflightError extends Error {
  readonly code: PreflightCode;
  constructor(code: PreflightCode) { super(`Pilot preflight: ${code}`); this.code = code; }
}
function validContext(context: Context, now: number): PreflightCode | undefined {
  const { plan, selection } = context.preflight;
  if (!Number.isSafeInteger(now) || now < 0) return "invalid_plan";
  if (now >= plan.expiresAt) return "consent_expired";
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.operation) || !Object.isFrozen(selection) ||
    plan.operation.pageId !== selection.pageId || plan.operation.metric !== selection.metric ||
    plan.operation.graphApiVersion !== selection.graphApiVersion || selection.operation !== "GET" ||
    plan.externalRequestBudget !== 1 || plan.retries !== 0 || plan.timeoutMs !== 10000 ||
    plan.maxRequestBytes !== 32768 || plan.maxResponseBytes !== 1048576 ||
    JSON.stringify({ plan, selection }) !== context.snapshot) return "invalid_plan";
  try { buildSyntheticBatchRequest(plan.operation, now); } catch { return "invalid_plan"; }
}
export function preparePilotPreflight(plan: PreparedPagePilot, selection: Selection, now = Date.now()): PilotPreflight {
  try {
    if (!selection || Object.keys(selection).some(key => !["pageId", "metric", "graphApiVersion", "operation"].includes(key))) throw new Error();
    // This approved 10C function validates that the plan was genuinely issued, not reconstructed.
    createSimulationConsent(plan, { operatorAlias: plan.operatorAlias,
      approvedFingerprint: plan.fingerprint, acknowledgement: "SIMULATION_ONLY" }, now);
    const preflight = Object.freeze({ plan, selection: Object.freeze({ ...selection }) });
    const context = { preflight, snapshot: JSON.stringify(preflight), attempted: false };
    if (validContext(context, now)) throw new Error();
    const previous = byPlan.get(plan);
    if (previous) return previous; // Re-preparation cannot reset the attempt budget for this plan identity.
    contexts.set(preflight, context); byPlan.set(plan, preflight); return preflight;
  } catch { throw new PreflightError("invalid_plan"); }
}
export function consentToPreflight(preflight: PilotPreflight, approval: {
  operatorAlias: string; approvedFingerprint: string; acknowledgement: string;
}, now = Date.now()): Consent {
  const context = contexts.get(preflight);
  if (!context || !approval || Object.keys(approval).some(key =>
    !["operatorAlias", "approvedFingerprint", "acknowledgement"].includes(key)) ||
    approval.operatorAlias !== preflight.plan.operatorAlias || approval.approvedFingerprint !== preflight.plan.fingerprint ||
    approval.acknowledgement !== "SYNTHETIC_INPUT_ONLY") throw new PreflightError("consent_mismatch");
  if (context.attempted) throw new PreflightError("consent_used");
  const invalid = validContext(context, now); if (invalid) throw new PreflightError(invalid);
  const consent = Object.freeze({ simulationOnly: true as const, fingerprint: preflight.plan.fingerprint, operatorAlias: approval.operatorAlias });
  consents.set(consent, { context, used: false }); return consent;
}
type Report = Readonly<{
  state: "PREPARED" | "BLOCKED"; outcome: string; realExecutionAuthorized: false;
  realCredentialsAccepted: false; realMetaValidated: false; requestsExecuted: 0;
  externalChecks: PreparedPagePilot["prerequisites"];
}>;
type RunOptions = { mode?: string; testTerminal?: TestTerminal; now?: () => number; signal?: AbortSignal; inputTimeoutMs?: number };
export async function runPilotPreflight(preflight: PilotPreflight, consent: Consent | undefined, options: RunOptions = {}): Promise<Report> {
  const admission = consent && consents.get(consent);
  const result = (outcome: string): Report => Object.freeze({ state: outcome === "prepared" ? "PREPARED" : "BLOCKED", outcome,
    realExecutionAuthorized: false, realCredentialsAccepted: false, realMetaValidated: false, requestsExecuted: 0,
    externalChecks: admission?.context.preflight.plan.prerequisites ?? Object.freeze([]),
  });
  if (admission) {
    if (admission.used || admission.context.attempted) return result("consent_used");
    // No await, callback or input before both markers are set. Error/abort/expiry never rolls this back.
    admission.used = true; admission.context.attempted = true;
  }
  if (options.mode !== "simulation") return result("real_execution_blocked");
  if (!admission) return result("consent_required");
  if (admission.context.preflight !== preflight || !contexts.has(preflight)) return result("consent_mismatch");
  const validate = (): PreflightCode | undefined => {
    try { return validContext(admission.context, options.now ? options.now() : Date.now()); }
    catch { return "invalid_plan"; }
  };
  let invalid = validate(); if (invalid) return result(invalid);
  if (options.signal?.aborted) return result("aborted");
  try {
    await readSyntheticCredentials({ mode: "simulation", testTerminal: options.testTerminal,
      signal: options.signal, timeoutMs: options.inputTimeoutMs, revalidate: () => validate() === undefined });
  } catch (error) {
    if (error instanceof ProtectedInputError && error.code === "terminal_restore_failed") return result(error.code);
    invalid = validate();
    return result(invalid ?? (error instanceof ProtectedInputError ? error.code : "input_failed"));
  }
  invalid = validate(); if (invalid) return result(invalid);
  if (options.signal?.aborted) return result("aborted");
  // Credentials deliberately do not become part of the result or any future-execution capability.
  return result("prepared");
}
