import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  process.exitCode = originalExitCode;
  for (const module of ["../src/app.ts", "../src/config.ts", "../src/database.ts", "../src/mediaStorage.ts"]) vi.doUnmock(module);
  vi.resetModules();
});

async function runningBackend() {
  vi.useFakeTimers();
  const handlers = new Map<string | symbol, () => void>();
  vi.spyOn(process, "once").mockImplementation((event, callback) => { handlers.set(event, callback); return process; });
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const phases: string[] = [];
  let settle!: () => void;
  const drain = new Promise<void>(resolve => { settle = resolve; });
  const pool = { end: vi.fn(async () => { phases.push("pool-ended"); }) };
  const server = Object.assign(new EventEmitter(), {
    listen: vi.fn((_port: number, _host: string, ready: () => void) => ready()),
    close: vi.fn((closed: (error?: Error) => void) => { phases.push("http-closed"); closed(); }),
    publicationScheduler: {
      start: vi.fn(), stop: vi.fn(() => { phases.push("stopped"); }),
      whenIdle: vi.fn(async () => { await drain; phases.push("drained"); }),
    },
  });
  vi.doMock("../src/app.ts", () => ({ createApiServer: () => server }));
  vi.doMock("../src/config.ts", () => ({ loadServerConfig: () => ({ socialTokenEncryptionKey: Buffer.alloc(32, 7) }) }));
  vi.doMock("../src/database.ts", () => ({ createDatabasePool: () => pool }));
  vi.doMock("../src/mediaStorage.ts", () => ({ ensureMediaStorageReady: async () => {} }));
  await import("../src/index.ts");
  return { handlers, exit, pool, server, phases, settle };
}

describe("backend publication shutdown", () => {
  it("keeps the shutdown bound active if closing HTTP fails while provider work is pending", async () => {
    const s = await runningBackend();
    s.server.close.mockImplementation(closed => { closed(new Error("controlled close failure")); });
    s.handlers.get("SIGTERM")!();
    await vi.advanceTimersByTimeAsync(330_000);
    expect(s.exit).toHaveBeenCalledWith(1);
    expect(s.pool.end).not.toHaveBeenCalled();
    s.settle(); await vi.advanceTimersByTimeAsync(0);
  });

  it("stops accepting requests immediately and preserves the pool until emitted provider work settles", async () => {
    const s = await runningBackend();
    s.handlers.get("SIGTERM")!();
    expect(s.phases).toEqual(["stopped", "http-closed"]);
    expect(s.pool.end).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.exit).not.toHaveBeenCalled();
    s.settle(); await vi.advanceTimersByTimeAsync(0);
    expect(s.phases).toEqual(["stopped", "http-closed", "drained", "pool-ended"]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.exit).not.toHaveBeenCalled();
  });

  it("bounds shutdown at 330 seconds without claiming an external request was cancelled", async () => {
    const s = await runningBackend();
    s.handlers.get("SIGINT")!();
    await vi.advanceTimersByTimeAsync(329_999);
    expect(s.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.exit).toHaveBeenCalledWith(1);
    expect(s.pool.end).not.toHaveBeenCalled();
    s.settle(); await vi.advanceTimersByTimeAsync(0);
  });
});
