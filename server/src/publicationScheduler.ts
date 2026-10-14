import type { PublicationCoordinator } from "./publicationCoordinator.ts";

type Coordinator = Pick<PublicationCoordinator, "failStale" | "publishDueBatch"> & Partial<Pick<PublicationCoordinator, "stop" | "whenIdle">>;
type Logger = { error(message: string, context: { phase: "stale" | "due" }): void };

export type PublicationSchedulerOptions = {
  coordinator: Coordinator;
  intervalMs?: number;
  now?: () => Date;
  logger?: Logger;
  setInterval?: (callback: () => void, milliseconds: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export class PublicationScheduler {
  private readonly options: PublicationSchedulerOptions;
  private timer: unknown;
  private started = false;
  private stopped = false;
  private active: Promise<void> | null = null;

  constructor(options: PublicationSchedulerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    const schedule = this.options.setInterval ?? ((callback, milliseconds) => globalThis.setInterval(callback, milliseconds));
    this.timer = schedule(() => { if (this.started) void this.tick(); }, this.options.intervalMs ?? 15_000);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.options.coordinator.stop?.();
    if (!this.started) return;
    this.started = false;
    const cancel = this.options.clearInterval ?? ((handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
    cancel(this.timer);
    this.timer = undefined;
  }

  isStarted(): boolean {
    return this.started;
  }

  async whenIdle(): Promise<void> {
    await this.active;
    await this.options.coordinator.whenIdle?.();
  }

  async tick(): Promise<void> {
    if (this.active || this.stopped) return;
    const work = async () => {
      const now = (this.options.now ?? (() => new Date()))();
      const logger = this.options.logger ?? console;
      try {
        await this.options.coordinator.failStale(now);
      } catch {
        logger.error("Falha na reconciliação de publicações.", { phase: "stale" });
      }
      try {
        if (!this.stopped) await this.options.coordinator.publishDueBatch(now);
      } catch {
        logger.error("Falha no processamento de publicações vencidas.", { phase: "due" });
      }
    };
    const active = work();
    this.active = active;
    try {
      await active;
    } finally {
      this.active = null;
    }
  }
}
