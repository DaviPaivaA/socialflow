import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnauthorizedError, type AuthContext } from "../src/authService.ts";
import { InvalidInsightsTargetError, PostgresInsightsRepository } from "../src/insightsRepository.ts";
import { publicationFixture, cipher } from "./publicationFixtures.ts";
import { requirePostManagementTestDatabase } from "./postManagementFixtures.ts";

// Each assertion protects a real SQL boundary: removing a tenant/session join,
// borrowing a token, or treating a container as final must change its result.
describe("Insights private read snapshots (isolated PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  let repository: PostgresInsightsRepository;
  beforeAll(async () => {
    const url = new URL(requirePostManagementTestDatabase());
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.searchParams.get("host") ?? url.hostname)) {
      throw new Error("Expected loopback test PostgreSQL");
    }
    fixture = await publicationFixture();
    repository = new PostgresInsightsRepository(fixture.pool);
  });
  afterAll(async () => { await fixture?.close(); });

  async function reader(tenantId: string, userId: string, role = "member"): Promise<AuthContext> {
    const member = (await fixture.pool.query(`INSERT INTO tenant_members (tenant_id,user_id,role)
      VALUES ($1,$2,$3) ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=excluded.role RETURNING id`,
    [tenantId, userId, role])).rows[0];
    const session = (await fixture.pool.query(`INSERT INTO auth_sessions (membership_id,token_hash,expires_at)
      VALUES ($1,$2,clock_timestamp()+interval '1 hour') RETURNING id`,
    [member.id, randomBytes(32).toString("hex")])).rows[0];
    return { sessionId: session.id, membershipId: member.id,
      tenant: { id: tenantId, name: "Reader workspace", slug: "reader", role: role as "member" },
      user: { id: userId, displayName: "Reader", email: "reader@example.test" } };
  }
  async function setup(instagram = false) {
    const a = await fixture.post();
    const socialAccountId = a.publications[0].socialAccountId;
    const context = await reader(a.tenantId, a.authorUserId, "owner");
    await fixture.pool.query(`UPDATE social_accounts SET metadata='{"tasks":["ANALYZE"]}' WHERE id=$1`, [socialAccountId]);
    await fixture.pool.query(`UPDATE oauth_connections SET scopes=ARRAY['read_insights','pages_read_engagement','instagram_basic','instagram_manage_insights'],
      access_token_expires_at='2099-01-01T00:00:00Z' WHERE id=$1`, [a.connectionId]);
    await fixture.pool.query(`UPDATE social_account_credentials SET access_token_expires_at='2098-01-01T00:00:00Z' WHERE social_account_id=$1`, [socialAccountId]);
    if (instagram) {
      await fixture.pool.query(`UPDATE social_accounts SET account_type='instagram_business',external_account_id='200',
        metadata='{"pageId":"100","tasks":["ANALYZE"]}' WHERE id=$1`, [socialAccountId]);
      await fixture.pool.query(`INSERT INTO social_accounts (tenant_id,oauth_connection_id,account_type,external_account_id,metadata)
        VALUES ($1,$2,'facebook_page','100','{"tasks":["ANALYZE"]}')`, [a.tenantId, a.connectionId]);
    }
    return { ...a, socialAccountId, context, target: { kind: "account" as const, socialAccountId },
      publicationTarget: { kind: "publication" as const, publicationId: a.publications[0].id } };
  }
  async function operation(a: Awaited<ReturnType<typeof setup>>, kind = "instagram_image", stage = "succeeded") {
    const mediaId = randomUUID();
    const video = kind !== "instagram_image";
    await fixture.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,original_filename,
      media_type,mime_type,size_bytes,sha256) VALUES ($1,$2,$3,$4,'asset',$5,$6,100,$7)`,
    [mediaId, a.tenantId, a.authorUserId, `${a.tenantId}/${mediaId}.${video ? "mp4" : "jpg"}`,
      video ? "video" : "image", video ? "video/mp4" : "image/jpeg", "a".repeat(64)]);
    await fixture.pool.query(`INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)`, [a.tenantId, a.postId, mediaId]);
    await fixture.pool.query(`INSERT INTO publication_operations (tenant_id,publication_id,media_asset_id,kind,stage,
      provider_account_id,graph_api_version,external_id,deadline_at,stage_started_at,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'v26.0','333',now()+interval '1 hour',now(),now(),now())`,
    [a.tenantId, a.publications[0].id, mediaId, kind, stage, kind === "facebook_reel" ? "100" : "200"]);
    return mediaId;
  }

  it.each(["owner", "admin", "member"])("lets a current %s read another author's Page ciphertext", async role => {
    const a = await setup();
    const b = await fixture.post();
    const context = await reader(a.tenantId, b.authorUserId, role);
    const snapshot = await repository.load(context, a.target);
    expect(snapshot).toMatchObject({ tenantId: a.tenantId,
      account: { id: a.socialAccountId, type: "facebook_page", providerAccountId: "100", isActive: true },
      credential: { kind: "page", accessTokenEncrypted: expect.stringMatching(/^v1\./), expiresAt: "2098-01-01T00:00:00.000Z" },
      connection: { id: a.connectionId, scopes: ["read_insights", "pages_read_engagement", "instagram_basic", "instagram_manage_insights"] },
      publication: null });
    expect(cipher.decryptSecret(snapshot!.credential!.accessTokenEncrypted!)).toBe("private-page-token");
    expect(JSON.stringify(snapshot)).not.toContain("private-page-token");
    expect(JSON.stringify(snapshot)).not.toContain("user-token");
  });

  it("uses the linked User ciphertext and its own expiry for Instagram, never the Page token", async () => {
    const a = await setup(true);
    const snapshot = await repository.load(a.context, a.target);
    expect(snapshot).toMatchObject({ credential: { kind: "user", expiresAt: "2099-01-01T00:00:00.000Z" },
      account: { pageId: "100" }, pageLink: { providerAccountId: "100", connectionId: a.connectionId, isActive: true } });
    expect(cipher.decryptSecret(snapshot!.credential!.accessTokenEncrypted!)).toBe("user-token");
    await fixture.pool.query("DELETE FROM social_account_credentials WHERE social_account_id=$1", [a.socialAccountId]);
    expect((await repository.load(a.context, a.target))?.credential?.accessTokenEncrypted).toBe(snapshot!.credential!.accessTokenEncrypted);
    await fixture.pool.query("UPDATE oauth_connections SET access_token_encrypted=NULL WHERE id=$1", [a.connectionId]);
    expect((await repository.load(a.context, a.target))?.credential).toMatchObject({ kind: "user", accessTokenEncrypted: null });
  });

  it.each([false, true])("never falls back when the selected credential is absent (IG=%s)", async ig => {
    const a = await setup(ig);
    if (ig) await fixture.pool.query("UPDATE oauth_connections SET access_token_encrypted=NULL WHERE id=$1", [a.connectionId]);
    else await fixture.pool.query("DELETE FROM social_account_credentials WHERE social_account_id=$1", [a.socialAccountId]);
    expect((await repository.load(a.context, a.target))?.credential?.accessTokenEncrypted).toBeNull();
  });

  it.each(["missing", "foreign", "different-connection", "malformed"])("preserves absent IG Page-link evidence: %s", async state => {
    const a = await setup(true);
    if (state === "missing") await fixture.pool.query("DELETE FROM social_accounts WHERE tenant_id=$1 AND account_type='facebook_page'", [a.tenantId]);
    if (state === "foreign") {
      await fixture.pool.query("DELETE FROM social_accounts WHERE tenant_id=$1 AND account_type='facebook_page'", [a.tenantId]);
      await setup(true); // Same provider Page ID exists, but in another tenant.
    }
    if (state === "different-connection") {
      const other = await fixture.post();
      const conn = (await fixture.pool.query(`INSERT INTO oauth_connections (tenant_id,platform,external_user_id,status)
        VALUES ($1,'meta',$2,'active') RETURNING id`, [a.tenantId, other.connectionId])).rows[0].id;
      await fixture.pool.query("UPDATE social_accounts SET oauth_connection_id=$1 WHERE tenant_id=$2 AND account_type='facebook_page'", [conn, a.tenantId]);
    }
    if (state === "malformed") await fixture.pool.query("UPDATE social_accounts SET metadata='{\"pageId\":100}' WHERE id=$1", [a.socialAccountId]);
    expect((await repository.load(a.context, a.target))?.pageLink).toBeNull();
  });

  it.each(["inactive", "disconnected", "revoked", "expired"])("captures account/connection state without authorizing a shared connection: %s", async state => {
    const a = await setup(true);
    if (state === "inactive") await fixture.pool.query("UPDATE social_accounts SET is_active=false WHERE id=$1", [a.socialAccountId]);
    if (state === "disconnected") await fixture.pool.query("UPDATE social_accounts SET disconnected_at=now() WHERE id=$1", [a.socialAccountId]);
    if (state === "revoked") await fixture.pool.query("UPDATE oauth_connections SET status='revoked',revoked_at=now(),access_token_encrypted=NULL WHERE id=$1", [a.connectionId]);
    if (state === "expired") await fixture.pool.query("UPDATE oauth_connections SET access_token_expires_at='2000-01-01T00:00:00Z' WHERE id=$1", [a.connectionId]);
    const snapshot = await repository.load(a.context, a.target);
    expect(snapshot).not.toBeNull();
    if (state === "expired") expect(snapshot!.credential).toMatchObject({ expiresAt: "2000-01-01T00:00:00.000Z", accessTokenEncrypted: expect.stringMatching(/^v1\./) });
    else expect(snapshot!.credential?.accessTokenEncrypted).toBeNull();
  });

  it("keeps actual partial grants, malformed tasks and absent Page metadata without inferring permission", async () => {
    const a = await setup(true);
    await fixture.pool.query("UPDATE oauth_connections SET scopes=ARRAY['instagram_basic'] WHERE id=$1", [a.connectionId]);
    await fixture.pool.query("UPDATE social_accounts SET metadata='{\"tasks\":[\"ANALYZE\",42]}' WHERE id=$1", [a.socialAccountId]);
    expect(await repository.load(a.context, a.target)).toMatchObject({ connection: { scopes: ["instagram_basic"] }, account: { tasks: ["ANALYZE", 42], pageId: null }, pageLink: null });
  });

  it.each(["session-deleted", "session-expired", "membership-deleted", "user-inactive", "wrong-session", "wrong-membership", "wrong-user", "wrong-tenant", "malformed-context"])("rejects stale/forged reader context: %s", async state => {
    const a = await setup();
    const b = await setup();
    const ctx = structuredClone(a.context);
    if (state === "session-deleted") await fixture.pool.query("DELETE FROM auth_sessions WHERE id=$1", [ctx.sessionId]);
    if (state === "session-expired") await fixture.pool.query("UPDATE auth_sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [ctx.sessionId]);
    if (state === "membership-deleted") await fixture.pool.query("DELETE FROM tenant_members WHERE id=$1", [ctx.membershipId]);
    if (state === "user-inactive") await fixture.pool.query("UPDATE users SET is_active=false WHERE id=$1", [ctx.user.id]);
    if (state === "wrong-session") ctx.sessionId = b.context.sessionId;
    if (state === "wrong-membership") ctx.membershipId = b.context.membershipId;
    if (state === "wrong-user") ctx.user.id = b.context.user.id;
    if (state === "wrong-tenant") ctx.tenant.id = b.context.tenant.id;
    if (state === "malformed-context") ctx.sessionId = "not-uuid-secret";
    await expect(repository.load(ctx, a.target)).rejects.toBeInstanceOf(UnauthorizedError);
    // Invalid authentication is not hidden as a missing target.
    await expect(repository.load(ctx, { kind: "account", socialAccountId: randomUUID() })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("uses persisted role, not stale owner/admin claims", async () => {
    const a = await setup();
    await fixture.pool.query("UPDATE tenant_members SET role='member' WHERE id=$1", [a.context.membershipId]);
    expect(await repository.load(a.context, a.target)).not.toBeNull();
  });

  it("isolates missing/cross-tenant accounts and publication IDs", async () => {
    const a = await setup();
    const b = await setup();
    for (const target of [b.target, b.publicationTarget, { kind: "account" as const, socialAccountId: randomUUID() }]) {
      await expect(repository.load(a.context, target)).resolves.toBeNull();
    }
  });

  it.each([{ kind: "account", socialAccountId: "graph-secret" }, { kind: "publication", publicationId: "invalid-secret" },
    { kind: "publication", publicationId: randomUUID(), socialAccountId: "invalid-secret" }])("rejects malformed local UUID targets safely: %j", async target => {
    const a = await setup();
    await expect(repository.load(a.context, target as Parameters<typeof repository.load>[1])).rejects.toBeInstanceOf(InvalidInsightsTargetError);
    await expect(repository.load(a.context, target as Parameters<typeof repository.load>[1])).rejects.not.toThrow("secret");
  });

  it.each(["instagram_image", "instagram_reel", "facebook_reel"])("captures %s proof but never substitutes the container for the final ID", async kind => {
    const a = await setup(kind !== "facebook_reel");
    const mediaId = await operation(a, kind);
    await fixture.pool.query("UPDATE posts SET status='partially_failed' WHERE id=$1", [a.postId]);
    await fixture.pool.query("UPDATE post_publications SET status='published',provider_post_id='444' WHERE id=$1", [a.publications[0].id]);
    const snapshot = await repository.load(a.context, a.publicationTarget);
    expect(snapshot).toMatchObject({ publication: { id: a.publications[0].id, postId: a.postId,
      status: "published", postStatus: "partially_failed", providerPostId: "444",
      operation: { kind, stage: "succeeded", externalId: "333", mediaAssetId: mediaId, media: { id: mediaId, deletedAt: null } },
      media: [{ id: mediaId, position: 0, mediaType: kind === "instagram_image" ? "image" : "video" }] } });
    await fixture.pool.query("UPDATE post_publications SET provider_post_id=NULL WHERE id=$1", [a.publications[0].id]);
    expect((await repository.load(a.context, a.publicationTarget))?.publication?.providerPostId).toBeNull();
  });

  it("preserves uncertain operations, mismatched provider and detached/deleted media as evidence, not proof", async () => {
    const a = await setup(true);
    const mediaId = await operation(a, "instagram_image", "unknown");
    await fixture.pool.query("UPDATE publication_operations SET provider_account_id='999' WHERE publication_id=$1", [a.publications[0].id]);
    await fixture.pool.query("DELETE FROM post_media WHERE post_id=$1", [a.postId]);
    await fixture.pool.query("UPDATE media_assets SET deleted_at=now() WHERE id=$1", [mediaId]);
    expect(await repository.load(a.context, a.publicationTarget)).toMatchObject({ publication: { providerPostId: null, status: "scheduled",
      operation: { stage: "unknown", providerAccountId: "999", media: { deletedAt: expect.any(String) } }, media: [] } });
  });

  it("preserves contradictory published/unknown outcome evidence for the service gate", async () => {
    const a = await setup();
    await fixture.pool.query(`UPDATE post_publications SET status='published',provider_post_id='100_444',
      error_code='publication_state_unknown',error_message='Outcome remains unconfirmed.',
      published_at='2026-10-21T15:00:00Z' WHERE id=$1`, [a.publications[0].id]);
    expect(await repository.load(a.context, a.publicationTarget)).toMatchObject({ publication: {
      status: "published", providerPostId: "100_444", errorCode: "publication_state_unknown",
      errorMessage: "Outcome remains unconfirmed.", publishedAt: "2026-10-21T15:00:00.000Z",
    } });
  });

  it("exposes an error-code-only change without relying on updated_at", async () => {
    const a = await setup();
    const before = await repository.load(a.context, a.publicationTarget);
    await fixture.pool.query("UPDATE post_publications SET error_code='publication_state_unknown' WHERE id=$1", [a.publications[0].id]);
    const after = await repository.load(a.context, a.publicationTarget);
    expect(after).not.toEqual(before);
    expect(before?.publication).toMatchObject({ errorCode: null, errorMessage: null, publishedAt: null });
    expect(after).toEqual({ ...before, publication: { ...before!.publication, errorCode: "publication_state_unknown" } });
  });

  it("requires the expected account when supplied and never manufactures legacy destinations", async () => {
    const a = await setup();
    await expect(repository.load(a.context, { ...a.publicationTarget, socialAccountId: randomUUID() })).resolves.toBeNull();
    expect(await repository.load(a.context, { ...a.publicationTarget, socialAccountId: a.socialAccountId })).not.toBeNull();
    await fixture.pool.query("DELETE FROM post_publications WHERE id=$1", [a.publications[0].id]);
    await expect(repository.load(a.context, a.publicationTarget)).resolves.toBeNull();
    await expect(repository.load(a.context, { kind: "publication", publicationId: a.postId })).resolves.toBeNull();
    expect((await fixture.pool.query("SELECT count(*)::int n FROM post_publications WHERE post_id=$1", [a.postId])).rows[0].n).toBe(0);
  });

  it("allows an authorized reader after the original author/connector is inactive and removed from membership", async () => {
    const a = await setup();
    const other = await fixture.post();
    const ctx = await reader(a.tenantId, other.authorUserId);
    await fixture.pool.query("UPDATE oauth_connections SET created_by_user_id=$1 WHERE id=$2", [a.authorUserId, a.connectionId]);
    await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [a.tenantId, a.authorUserId]);
    await fixture.pool.query("UPDATE users SET is_active=false WHERE id=$1", [a.authorUserId]);
    expect((await repository.load(ctx, a.publicationTarget))?.credential?.accessTokenEncrypted).toMatch(/^v1\./);
    await expect(repository.load(a.context, a.publicationTarget)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("reads concurrent tenants without mixing two distinct encrypted credentials", async () => {
    const a = await setup(true);
    const b = await setup(true);
    await fixture.pool.query("UPDATE oauth_connections SET access_token_encrypted=$1 WHERE id=$2", [Buffer.from(cipher.encryptSecret("distinct-b")), b.connectionId]);
    const results = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const p = index % 2 ? a : b;
      const snapshot = await repository.load(p.context, p.target);
      return { tenant: snapshot?.tenantId, token: cipher.decryptSecret(snapshot!.credential!.accessTokenEncrypted!) };
    }));
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index % 2
      ? { tenant: a.tenantId, token: "user-token" } : { tenant: b.tenantId, token: "distinct-b" }));
  });
});
