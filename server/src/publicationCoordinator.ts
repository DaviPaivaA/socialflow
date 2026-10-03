import type { CreatePostResponse } from "../../shared/postPublicationContract.ts";
import type { FacebookPublishingService } from "./facebookPublishingService.ts";
import { PublicationError } from "./publicationErrors.ts";
import type { ClaimedPublication, PostPublicationsRepository } from "./postPublicationsRepository.ts";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_POLL_INTERVAL_MS = 100;
// The provider operation can take up to 60 seconds; allow persistence a short margin.
const DEFAULT_WAIT_TIMEOUT_MS = 65_000;
const STALE_AFTER_MS = 600_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export type PublicationCoordinatorOptions = {
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  batchSize?: number;
};

export class PublicationCoordinator {
  constructor(
    private readonly repository: PostPublicationsRepository,
    private readonly service: Pick<FacebookPublishingService, "publish">,
    private readonly options: PublicationCoordinatorOptions = {},
  ) {}

  async publishPostNow(tenantId: string, postId: string): Promise<CreatePostResponse> {
    const now = this.options.now ?? (() => new Date());
    const startedAt = now();
    const deadline = startedAt.getTime() + (this.options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    let claimedAny = false;
    let publications;
    try {
      for (;;) {
        // Claim directly before dispatch. Earlier claims must not wait locally behind a slow Page.
        const [claim] = await this.repository.claimPost(tenantId, postId, now(), 1);
        if (!claim) break;
        claimedAny = true;
        await this.processClaims([claim]);
      }

      publications = await this.repository.listForPost(tenantId, postId);
      const intervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const wait = this.options.sleep ?? sleep;
      let remainingMs = deadline - now().getTime();
      while (publications.some(row => row.status === "scheduled" || row.status === "publishing") && remainingMs > 0) {
        const delayMs = Math.min(intervalMs, remainingMs);
        await wait(delayMs);
        publications = await this.repository.listForPost(tenantId, postId);
        remainingMs = deadline - now().getTime();
      }
    } catch (error) {
      if (claimedAny) {
        try {
          await this.repository.refreshPostAggregate(tenantId, postId, now());
        } catch {
          // Preserve the acquisition/read error while still attempting finalization.
        }
      }
      throw error;
    }

    const post = await this.repository.refreshPostAggregate(tenantId, postId, now());
    // A different executor can finish during the refresh; return the latest persisted rows.
    publications = await this.repository.listForPost(tenantId, postId);
    return { post, publications };
  }

  async publishDueBatch(now: Date): Promise<void> {
    const clock = this.options.now ?? (() => new Date());
    const currentTime = () => new Date(Math.max(now.getTime(), clock().getTime()));
    const affected: ClaimedPublication[] = [];
    let claimTime = now;
    let failure: { reason: unknown } | null = null;
    try {
      for (let index = 0; index < (this.options.batchSize ?? DEFAULT_BATCH_SIZE); index++) {
        // The next destination is claimed only when it is ready to execute.
        const [claim] = await this.repository.claimDue(claimTime, 1);
        if (!claim) break;
        affected.push(claim);
        await this.processClaims([claim]);
        claimTime = currentTime();
      }
    } catch (error) {
      failure = { reason: error };
    }
    for (const { tenantId, postId } of this.affectedPosts(affected)) {
      try {
        await this.repository.refreshPostAggregate(tenantId, postId, currentTime());
      } catch (error) {
        failure ??= { reason: error };
      }
    }
    if (failure) throw failure.reason;
    await this.reconcileAggregates(currentTime());
  }

  async failStale(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const affected = await this.repository.failStalePublishing(cutoff, now);
    let failure: { reason: unknown } | null = null;
    for (const { tenantId, postId } of affected) {
      try {
        await this.repository.refreshPostAggregate(tenantId, postId, now);
      } catch (error) {
        failure ??= { reason: error };
      }
    }
    if (failure) throw failure.reason;
    await this.reconcileAggregates(now);
  }

  private async reconcileAggregates(now: Date): Promise<void> {
    const candidates = await this.repository.listAggregateRefreshCandidates(this.options.batchSize ?? DEFAULT_BATCH_SIZE);
    let failure: { reason: unknown } | null = null;
    for (const { tenantId, postId } of candidates) {
      try {
        await this.repository.refreshPostAggregate(tenantId, postId, now);
      } catch (error) {
        failure ??= { reason: error };
      }
    }
    if (failure) throw failure.reason;
  }

  private async processClaims(claims: ClaimedPublication[]): Promise<void> {
    for (const claim of claims) {
      try {
        await this.service.publish(claim);
      } catch (error) {
        if (error instanceof PublicationError) {
          try {
            await this.repository.markFailed({
              id: claim.id,
              tenantId: claim.tenantId,
              errorCode: error.code,
              errorMessage: error.message,
              failedAt: (this.options.now ?? (() => new Date()))(),
            });
          } catch {
            // Persistence is uncertain; leave the row for the stale sweep.
          }
        }
        // Unknown/operational failures leave publishing for the stale sweep. No retry.
      }
    }
  }

  private affectedPosts(claims: ClaimedPublication[]): Array<{ tenantId: string; postId: string }> {
    const seen = new Set<string>();
    const posts: Array<{ tenantId: string; postId: string }> = [];
    for (const claim of claims) {
      const key = `${claim.tenantId}:${claim.postId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      posts.push({ tenantId: claim.tenantId, postId: claim.postId });
    }
    return posts;
  }
}
