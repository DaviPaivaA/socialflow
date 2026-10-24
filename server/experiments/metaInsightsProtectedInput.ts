// No stdin/stdout binding, CLI, env lookup or persistent credential storage.
import type { SyntheticPageCredential } from "./metaInsightsBatchHttpsExecutor.ts";

type InputEvent = "data" | "error" | "end" | "close";
export type TestTerminal = {
  input: { isTTY: boolean; isRaw: boolean; isPaused(): boolean; pause(): unknown; resume(): unknown;
    setRawMode(value: boolean): unknown; listenerCount(event: string): number;
    on(event: InputEvent, listener: (chunk?: unknown) => void): unknown;
    off(event: InputEvent, listener: (chunk?: unknown) => void): unknown };
  output: { isTTY: boolean; write(value: string): unknown };
};
export type ProtectedInputCode = "real_input_blocked" | "tty_required" | "terminal_busy" | "input_failed" |
  "input_closed" | "input_timeout" | "aborted" | "empty_token" | "empty_secret" |
  "invalid_credential" | "input_too_large" | "terminal_restore_failed" | "preflight_invalidated";
export class ProtectedInputError extends Error {
  readonly code: ProtectedInputCode;
  constructor(code: ProtectedInputCode) { super(`Protected synthetic input: ${code}`); this.code = code; }
}
const busy = new WeakSet<object>();
type InputOptions = { mode?: string; testTerminal?: TestTerminal; signal?: AbortSignal; timeoutMs?: number;
  revalidate?: () => boolean };
export function readSyntheticCredentials(options: InputOptions = {}): Promise<SyntheticPageCredential> {
  const fail = (code: ProtectedInputCode) => Promise.reject(new ProtectedInputError(code));
  if (options.mode !== "simulation") return fail("real_input_blocked");
  const terminal = options.testTerminal;
  let raw: boolean, paused: boolean;
  try {
    if (!terminal || terminal.input?.isTTY !== true || terminal.output?.isTTY !== true ||
      typeof terminal.input.isRaw !== "boolean" || typeof terminal.input.setRawMode !== "function") return fail("tty_required");
    if (busy.has(terminal.input) || terminal.input.listenerCount("data") || terminal.input.listenerCount("readable")) return fail("terminal_busy");
    raw = terminal.input.isRaw; paused = terminal.input.isPaused();
  } catch { return fail("input_failed"); }
  const { input, output } = terminal;
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) return fail("input_failed");
  if (options.signal?.aborted) return fail("aborted");
  busy.add(input);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let field: "token" | "secret" = "token";
    let line = "", token = "";
    let afterCR = false;
    const finish = (code?: ProtectedInputCode, credential?: SyntheticPageCredential) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      let restored = true;
      try { input.pause(); } catch { restored = false; }
      try { input.setRawMode(raw); if (input.isRaw !== raw) restored = false; } catch { restored = false; }
      for (const [event, listener] of listeners) {
        try { input.off(event, listener); } catch { restored = false; }
      }
      try { if (!paused) input.resume(); if (input.isPaused() !== paused) restored = false; } catch { restored = false; }
      if (restored) busy.delete(input); // Unknown terminal state is quarantined, never automatically reused.
      // Drop our references; JavaScript provides no guaranteed string zeroization.
      line = ""; token = "";
      if (!restored) reject(new ProtectedInputError("terminal_restore_failed"));
      else if (code) reject(new ProtectedInputError(code));
      else resolve(credential!);
    };
    const guard = () => {
      if (options.signal?.aborted) { finish("aborted"); return false; }
      try { if (options.revalidate && !options.revalidate()) { finish("preflight_invalidated"); return false; } }
      catch { finish("preflight_invalidated"); return false; }
      return !settled;
    };
    const abort = () => finish("aborted");
    const onError = () => finish("input_failed");
    const onClose = () => finish("input_closed");
    const onData = (chunk?: unknown) => {
      if (settled) return;
      try {
        if (!(typeof chunk === "string" || chunk instanceof Uint8Array)) return finish("invalid_credential");
        if ((typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength) > 16384) return finish("input_too_large");
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        for (const char of text) {
          if (settled) return;
          if (afterCR && char === "\n") { afterCR = false; continue; }
          afterCR = false;
          if (char === "\u0003") return finish("aborted");
          if (char === "\u0004") return finish("input_closed");
          if (char === "\u007f" || char === "\b") { line = line.slice(0, -1); continue; }
          if (char === "\r" || char === "\n") {
            afterCR = char === "\r";
            if (!line.trim()) return finish(field === "token" ? "empty_token" : "empty_secret");
            if (!/^SYNTHETIC_[A-Za-z0-9_+&= .?-]+$/.test(line)) return finish("invalid_credential");
            // Each completed field follows an asynchronous input wait: validate before the next prompt/result.
            if (!guard()) return;
            if (field === "token") { token = line; line = ""; field = "secret"; output.write("\nApp Secret sintético: "); }
            else {
              const credential = Object.freeze({ tokenKind: "page" as const, accessToken: token, appSecret: line });
              output.write("\n"); finish(undefined, credential);
            }
          } else {
            if (char < " " || char > "~") return finish("invalid_credential");
            line += char;
            if (line.length > (field === "token" ? 8192 : 1024)) return finish("input_too_large");
          }
        }
      } catch { finish("input_failed"); }
    };
    const listeners: [InputEvent, (chunk?: unknown) => void][] = [
      ["data", onData], ["error", onError], ["end", onClose], ["close", onClose],
    ];
    const continueSetup = () => {
      if (!settled && options.signal?.aborted) abort();
      return !settled;
    };
    try {
      if (!guard()) return;
      // Attach only to an explicitly supplied test dependency. No real terminal is selected here.
      input.pause(); if (!continueSetup()) return;
      for (const [event, listener] of listeners) {
        if (event === "data") continue;
        input.on(event, listener); if (!continueSetup()) return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      if (!continueSetup()) return;
      timer = setTimeout(() => finish("input_timeout"), timeoutMs);
      input.setRawMode(true); if (!continueSetup()) return;
      if (input.isRaw !== true) throw new Error();
      // A buffered stream can deliver synchronously on registration/resume; never continue after finish.
      input.on("data", onData); if (!continueSetup()) return;
      output.write("Token sintético: "); if (!continueSetup()) return;
      input.resume(); continueSetup();
    } catch { finish("input_failed"); }
  });
}
