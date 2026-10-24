// Offline verification ONLY. No real trust bootstrap, private key, signing, CLI, or I/O.
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { buildSyntheticBatchRequest, type PageProbe } from "./metaInsightsBatchExperiment.ts";

export type SyntheticAuthorizationRequest = Readonly<{
  domain: "socialflow.meta-insights.synthetic.authorization.v1";
  environment: "synthetic"; runId: string; operatorAlias: string; requestedByAlias: string;
  tenantId: string; operation: PageProbe; purpose: "validate_facebook_page_insights_batch_read";
  approvedCodeSha256: string; issuedAt: number; expiresAt: number;
  limits: Readonly<{ externalRequests: 1; retries: 0; redirects: 0; pagination: 0;
    automaticMonetarySpend: false; timeoutMs: 10000; maxRequestBytes: 32768; maxResponseBytes: 1048576 }>;
}>;
export type SyntheticApprovalEnvelope = Readonly<{
  domain: "socialflow.meta-insights.synthetic.approval.v1"; keyId: string; requestSha256: string; signature: string;
}>;
export type SyntheticTrustEntry = Readonly<{ environment: "synthetic"; operatorAlias: string; keyId: string; publicKey: KeyObject }>;
export type SyntheticAuthorizationContext = Readonly<{
  environment: "synthetic"; tenantId: string; operatorAlias: string; requestedByAlias: string; approvedCodeSha256: string;
}>;
const REQUEST_DOMAIN = "socialflow.meta-insights.synthetic.authorization.v1";
const APPROVAL_DOMAIN = "socialflow.meta-insights.synthetic.approval.v1";
export const syntheticUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const syntheticSha256 = /^[0-9a-f]{64}$/;
const alias = /^[A-Za-z0-9_-]{1,48}$/;
function invalid(): never { throw new Error("invalid_synthetic_authorization"); }
// Reject accessors, symbols, non-enumerable extras, inherited/custom prototypes and missing fields.
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) invalid();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    result[key] = descriptor.value;
  }
  return result;
}
export function canonicalizeSyntheticAuthorization(input: unknown, now: number): SyntheticAuthorizationRequest {
  const raw = record(input, ["domain", "environment", "runId", "operatorAlias", "requestedByAlias", "tenantId", "operation",
    "purpose", "approvedCodeSha256", "issuedAt", "expiresAt", "limits"]);
  const operation = record(raw.operation, ["pageId", "graphApiVersion", "metric", "period", "since", "until"]);
  const limits = record(raw.limits, ["externalRequests", "retries", "redirects", "pagination", "automaticMonetarySpend",
    "timeoutMs", "maxRequestBytes", "maxResponseBytes"]);
  if (raw.domain !== REQUEST_DOMAIN || raw.environment !== "synthetic" ||
    typeof raw.runId !== "string" || !syntheticUuid.test(raw.runId) ||
    typeof raw.tenantId !== "string" || !syntheticUuid.test(raw.tenantId) ||
    typeof raw.operatorAlias !== "string" || !alias.test(raw.operatorAlias) ||
    typeof raw.requestedByAlias !== "string" || !alias.test(raw.requestedByAlias) || raw.operatorAlias === raw.requestedByAlias ||
    raw.purpose !== "validate_facebook_page_insights_batch_read" ||
    typeof raw.approvedCodeSha256 !== "string" || !syntheticSha256.test(raw.approvedCodeSha256) ||
    !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 ||
    typeof raw.issuedAt !== "number" || !Number.isSafeInteger(raw.issuedAt) || raw.issuedAt < 0 || raw.issuedAt > now ||
    typeof raw.expiresAt !== "number" || !Number.isSafeInteger(raw.expiresAt) || raw.expiresAt > 8640000000000000 ||
    raw.expiresAt <= now || raw.expiresAt <= raw.issuedAt || raw.expiresAt - raw.issuedAt > 300000 ||
    typeof operation.pageId !== "string" || !/^[1-9][0-9]{0,31}$/.test(operation.pageId) ||
    typeof operation.since !== "number" || typeof operation.until !== "number" ||
    operation.since % 86400 !== 0 || operation.until % 86400 !== 0 || operation.until <= operation.since ||
    limits.externalRequests !== 1 || limits.retries !== 0 || limits.redirects !== 0 || limits.pagination !== 0 ||
    limits.automaticMonetarySpend !== false || limits.timeoutMs !== 10000 || limits.maxRequestBytes !== 32768 ||
    limits.maxResponseBytes !== 1048576) invalid();
  const probe = operation as unknown as PageProbe;
  buildSyntheticBatchRequest(probe, now); // Existing query/version/window contract remains authoritative.
  return Object.freeze({ domain: REQUEST_DOMAIN, environment: "synthetic", runId: raw.runId,
    operatorAlias: raw.operatorAlias, requestedByAlias: raw.requestedByAlias, tenantId: raw.tenantId,
    operation: Object.freeze({ pageId: probe.pageId, graphApiVersion: probe.graphApiVersion, metric: probe.metric,
      period: probe.period, since: probe.since, until: probe.until }),
    purpose: "validate_facebook_page_insights_batch_read", approvedCodeSha256: raw.approvedCodeSha256,
    issuedAt: raw.issuedAt, expiresAt: raw.expiresAt,
    limits: Object.freeze({ externalRequests: 1, retries: 0, redirects: 0, pagination: 0, automaticMonetarySpend: false,
      timeoutMs: 10000, maxRequestBytes: 32768, maxResponseBytes: 1048576 }) });
}
export function syntheticAuthorizationHash(request: SyntheticAuthorizationRequest): string {
  const snapshot = canonicalizeSyntheticAuthorization(request, request.issuedAt);
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}
export function syntheticApprovalMessage(request: SyntheticAuthorizationRequest): Uint8Array {
  return Buffer.from(`${APPROVAL_DOMAIN}\n${syntheticAuthorizationHash(request)}`, "utf8");
}
export function createSyntheticApprovalVerifier(trust: readonly SyntheticTrustEntry[]) {
  // Copy and re-import public key material at bootstrap; later mutation of caller objects cannot change trust.
  const keys = trust.map(entry => {
    const raw = record(entry, ["environment", "operatorAlias", "keyId", "publicKey"]);
    if (raw.environment !== "synthetic" || typeof raw.operatorAlias !== "string" || !alias.test(raw.operatorAlias) ||
      typeof raw.keyId !== "string" || !alias.test(raw.keyId) || !raw.publicKey || typeof raw.publicKey !== "object") invalid();
    const publicKey = raw.publicKey as KeyObject;
    if (publicKey.type !== "public" || publicKey.asymmetricKeyType !== "ed25519") invalid();
    return Object.freeze({ operatorAlias: raw.operatorAlias, keyId: raw.keyId,
      publicKey: createPublicKey({ key: publicKey.export({ type: "spki", format: "der" }), type: "spki", format: "der" }) });
  });
  if (new Set(keys.map(key => key.keyId)).size !== keys.length) invalid();
  return (request: SyntheticAuthorizationRequest, envelope: unknown): boolean => {
    try {
      const snapshot = canonicalizeSyntheticAuthorization(request, request.issuedAt);
      const raw = record(envelope, ["domain", "keyId", "requestSha256", "signature"]);
      if (raw.domain !== APPROVAL_DOMAIN || raw.requestSha256 !== syntheticAuthorizationHash(snapshot) ||
        typeof raw.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(raw.signature)) return false;
      const signature = Buffer.from(raw.signature, "base64");
      if (signature.length !== 64 || signature.toString("base64") !== raw.signature) return false;
      const key = keys.find(candidate => candidate.keyId === raw.keyId && candidate.operatorAlias === snapshot.operatorAlias);
      return !!key && verify(null, syntheticApprovalMessage(snapshot), key.publicKey, signature);
    } catch { return false; }
  };
}
