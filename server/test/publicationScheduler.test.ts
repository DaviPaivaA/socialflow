import { describe, expect, it, vi } from "vitest";
import { PublicationScheduler } from "../src/publicationScheduler.ts";

const now = new Date("2026-09-27T12:00:00.000Z");

function setup(overrides: {
  failStale?: (at: Date) => Promise<void>;
  publishDueBatch?: (at: Date) => Promise<void>;
} = {}) {
  const calls: string[] = [];
  const failStale = vi.fn(overrides.failStale ?? (async () => { calls.push("stale"); }));
  const publishDueBatch = vi.fn(overrides.publishDueBatch ?? (async () => { calls.push("due"); }));
  const setInterval = vi.fn((callback: () => void, milliseconds: number) => {
    void callback;
    void milliseconds;
    return 123;
  });
  const clearInterval = vi.fn();
  const logger = { error: vi.fn() };
  const scheduler = new PublicationScheduler({
    coordinator: { failStale, publishDueBatch },
    now: () => now,
    setInterval,
    clearInterval,
    logger,
  });
  return { scheduler, calls, failStale, publishDueBatch, setInterval, clearInterval, logger };
}

describe("PublicationScheduler", () => {
  it("starts an immediate tick and schedules ticks every 15 seconds", async () => {
    const { scheduler, setInterval, failStale } = setup();
    scheduler.start();
    scheduler.start();
    await scheduler.whenIdle();
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval.mock.calls[0]?.[1]).toBe(15_000);
    expect(failStale).toHaveBeenCalledWith(now);
    scheduler.stop();
  });

  it("cancels future timer callbacks on stop", async () => {
    const { scheduler, setInterval, clearInterval, failStale } = setup();
    scheduler.start();
    await scheduler.whenIdle();
    scheduler.stop();
    expect(clearInterval).toHaveBeenCalledWith(123);
    setInterval.mock.calls[0]?.[0]();
    await scheduler.whenIdle();
    expect(failStale).toHaveBeenCalledTimes(1);
  });

  it("runs stale reconciliation before due publication with one clock value", async () => {
    const { scheduler, calls, failStale, publishDueBatch } = setup();
    await scheduler.tick();
    expect(calls).toEqual(["stale", "due"]);
    expect(failStale).toHaveBeenCalledWith(now);
    expect(publishDueBatch).toHaveBeenCalledWith(now);
  });

  it("skips an overlapping tick", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { scheduler, failStale, publishDueBatch } = setup({ failStale: () => pending });
    const first = scheduler.tick();
    await scheduler.tick();
    expect(failStale).toHaveBeenCalledTimes(1);
    expect(publishDueBatch).not.toHaveBeenCalled();
    release();
    await first;
    expect(publishDueBatch).toHaveBeenCalledTimes(1);
  });

  it("continues due work after stale reconciliation throws and never logs secret error data", async () => {
    const secret = "raw-access-token-SECRET";
    let attempts = 0;
    const { scheduler, publishDueBatch, logger } = setup({
      failStale: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error(secret);
      },
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(publishDueBatch).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
  });

  it("continues on a later tick after due work fails", async () => {
    let attempts = 0;
    const { scheduler, failStale, logger } = setup({
      publishDueBatch: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("raw-provider-payload-SECRET");
      },
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(failStale).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SECRET");
  });
});
