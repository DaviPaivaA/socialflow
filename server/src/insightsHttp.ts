import type { IncomingMessage, ServerResponse } from "node:http";
import { isInsightsResponse, isInsightsSelection, type InsightsScope } from "../../shared/insightsContract.ts";
import { isUuid } from "../../shared/postContract.ts";
import { UnauthorizedError, type PostgresAuthService } from "./authService.ts";
import { InsightsServiceError, type InsightsService, type InsightsServiceQuery } from "./insightsService.ts";

type Dependencies = {
  authService: Pick<PostgresAuthService, "require">;
  insightsService: Pick<InsightsService, "query">;
  sendJson: (response: ServerResponse, status: number, body: unknown) => void;
};

// Only fixed messages/codes leave this boundary. Never inspect or log raw errors,
// query values, headers, credentials, database details or AbortSignal.reason.
const ERRORS = {
  invalid_id: [400, "invalid_insights_id", "O identificador de Insights é inválido."],
  invalid_query: [400, "invalid_insights_query", "A consulta de Insights é inválida."],
  unauthorized: [401, "unauthorized", "Autenticação necessária."],
  not_found: [404, "insights_not_found", "O recurso de Insights não foi encontrado."],
  permission_required: [409, "meta_insights_permission_required", "A conexão não possui permissão para consultar Insights."],
  token_expired: [409, "meta_insights_token_expired", "A autorização para consultar Insights expirou."],
  unsupported_object: [409, "meta_insights_unsupported_object", "Este recurso não permite a consulta de Insights."],
  rate_limited: [429, "meta_insights_rate_limited", "O limite de consultas de Insights foi atingido."],
  transport_blocked: [503, "meta_insights_not_enabled", "A consulta de Insights não está habilitada."],
  timeout: [503, "meta_insights_timeout", "O tempo de consulta de Insights foi excedido."],
  aborted: [503, "meta_insights_aborted", "A consulta de Insights foi interrompida."],
  provider_unavailable: [503, "meta_insights_provider_unavailable", "O serviço de Insights está temporariamente indisponível."],
  method_not_allowed: [405, "method_not_allowed", "Método não permitido para este recurso."],
} as const;
type ErrorKey = keyof typeof ERRORS;
class InsightsHttpError extends Error {
  readonly code: "invalid_id" | "invalid_query";
  constructor(code: "invalid_id" | "invalid_query") {
    super("Invalid Insights request");
    this.code = code;
  }
}
function invalidQuery(): never { throw new InsightsHttpError("invalid_query"); }

function utcSeconds(value: string | null): number {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalidQuery();
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || new Date(milliseconds).toISOString().slice(0, 10) !== value) return invalidQuery();
  return milliseconds / 1000;
}

function parseQuery(url: URL, scope: InsightsScope, id: string): InsightsServiceQuery {
  if (!isUuid(id)) throw new InsightsHttpError("invalid_id");
  const account = scope === "facebook_page" || scope === "instagram_account";
  const allowed = ["metrics", "period", ...(account ? ["since", "until"] : []), ...(scope === "instagram_account" ? ["metricType"] : [])];
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!allowed.includes(key) || seen.has(key)) return invalidQuery();
    seen.add(key);
  }
  const metrics = url.searchParams.get("metrics");
  const selection = {
    scope,
    period: url.searchParams.get("period") ?? (account ? "day" : "lifetime"),
    metrics: metrics === null ? [scope === "facebook_page" ? "page_media_view" : scope === "facebook_post" ? "post_media_view" : "views"] : metrics.split(","),
  };
  if (!isInsightsSelection(selection)) return invalidQuery();
  if (!account) return { ...selection, publicationId: id } as InsightsServiceQuery;
  const since = utcSeconds(url.searchParams.get("since"));
  const until = utcSeconds(url.searchParams.get("until"));
  if (until <= since) return invalidQuery();
  if (scope === "instagram_account") {
    const metricType = url.searchParams.get("metricType") ?? "total_value";
    if ((metricType !== "total_value" && metricType !== "time_series") ||
        (metricType === "time_series" && selection.metrics.some(metric => metric !== "reach"))) return invalidQuery();
    return { ...selection, socialAccountId: id, since, until, metricType } as InsightsServiceQuery;
  }
  return { ...selection, socialAccountId: id, since, until } as InsightsServiceQuery;
}

export async function handleInsightsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  dependencies: Dependencies,
): Promise<boolean> {
  const route = /^\/insights\/(facebook|instagram)\/(accounts|publications)\/([^/]+)$/.exec(url.pathname);
  if (!route) return false;
  const controller = new AbortController();
  const onAbort = () => { controller.abort(); };
  const onClose = () => { if (!response.writableEnded) onAbort(); };
  request.once("aborted", onAbort);
  response.once("close", onClose);
  if (request.aborted || response.destroyed) onAbort();
  const usable = () => !controller.signal.aborted && !request.aborted && !response.destroyed && !response.writableEnded;
  function sendError(key: ErrorKey) {
    if (!usable()) return;
    const [status, code, message] = ERRORS[key];
    dependencies.sendJson(response, status, { error: { code, message } });
  }
  try {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET, OPTIONS");
      sendError("method_not_allowed");
      return true;
    }
    const context = await dependencies.authService.require(request);
    if (!usable()) return true;
    const scope = route[1] === "facebook"
      ? (route[2] === "accounts" ? "facebook_page" : "facebook_post")
      : (route[2] === "accounts" ? "instagram_account" : "instagram_media");
    const query = parseQuery(url, scope, route[3]);
    const result = await dependencies.insightsService.query(context, query, { signal: controller.signal });
    // The service has just revalidated authorization and credentials. Do not add
    // an await between its final gate and this synchronous validation/send.
    if (!usable()) return true;
    if (!isInsightsResponse(result)) { sendError("provider_unavailable"); return true; }
    dependencies.sendJson(response, 200, result);
  } catch (error) {
    const key = error instanceof UnauthorizedError ? "unauthorized"
      : error instanceof InsightsHttpError ? error.code
        : error instanceof InsightsServiceError && Object.hasOwn(ERRORS, error.code) ? error.code
          : "provider_unavailable";
    sendError(key);
  } finally {
    request.off("aborted", onAbort);
    response.off("close", onClose);
  }
  return true;
}
