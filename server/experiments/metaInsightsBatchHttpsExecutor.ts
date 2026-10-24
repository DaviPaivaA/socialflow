// Experimental HTTPS mechanics. No native request implementation, CLI, env or app wiring.
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { isInsightsRecord } from "../../shared/insightsContract.ts";
import { buildSyntheticBatchRequest, calculateProof, runBatchExperiment,
  type PageProbe, type ProbeReport, type SimulatedResponse, type SyntheticBatchRequest,
} from "./metaInsightsBatchExperiment.ts";

export type SimulationHttpsRequest = (
  options: RequestOptions, callback: (response: IncomingMessage) => void,
) => ClientRequest;
export type SyntheticPageCredential = Readonly<{
  tokenKind: "page";
  accessToken: string;
  appSecret: string;
}>;
type WireCode = "tls_error" | "invalid_response" | "response_too_large"
  | "request_too_large" | "provider_unavailable" | "aborted";
type Outcome = ProbeReport["outcome"] | WireCode | "invalid_credential"
  | "operation_in_progress" | "pilot_already_attempted";
export type HttpsExperimentReport = Readonly<{
  simulated: boolean;
  realMetaValidated: false;
  family: "facebook_page";
  graphApiVersion: "v26.0";
  method: "POST";
  localValidation: "passed" | "rejected" | "blocked";
  outcome: Outcome;
  errorCategory: Exclude<Outcome, "available" | "not_available"> | null;
  outerStatus: number | null;
  innerStatus: number | null;
  durationMs: number;
  blockedReason: "real_pilot_not_authorized" | "simulation_driver_required";
}>;
type ExecuteOptions = { mode?: string; now?: number; timeoutMs?: number; signal?: AbortSignal };
class WireError extends Error {
  readonly code: WireCode;
  constructor(code: WireCode) { super(`Isolated HTTPS: ${code}`); this.code = code; }
}
type Ticket = { closed: boolean; finished: boolean };
// Only an occupancy marker: never stores credentials, responses, accounts or tenant authority.
let active: Ticket | undefined;
function release(ticket: Ticket) {
  if (active === ticket && ticket.closed && ticket.finished) active = undefined;
}
function validCredential(value: SyntheticPageCredential): boolean {
  return isInsightsRecord(value) && Object.keys(value).every(key => ["tokenKind", "accessToken", "appSecret"].includes(key)) &&
    value.tokenKind === "page" && typeof value.accessToken === "string" && typeof value.appSecret === "string" &&
    value.accessToken.length <= 8192 && value.appSecret.length <= 1024 &&
    /^SYNTHETIC_[A-Za-z0-9_+&= .?-]+$/.test(value.accessToken) &&
    /^SYNTHETIC_[A-Za-z0-9_+&= .?-]+$/.test(value.appSecret);
}
function classifyIo(error: unknown): WireError {
  const code = isInsightsRecord(error) ? error.code : undefined;
  return new WireError(typeof code === "string" && (
    /^ERR_(TLS|SSL)_/.test(code) || ["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT"].includes(code)
  ) ? "tls_error" : "provider_unavailable");
}
const MAX_RESPONSE = 1024 * 1024;
const MAX_REQUEST = 32 * 1024;

async function exchange(
  candidate: SyntheticBatchRequest, credential: SyntheticPageCredential, driver: SimulationHttpsRequest,
  signal: AbortSignal, ticket: Ticket, observeStatus: (status: number) => void,
): Promise<SimulatedResponse> {
  const form = new FormData();
  form.set("access_token", credential.accessToken);
  form.set("appsecret_proof", calculateProof(credential.accessToken, credential.appSecret));
  form.set("batch", String(candidate.body.get("batch")));
  // Request is used solely as the native multipart encoder; constructing/reading it performs no IO.
  const encoded = new Request("https://graph.facebook.com/v26.0/", { method: "POST", body: form });
  const payload = Buffer.from(await encoded.arrayBuffer());
  if (payload.length > MAX_REQUEST) throw new WireError("request_too_large");
  if (signal.aborted) throw new WireError("aborted");
  return new Promise<SimulatedResponse>((resolve, reject) => {
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let settled = false;
    let bytes = 0;
    let declaredLength: number | undefined;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      response?.off("data", onData);
      response?.off("end", onEnd);
      response?.off("aborted", onAborted);
      response?.off("close", onPrematureClose);
      // Error guards remain until close to observe late errors caused by destruction.
      try { response?.destroy(); } catch { /* Never echo a dependency exception. */ }
      try { request?.destroy(); } catch { /* Keep the occupancy gate closed until close is observed. */ }
    };
    const fail = (error: WireError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = () => {
      if (settled || !response) return;
      settled = true;
      const result = { status: response.statusCode!, headers: {}, body: (async function* () {
        yield Buffer.concat(chunks, bytes);
      })() };
      cleanup();
      resolve(result);
    };
    const abort = () => fail(new WireError("aborted"));
    const onError = (error: unknown) => fail(classifyIo(error));
    const onAborted = () => fail(new WireError("provider_unavailable"));
    const onPrematureClose = () => { if (!settled) fail(new WireError("provider_unavailable")); };
    const onData = (chunk: unknown) => {
      if (settled) return;
      if (!(chunk instanceof Uint8Array)) return fail(new WireError("invalid_response"));
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE) return fail(new WireError("response_too_large"));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      if (declaredLength !== undefined && declaredLength !== bytes) return fail(new WireError("invalid_response"));
      succeed();
    };
    const onResponse = (incoming: IncomingMessage) => {
      response = incoming;
      incoming.on("error", onError);
      incoming.once("close", () => incoming.off("error", onError));
      if (settled || signal.aborted) { cleanup(); return; }
      const tls = incoming.socket as typeof incoming.socket & { encrypted?: boolean; authorized?: boolean };
      if (tls?.encrypted !== true || tls.authorized !== true) return fail(new WireError("tls_error"));
      const status = incoming.statusCode;
      if (!Number.isInteger(status) || status! < 100 || status! > 599) return fail(new WireError("invalid_response"));
      observeStatus(status!);
      // Classify status-only quota/redirect without consuming untrusted error payloads.
      if (status === 429 || (status! >= 300 && status! < 400)) { succeed(); return; }
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (key.toLowerCase() === "content-encoding" && value !== "identity") return fail(new WireError("invalid_response"));
        if (key.toLowerCase() === "content-length") {
          if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
            return fail(new WireError("invalid_response"));
          }
          declaredLength = Number(value);
          if (declaredLength > MAX_RESPONSE) return fail(new WireError("response_too_large"));
        }
      }
      incoming.on("data", onData);
      incoming.once("end", onEnd);
      incoming.once("aborted", onAborted);
      incoming.once("close", onPrematureClose);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      ticket.closed = false;
      request = driver({ protocol: "https:", hostname: "graph.facebook.com", port: 443,
        servername: "graph.facebook.com", path: "/v26.0/", method: "POST", agent: false,
        rejectUnauthorized: true, minVersion: "TLSv1.2", maxHeaderSize: 16 * 1024,
        headers: { "content-type": encoded.headers.get("content-type")!,
          "content-length": String(payload.length), "accept-encoding": "identity" },
      }, onResponse);
      request.on("error", onError);
      request.once("close", () => {
        ticket.closed = true;
        request?.off("error", onError);
        if (!settled) fail(new WireError("provider_unavailable"));
        release(ticket);
      });
      if (settled || signal.aborted) { cleanup(); if (!settled) abort(); return; }
      request.end(payload);
    } catch (error) {
      if (!request) ticket.closed = true;
      fail(classifyIo(error));
    }
  });
}

export function createIsolatedBatchHttpsExecutor(
  configuration: { simulationRequest?: SimulationHttpsRequest } = {},
) {
  let used = false;
  return { async execute(query: PageProbe, credential: SyntheticPageCredential, options: ExecuteOptions = {}): Promise<HttpsExperimentReport> {
    const started = performance.now();
    let localValidation: HttpsExperimentReport["localValidation"] = "blocked";
    let observedStatus: number | null = null;
    const driver = configuration.simulationRequest;
    const finish = (outcome: Outcome, result?: ProbeReport): HttpsExperimentReport => Object.freeze({
      simulated: driver !== undefined, realMetaValidated: false, family: "facebook_page", graphApiVersion: "v26.0",
      method: "POST", localValidation, outcome,
      errorCategory: outcome === "available" || outcome === "not_available" ? null : outcome,
      outerStatus: result?.outerStatus ?? observedStatus, innerStatus: result?.innerStatus ?? null,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      blockedReason: driver === undefined ? "simulation_driver_required" : "real_pilot_not_authorized",
    });
    if (!driver) return finish("transport_blocked");
    if (options.mode !== "simulation") return finish("pilot_not_authorized");
    localValidation = "rejected";
    if (!validCredential(credential)) return finish("invalid_credential");
    if (Object.keys(configuration).some(key => key !== "simulationRequest") || typeof driver !== "function" ||
      Object.keys(options).some(key => !["mode", "now", "signal", "timeoutMs"].includes(key))
    ) return finish("invalid_query");
    const now = options.now ?? Date.now();
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) return finish("invalid_query");
    try { buildSyntheticBatchRequest(query, now); } catch { return finish("invalid_query"); }
    if (options.signal?.aborted) return finish("aborted");
    localValidation = "blocked";
    if (used) return finish("pilot_already_attempted");
    if (active) return finish("operation_in_progress");
    const ticket: Ticket = { closed: true, finished: false };
    active = ticket;
    used = true;
    localValidation = "passed";
    const snapshot = { ...query };
    const secrets = { ...credential };
    let wireError: WireError | undefined;
    try {
      const result = await runBatchExperiment(snapshot, { now, signal: options.signal, timeoutMs,
        http: async (candidate, signal) => {
          try { return await exchange(candidate, secrets, driver, signal, ticket, status => { observedStatus = status; }); }
          catch (error) { wireError = error instanceof WireError ? error : classifyIo(error); throw wireError; }
        },
      });
      const outcome = result.outcome === "timeout" || result.outcome === "aborted"
        ? result.outcome : wireError?.code ?? result.outcome;
      return finish(outcome, result);
    } finally {
      ticket.finished = true;
      release(ticket);
    }
  } };
}
