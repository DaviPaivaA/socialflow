import { randomBytes, randomUUID } from "node:crypto";
import type { AuthContext } from "../src/authService.ts";
import type { InsightsReadSnapshot } from "../src/insightsRepository.ts";
import { cipher, publicationFixture } from "./publicationFixtures.ts";
import { requirePostManagementTestDatabase } from "./postManagementFixtures.ts";
export const insightsNow = Date.parse("2026-10-21T15:00:00Z");
export const readScopes = ["read_insights", "pages_read_engagement", "pages_show_list", "instagram_basic", "instagram_manage_insights"];
export function insightsContext(): AuthContext {
    return { sessionId: randomUUID(), membershipId: randomUUID(),
        tenant: { id: randomUUID(), name: "Workspace", slug: "workspace", role: "member" },
        user: { id: randomUUID(), displayName: "Reader", email: "reader@example.test" } };
}
export function insightsSnapshot(ctx: AuthContext, instagram = false): InsightsReadSnapshot {
    const connectionId = randomUUID();
    return { tenantId: ctx.tenant.id, authorizationExpiresAt: "2099-01-01T00:00:00.000Z",
        account: { id: randomUUID(), type: instagram ? "instagram_business" : "facebook_page",
            providerAccountId: instagram ? "200" : "100", isActive: true, disconnectedAt: null,
            pageId: instagram ? "100" : null, tasks: ["ANALYZE"] },
        connection: { id: connectionId, platform: "meta", status: "active", revokedAt: null, scopes: [...readScopes] },
        credential: { kind: instagram ? "user" : "page", accessTokenEncrypted: cipher.encryptSecret(instagram ? "user-token" : "private-page-token"), expiresAt: "2098-01-01T00:00:00.000Z" },
        pageLink: instagram ? { id: randomUUID(), connectionId, providerAccountId: "100", isActive: true, disconnectedAt: null, tasks: [] } : null,
        publication: null };
}
export function addPublication(snapshot: InsightsReadSnapshot, kind: "text" | "photo" | "instagram_image" | "instagram_reel" | "facebook_reel" = "text") {
    const video = kind.endsWith("reel");
    const media = { id: randomUUID(), mediaType: video ? "video" as const : "image" as const,
        mimeType: video ? "video/mp4" : "image/jpeg", deletedAt: null };
    snapshot.publication = { id: randomUUID(), postId: randomUUID(), socialAccountId: snapshot.account.id,
        status: "published", postStatus: "partially_failed", providerPostId: snapshot.account.type === "facebook_page" ? "100_444" : "444",
        errorCode: null, errorMessage: null, publishedAt: null,
        media: kind === "text" ? [] : [{ ...media, position: 0 }],
        operation: kind.startsWith("instagram") || kind === "facebook_reel" ? {
            kind: kind as "instagram_image" | "instagram_reel" | "facebook_reel", stage: "succeeded",
            providerAccountId: snapshot.account.providerAccountId, externalId: "333", graphApiVersion: "v26.0", mediaAssetId: media.id, media: { ...media },
        } : null };
    return snapshot;
}
export function deferred<T>() {
    let resolved = false;
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = value => { resolved = true; yes(value); }; reject = no; });
    return { promise, resolve, reject, isResolved: () => resolved };
}
export async function insightsPgFixture() {
    const url = new URL(requirePostManagementTestDatabase());
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.searchParams.get("host") ?? url.hostname))
        throw new Error("Expected loopback test PostgreSQL");
    const fixture = await publicationFixture();
    async function reader(tenantId: string, userId: string, role = "member"): Promise<AuthContext> {
        const member = (await fixture.pool.query(`INSERT INTO tenant_members (tenant_id,user_id,role) VALUES ($1,$2,$3)
      ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=excluded.role RETURNING id`, [tenantId, userId, role])).rows[0];
        const session = (await fixture.pool.query(`INSERT INTO auth_sessions (membership_id,token_hash,expires_at)
      VALUES ($1,$2,clock_timestamp()+interval '1 hour') RETURNING id`, [member.id, randomBytes(32).toString("hex")])).rows[0];
        return { ...insightsContext(), sessionId: session.id, membershipId: member.id,
            tenant: { id: tenantId, name: "Reader", slug: "reader", role: role as "member" },
            user: { id: userId, displayName: "Reader", email: "reader@example.test" } };
    }
    async function setup(instagram = false, kind: Parameters<typeof addPublication>[1] = "text") {
        const a = await fixture.post();
        const context = await reader(a.tenantId, a.authorUserId, "owner");
        const socialAccountId = a.publications[0].socialAccountId;
        await fixture.pool.query(`UPDATE oauth_connections SET scopes=$1,access_token_expires_at='2099-01-01T00:00:00Z' WHERE id=$2`, [readScopes, a.connectionId]);
        await fixture.pool.query(`UPDATE social_account_credentials SET access_token_expires_at='2098-01-01T00:00:00Z' WHERE social_account_id=$1`, [socialAccountId]);
        await fixture.pool.query(`UPDATE social_accounts SET metadata='{"tasks":["ANALYZE"]}' WHERE id=$1`, [socialAccountId]);
        if (instagram) {
            await fixture.pool.query(`UPDATE social_accounts SET account_type='instagram_business',external_account_id='200',metadata='{"pageId":"100"}' WHERE id=$1`, [socialAccountId]);
            await fixture.pool.query(`INSERT INTO social_accounts (tenant_id,oauth_connection_id,account_type,external_account_id,metadata)
        VALUES ($1,$2,'facebook_page','100','{}')`, [a.tenantId, a.connectionId]);
        }
        const snapshot = addPublication(insightsSnapshot(context, instagram), kind);
        if (snapshot.publication!.media.length) {
            const m = snapshot.publication!.media[0];
            await fixture.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,original_filename,media_type,mime_type,size_bytes,sha256)
        VALUES ($1,$2,$3,$4,'asset',$5,$6,100,$7)`, [m.id, a.tenantId, a.authorUserId, `${a.tenantId}/${m.id}.${m.mediaType === "video" ? "mp4" : "jpg"}`, m.mediaType, m.mimeType, "a".repeat(64)]);
            await fixture.pool.query(`INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)`, [a.tenantId, a.postId, m.id]);
            if (snapshot.publication!.operation) {
                const op = snapshot.publication!.operation;
                await fixture.pool.query(`INSERT INTO publication_operations (tenant_id,publication_id,media_asset_id,kind,stage,provider_account_id,
          graph_api_version,external_id,deadline_at,stage_started_at,created_at,updated_at) VALUES ($1,$2,$3,$4,'succeeded',$5,'v26.0','333',now()+interval '1 hour',now(),now(),now())`, [a.tenantId, a.publications[0].id, m.id, op.kind, instagram ? "200" : "100"]);
            }
        }
        await fixture.pool.query(`UPDATE post_publications SET status='published',provider_post_id=$1 WHERE id=$2`, [instagram ? "444" : "100_444", a.publications[0].id]);
        await fixture.pool.query(`UPDATE posts SET status='partially_failed' WHERE id=$1`, [a.postId]);
        return { ...a, context, socialAccountId, publicationId: a.publications[0].id };
    }
    return { ...fixture, reader, setup };
}
