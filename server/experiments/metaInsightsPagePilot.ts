// Preparatory admission only: no CLI, environment reader, real consent or network activation.
import { createHash } from "node:crypto";
import { buildSyntheticBatchRequest, type PageProbe } from "./metaInsightsBatchExperiment.ts";
import { createIsolatedBatchHttpsExecutor, type HttpsExperimentReport, type SimulationHttpsRequest,
  type SyntheticPageCredential } from "./metaInsightsBatchHttpsExecutor.ts";
import { createNativePageHttpsDriver } from "./metaInsightsNativeHttpsDriver.ts";

type AdmissionCode = "invalid_plan" | "consent_required" | "consent_mismatch" | "consent_expired" |
  "consent_used" | "real_execution_blocked" | "credentials_unavailable" | "aborted";
class PilotAdmissionError extends Error {
  readonly code: AdmissionCode;
  constructor(code: AdmissionCode) { super(`Page pilot preparation: ${code}`); this.code = code; }
}
const prerequisiteDefinitions = [
  ["page_token_kind", "Page Access Token: evidência Meta/operador, não inferida do prefixo sintético"],
  ["read_insights_grant", "Permissão efetivamente concedida, distinta do escopo solicitado"],
  ["pages_read_engagement_grant", "Dependência de leitura da edge Page Insights"],
  ["pages_show_list_grant", "Descoberta de Pages e contrato do client atual; não prova requisito direto da edge"],
  ["page_analyze_task", "Tarefa ANALYZE e vínculo com o ativo de teste"],
  ["page_eligibility", "Elegibilidade, disponibilidade da métrica e restrições da Page"],
  ["app_access", "App mode, papéis de teste, App Review, Advanced Access e Business Verification quando aplicáveis"],
  ["batch_compatibility", "Aceitação real da composição Batch/token/proof/edge ainda não demonstrada"],
] as const;
type Prerequisite = Readonly<{ id: string; status: "not_verified"; evidenceRequired: string }>;
export type PreparedPagePilot = Readonly<{
  operation: Readonly<PageProbe>; assetAlias: string; operatorAlias: string;
  purpose: "validate_facebook_page_insights_batch_read"; externalRequestBudget: 1; retries: 0;
  timeoutMs: 10000; maxRequestBytes: 32768; maxResponseBytes: 1048576;
  expiresAt: number; fingerprint: string; prerequisites: readonly Prerequisite[];
}>;
export type SimulationConsent = Readonly<{
  simulationOnly: true; planFingerprint: string; operatorAlias: string; purpose: string; expiresAt: number;
}>;
const plans = new WeakSet<PreparedPagePilot>();
const attemptedPlans = new WeakSet<PreparedPagePilot>();
const consents = new WeakMap<SimulationConsent, { plan: PreparedPagePilot; used: boolean }>();
const validNow = (now: number) => Number.isSafeInteger(now) && now >= 0 && now <= 8640000000000000 - 300000;
export function preparePagePilot(input: { operation: PageProbe; assetAlias: string; operatorAlias: string }, now = Date.now()): PreparedPagePilot {
  try {
    if (!input || Object.keys(input).some(key => !["operation", "assetAlias", "operatorAlias"].includes(key)) ||
      !validNow(now) || typeof input.assetAlias !== "string" || typeof input.operatorAlias !== "string" ||
      !/^[A-Za-z0-9_-]{1,48}$/.test(input.assetAlias) || !/^[A-Za-z0-9_-]{1,48}$/.test(input.operatorAlias)) throw new Error();
    buildSyntheticBatchRequest(input.operation, now);
    const base = { operation: Object.freeze({ ...input.operation }), assetAlias: input.assetAlias, operatorAlias: input.operatorAlias,
      purpose: "validate_facebook_page_insights_batch_read" as const, externalRequestBudget: 1 as const, retries: 0 as const,
      timeoutMs: 10000 as const, maxRequestBytes: 32768 as const, maxResponseBytes: 1048576 as const, expiresAt: now + 300000 };
    const fingerprint = createHash("sha256").update(JSON.stringify(base)).digest("hex");
    const prerequisites = Object.freeze(prerequisiteDefinitions.map(([id, evidenceRequired]) =>
      Object.freeze({ id, status: "not_verified" as const, evidenceRequired })));
    const plan = Object.freeze({ ...base, fingerprint, prerequisites });
    plans.add(plan); return plan;
  } catch { throw new PilotAdmissionError("invalid_plan"); }
}
export function createSimulationConsent(plan: PreparedPagePilot, approval: {
  operatorAlias: string; approvedFingerprint: string; acknowledgement: string;
}, now = Date.now()): SimulationConsent {
  if (!plans.has(plan) || !approval || Object.keys(approval).some(key =>
    !["operatorAlias", "approvedFingerprint", "acknowledgement"].includes(key)) ||
    approval.operatorAlias !== plan.operatorAlias || approval.approvedFingerprint !== plan.fingerprint ||
    approval.acknowledgement !== "SIMULATION_ONLY") throw new PilotAdmissionError("consent_mismatch");
  if (!validNow(now) || now >= plan.expiresAt) throw new PilotAdmissionError("consent_expired");
  const consent = Object.freeze({ simulationOnly: true as const, planFingerprint: plan.fingerprint,
    operatorAlias: plan.operatorAlias, purpose: plan.purpose, expiresAt: plan.expiresAt });
  consents.set(consent, { plan, used: false }); return consent;
}
type PilotOptions = { mode?: string; now?: number; testRequest?: SimulationHttpsRequest;
  credentials?: () => SyntheticPageCredential; signal?: AbortSignal; timeoutMs?: number };
type PilotReport = Readonly<Omit<HttpsExperimentReport, "outcome" | "errorCategory" | "blockedReason"> & {
  outcome: HttpsExperimentReport["outcome"] | AdmissionCode; errorCategory: string | null;
  blockedReason: "real_pilot_not_authorized"; consentValidated: boolean; metaPrerequisitesVerified: false;
}>;
export async function runPreparedPagePilot(plan: PreparedPagePilot, consent: SimulationConsent | undefined,
  options: PilotOptions = {}): Promise<PilotReport> {
  const blocked = (outcome: AdmissionCode, consentValidated = false): PilotReport => Object.freeze({
    simulated: false, realMetaValidated: false, family: "facebook_page", graphApiVersion: "v26.0", method: "POST",
    localValidation: "blocked", outcome, errorCategory: outcome, outerStatus: null, innerStatus: null, durationMs: 0,
    blockedReason: "real_pilot_not_authorized", consentValidated, metaPrerequisitesVerified: false,
  });
  // Admission precedes access to any credential provider. It never checks environment variables.
  if (options.mode !== "simulation" || typeof options.testRequest !== "function") return blocked("real_execution_blocked");
  if (!plans.has(plan)) return blocked("invalid_plan");
  const admission = consent && consents.get(consent);
  if (!admission) return blocked("consent_required");
  if (admission.plan !== plan) return blocked("consent_mismatch");
  const now = options.now ?? Date.now();
  if (!validNow(now) || now >= plan.expiresAt) return blocked("consent_expired");
  if (admission.used || attemptedPlans.has(plan)) return blocked("consent_used");
  if (options.signal?.aborted) return blocked("aborted");
  admission.used = true; // Even a failed preparation consumes this consent; no implicit retry.
  attemptedPlans.add(plan);
  let credential: SyntheticPageCredential;
  try {
    if (!options.credentials) return blocked("credentials_unavailable", true);
    credential = { ...options.credentials() };
  } catch { return blocked("credentials_unavailable", true); }
  if (options.signal?.aborted) return blocked("aborted", true);
  if (options.now === undefined && Date.now() >= plan.expiresAt) return blocked("consent_expired", true);
  const executor = createIsolatedBatchHttpsExecutor({ simulationRequest: createNativePageHttpsDriver({ testRequest: options.testRequest }) });
  const report = await executor.execute(plan.operation, credential, { mode: "simulation", now,
    timeoutMs: options.timeoutMs ?? plan.timeoutMs, signal: options.signal });
  return Object.freeze({ ...report, blockedReason: "real_pilot_not_authorized", consentValidated: true, metaPrerequisitesVerified: false });
}
