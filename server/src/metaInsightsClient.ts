import {
  isInsightsRecord, isInsightsSelection, isInsightsTimestamp,
  type InsightsPeriod, type InsightsScope, type InsightsSelection,
} from "../../shared/insightsContract.ts";

export type MetaInsightsErrorCode =
  | "invalid_query" | "permission_required" | "token_expired" | "rate_limited"
  | "invalid_response" | "provider_unavailable" | "timeout" | "aborted"
  | "transport_blocked" | "unsupported_object";
const ERROR_CODES: readonly MetaInsightsErrorCode[] = [
  "invalid_query", "permission_required", "token_expired", "rate_limited",
  "invalid_response", "provider_unavailable", "timeout", "aborted",
  "transport_blocked", "unsupported_object",
];
export class MetaInsightsClientError extends Error {
  readonly code: MetaInsightsErrorCode;
  constructor(code: MetaInsightsErrorCode) {
    const safeCode = ERROR_CODES.includes(code) ? code : "provider_unavailable";
    super(`Meta Insights: ${safeCode}`);
    this.name = "MetaInsightsClientError";
    this.code = safeCode;
  }
}

type CredentialFields = {
  readonly accessToken: string;
  readonly expiresAt: string | null;
  readonly grantedScopes: readonly string[];
  readonly tasks: readonly string[];
};
// Private server-only credential: never included in a descriptor or public DTO.
export type InsightsCredential = CredentialFields &
  ({ readonly tokenKind: "page" } | { readonly tokenKind: "user" });
export type InsightsRequestInput = InsightsSelection & {
  objectId: string;
  graphApiVersion: string;
  metricType?: "total_value" | "time_series";
  since?: number;
  until?: number;
};
export type InsightsRequestDescriptor = Readonly<{
  host: "graph.facebook.com";
  graphApiVersion: "v26.0";
  method: "GET";
  objectId: string;
  edge: "insights";
  scope: InsightsScope;
  parameters: Readonly<{
    metric: string;
    period?: InsightsPeriod;
    metric_type?: "total_value" | "time_series";
    since?: number;
    until?: number;
  }>;
}>;
// A trusted internal fake seam, NOT an HTTP implementation or proof/header policy.
// No default transport, no URL/token/proof construction, and no global fetch fallback.
export type InsightsTransport = (
  descriptor: InsightsRequestDescriptor,
  credential: InsightsCredential,
  signal: AbortSignal,
) => Promise<{ status: number; body: unknown }>;
export type InsightsClientOptions = {
  transport?: InsightsTransport;
  timeoutMs?: number;
  now?: () => number;
};
export type InsightsCallOptions = { signal?: AbortSignal };

export function createInsightsRequestDescriptor(input: InsightsRequestInput): InsightsRequestDescriptor {
  if (
    !isInsightsRecord(input) || Object.keys(input).some((key) => ![
      "scope", "period", "metrics", "objectId", "graphApiVersion", "metricType", "since", "until",
    ].includes(key)) ||
    !isInsightsSelection({ scope: input.scope, period: input.period, metrics: input.metrics }) ||
    input.graphApiVersion !== "v26.0" || typeof input.objectId !== "string" ||
    !(input.scope === "facebook_post" ? /^\d{1,32}(?:_\d{1,32})?$/ : /^\d{1,32}$/).test(input.objectId)
  ) throw new MetaInsightsClientError("invalid_query");
  const hasRange = input.since !== undefined || input.until !== undefined;
  if (hasRange && (
    input.scope === "facebook_post" || input.scope === "instagram_media" ||
    !Number.isSafeInteger(input.since) || !Number.isSafeInteger(input.until) ||
    input.since! < 0 || input.until! <= input.since!
  )) throw new MetaInsightsClientError("invalid_query");
  if (input.scope === "instagram_account") {
    if (input.metricType !== "total_value" && input.metricType !== "time_series") {
      throw new MetaInsightsClientError("invalid_query");
    }
    if (input.metricType === "time_series" && input.metrics.some((name) => name !== "reach")) {
      throw new MetaInsightsClientError("invalid_query");
    }
  } else if (input.metricType !== undefined) throw new MetaInsightsClientError("invalid_query");
  return Object.freeze({
    host: "graph.facebook.com",
    graphApiVersion: "v26.0",
    method: "GET",
    objectId: input.objectId,
    edge: "insights",
    scope: input.scope,
    parameters: Object.freeze({
      metric: input.metrics.join(","),
      ...(input.scope === "instagram_media" ? {} : { period: input.period }),
      ...(input.metricType ? { metric_type: input.metricType } : {}),
      ...(hasRange ? { since: input.since, until: input.until } : {}),
    }),
  });
}

function credentialSnapshot(
  credential: InsightsCredential,
  scope: InsightsScope,
  now: number,
): InsightsCredential {
  const facebook = scope === "facebook_page" || scope === "facebook_post";
  const required = facebook
    ? ["read_insights", "pages_read_engagement", "pages_show_list"]
    : ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"];
  if (
    !isInsightsRecord(credential) || credential.tokenKind !== (facebook ? "page" : "user") ||
    typeof credential.accessToken !== "string" || !credential.accessToken.trim() ||
    !Array.isArray(credential.grantedScopes) ||
    !required.every((scope) => credential.grantedScopes.includes(scope)) ||
    !Array.isArray(credential.tasks) || (facebook && !credential.tasks.includes("ANALYZE"))
  ) throw new MetaInsightsClientError("permission_required");
  if (credential.expiresAt !== null && (
    !isInsightsTimestamp(credential.expiresAt) || Date.parse(credential.expiresAt) <= now
  )) throw new MetaInsightsClientError("token_expired");
  return Object.freeze({
    tokenKind: credential.tokenKind,
    accessToken: credential.accessToken,
    expiresAt: credential.expiresAt,
    grantedScopes: Object.freeze([...credential.grantedScopes]),
    tasks: Object.freeze([...credential.tasks]),
  });
}

function validateTransportResponse(response: unknown): unknown {
  if (
    !isInsightsRecord(response) || !Number.isInteger(response.status) ||
    Number(response.status) < 100 || Number(response.status) > 599
  ) throw new MetaInsightsClientError("invalid_response");
  let serialized: string | undefined;
  try { serialized = JSON.stringify(response.body); } catch { throw new MetaInsightsClientError("invalid_response"); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 1024 * 1024) {
    throw new MetaInsightsClientError("invalid_response");
  }
  const error = isInsightsRecord(response.body) && isInsightsRecord(response.body.error)
    ? response.body.error : undefined;
  const code = error?.code;
  if (response.status === 429 || (typeof code === "number" && [4, 17, 32, 613, 80001].includes(code))) {
    throw new MetaInsightsClientError("rate_limited");
  }
  if (code === 190) throw new MetaInsightsClientError("token_expired");
  if (code === 200) throw new MetaInsightsClientError("permission_required");
  if (error?.is_transient === true) throw new MetaInsightsClientError("provider_unavailable");
  if (code === 100) throw new MetaInsightsClientError("invalid_query");
  if (
    (isInsightsRecord(response.body) && Object.hasOwn(response.body, "error")) ||
    Number(response.status) < 200 || Number(response.status) >= 300
  ) throw new MetaInsightsClientError("provider_unavailable");
  if (isInsightsRecord(response.body) && Array.isArray(response.body.data)) {
    let datapoints = 0;
    for (const row of response.body.data) {
      if (!isInsightsRecord(row)) continue; // Shape validation belongs to the provider parser.
      datapoints += Array.isArray(row.values) ? row.values.length : 0;
      if (Object.hasOwn(row, "total_value")) datapoints += 1;
      if (datapoints > 1000) throw new MetaInsightsClientError("invalid_response");
    }
  }
  return response.body;
}

export async function executeInsightsRequest(
  input: InsightsRequestInput,
  credential: InsightsCredential,
  options: InsightsClientOptions & InsightsCallOptions = {},
): Promise<unknown> {
  const descriptor = createInsightsRequestDescriptor(input);
  const privateCredential = credentialSnapshot(credential, input.scope, (options.now ?? Date.now)());
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
    throw new MetaInsightsClientError("invalid_query");
  }
  if (options.signal?.aborted) throw new MetaInsightsClientError("aborted");
  const transport = options.transport;
  if (!transport) throw new MetaInsightsClientError("transport_blocked");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const cancellation = new Promise<never>((_resolve, reject) => {
      const cancel = (code: "timeout" | "aborted") => {
        reject(new MetaInsightsClientError(code));
        controller.abort();
      };
      abort = () => cancel("aborted");
      options.signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => cancel("timeout"), timeoutMs);
    });
    // The fake may throw synchronously, ignore abort, or reject with secret-bearing errors.
    let pending: Promise<{ status: number; body: unknown }>;
    try { pending = Promise.resolve(transport(descriptor, privateCredential, controller.signal)); }
    catch { throw new MetaInsightsClientError("provider_unavailable"); }
    const response = await Promise.race([
      pending.catch(() => { throw new MetaInsightsClientError("provider_unavailable"); }),
      cancellation,
    ]);
    return validateTransportResponse(response);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
  }
}
