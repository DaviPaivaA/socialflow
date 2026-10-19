import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../src/authService.ts";
import { PostForbiddenError, PostNotCancellableError, PostNotEditableError, PostNotFoundError } from "../src/postManagementErrors.ts";
import { PostgresPostsStore } from "../src/postsStore.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";
import { PublicationCoordinator } from "../src/publicationCoordinator.ts";
import { postManagementFixture } from "./postManagementFixtures.ts";

function gate() {
  let release!: () => void;
  const reached = new Promise<void>(resolve => { release = resolve; });
  return { reached, release };
}

async function waitForGate(reached: Promise<void>, work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([reached, work.then(() => { throw new Error("Mutation finished before reaching the expected barrier."); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Query barrier was not reached.")), 2_000); })]);
  } finally { clearTimeout(timer); }
}

// This wrapper owns only the test's client. All statements still execute on real PostgreSQL.
const testClientReleases = new WeakMap<PoolClient, () => void>();
function releaseTestClient(client: PoolClient) { (testClientReleases.get(client) ?? client.release.bind(client))(); }
function interceptedPool(pool: Pool, client: PoolClient,
  intercept: (sql: string, execute: () => Promise<unknown>) => Promise<unknown>): Pool {
  const wrapped = Object.create(pool) as Pool;
  wrapped.query = pool.query.bind(pool);
  const release = client.release.bind(client);
  let released = false;
  let supplied = false;
  const releaseOnce = () => { if (!released) { released = true; release(); } };
  testClientReleases.set(client, releaseOnce);
  wrapped.connect = (async () => {
    if (supplied) return pool.connect();
    supplied = true;
    const query = client.query.bind(client);
    const proxy = Object.create(client) as PoolClient;
    proxy.query = (async (...args: unknown[]) => intercept(typeof args[0] === "string" ? args[0] : "",
      () => (query as (...args: unknown[]) => Promise<unknown>)(...args))) as typeof client.query;
    proxy.release = releaseOnce;
    return proxy;
  }) as typeof pool.connect;
  return wrapped;
}

async function snapshot(pool: Pool, postId: string) {
  return (await pool.query(`SELECT row_to_json(post) AS post,
    (SELECT json_agg(destination ORDER BY id) FROM post_publications destination WHERE post_id=post.id) AS destinations,
    (SELECT count(*)::int FROM publication_operations) AS operations,
    (SELECT json_agg(operation ORDER BY publication_id) FROM publication_operations operation) AS operation_history,
    (SELECT count(*)::int FROM post_media WHERE post_id=post.id) AS media
    ,(SELECT json_agg(relation ORDER BY position) FROM post_media relation WHERE post_id=post.id) AS media_history
    FROM posts post WHERE id=$1`, [postId])).rows[0];
}

describe("transactional scheduled edit races (PostgreSQL)", () => {
  it("edit loses to claim and preserves all acquired history", async () => {
    const f = await postManagementFixture();
    const claimClient = await f.pool.connect(); const editClient = await f.pool.connect();
    const locked = gate(); const proceed = gate(); const entered = gate();
    let claim: Promise<unknown> | undefined; let edit: Promise<unknown> | undefined;
    try {
      const p = await duePost(f); await f.eligible();
      const claimPool = interceptedPool(f.pool,claimClient,async (sql,execute) => {
        const result = await execute();
        if (sql.includes("FROM posts post") && sql.includes("FOR UPDATE")) { locked.release(); await proceed.reached; }
        return result;
      });
      claim = new PostgresPostPublicationsRepository(claimPool).claimPost(f.tenantId,p.postId,new Date());
      void claim.catch(()=>{}); await waitForGate(locked.reached,claim);
      const editPool = interceptedPool(f.pool,editClient,async (sql,execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) entered.release();
        return execute();
      });
      edit = new PostgresPostsStore(editPool).updateScheduled(f.author.context,p.postId,{title:"Too late"});
      void edit.catch(()=>{}); await waitForGate(entered.reached,edit);
      proceed.release(); await claim; const before = await snapshot(f.pool,p.postId);
      await expect(edit).rejects.toBeInstanceOf(PostNotEditableError);
      expect(await snapshot(f.pool,p.postId)).toEqual(before);
    } finally { proceed.release(); await claim?.catch(()=>{}); await edit?.catch(()=>{});
      releaseTestClient(claimClient); releaseTestClient(editClient); await f.close(); }
  });

  it("reschedule wins over stale due discovery without acquisition", async () => {
    const f = await postManagementFixture(); const client = await f.pool.connect();
    const discovered = gate(); const proceed = gate(); let claim: Promise<unknown> | undefined;
    try {
      const p = await duePost(f); await f.eligible();
      let paused = false;
      const pool = interceptedPool(f.pool,client,async (sql,execute) => {
        if (!paused && sql.includes("FROM posts post") && sql.includes("FOR UPDATE")) {
          paused = true;
          expect((await client.query("SELECT id FROM posts WHERE id=$1 AND scheduled_for<=clock_timestamp()",[p.postId])).rowCount).toBe(1);
          discovered.release(); await proceed.reached;
        }
        return execute();
      });
      const cutoff = new Date();
      claim = new PostgresPostPublicationsRepository(pool).claimDue(cutoff,1); void claim.catch(()=>{});
      await waitForGate(discovered.reached,claim);
      const future = new Date(Date.now()+86400000).toISOString();
      const result = await new PostgresPostsStore(f.pool).updateScheduled(f.author.context,p.postId,{scheduledFor:future});
      proceed.release(); expect(await claim).toEqual([]);
      expect(result.post.scheduledFor).toBe(future);
      expect((await snapshot(f.pool,p.postId)).destinations[0]).toMatchObject({status:"scheduled",started_at:null});
    } finally { proceed.release(); await claim?.catch(()=>{}); releaseTestClient(client); await f.close(); }
  });

  it("cancel beats waiting edit", async () => {
    const f = await postManagementFixture(); const first = await f.pool.connect(); const second = await f.pool.connect();
    const locked = gate(); const proceed = gate(); const entered = gate();
    let cancel: Promise<unknown> | undefined; let edit: Promise<unknown> | undefined;
    try {
      const p = await f.post(); await f.eligible();
      const pool = interceptedPool(f.pool,first,async (sql,execute) => {
        const result = await execute();
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) { locked.release(); await proceed.reached; }
        return result;
      });
      cancel = new PostgresPostsStore(pool).cancelScheduled(f.author.context,p.postId); void cancel.catch(()=>{});
      await waitForGate(locked.reached,cancel);
      const secondPool = interceptedPool(f.pool,second,async (sql,execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) entered.release(); return execute();
      });
      edit = new PostgresPostsStore(secondPool).updateScheduled(f.owner.context,p.postId,{caption:"Cannot revive"}); void edit.catch(()=>{});
      await waitForGate(entered.reached,edit); proceed.release(); await cancel;
      const before = await snapshot(f.pool,p.postId);
      await expect(edit).rejects.toBeInstanceOf(PostNotEditableError);
      expect(await snapshot(f.pool,p.postId)).toEqual(before);
    } finally { proceed.release(); await cancel?.catch(()=>{}); await edit?.catch(()=>{});
      releaseTestClient(first); releaseTestClient(second); await f.close(); }
  });

  it("edit then cancel keeps committed edits and cancels every surviving destination", async () => {
    const f = await postManagementFixture(); const first = await f.pool.connect(); const second = await f.pool.connect();
    const locked = gate(); const proceed = gate(); const entered = gate();
    let edit: Promise<unknown> | undefined; let cancel: Promise<unknown> | undefined;
    try {
      const p = await f.post({count:2}); await f.eligible();
      const pool = interceptedPool(f.pool,first,async (sql,execute) => {
        const result = await execute();
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) { locked.release(); await proceed.reached; }
        return result;
      });
      edit = new PostgresPostsStore(pool).updateScheduled(f.author.context,p.postId,{caption:"Committed edit",socialAccountIds:[p.publications[0]!.socialAccountId]}); void edit.catch(()=>{});
      await waitForGate(locked.reached,edit);
      const secondPool = interceptedPool(f.pool,second,async (sql,execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) entered.release(); return execute();
      });
      cancel = new PostgresPostsStore(secondPool).cancelScheduled(f.owner.context,p.postId); void cancel.catch(()=>{});
      await waitForGate(entered.reached,cancel); proceed.release(); await edit; await cancel;
      const after = await snapshot(f.pool,p.postId);
      expect(after.post).toMatchObject({caption:"Committed edit",status:"cancelled",author_user_id:f.author.context.user.id});
      expect(after.destinations).toHaveLength(2); expect(after.destinations.every((row:{status:string})=>row.status==="cancelled")).toBe(true);
    } finally { proceed.release(); await edit?.catch(()=>{}); await cancel?.catch(()=>{});
      releaseTestClient(first); releaseTestClient(second); await f.close(); }
  });

  it.each([{label:"disjoint",sameField:false},{label:"same-field",sameField:true}])(
    "two $label patches preserve committed state and relations", async ({sameField}) => {
    const f = await postManagementFixture(); const first = await f.pool.connect(); const second = await f.pool.connect();
    const locked = gate(); const proceed = gate(); const entered = gate();
    let one: Promise<unknown> | undefined; let two: Promise<unknown> | undefined;
    try {
      const p = await f.post({count:2}); await f.eligible(); const media = await f.media();
      const pool = interceptedPool(f.pool,first,async (sql,execute) => {
        const result = await execute();
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) { locked.release(); await proceed.reached; }
        return result;
      });
      one = new PostgresPostsStore(pool).updateScheduled(f.author.context,p.postId,{title:"First title",mediaAssetIds:[media],socialAccountIds:[p.publications[0]!.socialAccountId]}); void one.catch(()=>{});
      await waitForGate(locked.reached,one);
      const secondPool = interceptedPool(f.pool,second,async (sql,execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) entered.release(); return execute();
      });
      two = new PostgresPostsStore(secondPool).updateScheduled(f.owner.context,p.postId,sameField ? {title:"Last title"} : {caption:"Second caption"}); void two.catch(()=>{});
      await waitForGate(entered.reached,two); proceed.release(); await one; await two;
      const after = await new PostgresPostsStore(f.pool).get(f.author.context,p.postId);
      expect(after.post).toMatchObject({title:sameField ? "Last title" : "First title",caption:sameField ? "Scheduled message" : "Second caption",mediaAssetIds:[media],authorUserId:f.author.context.user.id});
      expect(after.publications.find(row=>row.id===p.publications[1]!.id)?.status).toBe("cancelled");
      expect(after.publications.find(row=>row.id===p.publications[0]!.id)?.status).toBe("scheduled");
    } finally { proceed.release(); await one?.catch(()=>{}); await two?.catch(()=>{});
      releaseTestClient(first); releaseTestClient(second); await f.close(); }
  });

  it.each(["schedule","session"] as const)("rejects %s expiration while waiting for a real post lock", async kind => {
    const f = await postManagementFixture(); const blocker = await f.pool.connect(); const client = await f.pool.connect();
    const entered = gate(); let work: Promise<unknown> | undefined;
    try {
      const p = await f.post(); await f.eligible(); const before = await snapshot(f.pool,p.postId);
      const deadline = (await f.pool.query<{deadline:Date}>("SELECT clock_timestamp()+interval '750 milliseconds' AS deadline")).rows[0]!.deadline;
      if (kind === "session") await f.pool.query("UPDATE auth_sessions SET expires_at=$1 WHERE id=$2",[deadline,f.author.context.sessionId]);
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE",[p.postId]);
      const pool = interceptedPool(f.pool,client,async (sql,execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) entered.release(); return execute();
      });
      work = new PostgresPostsStore(pool).updateScheduled(f.author.context,p.postId,
        kind === "schedule" ? {scheduledFor:deadline.toISOString()} : {title:"Expired"}); void work.catch(()=>{});
      await waitForGate(entered.reached,work);
      // Advance the actual deadline only: row lock + query barrier establish the ordering, not sleep.
      await blocker.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.01)",[deadline]);
      await blocker.query("COMMIT");
      if (kind === "session") await expect(work).rejects.toBeInstanceOf(UnauthorizedError);
      else await expect(work).rejects.toMatchObject({code:"invalid_post",fields:["scheduledFor"]});
      expect(await snapshot(f.pool,p.postId)).toEqual(before);
    } finally { await blocker.query("ROLLBACK"); await work?.catch(()=>{}); blocker.release(); releaseTestClient(client); await f.close(); }
  });

  it.each([
    {token:"connection",lock:"post"}, {token:"page",lock:"post"},
    {token:"connection",lock:"credential"}, {token:"page",lock:"credential"},
  ])("rejects $token token expiry during $lock lock wait", async ({token,lock}) => {
    const f = await postManagementFixture(); const blocker = await f.pool.connect(); const client = await f.pool.connect();
    const entered = gate(); let work: Promise<unknown> | undefined;
    try {
      const p = await f.post(); await f.eligible(); const before = await snapshot(f.pool,p.postId);
      const deadline = (await f.pool.query<{deadline:Date}>("SELECT clock_timestamp()+interval '750 milliseconds' AS deadline")).rows[0]!.deadline;
      if (token === "connection") await f.pool.query("UPDATE oauth_connections SET access_token_expires_at=$1",[deadline]);
      else await f.pool.query("UPDATE social_account_credentials SET access_token_expires_at=$1",[deadline]);
      await blocker.query("BEGIN");
      if (lock === "post") await blocker.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE",[p.postId]);
      else await blocker.query("SELECT social_account_id FROM social_account_credentials WHERE social_account_id=$1 FOR UPDATE",[p.publications[0]!.socialAccountId]);
      const pool = interceptedPool(f.pool,client,async (sql,execute) => {
        if ((lock === "post" && /FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) ||
          (lock === "credential" && sql.includes("FROM social_accounts account") && sql.includes("FOR SHARE"))) entered.release();
        return execute();
      });
      work = new PostgresPostsStore(pool).updateScheduled(f.author.context,p.postId,{title:"Must not accept expired credentials"});
      void work.catch(()=>{}); await waitForGate(entered.reached,work);
      // Only advance a known expiry deadline: independent row locks and barriers establish ordering.
      await blocker.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM $1::timestamptz-clock_timestamp()))+0.01)",[deadline]);
      await blocker.query("COMMIT");
      await expect(work).rejects.toMatchObject({name:"InvalidPostDestinationError"});
      expect(await snapshot(f.pool,p.postId)).toEqual(before);
    } finally { await blocker.query("ROLLBACK"); await work?.catch(()=>{}); blocker.release(); releaseTestClient(client); await f.close(); }
  });

  it.each(["update","insert"] as const)("rollback after post update restores every relation on destination %s failure", async action => {
    const f = await postManagementFixture();
    try {
      const p = await f.post({count:2}); const extra = await f.post(); await f.eligible();
      const originalMedia = await f.media(); const nextMedia = await f.media("image/png");
      await f.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)",[f.tenantId,p.postId,originalMedia]);
      await f.pool.query(`CREATE FUNCTION reject_edit_destination() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'controlled edit destination failure'; END $$`);
      await f.pool.query(`CREATE TRIGGER reject_edit_destination BEFORE ${action === "update" ? "UPDATE" : "INSERT"}
        ON post_publications FOR EACH ROW EXECUTE FUNCTION reject_edit_destination()`);
      const before = await snapshot(f.pool,p.postId);
      const accounts = action === "update" ? [p.publications[0]!.socialAccountId] : [...p.publications.map(row=>row.socialAccountId),extra.publications[0]!.socialAccountId];
      await expect(new PostgresPostsStore(f.pool).updateScheduled(f.owner.context,p.postId,{title:"Rolled back",caption:"Rolled back",mediaAssetIds:[nextMedia],socialAccountIds:accounts}))
        .rejects.toThrow("controlled edit destination failure");
      expect(await snapshot(f.pool,p.postId)).toEqual(before);
      expect((await f.pool.query("SELECT id FROM media_assets WHERE deleted_at IS NULL ORDER BY id")).rows.map(row=>row.id)).toEqual([originalMedia,nextMedia].sort());
    } finally { await f.close(); }
  });
});

type Fixture = Awaited<ReturnType<typeof postManagementFixture>>;
type FixturePost = Awaited<ReturnType<Fixture["post"]>>;
async function duePost(f: Fixture, kind = "text"): Promise<FixturePost> {
  const post = await f.post();
  await f.pool.query("UPDATE posts SET scheduled_for=clock_timestamp()-interval '1 hour' WHERE id=$1", [post.postId]);
  if (kind !== "text") {
    const mediaId = randomUUID();
    const video = kind.endsWith("video");
    await f.pool.query(`INSERT INTO media_assets (id, tenant_id, uploaded_by_user_id, storage_key,
      original_filename, media_type, mime_type, size_bytes, sha256)
      VALUES ($1,$2,$3,$4,'asset',$5,$6,100,$7)`,
    [mediaId, post.tenantId, post.authorUserId, `${post.tenantId}/${mediaId}.${video ? "mp4" : "jpg"}`, video ? "video" : "image",
      video ? "video/mp4" : "image/jpeg", "a".repeat(64)]);
    await f.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)",
      [post.tenantId, post.postId, mediaId]);
    if (kind.startsWith("instagram")) await f.pool.query("UPDATE social_accounts SET account_type='instagram_business' WHERE id=$1", [post.publications[0]!.socialAccountId]);
  }
  return post;
}

describe("persistent cancellation and initial claim fencing (PostgreSQL)", () => {
  it("post lock fences scheduler acquisition and skips to another post without touching A", async () => {
    const f = await postManagementFixture();
    const blocker = await f.pool.connect();
    try {
      const a = await duePost(f);
      const b = await duePost(f);
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE", [a.postId]);
      const repository = new PostgresPostPublicationsRepository(f.pool);
      const claimed = await repository.claimDue(new Date(), 1);
      expect(claimed.map(row => row.id)).toEqual([b.publications[0]!.id]);
      expect(await repository.claimPost(a.tenantId, a.postId, new Date())).toEqual([]);
      expect((await repository.listForPost(a.tenantId, a.postId))[0]).toMatchObject({ status: "scheduled", startedAt: null });
      await blocker.query("COMMIT");
      expect((await repository.claimDue(new Date(), 1)).map(row => row.id)).toEqual([a.publications[0]!.id]);
      expect(await repository.claimDue(new Date(), 2)).toEqual([]);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await f.close(); }
  });

  it.each(["text", "photo", "facebook-video", "instagram-image", "instagram-video"])(
    "cancel wins before discovered due target (%s), with no provider dispatch", async kind => {
      const f = await postManagementFixture();
      const client = await f.pool.connect();
      const discovered = gate(); const proceed = gate();
      let work: Promise<void> | undefined;
      try {
        const post = await duePost(f, kind);
        let paused = false;
        const pool = interceptedPool(f.pool, client, async (sql, execute) => {
          if (!paused && /FROM posts post|WITH candidates/.test(sql)) {
            paused = true;
            // New claims discover first, then lock in another statement: pause after real discovery.
            if (!sql.includes("FOR UPDATE")) {
              const result = await execute();
              discovered.release(); await proceed.reached;
              return result;
            }
            // Legacy claim combines discovery/mutation; expose a real discovered due row first.
            expect((await client.query("SELECT id FROM posts WHERE id=$1 AND status='scheduled' AND scheduled_for<=clock_timestamp()", [post.postId])).rowCount).toBe(1);
            discovered.release(); await proceed.reached;
          }
          return execute();
        });
        let providerCallCount = 0;
        const repository = new PostgresPostPublicationsRepository(pool);
        const claims: string[] = [];
        const claimDue = repository.claimDue.bind(repository);
        repository.claimDue = async (...args) => { const result = await claimDue(...args); claims.push(...result.map(row => row.id)); return result; };
        const runner = new PublicationCoordinator(repository, { publish: async () => { providerCallCount++; } });
        work = runner.publishDueBatch(new Date());
        void work.catch(() => {});
        await waitForGate(discovered.reached, work);
        await new PostgresPostsStore(f.pool).cancelScheduled(f.author.context, post.postId);
        proceed.release(); await work; await runner.whenIdle();
        expect(claims).toEqual([]);
        expect(providerCallCount).toBe(0);
        expect((await snapshot(f.pool, post.postId)).operations).toBe(0);
      } finally { proceed.release(); await work?.catch(() => {}); releaseTestClient(client); await f.close(); }
    },
  );

  it.each(["text", "photo", "facebook-video", "instagram-image", "instagram-video"])(
    "claim wins before cancellation (%s), preserving every claimed result/operation", async kind => {
      const f = await postManagementFixture();
      try {
        const post = await duePost(f, kind);
        const repository = new PostgresPostPublicationsRepository(f.pool);
        expect((await repository.claimPost(post.tenantId, post.postId, new Date())).map(row => row.id)).toEqual([post.publications[0]!.id]);
        const before = await snapshot(f.pool, post.postId);
        expect(before.operations).toBe(kind.includes("video") || kind.startsWith("instagram") ? 1 : 0);
        await expect(new PostgresPostsStore(f.pool).cancelScheduled(f.owner.context, post.postId)).rejects.toBeInstanceOf(PostNotCancellableError);
        expect(await snapshot(f.pool, post.postId)).toEqual(before);
      } finally { await f.close(); }
    },
  );

  it("cancel twice leaves all timestamps, relationships and counts unchanged, even disconnected", async () => {
    const f = await postManagementFixture();
    try {
      const post = await duePost(f, "photo");
      await f.pool.query("UPDATE social_accounts SET is_active=false,disconnected_at=now()");
      const store = new PostgresPostsStore(f.pool);
      const original = await snapshot(f.pool, post.postId);
      await store.cancelScheduled(f.author.context, post.postId);
      const cancelled = await snapshot(f.pool, post.postId);
      expect(cancelled.post).toMatchObject({ status: "cancelled", scheduled_for: original.post.scheduled_for, author_user_id: original.post.author_user_id });
      expect(cancelled.destinations).toHaveLength(1);
      expect(cancelled.destinations[0]).toMatchObject({ status: "cancelled", started_at: null });
      expect(cancelled.media).toBe(1);
      await store.cancelScheduled(f.owner.context, post.postId);
      expect(await snapshot(f.pool, post.postId)).toEqual(cancelled);
    } finally { await f.close(); }
  });

  it("cancel legacy empty post survives reconciliation without backfill or timestamp churn", async () => {
    const f = await postManagementFixture();
    try {
      const post = await f.post({ count: 0 });
      const store = new PostgresPostsStore(f.pool);
      await store.cancelScheduled(f.author.context, post.postId);
      const before = await snapshot(f.pool, post.postId);
      const repository = new PostgresPostPublicationsRepository(f.pool);
      expect((await repository.refreshPostAggregate(post.tenantId, post.postId, new Date())).status).toBe("cancelled");
      expect(await snapshot(f.pool, post.postId)).toEqual(before);
      expect(await repository.listAggregateRefreshCandidates(10)).toEqual([]);
    } finally { await f.close(); }
  });

  it.each([["scheduled", "prepared"], ["cancelled", "prepared"], ["scheduled", "unknown"], ["cancelled", "succeeded"]])(
    "operation-only evidence blocks cancellation for %s aggregate and %s operation", async (status, stage) => {
      const f = await postManagementFixture();
      try {
        const post = await duePost(f, "instagram-image");
        const repository = new PostgresPostPublicationsRepository(f.pool);
        await repository.claimPost(post.tenantId, post.postId, new Date());
        await f.pool.query("UPDATE publication_operations SET stage=$1,external_id='123'", [stage]);
        await f.pool.query("UPDATE post_publications SET status=$1,started_at=NULL WHERE post_id=$2", [status, post.postId]);
        await f.pool.query("UPDATE posts SET status=$1 WHERE id=$2", [status, post.postId]);
        const before = await snapshot(f.pool, post.postId);
        await expect(new PostgresPostsStore(f.pool).cancelScheduled(f.owner.context, post.postId)).rejects.toBeInstanceOf(PostNotCancellableError);
        expect(await snapshot(f.pool, post.postId)).toEqual(before);
      } finally { await f.close(); }
    },
  );

  it("parallel DELETE/DELETE is authorized and idempotent", async () => {
    const f = await postManagementFixture();
    const first = await f.pool.connect();
    const secondClient = await f.pool.connect();
    const locked = gate(); const proceed = gate(); const secondEntered = gate();
    let work: Promise<void> | undefined; let second: Promise<void> | undefined;
    try {
      const post = await f.post({ count: 2 });
      const pool = interceptedPool(f.pool, first, async (sql, execute) => {
        const result = await execute();
        if (/FROM posts\s/.test(sql) && /FOR UPDATE/.test(sql)) { locked.release(); await proceed.reached; }
        return result;
      });
      work = new PostgresPostsStore(pool).cancelScheduled(f.author.context, post.postId);
      void work.catch(() => {});
      await waitForGate(locked.reached, work);
      const secondPool = interceptedPool(f.pool, secondClient, async (sql, execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) secondEntered.release();
        return execute();
      });
      second = new PostgresPostsStore(secondPool).cancelScheduled(f.owner.context, post.postId);
      void second.catch(() => {});
      await waitForGate(secondEntered.reached, second);
      proceed.release(); await work;
      const before = await snapshot(f.pool, post.postId);
      await second;
      expect(await snapshot(f.pool, post.postId)).toEqual(before);
    } finally {
      proceed.release(); await work?.catch(() => {}); await second?.catch(() => {});
      releaseTestClient(first); releaseTestClient(secondClient); await f.close();
    }
  });

  it("current role, cross-tenant visibility and revoked session precede mutation", async () => {
    const f = await postManagementFixture();
    try {
      const post = await f.post(); const store = new PostgresPostsStore(f.pool);
      const before = await snapshot(f.pool, post.postId);
      await f.pool.query("UPDATE tenant_members SET role='member' WHERE id=$1", [f.administrator.context.membershipId]);
      await expect(store.cancelScheduled(f.administrator.context, post.postId)).rejects.toBeInstanceOf(PostForbiddenError);
      await expect(store.cancelScheduled(f.member.context, post.postId)).rejects.toBeInstanceOf(PostForbiddenError);
      await expect(store.cancelScheduled(f.foreign.context, post.postId)).rejects.toBeInstanceOf(PostNotFoundError);
      await f.pool.query("DELETE FROM auth_sessions WHERE id=$1", [f.owner.context.sessionId]);
      await expect(store.cancelScheduled(f.owner.context, post.postId)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(await snapshot(f.pool, post.postId)).toEqual(before);
    } finally { await f.close(); }
  });

  it.each(["started_at=now()", "error_code=''", "error_message=''", "provider_post_id=''", "published_at=now()", "failed_at=now()", "status='failed'"])(
    "rejects contradictory cancellation evidence %s without modifying history", async assignment => {
      const f = await postManagementFixture();
      try {
        const post = await f.post();
        await f.pool.query("UPDATE posts SET status='cancelled' WHERE id=$1", [post.postId]);
        await f.pool.query(`UPDATE post_publications SET ${assignment.startsWith("status=") ? assignment : `status='cancelled',${assignment}`} WHERE id=$1`, [post.publications[0]!.id]);
        const before = await snapshot(f.pool, post.postId);
        await expect(new PostgresPostsStore(f.pool).cancelScheduled(f.owner.context, post.postId)).rejects.toBeInstanceOf(PostNotCancellableError);
        expect(await snapshot(f.pool, post.postId)).toEqual(before);
      } finally { await f.close(); }
    },
  );

  it.each(["downgrade", "logout"] as const)("%s wins before the authorization lock", async action => {
    const f = await postManagementFixture();
    const blocker = await f.pool.connect(); const client = await f.pool.connect();
    const entered = gate();
    let work: Promise<void> | undefined;
    try {
      const post = await f.post(); const before = await snapshot(f.pool, post.postId);
      const context = f.administrator.context;
      await blocker.query("BEGIN");
      if (action === "logout") await blocker.query("DELETE FROM auth_sessions WHERE id=$1", [context.sessionId]);
      else await blocker.query("UPDATE tenant_members SET role='member' WHERE id=$1", [context.membershipId]);
      const pool = interceptedPool(f.pool, client, async (sql, execute) => {
        if (sql.includes(action === "logout" ? "FROM auth_sessions" : "FROM tenant_members") && sql.includes("FOR SHARE")) entered.release();
        return execute();
      });
      work = new PostgresPostsStore(pool).cancelScheduled(context, post.postId);
      void work.catch(() => {});
      await waitForGate(entered.reached, work);
      await blocker.query("COMMIT");
      await expect(work).rejects.toBeInstanceOf(action === "logout" ? UnauthorizedError : PostForbiddenError);
      expect(await snapshot(f.pool, post.postId)).toEqual(before);
    } finally {
      await blocker.query("ROLLBACK"); await work?.catch(() => {});
      releaseTestClient(client); blocker.release(); await f.close();
    }
  });

  it("role change waits for authorization locks already held by cancellation", async () => {
    const f = await postManagementFixture();
    const client = await f.pool.connect(); const writer = await f.pool.connect();
    const locked = gate(); const proceed = gate();
    let work: Promise<void> | undefined;
    try {
      const post = await f.post(); const context = f.administrator.context;
      const pool = interceptedPool(f.pool, client, async (sql, execute) => {
        const result = await execute();
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) { locked.release(); await proceed.reached; }
        return result;
      });
      work = new PostgresPostsStore(pool).cancelScheduled(context, post.postId);
      void work.catch(() => {});
      await waitForGate(locked.reached, work);
      await writer.query("SET lock_timeout='100ms'");
      await expect(writer.query("UPDATE tenant_members SET role='member' WHERE id=$1", [context.membershipId])).rejects.toMatchObject({ code: "55P03" });
      proceed.release(); await work;
      await writer.query("UPDATE tenant_members SET role='member' WHERE id=$1", [context.membershipId]);
      expect((await snapshot(f.pool, post.postId)).post.status).toBe("cancelled");
      await expect(new PostgresPostsStore(f.pool).cancelScheduled(context, post.postId)).rejects.toBeInstanceOf(PostForbiddenError);
    } finally { proceed.release(); await work?.catch(() => {}); releaseTestClient(client); writer.release(); await f.close(); }
  });

  it("session expiring while waiting for the post cannot authorize cancellation", async () => {
    const f = await postManagementFixture();
    const blocker = await f.pool.connect(); const client = await f.pool.connect();
    const entered = gate(); let work: Promise<void> | undefined;
    try {
      const post = await f.post(); const before = await snapshot(f.pool, post.postId);
      const context = f.author.context;
      await f.pool.query("UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [context.sessionId]);
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM posts WHERE id=$1 FOR UPDATE", [post.postId]);
      const pool = interceptedPool(f.pool, client, async (sql, execute) => {
        if (/FROM posts\s/.test(sql) && sql.includes("FOR UPDATE")) entered.release();
        return execute();
      });
      work = new PostgresPostsStore(pool).cancelScheduled(context, post.postId);
      void work.catch(() => {});
      await waitForGate(entered.reached, work);
      // Clock advancement only, not race orchestration: the independent post lock is held until expiry.
      await blocker.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.01)
        FROM auth_sessions WHERE id=$1`, [context.sessionId]);
      await blocker.query("COMMIT");
      await expect(work).rejects.toBeInstanceOf(UnauthorizedError);
      expect(await snapshot(f.pool, post.postId)).toEqual(before);
    } finally { await blocker.query("ROLLBACK"); await work?.catch(() => {}); releaseTestClient(client); blocker.release(); await f.close(); }
  });

  it("rolls back destination cancellation if the aggregate update fails", async () => {
    const f = await postManagementFixture();
    try {
      const post = await f.post({ count: 2 });
      await f.pool.query(`CREATE FUNCTION reject_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.status='cancelled' THEN RAISE EXCEPTION 'controlled cancellation failure'; END IF; RETURN NEW; END $$`);
      await f.pool.query("CREATE TRIGGER reject_cancel BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION reject_cancel()");
      const before = await snapshot(f.pool, post.postId);
      await expect(new PostgresPostsStore(f.pool).cancelScheduled(f.author.context, post.postId)).rejects.toThrow("controlled cancellation failure");
      expect(await snapshot(f.pool, post.postId)).toEqual(before);
    } finally { await f.close(); }
  });
});
