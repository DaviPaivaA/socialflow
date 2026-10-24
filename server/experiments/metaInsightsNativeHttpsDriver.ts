// Isolated node:https binding. The builtin is deliberately not admitted in Task 10C.
import https from "node:https";
import type { RequestOptions } from "node:https";
import type { OutgoingHttpHeaders } from "node:http";
import type { SimulationHttpsRequest } from "./metaInsightsBatchHttpsExecutor.ts";

type DriverCode = "real_execution_blocked" | "invalid_request" | "ERR_TLS_HANDSHAKE_FAILED" | "transport_failure";
class NativeDriverError extends Error {
  readonly code: DriverCode;
  constructor(code: DriverCode) { super(`Page HTTPS driver: ${code}`); this.code = code; }
}
function canonicalOptions(input: RequestOptions): RequestOptions {
  const keys = ["protocol", "hostname", "port", "servername", "path", "method", "agent",
    "rejectUnauthorized", "minVersion", "maxHeaderSize", "headers"];
  const headers = input?.headers;
  if (!input || Reflect.ownKeys(input).some(key => typeof key !== "string" || !keys.includes(key)) ||
    input.protocol !== "https:" || input.hostname !== "graph.facebook.com" || input.port !== 443 ||
    input.servername !== "graph.facebook.com" || input.path !== "/v26.0/" || input.method !== "POST" ||
    input.agent !== false || input.rejectUnauthorized !== true || input.minVersion !== "TLSv1.2" ||
    input.maxHeaderSize !== 16384 || !headers || Array.isArray(headers) ||
    Reflect.ownKeys(headers).some(key => typeof key !== "string" || !["content-type", "content-length", "accept-encoding"].includes(key))
  ) throw new NativeDriverError("invalid_request");
  const values = headers as OutgoingHttpHeaders;
  const type = values["content-type"], length = values["content-length"];
  if (typeof type !== "string" || !/^multipart\/form-data; boundary=[A-Za-z0-9_-]{1,70}$/.test(type) ||
    typeof length !== "string" || !/^[1-9]\d*$/.test(length) || Number(length) > 32768 ||
    values["accept-encoding"] !== "identity") throw new NativeDriverError("invalid_request");
  // Reconstruct, never forward inherited properties, agents, DNS hooks, CA overrides or proxy settings.
  return { protocol: "https:", hostname: "graph.facebook.com", port: 443, servername: "graph.facebook.com",
    path: "/v26.0/", method: "POST", agent: false, rejectUnauthorized: true, minVersion: "TLSv1.2",
    maxHeaderSize: 16384, headers: { "content-type": type, "content-length": length, "accept-encoding": "identity" } };
}
export function createNativePageHttpsDriver(configuration: { testRequest?: SimulationHttpsRequest } = {}): SimulationHttpsRequest {
  const injected = configuration.testRequest;
  const implementation = injected ?? https.request;
  return (options, callback) => {
    // No env, CLI option or consent can release this builtin binding in this revision.
    if (!injected || injected === https.request) throw new NativeDriverError("real_execution_blocked");
    const safe = canonicalOptions(options);
    try { return implementation(safe, callback); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const tls = typeof code === "string" && (/^ERR_(TLS|SSL)_/.test(code) ||
        ["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT"].includes(code));
      throw new NativeDriverError(tls ? "ERR_TLS_HANDSHAKE_FAILED" : "transport_failure");
    }
  };
}
