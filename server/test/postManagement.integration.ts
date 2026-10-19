import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isPostDetail } from "../../shared/postManagementContract.ts";
import { UnauthorizedError } from "../src/authService.ts";
import { PostForbiddenError, PostNotEditableError, PostNotFoundError } from "../src/postManagementErrors.ts";
import { PostgresPostsStore } from "../src/postsStore.ts";
import { assertPostActorSession, lockPostActor } from "../src/postManagementAuthorization.ts";
import { postManagementFixture, sessionRequest } from "./postManagementFixtures.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";

describe("transactional scheduled editing with PostgreSQL", () => {
  it("patch preserves identity author omitted fields and unmodified relations", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post({ count: 2 }); await f.eligible();
      const ragRunId = randomUUID();
      await f.pool.query("UPDATE posts SET rag_run_id=$1 WHERE id=$2",[ragRunId,p.postId]);
      const media = await f.media();
      await f.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [f.tenantId,p.postId,media]);
      const store = new PostgresPostsStore(f.pool);
      const before = await store.get(f.author.context,p.postId);
      const immutable = (await f.pool.query("SELECT id,author_user_id,rag_run_id,created_at::text,scheduled_for::text FROM posts WHERE id=$1",[p.postId])).rows;
      expect(before.post.ragRunId).toBe(ragRunId);
      for (const actor of [f.owner, f.administrator]) {
        const result = await store.updateScheduled(actor.context,p.postId,{ title: actor.context.user.displayName });
        expect(result.post.title).toBe(actor.context.user.displayName);
        expect(result.post).toMatchObject({ id:p.postId,authorUserId:before.post.authorUserId,
          createdAt:before.post.createdAt,ragRunId:before.post.ragRunId,caption:before.post.caption,
          scheduledFor:before.post.scheduledFor,mediaAssetIds:[media] });
        expect(result.publications).toEqual(before.publications);
        expect(isPostDetail(result)).toBe(true);
        expect((await f.pool.query("SELECT id,author_user_id,rag_run_id,created_at::text,scheduled_for::text FROM posts WHERE id=$1",[p.postId])).rows).toEqual(immutable);
      }
      const current = await store.get(f.author.context,p.postId);
      const mediaRows = (await f.pool.query("SELECT * FROM post_media WHERE post_id=$1", [p.postId])).rows;
      const persistedPost = (await f.pool.query("SELECT * FROM posts WHERE id=$1",[p.postId])).rows;
      // Uppercase UUIDs select the same persisted identities, and must not churn relationships.
      expect(await store.updateScheduled(f.author.context,p.postId,{ title:current.post.title,
        mediaAssetIds:[media.toUpperCase()],socialAccountIds:p.publications.map(row=>row.socialAccountId.toUpperCase()) })).toEqual(current);
      expect((await f.pool.query("SELECT * FROM post_media WHERE post_id=$1", [p.postId])).rows).toEqual(mediaRows);
      expect((await f.pool.query("SELECT * FROM posts WHERE id=$1",[p.postId])).rows).toEqual(persistedPost);
    } finally { await f.close(); }
  });

  it("member cannot edit other author and foreign IDs remain not found", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post(); await f.eligible();
      const store = new PostgresPostsStore(f.pool); const before = await store.get(f.author.context,p.postId);
      await expect(store.updateScheduled(f.member.context,p.postId,{title:"Unauthorized"})).rejects.toBeInstanceOf(PostForbiddenError);
      await expect(store.updateScheduled(f.foreign.context,p.postId,{title:"Foreign"})).rejects.toBeInstanceOf(PostNotFoundError);
      expect(await store.get(f.author.context,p.postId)).toEqual(before);
    } finally { await f.close(); }
  });

  it.each(["status='published'", "status='publishing'", "started_at=now()", "error_code=''", "provider_post_id=''"])(
    "published and acquired targets reject mutation: %s", async assignment => {
      const f = await postManagementFixture();
      try {
        const p = await f.post(); await f.eligible();
        await f.pool.query(`UPDATE post_publications SET ${assignment} WHERE post_id=$1`,[p.postId]);
        const store = new PostgresPostsStore(f.pool); const before = await store.get(f.author.context,p.postId);
        await expect(store.updateScheduled(f.owner.context,p.postId,{title:"Changed"})).rejects.toBeInstanceOf(PostNotEditableError);
        expect(await store.get(f.author.context,p.postId)).toEqual(before);
      } finally { await f.close(); }
    });

  it("legacy edit without destinations remains unsendable", async () => {
    const f = await postManagementFixture();
    try {
      const legacy = await f.post({count:0}); const account = await f.post(); await f.eligible();
      const store = new PostgresPostsStore(f.pool); const repo = new PostgresPostPublicationsRepository(f.pool);
      expect((await store.updateScheduled(f.owner.context,legacy.postId,{title:"Legacy"})).publications).toEqual([]);
      expect(await repo.claimPost(f.tenantId,legacy.postId,new Date(Date.now()+172800000))).toEqual([]);
      await expect(store.updateScheduled(f.owner.context,legacy.postId,{socialAccountIds:[]})).rejects.toMatchObject({code:"invalid_post",fields:["socialAccountIds"]});
      const result = await store.updateScheduled(f.owner.context,legacy.postId,{socialAccountIds:[account.publications[0]!.socialAccountId]});
      expect(result.publications).toHaveLength(1); expect(result.publications[0]!.status).toBe("scheduled");
    } finally { await f.close(); }
  });

  it("removing then restoring untouched target reuses id", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post({count:2}); await f.eligible(); const store = new PostgresPostsStore(f.pool);
      const before = await store.get(f.author.context,p.postId);
      const removed = await store.updateScheduled(f.author.context,p.postId,{socialAccountIds:[p.publications[0]!.socialAccountId]});
      expect(removed.publications.find(row=>row.id===p.publications[1]!.id)).toMatchObject({status:"cancelled",startedAt:null});
      expect(removed.publications.find(row=>row.id===p.publications[0]!.id)).toEqual(before.publications.find(row=>row.id===p.publications[0]!.id));
      const restored = await store.updateScheduled(f.author.context,p.postId,{socialAccountIds:p.publications.map(row=>row.socialAccountId)});
      expect(restored.publications.map(row=>row.id).sort()).toEqual(p.publications.map(row=>row.id).sort());
      expect(restored.publications.every(row=>row.status==="scheduled")).toBe(true);
    } finally { await f.close(); }
  });

  it("no-op still validates live destination eligibility and authority", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post(); await f.eligible(); const store = new PostgresPostsStore(f.pool);
      await f.pool.query("UPDATE oauth_connections SET revoked_at=now()");
      await expect(store.updateScheduled(f.author.context,p.postId,{title:"Title"})).rejects.toMatchObject({name:"InvalidPostDestinationError"});
      await f.pool.query("DELETE FROM auth_sessions WHERE id=$1",[f.author.context.sessionId]);
      await expect(store.updateScheduled(f.author.context,p.postId,{title:"Title"})).rejects.toBeInstanceOf(UnauthorizedError);
    } finally { await f.close(); }
  });

  it("rejects a past final date without updating the post", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post(); await f.eligible(); const store = new PostgresPostsStore(f.pool);
      const before = await store.get(f.author.context,p.postId);
      await expect(store.updateScheduled(f.author.context,p.postId,{scheduledFor:"2020-01-01T00:00:00Z"})).rejects.toMatchObject({code:"invalid_post",fields:["scheduledFor"]});
      expect(await store.get(f.author.context,p.postId)).toEqual(before);
    } finally { await f.close(); }
  });

  it.each([
    ["facebook", "image/jpeg", true], ["mixed", "image/jpeg", true],
    ["facebook", "image/png", true], ["mixed", "image/png", false],
    ["mixed", "video/mp4", true], ["mixed", "video/quicktime", true],
    ["instagram", null, false], ["facebook", "image/webp", false],
  ] as const)("preserves publishing matrix for %s with %s", async (provider, mime, allowed) => {
    const f = await postManagementFixture();
    try {
      const p = await f.post({ count: provider === "mixed" ? 2 : 1 }); await f.eligible();
      if (provider !== "facebook") await f.pool.query("UPDATE social_accounts SET account_type='instagram_business' WHERE id=$1",
        [p.publications[provider === "mixed" ? 1 : 0]!.socialAccountId]);
      const media = mime ? await f.media(mime) : null;
      const store = new PostgresPostsStore(f.pool,{instagramPublishingAvailable:true});
      const before = await store.get(f.author.context,p.postId);
      const work = store.updateScheduled(f.author.context,p.postId,{caption:"Edited caption",mediaAssetIds:media ? [media] : []});
      if (allowed) {
        const result = await work;
        expect(result.post.caption).toBe("Edited caption");
        expect(result.post.mediaAssetIds).toEqual(media ? [media] : []);
        expect(result.publications).toEqual(before.publications);
      } else {
        await expect(work).rejects.toMatchObject({name:"PostMediaAssetUnsupportedError"});
        expect(await store.get(f.author.context,p.postId)).toEqual(before);
      }
    } finally { await f.close(); }
  });

  it.each(["missing", "foreign", "deleted"] as const)("rejects %s media without touching relations", async kind => {
    const f = await postManagementFixture();
    try {
      const p = await f.post(); await f.eligible();
      const media = kind === "missing" ? randomUUID() : await f.media("image/jpeg",
        kind === "foreign" ? f.foreign.context.tenant.id : f.tenantId,
        kind === "foreign" ? f.foreign.context.user.id : f.author.context.user.id);
      if (kind === "deleted") await f.pool.query("UPDATE media_assets SET deleted_at=now() WHERE id=$1",[media]);
      const store = new PostgresPostsStore(f.pool); const before = await store.get(f.author.context,p.postId);
      await expect(store.updateScheduled(f.author.context,p.postId,{mediaAssetIds:[media]})).rejects.toMatchObject({name:"PostMediaAssetNotFoundError"});
      expect(await store.get(f.author.context,p.postId)).toEqual(before);
    } finally { await f.close(); }
  });

  it.each(["revoked", "scopes", "foreign", "unknown", "unsupported-provider"] as const)(
    "rejects %s destinations without modifying history", async kind => {
      const f = await postManagementFixture();
      try {
        const p = await f.post(); await f.eligible(); let id = p.publications[0]!.socialAccountId;
        if (kind === "revoked") await f.pool.query("UPDATE oauth_connections SET revoked_at=now()");
        if (kind === "scopes") await f.pool.query("UPDATE oauth_connections SET scopes=ARRAY[]::text[]");
        if (kind === "unsupported-provider") await f.pool.query("UPDATE social_accounts SET account_type='tiktok_account' WHERE id=$1",[id]);
        if (kind === "unknown") id = randomUUID();
        if (kind === "foreign") id = (await f.post({tenantId:f.foreign.context.tenant.id,authorUserId:f.foreign.context.user.id})).publications[0]!.socialAccountId;
        const store = new PostgresPostsStore(f.pool); const before = await store.get(f.author.context,p.postId);
        await expect(store.updateScheduled(f.owner.context,p.postId,{socialAccountIds:[id]})).rejects.toMatchObject({name:"InvalidPostDestinationError"});
        expect(await store.get(f.author.context,p.postId)).toEqual(before);
      } finally { await f.close(); }
    });

  it("preserves the Instagram environment gate", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post(); await f.eligible(); const media = await f.media();
      await f.pool.query("UPDATE social_accounts SET account_type='instagram_business'");
      await expect(new PostgresPostsStore(f.pool).updateScheduled(f.author.context,p.postId,{mediaAssetIds:[media]}))
        .rejects.toMatchObject({name:"InstagramPublishingUnavailableError"});
    } finally { await f.close(); }
  });

  it("media replacements remove only links and nullable title does not change identity", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post(); await f.eligible(); const first = await f.media(); const second = await f.media("image/png");
      const store = new PostgresPostsStore(f.pool);
      await store.updateScheduled(f.author.context,p.postId,{mediaAssetIds:[first]});
      const result = await store.updateScheduled(f.owner.context,p.postId,{title:null,mediaAssetIds:[second]});
      expect(result.post).toMatchObject({id:p.postId,authorUserId:f.author.context.user.id,title:null,mediaAssetIds:[second]});
      expect((await store.updateScheduled(f.author.context,p.postId,{mediaAssetIds:[]})).post.mediaAssetIds).toEqual([]);
      expect((await f.pool.query("SELECT id,deleted_at FROM media_assets ORDER BY id")).rows).toEqual(
        [first,second].sort().map(id=>({id,deleted_at:null})));
    } finally { await f.close(); }
  });

  it("legacy empty selection validates media existence without inventing a provider", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post({count:0}); const media = await f.media("image/webp");
      const store = new PostgresPostsStore(f.pool);
      const result = await store.updateScheduled(f.author.context,p.postId,{mediaAssetIds:[media]});
      expect(result.post.mediaAssetIds).toEqual([media]); expect(result.publications).toEqual([]);
      await f.pool.query("UPDATE media_assets SET deleted_at=now() WHERE id=$1",[media]);
      await expect(store.updateScheduled(f.author.context,p.postId,{title:"Still validates"})).rejects.toMatchObject({name:"PostMediaAssetNotFoundError"});
    } finally { await f.close(); }
  });

  it("operation-only history blocks restoration even when all target attempt fields were cleared", async () => {
    const f = await postManagementFixture();
    try {
      const p = await f.post({count:2}); await f.eligible(); const media = await f.media();
      await f.pool.query("UPDATE post_publications SET status='cancelled' WHERE id=$1",[p.publications[1]!.id]);
      await f.pool.query(`INSERT INTO publication_operations (tenant_id,publication_id,media_asset_id,kind,stage,
        provider_account_id,graph_api_version,deadline_at,stage_started_at,created_at,updated_at)
        VALUES ($1,$2,$3,'instagram_image','prepared','123','v26.0',now()+interval '1 hour',now(),now(),now())`,
      [f.tenantId,p.publications[1]!.id,media]);
      const store = new PostgresPostsStore(f.pool); const before = await store.get(f.author.context,p.postId);
      await expect(store.updateScheduled(f.author.context,p.postId,{socialAccountIds:p.publications.map(row=>row.socialAccountId)}))
        .rejects.toBeInstanceOf(PostNotEditableError);
      expect(await store.get(f.author.context,p.postId)).toEqual(before);
    } finally { await f.close(); }
  });
});

describe("authenticated post management detail with PostgreSQL", () => {
  it("all roles read tenant detail but never foreign detail", async () => {
    const f = await postManagementFixture();
    try {
      const own = await f.post();
      const foreign = await f.post({ tenantId: f.foreign.context.tenant.id, authorUserId: f.foreign.context.user.id });
      await f.pool.query(`UPDATE post_publications SET status = 'failed', provider_post_id = 'provider-123',
        error_code = 'provider_failure', error_message = 'Safe provider error', started_at = now(), failed_at = now()
        WHERE id = $1`, [own.publications[0]!.id]);
      const store = new PostgresPostsStore(f.pool);
      for (const session of [f.author, f.member, f.administrator, f.owner]) {
        const context = await f.auth.require(sessionRequest(session));
        const detail = await store.get(context, own.postId);
        expect(isPostDetail(detail)).toBe(true);
        expect(detail.post.authorUserId).toBe(f.author.context.user.id);
        expect(detail.publications[0]).toMatchObject({
          id: own.publications[0]!.id, status: "failed", providerPostId: "provider-123",
          errorCode: "provider_failure", errorMessage: "Safe provider error",
          startedAt: expect.any(String), failedAt: expect.any(String),
        });
        const serialized = JSON.stringify(detail);
        for (const secret of [session.token, "fixture-password-secret", "password_hash", "token_hash",
          "connection-token-secret", "page-token-secret", "account-metadata-secret", "lease_token", "access_token"]) {
          expect(serialized).not.toContain(secret);
        }
        await expect(store.get(context, foreign.postId)).rejects.toEqual(new PostNotFoundError());
        await expect(store.get(context, randomUUID())).rejects.toEqual(new PostNotFoundError());
      }
    } finally { await f.close(); }
  });

  it("permissions reflect actual membership, author and operation evidence", async () => {
    const f = await postManagementFixture();
    try {
      const own = await f.post();
      const store = new PostgresPostsStore(f.pool);
      for (const [session, allowed] of [[f.author, true], [f.member, false], [f.administrator, true], [f.owner, true]] as const) {
        expect((await store.get(session.context, own.postId)).permissions)
          .toEqual({ canEditSchedule: allowed, canCancelSchedule: allowed });
      }
      const capturedAdmin = f.administrator.context;
      await f.pool.query("UPDATE tenant_members SET role = 'member' WHERE id = $1", [capturedAdmin.membershipId]);
      expect((await store.get(capturedAdmin, own.postId)).permissions)
        .toEqual({ canEditSchedule: false, canCancelSchedule: false });
      await f.pool.query("UPDATE tenant_members SET role = 'admin' WHERE id = $1", [capturedAdmin.membershipId]);
      const mediaId = randomUUID();
      await f.pool.query(`INSERT INTO media_assets (id, tenant_id, uploaded_by_user_id, storage_key,
        original_filename, media_type, mime_type, size_bytes, sha256)
        VALUES ($1, $2, $3, $4, 'image.png', 'image', 'image/png', 100, $5)`,
      [mediaId, f.tenantId, f.author.context.user.id, `${f.tenantId}/${mediaId}.png`, "a".repeat(64)]);
      await f.pool.query(`INSERT INTO publication_operations (tenant_id, publication_id, media_asset_id,
        kind, stage, provider_account_id, graph_api_version, deadline_at, stage_started_at, created_at, updated_at)
        VALUES ($1, $2, $3, 'instagram_image', 'prepared', '123', 'v26.0', now() + interval '1 hour', now(), now(), now())`,
      [f.tenantId, own.publications[0]!.id, mediaId]);
      expect((await store.get(f.owner.context, own.postId)).permissions)
        .toEqual({ canEditSchedule: false, canCancelSchedule: false });
      await f.pool.query("DELETE FROM publication_operations");
      await f.pool.query("UPDATE post_publications SET started_at = now() WHERE id = $1", [own.publications[0]!.id]);
      expect((await store.get(f.owner.context, own.postId)).permissions)
        .toEqual({ canEditSchedule: false, canCancelSchedule: false });
    } finally { await f.close(); }
  });

  it("legacy zero destinations is visible without creating destination rows", async () => {
    const f = await postManagementFixture();
    try {
      const post = await f.post({ count: 0 });
      const detail = await new PostgresPostsStore(f.pool).get(f.author.context, post.postId);
      expect(detail.publications).toEqual([]);
      expect(detail.permissions).toEqual({ canEditSchedule: true, canCancelSchedule: true });
      expect((await f.pool.query("SELECT count(*)::int AS count FROM post_publications")).rows[0]).toEqual({ count: 0 });
    } finally { await f.close(); }
  });

  it.each([
    ["status = 'publishing'"], ["status = 'published'"], ["status = 'failed'"], ["status = 'cancelled'"],
    ["started_at = now()"], ["published_at = now()"], ["failed_at = now()"],
    ["provider_post_id = ''"], ["error_code = ''"], ["error_message = ''"],
  ])("blocks management for destination evidence: %s", async (assignment) => {
    const f = await postManagementFixture();
    try {
      const post = await f.post();
      // Literal assignments above intentionally cover empty-but-present evidence.
      await f.pool.query(`UPDATE post_publications SET ${assignment} WHERE id = $1`, [post.publications[0]!.id]);
      expect((await new PostgresPostsStore(f.pool).get(f.owner.context, post.postId)).permissions)
        .toEqual({ canEditSchedule: false, canCancelSchedule: false });
    } finally { await f.close(); }
  });

  it("allows mixed never-started scheduled and cancelled destinations", async () => {
    const f = await postManagementFixture();
    try {
      const post = await f.post({ count: 2 });
      await f.pool.query("UPDATE post_publications SET status = 'cancelled' WHERE id = $1", [post.publications[0]!.id]);
      expect((await new PostgresPostsStore(f.pool).get(f.owner.context, post.postId)).permissions)
        .toEqual({ canEditSchedule: true, canCancelSchedule: true });
    } finally { await f.close(); }
  });

  it.each(["status = 'cancelled'", "status = 'published'", "published_at = now()"])(
    "blocks management for aggregate evidence: %s", async (assignment) => {
      const f = await postManagementFixture();
      try {
        const post = await f.post();
        await f.pool.query(`UPDATE posts SET ${assignment} WHERE id = $1`, [post.postId]);
        expect((await new PostgresPostsStore(f.pool).get(f.owner.context, post.postId)).permissions)
          .toEqual({ canEditSchedule: false, canCancelSchedule: false });
      } finally { await f.close(); }
    },
  );

  it("revalidates revoked sessions without authentication cleanup side effects", async () => {
    const f = await postManagementFixture();
    try {
      const post = await f.post();
      const captured = f.owner.context;
      await f.pool.query("DELETE FROM auth_sessions WHERE id = $1", [captured.sessionId]);
      await expect(new PostgresPostsStore(f.pool).get(captured, post.postId)).rejects.toBeInstanceOf(UnauthorizedError);
      expect((await f.pool.query("SELECT count(*)::int AS count FROM auth_sessions")).rows[0]!.count).toBe(4);
    } finally { await f.close(); }
  });

  it("reads post, destinations and permissions from one readonly repeatable snapshot", async () => {
    const f = await postManagementFixture();
    const reader = await f.pool.connect();
    const writer = await f.pool.connect();
    let readerReleased = false;
    const releaseReader = reader.release.bind(reader);
    vi.spyOn(reader, "release").mockImplementation(() => { readerReleased = true; releaseReader(); });
    try {
      const post = await f.post();
      const originalQuery = reader.query.bind(reader);
      let transactionSettings: unknown;
      vi.spyOn(f.pool, "connect").mockResolvedValueOnce(reader);
      const spy = vi.spyOn(reader, "query");
      spy.mockImplementation((async (...args: unknown[]) => {
        const result = await (originalQuery as (...args: unknown[]) => Promise<unknown>)(...args);
        if (typeof args[0] === "string" && /FROM posts\s/.test(args[0])) {
          transactionSettings = (await originalQuery(`SELECT current_setting('transaction_isolation') AS isolation,
            current_setting('transaction_read_only') AS readonly`)).rows[0];
          await writer.query("UPDATE post_publications SET started_at = clock_timestamp() WHERE id = $1", [post.publications[0]!.id]);
        }
        return result;
      }) as typeof reader.query);
      const detail = await new PostgresPostsStore(f.pool).get(f.owner.context, post.postId);
      expect(transactionSettings).toEqual({ isolation: "repeatable read", readonly: "on" });
      expect(detail.publications[0]!.startedAt).toBeNull();
      expect(detail.permissions).toEqual({ canEditSchedule: true, canCancelSchedule: true });
      spy.mockRestore();
      expect((await writer.query("SELECT started_at FROM post_publications WHERE id = $1", [post.publications[0]!.id])).rows[0]!.started_at).not.toBeNull();
    } finally {
      vi.restoreAllMocks();
      // Store owns/released reader; writer remains test-owned.
      writer.release();
      if (!readerReleased) reader.release();
      await f.close();
    }
  });
});

describe("transactional post actor authorization with PostgreSQL", () => {
  it("revoked session and downgraded membership cannot reuse captured authority", async () => {
    const f = await postManagementFixture();
    const client = await f.pool.connect();
    try {
      const capturedOwner = await f.auth.require(sessionRequest(f.owner));
      await f.auth.logout(sessionRequest(f.owner));
      await client.query("BEGIN");
      await expect(lockPostActor(client, capturedOwner)).rejects.toBeInstanceOf(UnauthorizedError);
      await client.query("ROLLBACK");
      const capturedAdmin = await f.auth.require(sessionRequest(f.administrator));
      await f.pool.query("UPDATE tenant_members SET role = 'member' WHERE id = $1", [capturedAdmin.membershipId]);
      await client.query("BEGIN");
      await expect(lockPostActor(client, capturedAdmin)).resolves.toEqual({
        userId: capturedAdmin.user.id, tenantId: f.tenantId, role: "member",
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await f.close();
    }
  });

  it.each(["session", "membership", "tenant", "user", "inactive", "expired"] as const)(
    "rejects mismatched or invalid authenticated identity: %s", async (field) => {
      const f = await postManagementFixture();
      const client = await f.pool.connect();
      try {
        const context = structuredClone(f.owner.context);
        if (field === "session") context.sessionId = f.member.context.sessionId;
        if (field === "membership") context.membershipId = f.member.context.membershipId;
        if (field === "tenant") context.tenant.id = f.foreign.context.tenant.id;
        if (field === "user") context.user.id = f.member.context.user.id;
        if (field === "inactive") await f.pool.query("UPDATE users SET is_active = false WHERE id = $1", [context.user.id]);
        if (field === "expired") await f.pool.query(`UPDATE auth_sessions SET created_at = clock_timestamp() - interval '2 hours',
          expires_at = clock_timestamp() - interval '1 hour' WHERE id = $1`, [context.sessionId]);
        await client.query("BEGIN");
        await expect(lockPostActor(client, context)).rejects.toBeInstanceOf(UnauthorizedError);
      } finally {
        await client.query("ROLLBACK");
        client.release();
        await f.close();
      }
    },
  );

  it("shares auth row locks until caller commits and then permits revocation/downgrade/deactivation", async () => {
    const f = await postManagementFixture();
    const client = await f.pool.connect();
    const writer = await f.pool.connect();
    try {
      const context = f.owner.context;
      await client.query("BEGIN");
      await expect(lockPostActor(client, context)).resolves.toEqual({
        userId: context.user.id, tenantId: f.tenantId, role: "owner",
      });
      await writer.query("SET lock_timeout = '100ms'");
      // Shared authorization readers coexist, while each authority mutation waits.
      await writer.query("BEGIN");
      await expect(writer.query("SELECT id FROM auth_sessions WHERE id = $1 FOR SHARE NOWAIT", [context.sessionId])).resolves.toMatchObject({ rowCount: 1 });
      await writer.query("COMMIT");
      const changes = [
        ["DELETE FROM auth_sessions WHERE id = $1", context.sessionId],
        ["UPDATE tenant_members SET role = 'member' WHERE id = $1", context.membershipId],
        ["UPDATE users SET is_active = false WHERE id = $1", context.user.id],
      ];
      for (const [query, id] of changes) {
        await expect(writer.query(query!, [id])).rejects.toMatchObject({ code: "55P03" });
      }
      await client.query("COMMIT");
      for (const [query, id] of changes) {
        await expect(writer.query(query!, [id])).resolves.toMatchObject({ rowCount: 1 });
      }
    } finally {
      await client.query("ROLLBACK");
      await writer.query("ROLLBACK");
      client.release();
      writer.release();
      await f.close();
    }
  });

  it("rechecks expiration with the current clock after waiting for a post lock", async () => {
    const f = await postManagementFixture();
    const client = await f.pool.connect();
    const writer = await f.pool.connect();
    try {
      const post = await f.post();
      const context = f.owner.context;
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM posts WHERE id = $1 FOR UPDATE", [post.postId]);
      await f.pool.query("UPDATE auth_sessions SET expires_at = clock_timestamp() + interval '1 second' WHERE id = $1", [context.sessionId]);
      await client.query("BEGIN");
      await lockPostActor(client, context);
      await expect(assertPostActorSession(client, context)).resolves.toBeUndefined();
      const waiting = client.query("SELECT id FROM posts WHERE id = $1 FOR UPDATE", [post.postId]);
      await writer.query("SELECT pg_sleep(1.1)");
      await writer.query("COMMIT");
      await waiting;
      await expect(assertPostActorSession(client, context)).rejects.toBeInstanceOf(UnauthorizedError);
    } finally {
      await client.query("ROLLBACK");
      await writer.query("ROLLBACK");
      client.release();
      writer.release();
      await f.close();
    }
  });

  it.each(["session", "membership"] as const)("fresh session assertion compares the original %s ID", async (field) => {
    const f = await postManagementFixture();
    const client = await f.pool.connect();
    try {
      const context = structuredClone(f.owner.context);
      if (field === "session") context.sessionId = f.member.context.sessionId;
      else context.membershipId = f.member.context.membershipId;
      await client.query("BEGIN");
      await expect(assertPostActorSession(client, context)).rejects.toBeInstanceOf(UnauthorizedError);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await f.close();
    }
  });
});
