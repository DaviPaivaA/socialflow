import { EventEmitter } from "node:events";

export function fakeProtectedTerminal(settings: { raw?: boolean; paused?: boolean; tty?: boolean;
  failRaw?: boolean; failRestore?: boolean; failWrite?: boolean } = {}) {
  let paused = settings.paused ?? true;
  let rawCalls = 0;
  const writes: string[] = [];
  const input = Object.assign(new EventEmitter(), {
    isTTY: settings.tty ?? true, isRaw: settings.raw ?? false,
    isPaused() { return paused; }, pause() { paused = true; }, resume() { paused = false; },
    setRawMode(raw: boolean) {
      rawCalls++;
      if ((rawCalls === 1 && settings.failRaw) || (rawCalls > 1 && settings.failRestore)) throw Error("SENSITIVE_TTY_FAILURE");
      input.isRaw = raw;
    },
  });
  const output = { isTTY: true, write(text: string) {
    if (settings.failWrite) throw Error("SENSITIVE_OUTPUT_FAILURE"); writes.push(text); return true;
  } };
  return { input, output, writes, send(text: string) { input.emit("data", Buffer.from(text)); } };
}

export const syntheticInput = "SYNTHETIC_PAGE_10D\rSYNTHETIC_SECRET_10D\r";
