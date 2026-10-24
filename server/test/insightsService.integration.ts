import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../src/authService.ts";
import { FacebookInsightsClient } from "../src/facebookInsightsClient.ts";
import { InstagramInsightsClient } from "../src/instagramInsightsClient.ts";
import { PostgresInsightsRepository } from "../src/insightsRepository.ts";
import { InsightsService, type InsightsServiceQuery } from "../src/insightsService.ts";
import type { InsightsTransport } from "../src/metaInsightsClient.ts";
import { cipher } from "./publicationFixtures.ts";
import { deferred, insightsPgFixture } from "./insightsFixtures.ts";
describe("InsightsService with real PostgreSQL authorization and real clients", () => {
    let f: Awaited<ReturnType<typeof insightsPgFixture>>;
    beforeAll(async () => { f = await insightsPgFixture(); });
    afterAll(async () => { await f?.close(); });
    function service(transport?: InsightsTransport, now = Date.now) {
        const decryptSecret = vi.fn((value: string) => cipher.decryptSecret(value));
        const wire = vi.fn(transport ?? (async () => ({ status: 200, body: { data: [] } })));
        const instance = new InsightsService({ repository: new PostgresInsightsRepository(f.pool), cipher: { decryptSecret }, now,
            facebookClient: new FacebookInsightsClient({ transport: wire, now }), instagramClient: new InstagramInsightsClient({ transport: wire, now }) });
        return { instance, decryptSecret, wire };
    }
    function request(a: Awaited<ReturnType<typeof f.setup>>, ig = false, publication = false): InsightsServiceQuery {
        if (publication)
            return { scope: ig ? "instagram_media" : "facebook_post", period: "lifetime", metrics: ig ? ["views"] : ["post_media_view"], publicationId: a.publicationId };
        return { scope: ig ? "instagram_account" : "facebook_page", period: "day", metrics: ig ? ["views"] : ["page_media_view"], socialAccountId: a.socialAccountId, ...(ig ? { metricType: "total_value" as const } : {}) };
    }
    it.each(["owner", "admin", "member"])("lets current %s read another author's destination after author removal", async (role) => {
        const a = await f.setup();
        const other = await f.post();
        const ctx = await f.reader(a.tenantId, other.authorUserId, role);
        await f.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [a.tenantId, a.authorUserId]);
        await f.pool.query("UPDATE users SET is_active=false WHERE id=$1", [a.authorUserId]);
        const h = service();
        await expect(h.instance.query(ctx, request(a, false, true))).resolves.toMatchObject({ scope: "facebook_post" });
        expect(h.wire.mock.calls[0][0].objectId).toBe("100_444");
    });
    it.each(["text", "photo", "instagram_image", "instagram_reel"] as const)("queries persisted %s evidence, not its upload/container", async (kind) => {
        const ig = kind.startsWith("instagram");
        const a = await f.setup(ig, kind);
        const h = service();
        await expect(h.instance.query(a.context, request(a, ig, true))).resolves.toMatchObject({ scope: ig ? "instagram_media" : "facebook_post" });
        expect(h.wire.mock.calls[0][0].objectId).toBe(ig ? "444" : "100_444");
        expect(h.wire.mock.calls[0][1]).toMatchObject({ tokenKind: ig ? "user" : "page", accessToken: ig ? "user-token" : "private-page-token" });
    });
    it("does not need a Page credential or publishing grants for IG account", async () => {
        const a = await f.setup(true);
        await f.pool.query("DELETE FROM social_account_credentials WHERE tenant_id=$1", [a.tenantId]);
        const h = service();
        await expect(h.instance.query(a.context, request(a, true))).resolves.toMatchObject({ scope: "instagram_account" });
        expect(h.wire.mock.calls[0][1].accessToken).toBe("user-token");
    });
    it.each(["status-error", "revoked-at"])("M1: rejects permitted connection state %s even while ciphertext persists", async (state) => {
        const a = await f.setup(true);
        if (state === "status-error")
            await f.pool.query("UPDATE oauth_connections SET status='error' WHERE id=$1", [a.connectionId]);
        else
            await f.pool.query("UPDATE oauth_connections SET revoked_at=now() WHERE id=$1", [a.connectionId]);
        expect((await f.pool.query("SELECT access_token_encrypted IS NOT NULL AS present FROM oauth_connections WHERE id=$1", [a.connectionId])).rows[0].present).toBe(true);
        const h = service();
        await expect(h.instance.query(a.context, request(a, true))).rejects.toMatchObject({ code: "permission_required" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["missing", "foreign-account", "foreign-publication", "expected-account"])("hides unavailable local resource %s", async (state) => {
        const a = await f.setup();
        const b = await f.setup();
        const h = service();
        const q = state === "missing" ? { ...request(a), socialAccountId: randomUUID() } : state === "foreign-account" ? request(b) : state === "foreign-publication" ? request(b, false, true) : { ...request(a, false, true), socialAccountId: b.socialAccountId };
        await expect(h.instance.query(a.context, q)).rejects.toMatchObject({ code: "not_found" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["error-code", "error-message", "unknown-operation", "missing-final", "detached-media"])("blocks contradictory or unproven persisted result %s", async (state) => {
        const a = await f.setup(true, "instagram_image");
        if (state === "error-code")
            await f.pool.query("UPDATE post_publications SET error_code='publication_state_unknown' WHERE id=$1", [a.publicationId]);
        if (state === "error-message")
            await f.pool.query("UPDATE post_publications SET error_message='private-persisted-secret' WHERE id=$1", [a.publicationId]);
        if (state === "unknown-operation")
            await f.pool.query("UPDATE publication_operations SET stage='unknown' WHERE publication_id=$1", [a.publicationId]);
        if (state === "missing-final")
            await f.pool.query("UPDATE post_publications SET provider_post_id=NULL WHERE id=$1", [a.publicationId]);
        if (state === "detached-media")
            await f.pool.query("DELETE FROM post_media WHERE post_id=$1", [a.postId]);
        const h = service();
        await expect(h.instance.query(a.context, request(a, true, true))).rejects.toMatchObject({ code: "unsupported_object" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["session", "membership", "workspace", "disconnect", "rotation", "grants", "error-code", "error-message", "published-at"])("discards pending response after SQL-only %s change without updated_at", async (change) => {
        const a = await f.setup();
        const started = deferred<void>();
        const gate = deferred<{
            status: number;
            body: unknown;
        }>();
        const h = service(() => { started.resolve(); return gate.promise; });
        const before = (await f.pool.query("SELECT updated_at FROM post_publications WHERE id=$1", [a.publicationId])).rows[0].updated_at;
        const result = h.instance.query(a.context, request(a, false, true));
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        if (change === "session")
            await f.pool.query("DELETE FROM auth_sessions WHERE id=$1", [a.context.sessionId]);
        if (change === "membership")
            await f.pool.query("DELETE FROM tenant_members WHERE id=$1", [a.context.membershipId]);
        if (change === "workspace") {
            const b = await f.setup();
            const membership = await f.reader(b.tenantId, a.authorUserId);
            await f.pool.query("UPDATE auth_sessions SET membership_id=$1 WHERE id=$2", [membership.membershipId, a.context.sessionId]);
        }
        if (change === "disconnect")
            await f.pool.query("UPDATE social_accounts SET disconnected_at=now() WHERE id=$1", [a.socialAccountId]);
        if (change === "rotation")
            await f.pool.query("UPDATE social_account_credentials SET access_token_encrypted=$1 WHERE social_account_id=$2", [Buffer.from(cipher.encryptSecret("rotated-token")), a.socialAccountId]);
        if (change === "grants")
            await f.pool.query("UPDATE oauth_connections SET scopes=array_append(scopes,'new-grant') WHERE id=$1", [a.connectionId]);
        if (change === "error-code")
            await f.pool.query("UPDATE post_publications SET error_code='publication_state_unknown' WHERE id=$1", [a.publicationId]);
        if (change === "error-message")
            await f.pool.query("UPDATE post_publications SET error_message='private-secret' WHERE id=$1", [a.publicationId]);
        if (change === "published-at")
            await f.pool.query("UPDATE post_publications SET published_at=now() WHERE id=$1", [a.publicationId]);
        gate.resolve({ status: 200, body: { data: [] } });
        if (["session", "membership", "workspace"].includes(change))
            await expect(result).rejects.toBeInstanceOf(UnauthorizedError);
        else
            await expect(result).rejects.toBeInstanceOf(Error);
        expect((await f.pool.query("SELECT updated_at FROM post_publications WHERE id=$1", [a.publicationId])).rows[0].updated_at).toEqual(before);
    });
    it("rechecks authorization after an asynchronous provider error", async () => {
        const a = await f.setup();
        const started = deferred<void>();
        const gate = deferred<{
            status: number;
            body: unknown;
        }>();
        const h = service(() => { started.resolve(); return gate.promise; });
        const result = h.instance.query(a.context, request(a));
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        await f.pool.query("DELETE FROM auth_sessions WHERE id=$1", [a.context.sessionId]);
        gate.resolve({ status: 429, body: { error: { code: 4, message: "secret" } } });
        await expect(result).rejects.toBeInstanceOf(UnauthorizedError);
    });
    it("isolates two tenants and two accounts completing in reverse order", async () => {
        const a = await f.setup(true);
        const b = await f.setup(true);
        await f.pool.query("UPDATE social_accounts SET external_account_id='201' WHERE id=$1", [b.socialAccountId]);
        await f.pool.query("UPDATE oauth_connections SET access_token_encrypted=$1 WHERE id=$2", [Buffer.from(cipher.encryptSecret("b-private-token")), b.connectionId]);
        const gates = [deferred<{
                status: number;
                body: unknown;
            }>(), deferred<{
                status: number;
                body: unknown;
            }>()];
        const starts = [deferred<void>(), deferred<void>()];
        const h = service((descriptor, credential) => { const i = descriptor.objectId === "200" ? 0 : 1; expect(credential.accessToken).toBe(i ? "b-private-token" : "user-token"); starts[i].resolve(); return gates[i].promise; });
        const pa = h.instance.query(a.context, request(a, true));
        const pb = h.instance.query(b.context, request(b, true));
        void pa.catch(() => { });
        void pb.catch(() => { });
        await vi.waitFor(() => expect(starts.every(s => s.isResolved())).toBe(true), { timeout: 500, interval: 1 });
        gates[1].resolve({ status: 200, body: { data: [{ name: "views", period: "day", total_value: { value: 2 } }] } });
        expect((await pb).metrics[0].points[0].value).toBe(2);
        gates[0].resolve({ status: 200, body: { data: [{ name: "views", period: "day", total_value: { value: 0 } }] } });
        expect((await pa).metrics[0].points[0].value).toBe(0);
    });
    it("read failures leave publication status, credentials and operation untouched", async () => {
        const a = await f.setup(true, "instagram_image");
        const state = async () => (await f.pool.query(`SELECT row_to_json(p) p,row_to_json(c) c,row_to_json(o) o FROM post_publications p
      JOIN oauth_connections c ON c.id=$1 JOIN publication_operations o ON o.publication_id=p.id WHERE p.id=$2`, [a.connectionId, a.publicationId])).rows;
        const before = await state();
        const h = service(async () => ({ status: 400, body: { error: { code: 190, message: "secret" } } }));
        await expect(h.instance.query(a.context, request(a, true, true))).rejects.toMatchObject({ code: "token_expired" });
        expect(await state()).toEqual(before);
    });
});
