import type { ClaimedPublication } from "./postPublicationsRepository.ts";
import type { LeasedPublicationOperation } from "./publicationOperationsRepository.ts";
import type { PostgresPublicationOperationsRepository, PublicationOperationStage } from "./publicationOperationsRepository.ts";
import { loadMetaPublishingContext, type MetaContextDependencies, type MetaPublishingContext } from "./metaPublishingContext.ts";
import type { MediaAssetsService } from "./mediaAssetsService.ts";
import type { MetaPublishingProviderClient } from "./metaPublishingClient.ts";
import { MetaPublishingClientError } from "./metaPublishingClient.ts";
import { PublicationError, PublicationOperationalError, type PublicationErrorCode } from "./publicationErrors.ts";
import type { VerifiedMediaHandle } from "./mediaContent.ts";

export type PublishingStep = { target: ClaimedPublication; operation: LeasedPublicationOperation | null; signal?: AbortSignal };
export interface PublishingService { advance(step: PublishingStep): Promise<void> }

export type OperationRepositories = Pick<PostgresPublicationOperationsRepository, "checkpoint" | "complete" | "reserveStatusPoll">;
export type MetaStepDependencies = MetaContextDependencies & {
  operations: OperationRepositories; media: Pick<MediaAssetsService, "openPublishingFile">; client: MetaPublishingProviderClient;
};
const attemptedPublish = (stage: PublicationOperationStage) => stage === "publishing" || stage === "verifying";

/** Shared resource/lease mechanics; no scheduler, retries, sessions or provider protocol here. */
export class MetaPublishingSteps {
  readonly dependencies: MetaStepDependencies;
  constructor(dependencies: MetaStepDependencies) { this.dependencies = dependencies; }
  now(): Date { return this.dependencies.now?.() ?? new Date(); }
  async fail(lease: LeasedPublicationOperation, code: PublicationErrorCode, unknown = false): Promise<void> {
    const safe = new PublicationError(unknown ? "publication_state_unknown" : code);
    await this.dependencies.operations.complete({ lease, now: this.now(), result: { status: "failed", code: safe.code, message: safe.message, unknown } });
  }
  async succeeded(lease: LeasedPublicationOperation, providerPostId: string | null): Promise<void> {
    await this.dependencies.operations.complete({ lease, now: this.now(), result: { status: "published", providerPostId } });
  }
  nextPoll(lease: LeasedPublicationOperation): Date { return new Date(Math.min(this.now().getTime() + 60000, lease.deadlineAt.getTime())); }
  async checkpoint(lease: LeasedPublicationOperation, nextStage: PublicationOperationStage,
    extra: { externalId?: string; delivery?: { issuedAt: Date; expiresAt: Date }; nextActionAt?: Date | null } = {}): Promise<boolean> {
    return this.dependencies.operations.checkpoint({ lease, expectedStage: lease.stage, nextStage,
      nextActionAt: extra.nextActionAt === undefined ? this.now() : extra.nextActionAt, ...extra });
  }
  /** Context was produced by our server-side loader, never by an HTTP request. */
  async run(step: PublishingStep, resolved: MetaPublishingContext | undefined, provider: "facebook" | "instagram",
    action: (lease: LeasedPublicationOperation, context: MetaPublishingContext) => Promise<void>): Promise<void> {
    const lease = step.operation;
    if (!lease) throw new PublicationOperationalError();
    if (lease.tenantId !== step.target.tenantId || lease.publicationId !== step.target.id) throw new PublicationOperationalError();
    if (["succeeded", "failed", "unknown"].includes(lease.stage)) return;
    try {
      if (step.signal?.aborted) return;
      const current = this.now().getTime();
      const needsStatus = ["uploading", "processing", "publishing", "verifying"].includes(lease.stage);
      if (lease.deadlineAt.getTime() <= current || (needsStatus && lease.pollCount >= 30)) {
        await this.fail(lease, "meta_processing_timeout", attemptedPublish(lease.stage) || lease.stage === "creating"); return;
      }
      if (lease.stage === "creating") {
        if (current - lease.stageStartedAt.getTime() >= 600000) await this.fail(lease, "publication_state_unknown", true);
        return; // Unknown start/container cannot be repeated, even if no request actually left.
      }
      // Ready authorizes one immediate mutation; its retained GET floor governs recovery only.
      if (lease.stage !== "ready" && lease.nextActionAt && lease.nextActionAt.getTime() > current) return;
      const context = resolved ?? await loadMetaPublishingContext(this.dependencies, step.target, step.signal);
      if (context.provider !== provider || context.credential.providerAccountId !== lease.providerAccountId ||
        (provider === "facebook" ? lease.kind !== "facebook_reel" : lease.kind === "facebook_reel")) throw new PublicationError("meta_page_unavailable");
      if (context.post.mediaAssetIds.length !== 1 || context.post.mediaAssetIds[0] !== lease.mediaAssetId) throw new PublicationError("media_unavailable");
      await action(lease, context);
    } catch (error) {
      if (step.signal?.aborted) return;
      if (error instanceof PublicationError) {
        try { await this.fail(lease, error.code, attemptedPublish(lease.stage)); }
        catch { throw new PublicationOperationalError(); }
        return;
      }
      throw new PublicationOperationalError();
    }
  }
  async reserve(lease: LeasedPublicationOperation): Promise<boolean> {
    return this.dependencies.operations.reserveStatusPoll({ lease, expectedStage: lease.stage });
  }
  mayQuery(step: PublishingStep, lease: LeasedPublicationOperation, context: MetaPublishingContext): boolean {
    const current = this.now().getTime();
    return !step.signal?.aborted && current < lease.deadlineAt.getTime() &&
      (context.credential.tokenExpiresAt === null || Date.parse(context.credential.tokenExpiresAt) > current);
  }
  async mutation(lease: LeasedPublicationOperation, request: () => Promise<void>, uncertain: () => Promise<void>): Promise<void> {
    try { await request(); }
    catch (error) {
      if (error instanceof MetaPublishingClientError && error.outcome === "rejected") {
        await this.fail(lease, error.kind === "invalid_response" ? "meta_provider_error" : error.kind); return;
      }
      // This catch must surround ONLY the external call; DB failures remain operational.
      await uncertain();
    }
  }
  async pollFailure(lease: LeasedPublicationOperation, error: unknown): Promise<void> {
    if (error instanceof MetaPublishingClientError && error.outcome === "rejected" &&
      ["meta_token_invalid", "meta_permission_denied", "meta_page_unavailable"].includes(error.kind)) {
      await this.fail(lease, error.kind as PublicationErrorCode, attemptedPublish(lease.stage)); return;
    }
    await this.checkpoint(lease, lease.stage === "publishing" ? "verifying" : lease.stage, { nextActionAt: this.nextPoll(lease) });
  }
  async preparedFile(step: PublishingStep, lease: LeasedPublicationOperation,
    use: (file: VerifiedMediaHandle, current: MetaPublishingContext, mayEmit: () => boolean) => Promise<void>): Promise<void> {
    const cancel = new AbortController();
    const signal = step.signal ? AbortSignal.any([step.signal, cancel.signal]) : cancel.signal;
    const started = this.now().getTime();
    const remaining = Math.min(300000, lease.deadlineAt.getTime() - started);
    const timer = setTimeout(() => cancel.abort(), Math.max(0, remaining));
    let file: VerifiedMediaHandle | undefined;
    try {
      const initial = await loadMetaPublishingContext(this.dependencies, step.target, signal);
      try { file = await this.dependencies.media.openPublishingFile({ tenantId: initial.tenantId, authorUserId: initial.authorUserId }, lease.mediaAssetId, signal); }
      catch { if (signal.aborted || this.now().getTime() - started >= remaining) return; throw new PublicationError("media_unavailable"); }
      // Never race away the handle-producing promise: this owner closes even a late result.
      if (signal.aborted || this.now().getTime() - started >= remaining || this.now().getTime() >= lease.deadlineAt.getTime()) return;
      const latest = await loadMetaPublishingContext(this.dependencies, step.target, signal);
      if (signal.aborted || this.now().getTime() - started >= remaining || this.now().getTime() >= lease.deadlineAt.getTime()) return;
      if (latest.credential.providerAccountId !== lease.providerAccountId || latest.provider !== initial.provider ||
        latest.post.mediaAssetIds.length !== 1 || latest.post.mediaAssetIds[0] !== lease.mediaAssetId) throw new PublicationError("media_unavailable");
      const mayEmit = () => {
        const current = this.now().getTime();
        return !signal.aborted && current - started < remaining && current < lease.deadlineAt.getTime() &&
          (latest.credential.tokenExpiresAt === null || Date.parse(latest.credential.tokenExpiresAt) > current);
      };
      await use(file, latest, mayEmit); // Check again after the authoritative DB-clock intent CAS wait.
    } finally { clearTimeout(timer); await file?.close(); }
  }
}

export class MetaPublishingDispatcher implements PublishingService {
  private readonly dependencies: MetaContextDependencies;
  private readonly services: Record<"facebook" | "instagram", PublishingService & { advance(step: PublishingStep, resolved?: MetaPublishingContext): Promise<void> }>;
  private readonly operations: OperationRepositories;
  constructor(dependencies: MetaContextDependencies, services: MetaPublishingDispatcher["services"], operations: OperationRepositories) {
    this.dependencies = dependencies; this.services = services; this.operations = operations;
  }
  async advance(step: PublishingStep): Promise<void> {
    if (step.operation && (step.operation.tenantId !== step.target.tenantId || step.operation.publicationId !== step.target.id)) throw new PublicationOperationalError();
    let context: MetaPublishingContext;
    try { context = await loadMetaPublishingContext(this.dependencies, step.target, step.signal); }
    catch (error) {
      if (step.signal?.aborted) return;
      if (!(error instanceof PublicationError)) throw new PublicationOperationalError();
      if (!step.operation) throw error;
      const unknown = step.operation.stage === "creating" || attemptedPublish(step.operation.stage);
      const safe = new PublicationError(unknown ? "publication_state_unknown" : error.code);
      try { await this.operations.complete({ lease: step.operation, now: this.dependencies.now?.() ?? new Date(),
        result: { status: "failed", code: safe.code, message: safe.message, unknown } }); }
      catch { throw new PublicationOperationalError(); }
      return;
    }
    await this.services[context.provider].advance(step, context);
  }
}
