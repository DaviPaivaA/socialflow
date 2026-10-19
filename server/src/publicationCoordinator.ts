import type { CreatePostResponse } from "../../shared/postPublicationContract.ts";
import { PublicationError } from "./publicationErrors.ts";
import type { ClaimedPublication, PostPublicationsRepository } from "./postPublicationsRepository.ts";
import type { PostgresPublicationOperationsRepository, LeasedPublicationOperation } from "./publicationOperationsRepository.ts";
import type { PublishingService } from "./publishingService.ts";

const DEFAULT_BATCH_SIZE = 25;
const HTTP_BUDGET_MS = 5_000;
const STALE_AFTER_MS = 600_000;
type Scope = { tenantId: string; postId: string };
type Action = { target: ClaimedPublication; operation: LeasedPublicationOperation | null };
type Acquisition = { action: Action | null; consumed: boolean };
type Operations = Pick<PostgresPublicationOperationsRepository, "claimAction" | "claimDueActions" | "claimPostActions" | "hasOperation" | "sweepExpired">;

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export type PublicationCoordinatorOptions = {
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  batchSize?: number;
  operations?: Operations;
};

export class PublicationCoordinator {
  private readonly repository: PostPublicationsRepository;
  private readonly service: PublishingService | { publish(target: ClaimedPublication): Promise<void> };
  private readonly options: PublicationCoordinatorOptions;
  private readonly inFlight = new Set<Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private databaseWork: Promise<void> | null = null;
  private stopped = false;
  private nextClass: "scheduled" | "operation" = "scheduled";

  constructor(repository: PostPublicationsRepository,
    service: PublicationCoordinator["service"], options: PublicationCoordinatorOptions = {}) {
    this.repository = repository; this.service = service; this.options = options;
  }

  stop(): void {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
  }

  async whenIdle(): Promise<void> {
    while (this.databaseWork || this.inFlight.size) {
      await Promise.allSettled([...(this.databaseWork ? [this.databaseWork] : []), ...this.inFlight]);
    }
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }

  async publishPostNow(tenantId: string, postId: string): Promise<CreatePostResponse> {
    const deadline = this.now().getTime() + Math.min(HTTP_BUDGET_MS, this.options.waitTimeoutMs ?? HTTP_BUDGET_MS);
    try {
      await this.fill(this.now(), { tenantId, postId });
      let publications = await this.repository.listForPost(tenantId, postId);
      while (!this.stopped && publications.some(row => row.status === "scheduled" || row.status === "publishing")) {
        const remaining = deadline - this.now().getTime();
        if (remaining <= 0) break;
        await (this.options.sleep ?? sleep)(Math.min(this.options.pollIntervalMs ?? 100, remaining));
        await this.fill(this.now(), { tenantId, postId });
        publications = await this.repository.listForPost(tenantId, postId);
      }
    } catch (error) {
      try { await this.refreshPostAggregate(tenantId, postId, this.now()); } catch { /* Retain the original error. */ }
      throw error;
    }
    const post = await this.refreshPostAggregate(tenantId, postId, this.now());
    return { post, publications: await this.repository.listForPost(tenantId, postId) };
  }

  async publishDueBatch(now: Date): Promise<void> {
    if (this.stopped) return;
    await this.fill(now);
    await this.reconcileAggregates(new Date(Math.max(now.getTime(), this.now().getTime())));
  }

  async failStale(now: Date): Promise<void> {
    const affected = [
      ...await this.repository.failStalePublishing(new Date(now.getTime() - STALE_AFTER_MS), now),
      ...(await this.options.operations?.sweepExpired(now) ?? []),
    ];
    let failure: { reason: unknown } | null = null;
    const seen = new Set<string>();
    for (const { tenantId, postId } of affected) {
      const key = tenantId + ":" + postId;
      if (seen.has(key)) continue;
      seen.add(key);
      try { await this.refreshPostAggregate(tenantId, postId, now); }
      catch (error) { failure ??= { reason: error }; }
    }
    if (failure) throw failure.reason;
    await this.reconcileAggregates(now);
  }

  /** Avoid self-contention between short acquisitions and aggregate post locks in either direction.
   * No DB transaction is open while waiting, and external provider actions never own this latch.
   * PostgreSQL locks remain the authority across cancellation, other coordinators and processes.
   */
  private async withDatabaseWork<T>(work: () => Promise<T>): Promise<T> {
    while (this.databaseWork) await this.databaseWork;
    const running = work();
    // Only this operation's caller receives its failure; queued independent work can still proceed.
    this.databaseWork = running.then(() => {}, () => {});
    try { return await running; } finally { this.databaseWork = null; }
  }

  private async fill(now: Date, scope?: Scope): Promise<void> {
    await this.withDatabaseWork(async () => {
      if (!this.stopped) await this.acquire(now, scope);
    });
  }

  private refreshPostAggregate(tenantId: string, postId: string, now: Date) {
    return this.withDatabaseWork(() => this.repository.refreshPostAggregate(tenantId, postId, now));
  }

  private async acquire(now: Date, scope?: Scope): Promise<void> {
    for (let index = 0; index < (this.options.batchSize ?? DEFAULT_BATCH_SIZE) && !this.stopped && this.inFlight.size < 2; index++) {
      const first = this.nextClass;
      let acquired = await this.claim(first, now, scope);
      let acquiredClass = first;
      if (!acquired.action && !this.stopped) {
        acquiredClass = first === "scheduled" ? "operation" : "scheduled";
        const fallback = await this.claim(acquiredClass, now, scope);
        acquired = { action: fallback.action, consumed: acquired.consumed || fallback.consumed };
      }
      if (!acquired.action) {
        if (acquired.consumed) continue; // Another owner won this lease; later destinations still have a slot.
        break;
      }
      this.nextClass = acquiredClass === "scheduled" ? "operation" : "scheduled";
      if (this.stopped) break; // A durable claim remains safely recoverable after restart.
      this.launch(acquired.action);
      now = new Date(Math.max(now.getTime(), this.now().getTime()));
    }
  }

  private async claim(kind: "scheduled" | "operation", now: Date, scope?: Scope): Promise<Acquisition> {
    const operations = this.options.operations;
    if (kind === "operation") {
      if (!operations) return { action: null, consumed: false };
      const [operation] = scope
        ? await operations.claimPostActions(scope.tenantId, scope.postId, now, 1)
        : await operations.claimDueActions(now, 1);
      if (!operation) return { action: null, consumed: false };
      const target = await this.repository.findClaimedPublication?.(operation.tenantId, operation.publicationId);
      return { action: target ? { target, operation } : null, consumed: true };
    }
    const [target] = scope
      ? await this.repository.claimPost(scope.tenantId, scope.postId, now, 1)
      : await this.repository.claimDue(now, 1);
    if (!target) return { action: null, consumed: false };
    if (!operations || !await operations.hasOperation(target.tenantId, target.id)) return { action: { target, operation: null }, consumed: true };
    const operation = await operations.claimAction({ tenantId: target.tenantId, publicationId: target.id, now });
    // An unavailable lease is NOT an absent operation and never authorizes a legacy mutation.
    return { action: operation ? { target, operation } : null, consumed: true };
  }

  private launch(action: Action): void {
    const controller = new AbortController();
    this.controllers.add(controller);
    const work = this.process(action, controller.signal).finally(() => {
      this.inFlight.delete(work); this.controllers.delete(controller);
    });
    this.inFlight.add(work);
  }

  private async process({ target, operation }: Action, signal: AbortSignal): Promise<void> {
    try {
      if (signal.aborted) return;
      if ("advance" in this.service) await this.service.advance({ target, operation, signal });
      else await this.service.publish(target);
    } catch (error) {
      if (!operation && error instanceof PublicationError) {
        try { await this.repository.markFailed({ id: target.id, tenantId: target.tenantId,
          errorCode: error.code, errorMessage: error.message, failedAt: this.now() }); }
        catch { /* Keep uncertain persistence for reconciliation, never resend. */ }
      }
    } finally {
      try { await this.refreshPostAggregate(target.tenantId, target.postId, this.now()); }
      catch { /* The next durable aggregate sweep repairs this independently. */ }
    }
  }

  private async reconcileAggregates(now: Date): Promise<void> {
    const candidates = await this.repository.listAggregateRefreshCandidates(this.options.batchSize ?? DEFAULT_BATCH_SIZE);
    let failure: { reason: unknown } | null = null;
    for (const { tenantId, postId } of candidates) {
      try { await this.refreshPostAggregate(tenantId, postId, now); }
      catch (error) { failure ??= { reason: error }; }
    }
    if (failure) throw failure.reason;
  }
}
