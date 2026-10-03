import type { PublicationCoordinator } from "./publicationCoordinator.ts";

type Coordinator = Pick<PublicationCoordinator, "failStale" | "publishDueBatch">;
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
  private timer: unknown;
  private started = false;
  private active: Promise<void> | null = null;

  constructor(private readonly options: PublicationSchedulerOptions) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    const schedule = this.options.setInterval ?? ((callback, milliseconds) => globalThis.setInterval(callback, milliseconds));
    this.timer = schedule(() => { if (this.started) void this.tick(); }, this.options.intervalMs ?? 15_000);
    void this.tick();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    const cancel = this.options.clearInterval ?? ((handle: unknown) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
    cancel(this.timer);
    this.timer = undefined;
  }

  isStarted(): boolean {
    return this.started;
  }

  whenIdle(): Promise<void> {
    return this.active ?? Promise.resolve();
  }

  async tick(): Promise<void> {
    if (this.active) return;
    const work = async () => {
      const now = (this.options.now ?? (() => new Date()))();
      const logger = this.options.logger ?? console;
      try {
        await this.options.coordinator.failStale(now);
      } catch {
        logger.error("Falha na reconciliação de publicações.", { phase: "stale" });
      }
      try {
        await this.options.coordinator.publishDueBatch(now);
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
