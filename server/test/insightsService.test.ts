import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../src/authService.ts";
import { FacebookInsightsClient } from "../src/facebookInsightsClient.ts";
import { InstagramInsightsClient } from "../src/instagramInsightsClient.ts";
import { InsightsService, InsightsServiceError, type InsightsServiceQuery } from "../src/insightsService.ts";
import type { InsightsReadSnapshot } from "../src/insightsRepository.ts";
import type { InsightsTransport } from "../src/metaInsightsClient.ts";
import { cipher } from "./publicationFixtures.ts";
import { addPublication, deferred, insightsContext, insightsNow, insightsSnapshot } from "./insightsFixtures.ts";
// Mutations caught: skipping a gate leaks decryption/calls; borrowing IDs/tokens changes
// transport descriptors; skipping revalidation releases stale data or a stale public error.
function harness(ig = false, transport?: InsightsTransport, timeoutMs = 1_000) {
    const context = insightsContext();
    const snapshot = insightsSnapshot(context, ig);
    let current: InsightsReadSnapshot | null = snapshot;
    const load = vi.fn(async () => current);
    const decryptSecret = vi.fn((value: string) => cipher.decryptSecret(value));
    const wire = vi.fn(transport ?? (async () => ({ status: 200, body: { data: [] } })));
    let time = insightsNow;
    const now = () => time;
    const service = new InsightsService({ repository: { load }, cipher: { decryptSecret }, now,
        facebookClient: new FacebookInsightsClient({ transport: wire, now, timeoutMs }),
        instagramClient: new InstagramInsightsClient({ transport: wire, now, timeoutMs }) });
    return { context, snapshot, service, wire, decryptSecret, load, setCurrent: (value: InsightsReadSnapshot | null) => { current = value; },
        setTime: (value: number) => { time = value; },
        request: { scope: ig ? "instagram_account" : "facebook_page", period: "day", metrics: ig ? ["views"] : ["page_media_view"],
            socialAccountId: snapshot.account.id, ...(ig ? { metricType: "total_value" } : {}) } as InsightsServiceQuery };
}
describe("InsightsService private gate and client normalization", () => {
    it("does not reflect a malformed code in a typed dependency error", async () => {
        const h = harness();
        h.load.mockRejectedValueOnce(new InsightsServiceError("private-dependency-secret" as never));
        const error = await h.service.query(h.context, h.request).catch(e => e);
        expect(error).toMatchObject({ code: "provider_unavailable", availability: "provider_unavailable" });
        expect(String(error) + JSON.stringify(error)).not.toContain("private-dependency-secret");
    });
    it("keeps an actual zero distinct from absent metrics, without leaking private data", async () => {
        const h = harness(false, async () => ({ status: 200, body: { data: [
                    { name: "page_media_view", period: "day", values: [{ value: 0, end_time: "2026-10-21T00:00:00Z" }] },
                ] } }));
        h.request.metrics = ["page_media_view", "page_video_views"];
        const response = await h.service.query(h.context, h.request);
        expect(response).toMatchObject({ scope: "facebook_page", graphApiVersion: "v26.0", metrics: [
                { name: "page_media_view", status: "available", points: [{ value: 0, endTime: "2026-10-21T00:00:00Z" }] },
                { name: "page_video_views", status: "not_available", points: [{ value: null, endTime: null }] },
            ] });
        expect(JSON.stringify(response)).not.toMatch(/token|cipher|100|tenantId|accountId/);
        expect(h.wire.mock.calls[0][1]).toMatchObject({ tokenKind: "page", accessToken: "private-page-token" });
    });
    it.each(["text", "photo", "instagram_image", "instagram_reel"] as const)("queries only the persisted final ID for %s", async (kind) => {
        const ig = kind.startsWith("instagram");
        const h = harness(ig);
        addPublication(h.snapshot, kind);
        const result = await h.service.query(h.context, { scope: ig ? "instagram_media" : "facebook_post", period: "lifetime",
            metrics: ig ? ["views"] : ["post_media_view"], publicationId: h.snapshot.publication!.id });
        expect(result.scope).toBe(ig ? "instagram_media" : "facebook_post");
        expect(h.wire.mock.calls[0][0]).toMatchObject({ objectId: ig ? "444" : "100_444", parameters: ig ? { metric: "views" } : { metric: "post_media_view", period: "lifetime" } });
        expect(h.wire.mock.calls[0][1].tokenKind).toBe(ig ? "user" : "page");
        expect(h.wire.mock.calls[0][0].objectId).not.toBe("333");
    });
    it("uses only the User token for IG account and does not impose FB's date window", async () => {
        const h = harness(true);
        h.snapshot.account.tasks = null;
        h.snapshot.pageLink!.tasks = null;
        h.request.since = Math.floor(insightsNow / 1000) - 89 * 86400;
        h.request.until = Math.floor(insightsNow / 1000);
        await h.service.query(h.context, h.request);
        expect(h.wire.mock.calls[0][1]).toMatchObject({ tokenKind: "user", accessToken: "user-token" });
    });
    it.each([
        ["inactive", (s: InsightsReadSnapshot) => { s.account.isActive = false; }, "permission_required"],
        ["disconnected", (s: InsightsReadSnapshot) => { s.account.disconnectedAt = "2026-10-20T00:00:00Z"; }, "permission_required"],
        ["status error with ciphertext", (s: InsightsReadSnapshot) => { s.connection.status = "error"; }, "permission_required"],
        ["revoked with ciphertext", (s: InsightsReadSnapshot) => { s.connection.revokedAt = "2026-10-20T00:00:00Z"; }, "permission_required"],
        ["no grants", (s: InsightsReadSnapshot) => { s.connection.scopes = []; }, "permission_required"],
        ["no ANALYZE", (s: InsightsReadSnapshot) => { s.account.tasks = ["CREATE_CONTENT"]; }, "permission_required"],
        ["malformed tasks", (s: InsightsReadSnapshot) => { s.account.tasks = ["ANALYZE", 42]; }, "permission_required"],
        ["User not Page", (s: InsightsReadSnapshot) => { s.credential!.kind = "user"; }, "permission_required"],
        ["missing token", (s: InsightsReadSnapshot) => { s.credential!.accessTokenEncrypted = null; }, "permission_required"],
        ["expired", (s: InsightsReadSnapshot) => { s.credential!.expiresAt = "2020-01-01T00:00:00Z"; }, "token_expired"],
        ["invalid provider ID", (s: InsightsReadSnapshot) => { s.account.providerAccountId = "secret"; }, "unsupported_object"],
        ["wrong provider", (s: InsightsReadSnapshot) => { s.account.type = "tiktok_account"; }, "unsupported_object"],
    ] as const)("blocks %s before decrypt and Graph", async (_name, mutate, code) => {
        const h = harness();
        mutate(h.snapshot);
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["read_insights", "pages_read_engagement", "pages_show_list"])("requires each FB read grant: %s", async (scope) => {
        const h = harness();
        h.snapshot.connection.scopes = h.snapshot.connection.scopes.filter(s => s !== scope);
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code: "permission_required" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"])("requires each IG read grant: %s", async (scope) => {
        const h = harness(true);
        h.snapshot.connection.scopes = h.snapshot.connection.scopes.filter(s => s !== scope);
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code: "permission_required" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["page-token", "missing-link", "disconnected-link", "wrong-link"])("rejects IG %s without decrypt", async (state) => {
        const h = harness(true);
        if (state === "page-token")
            h.snapshot.credential!.kind = "page";
        if (state === "missing-link")
            h.snapshot.pageLink = null;
        if (state === "disconnected-link")
            h.snapshot.pageLink!.isActive = false;
        if (state === "wrong-link")
            h.snapshot.pageLink!.connectionId = "other";
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code: "permission_required" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["reel", "video-without-op", "foreign-prefix", "uncertain-error", "message-only", "not-published", "missing-id"])("rejects unproven FB Post %s", async (state) => {
        const h = harness();
        addPublication(h.snapshot, state === "reel" ? "facebook_reel" : "photo");
        const p = h.snapshot.publication!;
        if (state === "video-without-op")
            p.media[0].mediaType = "video";
        if (state === "foreign-prefix")
            p.providerPostId = "999_444";
        if (state === "uncertain-error")
            p.errorCode = "publication_state_unknown";
        if (state === "message-only")
            p.errorMessage = "private-secret";
        if (state === "not-published")
            p.status = "unknown";
        if (state === "missing-id")
            p.providerPostId = null;
        await expect(h.service.query(h.context, { scope: "facebook_post", period: "lifetime", metrics: ["post_media_view"], publicationId: p.id })).rejects.toMatchObject({ code: "unsupported_object" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each(["missing-op", "container-only", "unknown-op", "different-account", "detached-media", "deleted", "multiple", "wrong-mime", "wrong-version"])("rejects unproven IG Media %s", async (state) => {
        const h = harness(true);
        addPublication(h.snapshot, "instagram_image");
        const p = h.snapshot.publication!;
        if (state === "missing-op")
            p.operation = null;
        if (state === "container-only")
            p.providerPostId = null;
        if (state === "unknown-op")
            p.operation!.stage = "unknown";
        if (state === "different-account")
            p.operation!.providerAccountId = "999";
        if (state === "detached-media")
            p.media = [];
        if (state === "deleted")
            p.media[0].deletedAt = "2026-10-20T00:00:00Z";
        if (state === "multiple")
            p.media.push({ ...p.media[0], position: 1 });
        if (state === "wrong-mime")
            p.media[0].mimeType = "image/png";
        if (state === "wrong-version")
            p.operation!.graphApiVersion = "v25.0";
        await expect(h.service.query(h.context, { scope: "instagram_media", period: "lifetime", metrics: ["views"], publicationId: p.id })).rejects.toMatchObject({ code: "unsupported_object" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it.each([
        { metrics: [] }, { metrics: ["secret"] }, { period: "lifetime" }, { objectId: "200" },
        { subject: { ownerAccountId: "200", mediaType: "IMAGE", mediaProductType: "FEED", isAlbumChild: false } },
        { topLevelEvidence: { isTopLevel: true } }, { tenantId: "secret" }, { since: 1 },
        { since: 1, until: 2 }, { metricType: "total_value" },
    ])("rejects invalid selection or caller proof before decrypt: %j", async (extra) => {
        const h = harness();
        await expect(h.service.query(h.context, { ...h.request, ...extra } as InsightsServiceQuery)).rejects.toMatchObject({ code: "invalid_query" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
        expect(h.wire).not.toHaveBeenCalled();
    });
    it("does not use the FB window to admit stale IG account dates", async () => {
        const h = harness(true);
        h.request.since = Math.floor(insightsNow / 1000) - 91 * 86400;
        h.request.until = Math.floor(insightsNow / 1000);
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code: "invalid_query" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
    });
    it("blocks default transport without fake data or fetch fallback", async () => {
        const h = harness();
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        try {
            const service = new InsightsService({ repository: { load: h.load }, cipher, now: () => insightsNow });
            await expect(service.query(h.context, h.request)).rejects.toMatchObject({ code: "transport_blocked" });
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(h.load).toHaveBeenCalledTimes(2);
        }
        finally {
            fetchSpy.mockRestore();
        }
    });
    it.each([
        ["malformed", 200, { data: [{ name: "page_media_view", period: "day", values: [{ value: -1, end_time: "2026-10-21T00:00:00Z" }] }] }, "provider_unavailable"],
        ["rate", 429, { error: { message: "private-token", code: 4 } }, "rate_limited"],
        ["Page quota 80001", 400, { error: { message: "private-token", code: 80001 } }, "rate_limited"],
        ["permission", 400, { error: { message: "private-token", code: 200 } }, "permission_required"],
        ["expired", 400, { error: { message: "private-token", code: 190 } }, "token_expired"],
        ["story audience code 10", 400, { error: { message: "private-token", code: 10 } }, "provider_unavailable"],
    ] as const)("sanitizes %s and rereads before exposing its safe code", async (_name, status, body, code) => {
        const h = harness(false, async () => ({ status, body }));
        const err = await h.service.query(h.context, h.request).catch(e => e);
        expect(err).toMatchObject({ code });
        expect(err.cause).toBeUndefined();
        expect(String(err) + JSON.stringify(err)).not.toContain("private-token");
        expect(h.load).toHaveBeenCalledTimes(2);
    });
    it.each(["success", "error"])("discards %s when the same snapshot reference mutates during transport", async (outcome) => {
        const gate = deferred<{
            status: number;
            body: unknown;
        }>();
        const started = deferred<void>();
        const h = harness(false, () => { started.resolve(); return gate.promise; });
        const result = h.service.query(h.context, h.request);
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        h.snapshot.credential!.accessTokenEncrypted = cipher.encryptSecret("rotated-private-token");
        gate.resolve(outcome === "success" ? { status: 200, body: { data: [] } } : { status: 429, body: { error: { code: 4 } } });
        await expect(result).rejects.toMatchObject({ code: "provider_unavailable" });
    });
    it.each(["scope", "expiry", "account", "page-link", "publication-error", "published-at"])("compares complete private content after transport: %s", async (change) => {
        const gate = deferred<{
            status: number;
            body: unknown;
        }>();
        const started = deferred<void>();
        const h = harness(true, () => { started.resolve(); return gate.promise; });
        addPublication(h.snapshot, "instagram_image");
        const result = h.service.query(h.context, { scope: "instagram_media", period: "lifetime", metrics: ["views"], publicationId: h.snapshot.publication!.id });
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        if (change === "scope")
            h.snapshot.connection.scopes.push("unused-grant");
        if (change === "expiry")
            h.snapshot.credential!.expiresAt = "2097-01-01T00:00:00Z";
        if (change === "account")
            h.snapshot.account.providerAccountId = "201";
        if (change === "page-link")
            h.snapshot.pageLink!.tasks = ["ANALYZE"];
        if (change === "publication-error")
            h.snapshot.publication!.errorMessage = "secret";
        if (change === "published-at")
            h.snapshot.publication!.publishedAt = "2026-10-21T00:00:00Z";
        gate.resolve({ status: 200, body: { data: [] } });
        await expect(result).rejects.toBeInstanceOf(Error);
    });
    it("rechecks expiry with a fresh clock after transport", async () => {
        const gate = deferred<{
            status: number;
            body: unknown;
        }>();
        const started = deferred<void>();
        const h = harness(false, () => { started.resolve(); return gate.promise; });
        h.snapshot.credential!.expiresAt = new Date(insightsNow + 1000).toISOString();
        const result = h.service.query(h.context, h.request);
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        h.setTime(insightsNow + 1000);
        gate.resolve({ status: 200, body: { data: [] } });
        await expect(result).rejects.toMatchObject({ code: "token_expired" });
    });
    it("copies caller context and selection before lookup awaits", async () => {
        const h = harness();
        const loaded = deferred<InsightsReadSnapshot>();
        const started = deferred<void>();
        h.load.mockImplementationOnce(() => { started.resolve(); return loaded.promise; });
        const original = structuredClone(h.context);
        const id = h.request.socialAccountId;
        const result = h.service.query(h.context, h.request);
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        h.context.tenant.id = insightsContext().tenant.id;
        h.context.sessionId = insightsContext().sessionId;
        h.request.socialAccountId = insightsContext().tenant.id;
        h.request.metrics = ["page_video_views"];
        loaded.resolve(h.snapshot);
        const response = await result;
        expect(response.metrics[0].name).toBe("page_media_view");
        expect(h.load.mock.calls).toEqual([[original, { kind: "account", socialAccountId: id }], [original, { kind: "account", socialAccountId: id }]]);
    });
    it("sanitizes unexpected lookup/decrypt/transport errors", async () => {
        const h = harness(false, async () => { throw new Error("transport-secret"); });
        for (const source of ["lookup", "decrypt", "transport"]) {
            if (source === "lookup")
                h.load.mockRejectedValueOnce(new Error("db-secret"));
            if (source === "decrypt")
                h.decryptSecret.mockImplementationOnce(() => { throw new Error("cipher-secret"); });
            const err = await h.service.query(h.context, h.request).catch(e => e);
            expect(err).toMatchObject({ code: "provider_unavailable" });
            expect(String(err) + JSON.stringify(err)).not.toMatch(/secret|cause/);
        }
    });
    it("preserves a safe UnauthorizedError rather than a caller error message", async () => {
        const h = harness();
        h.load.mockRejectedValueOnce(new UnauthorizedError());
        await expect(h.service.query(h.context, h.request)).rejects.toBeInstanceOf(UnauthorizedError);
    });
    it("reports not_found without decryption", async () => {
        const h = harness();
        h.setCurrent(null);
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code: "not_found" });
        expect(h.decryptSecret).not.toHaveBeenCalled();
    });
    it("times out fake transport and still revalidates", async () => {
        const h = harness(false, () => new Promise(() => { }), 10);
        await expect(h.service.query(h.context, h.request)).rejects.toMatchObject({ code: "timeout" });
        expect(h.load).toHaveBeenCalledTimes(2);
    });
    it.each(["lookup", "transport", "reload"])("aborts %s promptly without reflecting reason or delayed rejection", async (phase) => {
        const h = harness();
        const gate = deferred<never>();
        const started = deferred<void>();
        const controller = new AbortController();
        if (phase === "lookup")
            h.load.mockImplementationOnce(() => { started.resolve(); return gate.promise; });
        if (phase === "reload")
            h.load.mockImplementationOnce(async () => h.snapshot).mockImplementationOnce(() => { started.resolve(); return gate.promise; });
        if (phase === "transport") {
            const transport: InsightsTransport = () => { started.resolve(); return gate.promise; };
            h.service = new InsightsService({ repository: { load: h.load }, cipher, now: () => insightsNow, facebookClient: new FacebookInsightsClient({ transport, now: () => insightsNow }) });
        }
        const result = h.service.query(h.context, h.request, { signal: controller.signal });
        void result.catch(() => { });
        await vi.waitFor(() => expect(started.isResolved()).toBe(true), { timeout: 500, interval: 1 });
        controller.abort(new Error("abort-reason-secret"));
        let settled: unknown;
        void result.then(value => { settled = value; }, error => { settled = error; });
        await vi.waitFor(() => expect(settled).toMatchObject({ code: "aborted" }), { timeout: 500, interval: 1 });
        const err = settled;
        expect(String(err) + JSON.stringify(err)).not.toMatch(/secret|cause/);
        gate.reject(new Error("late-secret"));
    });
});
