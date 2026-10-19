import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

  it.each(["legacy Facebook", "prepared operation", "rollback acknowledgement failure"])(
    "returns committed claims when a later post fails: %s", async kind => {
      const isolated = await publicationFixture();
      const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
      const releases: Array<Error | boolean | undefined> = [];
      try {
        const a = await isolated.post(1, new Date(now.getTime() - 2_000));
        const b = await isolated.post(1, new Date(now.getTime() - 1_000));
        const operation = kind === "prepared operation";
        if (operation) {
          for (const post of [a, b]) {
            const mediaId = randomUUID();
            await isolated.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,
              original_filename,media_type,mime_type,size_bytes,sha256)
              VALUES ($1,$2,$3,$4,'video.mp4','video','video/mp4',100,$5)`,
            [mediaId, post.tenantId, post.authorUserId, `${post.tenantId}/${mediaId}.mp4`, "a".repeat(64)]);
            await isolated.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)",
              [post.tenantId, post.postId, mediaId]);
          }
        }
        await isolated.pool.query("CREATE SEQUENCE failed_claim_attempts");
        const unsafeMessage = "controlled B failure: page-token-secret SELECT access_token_encrypted";
        await isolated.pool.query(`CREATE FUNCTION reject_later_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.${operation ? "publication_id" : "id"}='${b.publications[0].id}'::uuid THEN
            PERFORM nextval('failed_claim_attempts'); RAISE EXCEPTION '${unsafeMessage}';
          END IF; RETURN NEW; END $$`);
        await isolated.pool.query(`CREATE TRIGGER reject_later_claim ${operation ? "AFTER INSERT ON publication_operations" : "BEFORE UPDATE ON post_publications"}
          FOR EACH ROW EXECUTE FUNCTION reject_later_claim()`);
        let pool = isolated.pool;
        if (kind === "rollback acknowledgement failure") {
          pool = Object.create(isolated.pool) as Pool;
          pool.query = isolated.pool.query.bind(isolated.pool);
          pool.connect = (async () => {
            const client = await isolated.pool.connect();
            const proxy = Object.create(client) as PoolClient;
            const query = client.query.bind(client);
            proxy.query = (async (...args: unknown[]) => {
              const result = await (query as (...args: unknown[]) => Promise<unknown>)(...args);
              if (args[0] === "ROLLBACK") throw new Error("unsafe rollback acknowledgement: connection-token-secret");
              return result;
            }) as typeof client.query;
            proxy.release = error => { releases.push(error); client.release(error); };
            return proxy;
          }) as typeof pool.connect;
        }
        const repo = new PostgresPostPublicationsRepository(pool);
        const claims = await repo.claimDue(now, 2);
        expect(claims).toEqual(a.publications);
        expect((await repo.listForPost(a.tenantId, a.postId))[0]).toMatchObject({ status: "publishing", startedAt: now.toISOString() });
        expect((await repo.listForPost(b.tenantId, b.postId))[0]).toMatchObject({ status: "scheduled", startedAt: null });
        expect((await isolated.pool.query("SELECT last_value::int,is_called FROM failed_claim_attempts")).rows[0])
          .toEqual({ last_value: 1, is_called: true });
        expect((await isolated.pool.query("SELECT publication_id,stage FROM publication_operations ORDER BY publication_id")).rows)
          .toEqual(operation ? [{ publication_id: a.publications[0].id, stage: "prepared" }] : []);
        expect(diagnostic).toHaveBeenCalledExactlyOnceWith("Falha parcial na aquisição de publicações.", {
          phase: "claim", committedClaims: 1, rollbackFailed: kind === "rollback acknowledgement failure",
        });
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("secret");
        if (kind === "rollback acknowledgement failure") expect(releases).toContain(true);
        expect(await repo.claimPost(a.tenantId, a.postId, new Date(now.getTime() + 1))).toEqual([]);
      } finally { diagnostic.mockRestore(); await isolated.close(); }
    },
  );

  it("preserves the original error when the first post fails without any committed claim", async () => {
    const isolated = await publicationFixture();
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const post = await isolated.post();
      await isolated.pool.query(`CREATE FUNCTION reject_first_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'controlled first claim failure'; END $$`);
      await isolated.pool.query("CREATE TRIGGER reject_first_claim BEFORE UPDATE ON post_publications FOR EACH ROW EXECUTE FUNCTION reject_first_claim()");
      const repo = new PostgresPostPublicationsRepository(isolated.pool);
      await expect(repo.claimDue(now, 2)).rejects.toMatchObject({ code: "P0001", message: "controlled first claim failure" });
      expect((await repo.listForPost(post.tenantId, post.postId))[0]).toMatchObject({ status: "scheduled", startedAt: null });
      expect(diagnostic).not.toHaveBeenCalled();
    } finally { diagnostic.mockRestore(); await isolated.close(); }
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
    // Cancelled rows in this fixture have no attempt, error, result or operation evidence.
    [["published", "cancelled"], "published"],
    [["scheduled", "cancelled"], "scheduled"],
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

  it("does not discard a cancelled destination with attempted history", async () => {
    const post = await fixture.post(2);
    await fixture.pool.query("UPDATE post_publications SET status='published' WHERE id=$1", [post.publications[0].id]);
    await fixture.pool.query("UPDATE post_publications SET status='cancelled',started_at=$2 WHERE id=$1", [post.publications[1].id, now]);
    expect((await repository.refreshPostAggregate(post.tenantId, post.postId, now)).status).toBe("partially_failed");
  });

  it("untouched removed targets do not cause perpetual aggregate refresh candidates", async () => {
    const isolated = await publicationFixture();
    const repo = new PostgresPostPublicationsRepository(isolated.pool);
    try {
      const post = await isolated.post(2);
      await isolated.pool.query("UPDATE post_publications SET status='cancelled' WHERE id=$1", [post.publications[0].id]);
      expect((await repo.refreshPostAggregate(post.tenantId, post.postId, now)).status).toBe("scheduled");
      expect(await repo.listAggregateRefreshCandidates(1)).toEqual([]);
    } finally { await isolated.close(); }
  });

  it("explicitly cancelled zero-target aggregate never revives or changes timestamps", async () => {
    const post = await fixture.post(0);
    await fixture.pool.query("UPDATE posts SET status='cancelled' WHERE id=$1", [post.postId]);
    const before = (await fixture.pool.query("SELECT * FROM posts WHERE id=$1", [post.postId])).rows[0];
    expect((await repository.refreshPostAggregate(post.tenantId, post.postId, now)).status).toBe("cancelled");
    expect((await fixture.pool.query("SELECT * FROM posts WHERE id=$1", [post.postId])).rows[0]).toEqual(before);
  });

  it.each(["draft", "published", "failed"])("preserves legacy zero-target %s aggregate and timestamps", async status => {
    const post = await fixture.post(0);
    await fixture.pool.query("UPDATE posts SET status=$1 WHERE id=$2", [status, post.postId]);
    const before = (await fixture.pool.query("SELECT * FROM posts WHERE id=$1", [post.postId])).rows[0];
    expect((await repository.refreshPostAggregate(post.tenantId, post.postId, now)).status).toBe(status);
    expect((await fixture.pool.query("SELECT * FROM posts WHERE id=$1", [post.postId])).rows[0]).toEqual(before);
  });

  it("does not discard a cancelled destination with operation-only evidence", async () => {
    const post = await fixture.post(2);
    const mediaId = randomUUID();
    await fixture.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,
      original_filename,media_type,mime_type,size_bytes,sha256)
      VALUES ($1,$2,$3,$4,'image.jpg','image','image/jpeg',100,$5)`,
    [mediaId, post.tenantId, post.authorUserId, `${post.tenantId}/${mediaId}.jpg`, "a".repeat(64)]);
    await fixture.pool.query(`INSERT INTO publication_operations (tenant_id,publication_id,media_asset_id,
      kind,stage,provider_account_id,graph_api_version,deadline_at,stage_started_at,created_at,updated_at)
      VALUES ($1,$2,$3,'instagram_image','prepared','123','v26.0',now()+interval '1 hour',now(),now(),now())`,
    [post.tenantId, post.publications[1].id, mediaId]);
    await fixture.pool.query("UPDATE post_publications SET status='published' WHERE id=$1", [post.publications[0].id]);
    await fixture.pool.query("UPDATE post_publications SET status='cancelled' WHERE id=$1", [post.publications[1].id]);
    expect((await repository.refreshPostAggregate(post.tenantId, post.postId, now)).status).toBe("partially_failed");
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
