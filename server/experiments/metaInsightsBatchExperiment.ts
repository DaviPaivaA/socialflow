// Disposable synthetic-only spike. No HTTPS implementation and no application wiring.
import { createHmac, timingSafeEqual } from "node:crypto";
import { FacebookInsightsClient } from "../src/facebookInsightsClient.ts";
import { createInsightsRequestDescriptor, MetaInsightsClientError,
  type MetaInsightsErrorCode } from "../src/metaInsightsClient.ts";
import { isInsightsRecord, type InsightsStatus } from "../../shared/insightsContract.ts";

const TOKEN = "SYNTHETIC_PAGE_TOKEN_10A_+&=";
const SECRET = "SYNTHETIC_APP_SECRET_10A";
const MAX_BYTES = 1024 * 1024;

export type PageProbe = Readonly<{
  pageId: string;
  graphApiVersion: "v26.0";
  metric: "page_media_view";
  period: "day";
  since: number;
  until: number;
}>;
export type SyntheticBatchRequest = Readonly<{
  url: "https://graph.facebook.com/v26.0/";
  method: "POST";
  redirect: "error";
  headers: Readonly<{ "accept-encoding": "identity" }>;
  body: FormData;
}>;
export type SimulatedResponse = {
  status: number;
  headers?: Readonly<Record<string, string>>;
  body: AsyncIterable<Uint8Array>;
};
// Explicit fake dependency only. Deliberately no default fetch/https implementation.
export type SimulatedBatchHttp = (
  request: SyntheticBatchRequest, signal: AbortSignal,
) => Promise<SimulatedResponse>;
type ProbeCode = MetaInsightsErrorCode | "pilot_not_authorized" | "incomplete_response"
  | "redirect_blocked" | "response_too_large";
class ProbeError extends Error {
  readonly code: ProbeCode;
  constructor(code: ProbeCode) { super(`Synthetic probe: ${code}`); this.code = code; }
}
export type ProbeReport = {
  mode: "dry_run";
  simulated: true;
  realMetaValidated: false;
  family: "facebook_page";
  graphApiVersion: "v26.0";
  metric: "page_media_view";
  outcome: InsightsStatus | ProbeCode;
  outerStatus: number | null;
  innerStatus: number | null;
};
export type ProbeOptions = {
  mode?: string;
  now?: number;
  http?: SimulatedBatchHttp;
  signal?: AbortSignal;
  timeoutMs?: number;
};

// Pure helper; no logging, environment, persistence or network.
export function calculateProof(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}
export function verifyProof(token: string, secret: string, proof: string): boolean {
  return /^[a-f0-9]{64}$/.test(proof) &&
    timingSafeEqual(Buffer.from(proof, "hex"), Buffer.from(calculateProof(token, secret), "hex"));
}

export function buildSyntheticBatchRequest(query: PageProbe, now = Date.now()): SyntheticBatchRequest {
  if (!isInsightsRecord(query) || Object.keys(query).some(key => ![
    "pageId", "graphApiVersion", "metric", "period", "since", "until",
  ].includes(key)) || query.metric !== "page_media_view" || query.period !== "day" ||
    !Number.isSafeInteger(now) || !Number.isSafeInteger(query.since) || !Number.isSafeInteger(query.until)
  ) throw new ProbeError("invalid_query");
  const descriptor = createInsightsRequestDescriptor({
    scope: "facebook_page", objectId: query.pageId, graphApiVersion: query.graphApiVersion,
    metrics: [query.metric], period: query.period, since: query.since, until: query.until,
  });
  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
  if (query.since * 1000 < oldest.getTime() || query.until * 1000 > now ||
    query.until - query.since > 90 * 86400) throw new ProbeError("invalid_query");
  const parameters = new URLSearchParams({
    metric: descriptor.parameters.metric, period: "day",
    since: String(query.since), until: String(query.until),
  });
  const body = new FormData();
  body.set("access_token", TOKEN);
  body.set("appsecret_proof", calculateProof(TOKEN, SECRET));
  body.set("batch", JSON.stringify([{
    method: "GET", relative_url: `${descriptor.objectId}/insights?${parameters}`,
  }]));
  return Object.freeze({ url: "https://graph.facebook.com/v26.0/", method: "POST",
    redirect: "error", headers: Object.freeze({ "accept-encoding": "identity" }), body });
}

function json(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new ProbeError("invalid_response"); }
}
async function readBody(response: SimulatedResponse, signal: AbortSignal): Promise<unknown> {
  if (Object.entries(response.headers ?? {}).some(([name, encoding]) =>
    name.toLowerCase() === "content-encoding" && encoding !== "identity"
  )) throw new ProbeError("invalid_response");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    if (signal.aborted) throw new ProbeError("aborted");
    if (!(chunk instanceof Uint8Array)) throw new ProbeError("invalid_response");
    bytes += chunk.byteLength;
    if (bytes > MAX_BYTES) throw new ProbeError("response_too_large");
    chunks.push(Buffer.from(chunk));
  }
  if (signal.aborted) throw new ProbeError("aborted");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new ProbeError("invalid_response"); }
  return json(text);
}
function validStatus(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
}
const syntheticHttp: SimulatedBatchHttp = async () => ({
  status: 200,
  body: (async function* () {
    yield Buffer.from(JSON.stringify([{ code: 200, headers: [], body: JSON.stringify({ data: [{
      name: "page_media_view", period: "day", values: [{ value: 0, end_time: "2026-10-21T00:00:00+0000" }],
    }] }) }]));
  })(),
});

export async function runBatchExperiment(query: PageProbe, options: ProbeOptions = {}): Promise<ProbeReport> {
  const report: ProbeReport = { mode: "dry_run", simulated: true, realMetaValidated: false,
    family: "facebook_page", graphApiVersion: "v26.0", metric: "page_media_view",
    outcome: "provider_unavailable", outerStatus: null, innerStatus: null };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    // No environment or CLI switch can turn this spike into a real pilot.
    if (options.mode !== undefined && options.mode !== "dry_run") throw new ProbeError("pilot_not_authorized");
    const now = options.now ?? Date.now();
    const request = buildSyntheticBatchRequest(query, now);
    const snapshot = { ...query };
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
      throw new ProbeError("invalid_query");
    }
    if (options.signal?.aborted) throw new ProbeError("aborted");
    const cancellation = new Promise<never>((_resolve, reject) => {
      const cancel = (code: "timeout" | "aborted") => {
        reject(new ProbeError(code));
        controller.abort(); // Cooperative fake cancellation, not a claim of physical network cancellation.
      };
      abort = () => cancel("aborted");
      options.signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => cancel("timeout"), timeoutMs);
    });
    const work = async () => {
      const outer = await (options.http ?? syntheticHttp)(request, controller.signal);
      if (controller.signal.aborted) throw new ProbeError("aborted");
      if (!validStatus(outer.status)) throw new ProbeError("invalid_response");
      report.outerStatus = outer.status;
      if (outer.status === 429) throw new ProbeError("rate_limited");
      if (outer.status >= 300 && outer.status < 400) throw new ProbeError("redirect_blocked");
      const envelope = await readBody(outer, controller.signal);
      let status = outer.status;
      let body = envelope;
      if (status >= 200 && status < 300 && !(isInsightsRecord(envelope) && Object.hasOwn(envelope, "error"))) {
        if (!Array.isArray(envelope)) throw new ProbeError("invalid_response");
        if (envelope.length !== 1 || envelope[0] === null) throw new ProbeError("incomplete_response");
        const item: unknown = envelope[0];
        if (!isInsightsRecord(item) || !validStatus(item.code) || typeof item.body !== "string") {
          throw new ProbeError("invalid_response");
        }
        report.innerStatus = status = item.code;
        if (status === 429) throw new ProbeError("rate_limited");
        if (status >= 300 && status < 400) throw new ProbeError("redirect_blocked");
        if (Buffer.byteLength(item.body, "utf8") > MAX_BYTES) throw new ProbeError("response_too_large");
        body = json(item.body);
      }
      if (isInsightsRecord(body) && isInsightsRecord(body.paging) && Object.hasOwn(body.paging, "next")) {
        throw new ProbeError("incomplete_response");
      }
      // Existing approved core handles numeric Graph codes, including 80001; no duplicate classifier.
      const client = new FacebookInsightsClient({ now: () => now, transport: async () => ({ status, body }) });
      const normalized = await client.query({ scope: "facebook_page", objectId: snapshot.pageId,
        graphApiVersion: snapshot.graphApiVersion, period: snapshot.period, metrics: [snapshot.metric],
        since: snapshot.since, until: snapshot.until,
      }, { tokenKind: "page", accessToken: TOKEN, expiresAt: null,
        grantedScopes: ["read_insights", "pages_read_engagement", "pages_show_list"], tasks: ["ANALYZE"] },
      { signal: controller.signal });
      return normalized.metrics[0].status;
    };
    // The catch handler installed by race observes late rejection even if a fake ignores abort.
    report.outcome = await Promise.race([work(), cancellation]);
  } catch (error) {
    report.outcome = error instanceof ProbeError || error instanceof MetaInsightsClientError
      ? error.code : "provider_unavailable";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) options.signal?.removeEventListener("abort", abort);
    controller.abort();
  }
  return Object.freeze({ ...report });
}
