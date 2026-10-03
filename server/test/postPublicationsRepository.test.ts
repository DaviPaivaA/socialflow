import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { now, publicationFixture } from "./publicationFixtures.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("publication repository (PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  let repository: PostgresPostPublicationsRepository;
  beforeAll(async () => { fixture = await publicationFixture(); repository = new PostgresPostPublicationsRepository(fixture.pool); });
  afterAll(async () => { await fixture?.close(); });

  it("claims only eligible rows once, isolates tenants and preserves started_at", async () => {
    const post = await fixture.post(3);
    const foreign = await fixture.post();
    await fixture.pool.query("UPDATE post_publications SET status='failed' WHERE id=$1", [post.publications[1].id]);
    await fixture.pool.query("UPDATE post_publications SET status='cancelled' WHERE id=$1", [post.publications[2].id]);
    expect(await repository.claimPost(foreign.tenantId, post.postId, now)).toEqual([]);
    expect(await repository.claimPost(post.tenantId, post.postId, now)).toEqual([post.publications[0]]);
    expect(await repository.claimPost(post.tenantId, post.postId, new Date(now.getTime() + 1000))).toEqual([]);
    expect((await repository.listForPost(post.tenantId, post.postId)).find(row => row.id === post.publications[0].id)).toMatchObject({status: "publishing", startedAt: now.toISOString()});
    expect(await repository.listForPost(foreign.tenantId, post.postId)).toEqual([]);
  });

  it("can claim one destination at a time just before provider dispatch", async () => {
    const post = await fixture.post(3);
    const first = await repository.claimPost(post.tenantId, post.postId, now, 1);
    const second = await repository.claimPost(post.tenantId, post.postId, new Date(now.getTime() + 1), 1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).not.toBe(second[0].id);
    expect((await repository.listForPost(post.tenantId, post.postId)).filter(row => row.status === "scheduled")).toHaveLength(1);
  });

  it("claims due only and atomically arbitrates immediate versus scheduler workers", async () => {
    await fixture.pool.query("UPDATE post_publications SET status='cancelled' WHERE status='scheduled'");
    const due = await fixture.post(3);
    const future = await fixture.post(1, new Date(now.getTime() + 1));
    const unscheduled = await fixture.post(1, null);
    const claims = await Promise.all([
      repository.claimPost(due.tenantId, due.postId, now),
      repository.claimDue(now, 2), repository.claimDue(now, 2),
    ]);
    expect(claims.flat().map(row => row.id).sort()).toEqual(due.publications.map(row => row.id).sort());
    expect((await repository.listForPost(future.tenantId, future.postId))[0].status).toBe("scheduled");
    expect((await repository.listForPost(unscheduled.tenantId, unscheduled.postId))[0].status).toBe("scheduled");
    expect(await repository.claimPost(future.tenantId, future.postId, now)).toEqual([]);
  });

  it("bounds due batches and marks only stale publishing as unknown without retry", async () => {
    await fixture.pool.query("UPDATE post_publications SET status='cancelled'");
    const post = await fixture.post(3);
    const cutoff = new Date(now.getTime() - 600_000);
    expect(await repository.claimDue(new Date(cutoff.getTime() - 1), 2)).toEqual([]);
    await fixture.pool.query("UPDATE posts SET scheduled_for=$1 WHERE id=$2", [new Date(cutoff.getTime() - 1000), post.postId]);
    expect(await repository.claimDue(new Date(cutoff.getTime() - 1), 2)).toHaveLength(2);
    await repository.claimDue(cutoff, 2);
    expect(await repository.failStalePublishing(cutoff, now)).toEqual([{tenantId: post.tenantId, postId: post.postId}]);
    const rows = await repository.listForPost(post.tenantId, post.postId);
    expect(rows.filter(row => row.status === "failed")).toHaveLength(2);
    expect(rows.find(row => row.status === "failed")).toMatchObject({errorCode: "publication_state_unknown", failedAt: now.toISOString()});
    expect(rows.filter(row => row.status === "publishing")).toHaveLength(1);
    expect(await repository.claimPost(post.tenantId, post.postId, now)).toEqual([]);
    expect(await repository.claimDue(now, 10)).toEqual([]);
  });

  it("writes terminal outcomes only for a claimed row in its own tenant", async () => {
    const post = await fixture.post(2);
    const other = await fixture.post();
    await repository.claimPost(post.tenantId, post.postId, now);
    const publishedAt = new Date(now.getTime() + 1000);
    await repository.markPublished({id: post.publications[0].id, tenantId: other.tenantId, providerPostId: "foreign", publishedAt});
    await repository.markFailed({id: post.publications[1].id, tenantId: other.tenantId, errorCode: "wrong", errorMessage: "wrong", failedAt: publishedAt});
    expect((await repository.listForPost(post.tenantId, post.postId)).map(row => row.status)).toEqual(["publishing", "publishing"]);
    await repository.markPublished({id: post.publications[0].id, tenantId: post.tenantId, providerPostId: "page_123", publishedAt});
    await repository.markFailed({id: post.publications[1].id, tenantId: post.tenantId, errorCode: "meta_page_unavailable", errorMessage: "Página indisponível.", failedAt: publishedAt});
    const rows = await repository.listForPost(post.tenantId, post.postId);
    expect(rows.find(row => row.id === post.publications[0].id)).toMatchObject({status: "published", providerPostId: "page_123", publishedAt: publishedAt.toISOString()});
    expect(rows.find(row => row.id === post.publications[1].id)).toMatchObject({status: "failed", errorCode: "meta_page_unavailable", errorMessage: "Página indisponível.", failedAt: publishedAt.toISOString()});
    await repository.markFailed({id: post.publications[0].id, tenantId: post.tenantId, errorCode: "late", errorMessage: "late", failedAt: publishedAt});
    expect((await repository.listForPost(post.tenantId, post.postId)).find(row => row.id === post.publications[0].id)?.status).toBe("published");
  });

  it("reads only the tenant's persisted author and publication content", async () => {
    const post = await fixture.post();
    const other = await fixture.post();
    const mediaId = randomUUID();
    await fixture.pool.query(`INSERT INTO media_assets (id, tenant_id, uploaded_by_user_id, storage_key,
      original_filename, media_type, mime_type, size_bytes, sha256)
      VALUES ($1, $2, $3, $4, 'photo.jpg', 'image', 'image/jpeg', 8, $5)`,
    [mediaId, post.tenantId, post.authorUserId, `${post.tenantId}/${mediaId}.jpg`, "a".repeat(64)]);
    await fixture.pool.query("INSERT INTO post_media (tenant_id, post_id, media_asset_id, position) VALUES ($1, $2, $3, 0)", [post.tenantId, post.postId, mediaId]);
    expect(await repository.findPostForPublication(other.tenantId, post.postId)).toBeNull();
    expect(await repository.findPostForPublication(post.tenantId, post.postId)).toMatchObject({
      id: post.postId, tenantId: post.tenantId, authorUserId: post.authorUserId,
      caption: "Message", mediaAssetIds: [mediaId],
    });
  });

  it.each([
    [["scheduled", "scheduled"], "scheduled"],
    [["publishing", "scheduled"], "publishing"],
    [["published", "published"], "published"],
    [["published", "failed"], "partially_failed"],
    [["failed", "failed"], "failed"],
    [["cancelled", "cancelled"], "cancelled"],
    [["published", "cancelled"], "partially_failed"],
    [["failed", "cancelled"], "failed"],
  ] as const)("refreshes aggregate for %j as %s", async (states, expected) => {
    const post = await fixture.post(2);
    for (let index = 0; index < states.length; index++) {
      await fixture.pool.query("UPDATE post_publications SET status=$1 WHERE id=$2", [states[index], post.publications[index].id]);
    }
    const result = await repository.refreshPostAggregate(post.tenantId, post.postId, now);
    expect(result.status).toBe(expected);
    expect(result.publishedAt).toBe(expected === "published" || expected === "partially_failed" ? now.toISOString() : null);
    expect((await fixture.pool.query("SELECT status, published_at FROM posts WHERE id=$1", [post.postId])).rows[0]).toMatchObject({status: expected, published_at: result.publishedAt ? now : null});
  });

  it("preserves the first published timestamp on later aggregate refresh and isolates tenants", async () => {
    const post = await fixture.post(2);
    const other = await fixture.post();
    await fixture.pool.query("UPDATE post_publications SET status='published' WHERE id=$1", [post.publications[0].id]);
    await expect(repository.refreshPostAggregate(other.tenantId, post.postId, now)).rejects.toThrow("Publicação não encontrada.");
    const first = await repository.refreshPostAggregate(post.tenantId, post.postId, now);
    expect(first.publishedAt).toBeNull();
    await fixture.pool.query("UPDATE post_publications SET status='failed' WHERE id=$1", [post.publications[1].id]);
    const final = await repository.refreshPostAggregate(post.tenantId, post.postId, now);
    expect(final).toMatchObject({status: "partially_failed", publishedAt: now.toISOString()});
    expect((await repository.refreshPostAggregate(post.tenantId, post.postId, new Date(now.getTime() + 5000))).publishedAt).toBe(now.toISOString());
  });

  it("discovers bounded aggregate mismatches with tenant keys and excludes consistent posts", async () => {
    const isolated = await publicationFixture();
    const isolatedRepository = new PostgresPostPublicationsRepository(isolated.pool);
    try {
      const published = await isolated.post();
      const failedInAnotherTenant = await isolated.post();
      const stillScheduled = await isolated.post();
      const activelyPublishing = await isolated.post();
      await isolatedRepository.claimPost(published.tenantId, published.postId, now);
      await isolatedRepository.markPublished({ id: published.publications[0].id, tenantId: published.tenantId, providerPostId: "page_post", publishedAt: now });
      await isolatedRepository.claimPost(failedInAnotherTenant.tenantId, failedInAnotherTenant.postId, now);
      await isolatedRepository.markFailed({ id: failedInAnotherTenant.publications[0].id, tenantId: failedInAnotherTenant.tenantId, errorCode: "meta_page_unavailable", errorMessage: "A Página não está disponível para publicação.", failedAt: now });
      await isolatedRepository.claimPost(activelyPublishing.tenantId, activelyPublishing.postId, now);
      await isolatedRepository.refreshPostAggregate(activelyPublishing.tenantId, activelyPublishing.postId, now);

      const candidates = await isolatedRepository.listAggregateRefreshCandidates(10);

      expect(candidates.sort((a, b) => a.postId.localeCompare(b.postId))).toEqual([
        { tenantId: published.tenantId, postId: published.postId },
        { tenantId: failedInAnotherTenant.tenantId, postId: failedInAnotherTenant.postId },
      ].sort((a, b) => a.postId.localeCompare(b.postId)));
      expect(candidates).not.toContainEqual({ tenantId: stillScheduled.tenantId, postId: stillScheduled.postId });
      expect(candidates).not.toContainEqual({ tenantId: activelyPublishing.tenantId, postId: activelyPublishing.postId });
      expect(await isolatedRepository.listAggregateRefreshCandidates(1)).toHaveLength(1);
    } finally {
      await isolated.close();
    }
  });
});
