import { afterEach, describe, expect, it, vi } from "vitest";
import { readSyntheticCredentials } from "../experiments/metaInsightsProtectedInput.ts";
import { fakeProtectedTerminal, syntheticInput } from "./metaInsightsProtectedInputFixtures.ts";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("protected synthetic terminal input", () => {
  it.each([{ raw: false, paused: true }, { raw: true, paused: false }])("does not echo secrets and restores terminal state %j", async initial => {
    const terminal = fakeProtectedTerminal(initial);
    const result = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    expect(terminal.input.isRaw).toBe(true); terminal.send(syntheticInput);
    expect(await result).toEqual({ tokenKind: "page", accessToken: "SYNTHETIC_PAGE_10D", appSecret: "SYNTHETIC_SECRET_10D" });
    expect(terminal.writes.join("")).toBe("Token sintético: \nApp Secret sintético: \n");
    expect(terminal.input.isRaw).toBe(initial.raw); expect(terminal.input.isPaused()).toBe(initial.paused);
    expect(terminal.input.eventNames()).toEqual([]);
  });
  it.each([undefined, "real", "pilot", "prepared"])("blocks mode %s before touching terminal", async mode => {
    vi.stubEnv("META_INSIGHTS_PILOT_ENABLED", "true"); vi.stubEnv("META_ACCESS_TOKEN", "DO_NOT_USE");
    const terminal = fakeProtectedTerminal();
    await expect(readSyntheticCredentials({ mode, testTerminal: terminal })).rejects.toMatchObject({ code: "real_input_blocked" });
    expect(terminal.writes).toEqual([]); expect(terminal.input.isRaw).toBe(false);
  });
  it("rejects a missing injected terminal", async () => {
    await expect(readSyntheticCredentials({ mode: "simulation" })).rejects.toMatchObject({ code: "tty_required" });
  });
  it("rejects a non-TTY without changing it", async () => {
    const terminal = fakeProtectedTerminal({ tty: false });
    await expect(readSyntheticCredentials({ mode: "simulation", testTerminal: terminal })).rejects.toMatchObject({ code: "tty_required" });
    expect(terminal.writes).toEqual([]); expect(terminal.input.isRaw).toBe(false);
  });
  it.each([
    { value: "\r", code: "empty_token" },
    { value: "SYNTHETIC_PAGE_10D\r\r", code: "empty_secret" },
    { value: "NOT_SYNTHETIC\r", code: "invalid_credential" },
    { value: "SYNTHETIC_PAGE_10D\rNOT_SYNTHETIC\r", code: "invalid_credential" },
    { value: "SYNTHETIC_PAGE_10D\rSYNTHETIC_" + "a".repeat(1024), code: "input_too_large" },
    { value: "\u0003", code: "aborted" },
    { value: "\u0004", code: "input_closed" },
    { value: "SYNTHETIC_" + "a".repeat(8192), code: "input_too_large" },
    { value: "\u001b[31m", code: "invalid_credential" },
  ])("rejects $code and restores the terminal", async ({ value, code }) => {
    const terminal = fakeProtectedTerminal(); const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    terminal.send(value); await expect(pending).rejects.toMatchObject({ code });
    expect(terminal.input.isRaw).toBe(false); expect(terminal.input.isPaused()).toBe(true);
    expect(terminal.input.eventNames()).toEqual([]); expect(terminal.writes.join("")).not.toContain("SYNTHETIC_");
  });
  it.each(["error", "end", "close"])("sanitizes %s and restores terminal state", async event => {
    const terminal = fakeProtectedTerminal(); const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    terminal.input.emit(event, new Error("SENSITIVE_READ"));
    await expect(pending).rejects.toMatchObject({ code: event === "error" ? "input_failed" : "input_closed" });
    await expect(pending).rejects.not.toThrow(/SENSITIVE/);
    expect(terminal.input.isRaw).toBe(false); expect(terminal.input.isPaused()).toBe(true);
  });
  it.each([{ failRaw: true }, { failWrite: true }])("cleans up setup failure %j", async config => {
    const terminal = fakeProtectedTerminal(config);
    await expect(readSyntheticCredentials({ mode: "simulation", testTerminal: terminal })).rejects.toMatchObject({ code: "input_failed" });
    expect(terminal.input.isRaw).toBe(false); expect(terminal.input.isPaused()).toBe(true); expect(terminal.input.eventNames()).toEqual([]);
  });
  it("fails closed when terminal restoration itself fails", async () => {
    const terminal = fakeProtectedTerminal({ failRestore: true }); const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    terminal.send(syntheticInput); await expect(pending).rejects.toMatchObject({ code: "terminal_restore_failed" });
    expect(terminal.input.eventNames()).toEqual([]); expect(terminal.input.isPaused()).toBe(true);
  });
  it("does not reuse a terminal whose restoration failed", async () => {
    const terminal = fakeProtectedTerminal({ failRestore: true });
    const first = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    terminal.send(syntheticInput); await expect(first).rejects.toMatchObject({ code: "terminal_restore_failed" });
    const second = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal }); terminal.send(syntheticInput);
    await expect(second).rejects.toMatchObject({ code: "terminal_busy" });
  });
  it("sanitizes failure while inspecting the initial terminal state", async () => {
    const terminal = fakeProtectedTerminal(); terminal.input.isPaused = () => { throw Error("SENSITIVE_SNAPSHOT"); };
    const pending = Promise.resolve().then(() => readSyntheticCredentials({ mode: "simulation", testTerminal: terminal }));
    await expect(pending).rejects.toMatchObject({ code: "input_failed" });
    await expect(pending).rejects.not.toThrow(/SENSITIVE/); expect(terminal.writes).toEqual([]);
  });
  it("handles external abort without echoing its reason", async () => {
    const terminal = fakeProtectedTerminal(); const abort = new AbortController();
    const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal, signal: abort.signal });
    abort.abort("SENSITIVE_ABORT"); await expect(pending).rejects.toMatchObject({ code: "aborted" });
    await expect(pending).rejects.not.toThrow(/SENSITIVE/); expect(terminal.input.isRaw).toBe(false);
  });
  it("times out once and releases listeners and timers", async () => {
    vi.useFakeTimers(); const terminal = fakeProtectedTerminal();
    const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal, timeoutMs: 20 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "input_timeout" });
    await vi.advanceTimersByTimeAsync(20); await assertion;
    expect(terminal.input.eventNames()).toEqual([]); expect(vi.getTimerCount()).toBe(0); expect(terminal.input.isRaw).toBe(false);
  });
  it("rejects simultaneous readers instead of sharing a terminal", async () => {
    const terminal = fakeProtectedTerminal(); const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    const other = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    await expect(other).rejects.toMatchObject({ code: "terminal_busy" });
    terminal.send(syntheticInput); await pending;
  });
  it("refuses a terminal with an existing data consumer", async () => {
    const terminal = fakeProtectedTerminal(); const other = () => {}; terminal.input.on("data", other);
    await expect(readSyntheticCredentials({ mode: "simulation", testTerminal: terminal })).rejects.toMatchObject({ code: "terminal_busy" });
    expect(terminal.input.listeners("data")).toEqual([other]); expect(terminal.writes).toEqual([]);
  });
  it("handles CRLF and backspace without echoing edited characters", async () => {
    const terminal = fakeProtectedTerminal(); const pending = readSyntheticCredentials({ mode: "simulation", testTerminal: terminal });
    terminal.send("SYNTHETIC_PAGE_10X\u007fD\r\nSYNTHETIC_SECRET_10D\r\n");
    expect(await pending).toMatchObject({ accessToken: "SYNTHETIC_PAGE_10D", appSecret: "SYNTHETIC_SECRET_10D" });
    expect(terminal.writes.join("")).not.toMatch(/SYNTHETIC|10X|\u007f/); expect(terminal.input.isRaw).toBe(false);
  });
  it.each(["on", "write"])("stops setup when %s completes the read synchronously", async hook => {
    vi.useFakeTimers(); const terminal = fakeProtectedTerminal(); let sent = false;
    if (hook === "on") {
      const on = terminal.input.on.bind(terminal.input);
      terminal.input.on = (event, listener) => { const result = on(event, listener);
        if (event === "data" && !sent) { sent = true; terminal.send(syntheticInput); } return result; };
    } else {
      const write = terminal.output.write;
      terminal.output.write = text => { const result = write(text);
        if (text === "Token sintético: " && !sent) { sent = true; terminal.send(syntheticInput); } return result; };
    }
    try {
      expect(await readSyntheticCredentials({ mode: "simulation", testTerminal: terminal }))
        .toMatchObject({ accessToken: "SYNTHETIC_PAGE_10D" });
      expect(terminal.input.isRaw).toBe(false); expect(terminal.input.isPaused()).toBe(true);
      expect(terminal.input.eventNames()).toEqual([]); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.clearAllTimers(); }
  });
  it.each(["on", "raw"])("does not prompt or resume after cancellation from setup hook %s", async hook => {
    const terminal = fakeProtectedTerminal(); const abort = new AbortController(); let fired = false;
    if (hook === "on") {
      const on = terminal.input.on.bind(terminal.input);
      terminal.input.on = (event, listener) => { const result = on(event, listener);
        if (!fired) { fired = true; abort.abort(); } return result; };
    } else {
      const raw = terminal.input.setRawMode;
      terminal.input.setRawMode = value => { raw(value); if (value && !fired) { fired = true; abort.abort(); } };
    }
    await expect(readSyntheticCredentials({ mode: "simulation", testTerminal: terminal, signal: abort.signal }))
      .rejects.toMatchObject({ code: "aborted" });
    expect(terminal.writes).toEqual([]); expect(terminal.input.isRaw).toBe(false);
    expect(terminal.input.isPaused()).toBe(true); expect(terminal.input.eventNames()).toEqual([]);
  });
  it("restores correctly when resume delivers data synchronously", async () => {
    const terminal = fakeProtectedTerminal(); const resume = terminal.input.resume;
    terminal.input.resume = () => { resume(); terminal.send(syntheticInput); };
    expect(await readSyntheticCredentials({ mode: "simulation", testTerminal: terminal })).toMatchObject({ tokenKind: "page" });
    expect(terminal.input.isRaw).toBe(false); expect(terminal.input.isPaused()).toBe(true);
    expect(terminal.input.eventNames()).toEqual([]);
  });
});
