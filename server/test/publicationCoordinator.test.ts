import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationCoordinator } from "../src/publicationCoordinator.ts";
import { PublicationError, PublicationOperationalError } from "../src/publicationErrors.ts";
import { PostgresPostPublicationsRepository, type ClaimedPublication, type PostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { now, publicationFixture } from "./publicationFixtures.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("publication coordinator (PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  let repository: PostgresPostPublicationsRepository;

  beforeEach(async () => {
    fixture = await publicationFixture();
    repository = new PostgresPostPublicationsRepository(fixture.pool);
  });

  afterEach(async () => { await fixture?.close(); });

  function coordinator(
    publish: (claim: ClaimedPublication) => Promise<void>,
    options: ConstructorParameters<typeof PublicationCoordinator>[2] = {},
    selectedRepository: PostPublicationsRepository = repository,
  ) {
    return new PublicationCoordinator(selectedRepository, { publish }, { now: () => now, ...options });
  }

  it("publishes every claimed Page and returns persisted provider IDs", async () => {
    const post = await fixture.post(2);
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      await repository.markPublished({
        id: claim.id,
        tenantId: claim.tenantId,
        providerPostId: `page_${claim.socialAccountId}`,
        publishedAt: now,
      });
    });

    const result = await coordinator(publish).publishPostNow(post.tenantId, post.postId);

    expect(result.post).toMatchObject({ id: post.postId, status: "published" });
    expect(result.publications).toHaveLength(2);
    expect(result.publications.every(row => row.status === "published" && row.providerPostId === `page_${row.socialAccountId}`)).toBe(true);
    expect(publish.mock.calls.map(([claim]) => claim.id).sort()).toEqual(post.publications.map(row => row.id).sort());
  });

  it("persists every ordinary Page failure and returns a failed post", async () => {
    const post = await fixture.post(2);
    const publish = vi.fn(async () => { throw new PublicationError("meta_permission_denied"); });

    const result = await coordinator(publish).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("failed");
    expect(result.publications).toHaveLength(2);
    expect(result.publications.every(row => row.status === "failed" && row.errorCode === "meta_permission_denied" && row.errorMessage === "A autorização não permite publicar nesta Página.")).toBe(true);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("continues after one Page fails and returns a partially failed post", async () => {
    const post = await fixture.post(3);
    const failureId = post.publications[0].id;
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      if (claim.id === failureId) throw new PublicationError("meta_rate_limited");
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: `page_${claim.id}`, publishedAt: now });
    });

    const result = await coordinator(publish).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("partially_failed");
    expect(result.publications.find(row => row.id === failureId)).toMatchObject({ status: "failed", errorCode: "meta_rate_limited" });
    expect(result.publications.filter(row => row.status === "published")).toHaveLength(2);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("waits for a scheduler-owned claim and returns its result without publishing again", async () => {
    const post = await fixture.post();
    const [owned] = await repository.claimPost(post.tenantId, post.postId, now);
    const publish = vi.fn(async () => { throw new Error("duplicate provider call"); });
    const sleep = vi.fn(async () => {
      await repository.markPublished({ id: owned.id, tenantId: owned.tenantId, providerPostId: "scheduler_result", publishedAt: now });
    });

    const result = await coordinator(publish, { sleep, pollIntervalMs: 1, waitTimeoutMs: 100 }).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("published");
    expect(result.publications[0]).toMatchObject({ status: "published", providerPostId: "scheduler_result" });
    expect(publish).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("waits for another executor's Page even when it claimed a different Page", async () => {
    const post = await fixture.post(2);
    const [schedulerOwned] = await repository.claimDue(now, 1);
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: "immediate_result", publishedAt: now });
    });
    const sleep = vi.fn(async () => {
      await repository.markFailed({
        id: schedulerOwned.id,
        tenantId: schedulerOwned.tenantId,
        errorCode: "meta_page_unavailable",
        errorMessage: "A Página não está disponível para publicação.",
        failedAt: now,
      });
    });

    const result = await coordinator(publish, { sleep, pollIntervalMs: 1, waitTimeoutMs: 100 }).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("partially_failed");
    expect(result.publications.find(row => row.id === schedulerOwned.id)?.status).toBe("failed");
    expect(result.publications.find(row => row.id !== schedulerOwned.id)?.status).toBe("published");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].id).not.toBe(schedulerOwned.id);
  });

  it("returns a bounded persisted publishing result when another owner has not settled", async () => {
    const post = await fixture.post();
    await repository.claimPost(post.tenantId, post.postId, now);
    const publish = vi.fn(async () => { throw new Error("duplicate provider call"); });
    let elapsed = 0;

    const result = await coordinator(publish, {
      now: () => new Date(now.getTime() + elapsed),
      sleep: async (milliseconds) => { elapsed += milliseconds; },
      pollIntervalMs: 5,
      waitTimeoutMs: 10,
    }).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("publishing");
    expect(result.publications[0].status).toBe("publishing");
    expect(elapsed).toBe(10);
    expect(publish).not.toHaveBeenCalled();
  });

  it("counts database read time against the immediate polling deadline", async () => {
    const post = await fixture.post();
    await repository.claimPost(post.tenantId, post.postId, now);
    const publish = vi.fn(async () => { throw new Error("duplicate provider call"); });
    const slowRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let elapsed = 0;
    let slept = 0;
    slowRepository.listForPost = async (tenantId, postId) => {
      elapsed += 7;
      return repository.listForPost(tenantId, postId);
    };

    const result = await coordinator(publish, {
      now: () => new Date(now.getTime() + elapsed),
      sleep: async (milliseconds) => { slept += milliseconds; elapsed += milliseconds; },
      pollIntervalMs: 5,
      waitTimeoutMs: 10,
    }, slowRepository).publishPostNow(post.tenantId, post.postId);

    expect(result.publications[0].status).toBe("publishing");
    expect(slept).toBe(3);
    expect(publish).not.toHaveBeenCalled();
  });

  it("continues other Pages when recording one ordinary failure becomes operationally uncertain", async () => {
    const post = await fixture.post(2);
    const firstId = post.publications.map(row => row.id).sort()[0];
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    failingRepository.markFailed = async input => {
      if (input.id === firstId) throw new Error("temporary persistence failure");
      return repository.markFailed(input);
    };
    const publish = vi.fn(async () => { throw new PublicationError("meta_page_unavailable"); });
    let elapsed = 0;

    const result = await coordinator(publish, {
      now: () => new Date(now.getTime() + elapsed),
      sleep: async milliseconds => { elapsed += milliseconds; },
      pollIntervalMs: 1,
      waitTimeoutMs: 1,
    }, failingRepository).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("publishing");
    expect(result.publications.find(row => row.id === firstId)).toMatchObject({ status: "publishing", errorCode: null });
    expect(result.publications.find(row => row.id !== firstId)).toMatchObject({ status: "failed", errorCode: "meta_page_unavailable" });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("leaves operationally uncertain claims publishing while processing other Pages", async () => {
    const post = await fixture.post(2);
    const uncertainId = post.publications[0].id;
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      if (claim.id === uncertainId) throw new PublicationOperationalError();
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: "safe_result", publishedAt: now });
    });

    let elapsed = 0;
    const result = await coordinator(publish, {
      now: () => new Date(now.getTime() + elapsed),
      sleep: async milliseconds => { elapsed += milliseconds; },
      pollIntervalMs: 1,
      waitTimeoutMs: 1,
    }).publishPostNow(post.tenantId, post.postId);

    expect(result.post.status).toBe("publishing");
    expect(result.publications.find(row => row.id === uncertainId)).toMatchObject({ status: "publishing", errorCode: null });
    expect(result.publications.find(row => row.id !== uncertainId)).toMatchObject({ status: "published", providerPostId: "safe_result" });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("claims due work, records failures independently, and does not claim future posts", async () => {
    const due = await fixture.post(2);
    const future = await fixture.post(1, new Date(now.getTime() + 60_000));
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      if (claim.id === due.publications[0].id) throw new PublicationError("meta_token_invalid");
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: "due_result", publishedAt: now });
    });

    await coordinator(publish).publishDueBatch(now);

    expect((await repository.findPostForPublication(due.tenantId, due.postId))?.status).toBe("partially_failed");
    expect((await repository.listForPost(due.tenantId, due.postId)).map(row => row.status).sort()).toEqual(["failed", "published"]);
    expect((await repository.listForPost(future.tenantId, future.postId))[0].status).toBe("scheduled");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not send an immediate Page after a stale sweep finalized locally waiting work", async () => {
    const post = await fixture.post(2);
    let elapsed = 0;
    let attempts = 0;
    let firstId: string | null = null;
    const statusesAtDispatch: string[] = [];
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      attempts += 1;
      const row = (await repository.listForPost(claim.tenantId, claim.postId)).find(value => value.id === claim.id);
      statusesAtDispatch.push(row?.status ?? "missing");
      if (attempts === 1) {
        firstId = claim.id;
        elapsed = 600_001;
        await runner.failStale(new Date(now.getTime() + elapsed));
      }
      await repository.markPublished({
        id: claim.id, tenantId: claim.tenantId, providerPostId: `page_${claim.id}`,
        publishedAt: new Date(now.getTime() + elapsed),
      });
    });
    const runner = coordinator(publish, {
      now: () => new Date(now.getTime() + elapsed),
      sleep: async () => {},
      waitTimeoutMs: 1,
    });

    const result = await runner.publishPostNow(post.tenantId, post.postId);

    expect(statusesAtDispatch).toEqual(["publishing", "publishing"]);
    expect(result.publications.find(row => row.id === firstId)).toMatchObject({ status: "failed", errorCode: "publication_state_unknown" });
    expect(result.publications.find(row => row.id !== firstId)?.status).toBe("published");
    expect(result.post.status).toBe("partially_failed");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not send a due Page after a stale sweep finalized locally waiting work", async () => {
    const post = await fixture.post(2);
    let elapsed = 0;
    let attempts = 0;
    let firstId: string | null = null;
    const statusesAtDispatch: string[] = [];
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      attempts += 1;
      const row = (await repository.listForPost(claim.tenantId, claim.postId)).find(value => value.id === claim.id);
      statusesAtDispatch.push(row?.status ?? "missing");
      if (attempts === 1) {
        firstId = claim.id;
        elapsed = 600_001;
        await runner.failStale(new Date(now.getTime() + elapsed));
      }
      await repository.markPublished({
        id: claim.id, tenantId: claim.tenantId, providerPostId: `page_${claim.id}`,
        publishedAt: new Date(now.getTime() + elapsed),
      });
    });
    const runner = coordinator(publish, { now: () => new Date(now.getTime() + elapsed) });

    await runner.publishDueBatch(now);

    const rows = await repository.listForPost(post.tenantId, post.postId);
    expect(statusesAtDispatch).toEqual(["publishing", "publishing"]);
    expect(rows.find(row => row.id === firstId)).toMatchObject({ status: "failed", errorCode: "publication_state_unknown" });
    expect(rows.find(row => row.id !== firstId)?.status).toBe("published");
    expect((await repository.findPostForPublication(post.tenantId, post.postId))?.status).toBe("partially_failed");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("timestamps a completed due post when provider work finishes", async () => {
    const post = await fixture.post();
    let elapsed = 0;
    const publish = async (claim: ClaimedPublication) => {
      elapsed = 5_000;
      await repository.markPublished({
        id: claim.id, tenantId: claim.tenantId, providerPostId: "published_after_work",
        publishedAt: new Date(now.getTime() + elapsed),
      });
    };

    await coordinator(publish, { now: () => new Date(now.getTime() + elapsed) }).publishDueBatch(now);

    const persisted = await repository.findPostForPublication(post.tenantId, post.postId);
    expect(persisted?.status).toBe("published");
    expect(persisted?.publishedAt).toBe(new Date(now.getTime() + 5_000).toISOString());
  });

  it("keeps the supplied due cutoff when the injected clock lags between Page claims", async () => {
    const post = await fixture.post(2);
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: `page_${claim.id}`, publishedAt: now });
    });

    await coordinator(publish, { now: () => new Date(now.getTime() - 60_000) }).publishDueBatch(now);

    expect((await repository.listForPost(post.tenantId, post.postId)).map(row => row.status)).toEqual(["published", "published"]);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("refreshes an immediate post after its next tenant-scoped claim fails", async () => {
    const post = await fixture.post();
    const transient = new Error("second immediate claim unavailable");
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let claims = 0;
    failingRepository.claimPost = async (tenantId, postId, claimAt, limit) => {
      claims += 1;
      if (claims === 2) throw transient;
      return repository.claimPost(tenantId, postId, claimAt, limit);
    };
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: "persisted_first", publishedAt: now });
    });

    await expect(coordinator(publish, {}, failingRepository).publishPostNow(post.tenantId, post.postId)).rejects.toBe(transient);

    expect((await repository.findPostForPublication(post.tenantId, post.postId))).toMatchObject({ status: "published", publishedAt: now.toISOString() });
    expect((await repository.listForPost(post.tenantId, post.postId))[0]).toMatchObject({ status: "published", providerPostId: "persisted_first" });
    await coordinator(publish).publishDueBatch(now);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("refreshes a due post after its next claim fails and reports acquisition error", async () => {
    const post = await fixture.post();
    const transient = new Error("second due claim unavailable");
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let claims = 0;
    failingRepository.claimDue = async (claimAt, limit) => {
      claims += 1;
      if (claims === 2) throw transient;
      return repository.claimDue(claimAt, limit);
    };
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: "persisted_first", publishedAt: now });
    });

    await expect(coordinator(publish, {}, failingRepository).publishDueBatch(now)).rejects.toBe(transient);

    expect((await repository.findPostForPublication(post.tenantId, post.postId))).toMatchObject({ status: "published", publishedAt: now.toISOString() });
    expect((await repository.listForPost(post.tenantId, post.postId))[0]).toMatchObject({ status: "published", providerPostId: "persisted_first" });
    await coordinator(publish).publishDueBatch(now);
    await coordinator(publish).failStale(new Date(now.getTime() + 600_001));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("repairs a committed published destination after refresh failure on a later coordinator tick", async () => {
    const post = await fixture.post();
    const transient = new Error("one-time aggregate refresh failure");
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let refreshes = 0;
    failingRepository.refreshPostAggregate = async (tenantId, postId, refreshAt) => {
      refreshes += 1;
      if (refreshes === 1) throw transient;
      return repository.refreshPostAggregate(tenantId, postId, refreshAt);
    };
    const publish = vi.fn(async (claim: ClaimedPublication) => {
      await repository.markPublished({ id: claim.id, tenantId: claim.tenantId, providerPostId: "persisted_page_post", publishedAt: now });
    });

    await expect(coordinator(publish, {}, failingRepository).publishDueBatch(now)).rejects.toBe(transient);
    expect((await repository.listForPost(post.tenantId, post.postId))[0].status).toBe("published");
    expect((await repository.findPostForPublication(post.tenantId, post.postId))?.status).toBe("scheduled");

    // A fresh coordinator has no in-memory record of the earlier failure.
    await coordinator(publish).publishDueBatch(new Date(now.getTime() + 15_000));

    expect((await repository.findPostForPublication(post.tenantId, post.postId))?.status).toBe("published");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("repairs multiple stale-unknown posts after refresh failure on a later coordinator tick", async () => {
    const startedAt = new Date(now.getTime() - 600_001);
    const first = await fixture.post(1, new Date(startedAt.getTime() - 1));
    const second = await fixture.post(1, new Date(startedAt.getTime() - 1));
    await repository.claimPost(first.tenantId, first.postId, startedAt);
    await repository.claimPost(second.tenantId, second.postId, startedAt);
    const transient = new Error("one-time stale aggregate refresh failure");
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let refreshes = 0;
    failingRepository.refreshPostAggregate = async (tenantId, postId, refreshAt) => {
      refreshes += 1;
      if (refreshes === 1) throw transient;
      return repository.refreshPostAggregate(tenantId, postId, refreshAt);
    };
    const publish = vi.fn(async () => { throw new Error("no provider resend"); });

    await expect(coordinator(publish, {}, failingRepository).failStale(now)).rejects.toBe(transient);
    expect((await repository.listForPost(first.tenantId, first.postId))[0].errorCode).toBe("publication_state_unknown");
    expect((await repository.listForPost(second.tenantId, second.postId))[0].errorCode).toBe("publication_state_unknown");

    await coordinator(publish).failStale(new Date(now.getTime() + 15_000));

    expect((await repository.findPostForPublication(first.tenantId, first.postId))?.status).toBe("failed");
    expect((await repository.findPostForPublication(second.tenantId, second.postId))?.status).toBe("failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("refreshes other stale posts when one aggregate refresh keeps failing", async () => {
    const startedAt = new Date(now.getTime() - 600_001);
    const first = await fixture.post(1, new Date(startedAt.getTime() - 1));
    const second = await fixture.post(1, new Date(startedAt.getTime() - 1));
    await repository.claimPost(first.tenantId, first.postId, startedAt);
    await repository.claimPost(second.tenantId, second.postId, startedAt);
    const transient = new Error("persistent aggregate failure for one post");
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let failingPostId: string | null = null;
    const attempted: string[] = [];
    failingRepository.refreshPostAggregate = async (tenantId, postId, refreshAt) => {
      failingPostId ??= postId;
      attempted.push(postId);
      if (postId === failingPostId) throw transient;
      return repository.refreshPostAggregate(tenantId, postId, refreshAt);
    };
    const publish = vi.fn(async () => { throw new Error("no provider resend"); });

    await expect(coordinator(publish, {}, failingRepository).failStale(now)).rejects.toBe(transient);

    expect(new Set(attempted)).toEqual(new Set([first.postId, second.postId]));
    const recovered = first.postId === failingPostId ? second : first;
    expect((await repository.findPostForPublication(recovered.tenantId, recovered.postId))?.status).toBe("failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("reconciles other terminal posts when one durable candidate keeps failing", async () => {
    const first = await fixture.post();
    const second = await fixture.post();
    for (const post of [first, second]) {
      await repository.claimPost(post.tenantId, post.postId, now);
      await repository.markPublished({ id: post.publications[0].id, tenantId: post.tenantId, providerPostId: `page_${post.postId}`, publishedAt: now });
    }
    const transient = new Error("persistent reconciliation failure for one post");
    const failingRepository = Object.create(repository) as PostgresPostPublicationsRepository;
    let failingPostId: string | null = null;
    const attempted: string[] = [];
    failingRepository.refreshPostAggregate = async (tenantId, postId, refreshAt) => {
      failingPostId ??= postId;
      attempted.push(postId);
      if (postId === failingPostId) throw transient;
      return repository.refreshPostAggregate(tenantId, postId, refreshAt);
    };
    const publish = vi.fn(async () => { throw new Error("no provider resend"); });

    await expect(coordinator(publish, {}, failingRepository).publishDueBatch(now)).rejects.toBe(transient);

    expect(new Set(attempted)).toEqual(new Set([first.postId, second.postId]));
    const recovered = first.postId === failingPostId ? second : first;
    expect((await repository.findPostForPublication(recovered.tenantId, recovered.postId))?.status).toBe("published");
    expect(publish).not.toHaveBeenCalled();
  });

  it("turns stale publishing into unknown failure without another provider attempt", async () => {
    const startedAt = new Date(now.getTime() - 600_001);
    const post = await fixture.post(1, new Date(startedAt.getTime() - 1));
    expect(await repository.claimPost(post.tenantId, post.postId, startedAt)).toHaveLength(1);
    const publish = vi.fn(async () => { throw new Error("unexpected call"); });

    await coordinator(publish).failStale(now);
    await coordinator(publish).publishDueBatch(now);

    expect((await repository.findPostForPublication(post.tenantId, post.postId))?.status).toBe("failed");
    expect((await repository.listForPost(post.tenantId, post.postId))[0]).toMatchObject({
      status: "failed", errorCode: "publication_state_unknown", failedAt: now.toISOString(),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not claim another tenant's post through the immediate path", async () => {
    const post = await fixture.post();
    const foreign = await fixture.post();
    const publish = vi.fn(async () => { throw new Error("unexpected call"); });

    await expect(coordinator(publish).publishPostNow(foreign.tenantId, post.postId)).rejects.toThrow("Publicação não encontrada.");

    expect((await repository.listForPost(post.tenantId, post.postId))[0].status).toBe("scheduled");
    expect(publish).not.toHaveBeenCalled();
  });
});
