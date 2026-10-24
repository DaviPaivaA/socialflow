import { isDeepStrictEqual } from "node:util";
import { isInsightsRecord, isInsightsSelection, isInsightsTimestamp, type InsightsResponse, type InsightsSelection, type InsightsStatus } from "../../shared/insightsContract.ts";
import { isUuid } from "../../shared/postContract.ts";
import { UnauthorizedError, type AuthContext } from "./authService.ts";
import { FacebookInsightsClient, type FacebookInsightsQuery } from "./facebookInsightsClient.ts";
import { InstagramInsightsClient, type InstagramInsightsQuery } from "./instagramInsightsClient.ts";
import { InvalidInsightsTargetError, type InsightsReadSnapshot, type InsightsRepository, type InsightsTarget } from "./insightsRepository.ts";
import { createInsightsRequestDescriptor, MetaInsightsClientError, type InsightsRequestInput, type MetaInsightsErrorCode } from "./metaInsightsClient.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";
export type InsightsServiceQuery = (Extract<InsightsSelection, {
    scope: "facebook_page";
}> & {
    socialAccountId: string;
    since?: number;
    until?: number;
}) | (Extract<InsightsSelection, {
    scope: "instagram_account";
}> & {
    socialAccountId: string;
    metricType: "total_value" | "time_series";
    since?: number;
    until?: number;
}) | (Extract<InsightsSelection, {
    scope: "facebook_post" | "instagram_media";
}> & {
    publicationId: string;
    socialAccountId?: string;
});
export type InsightsServiceDependencies = {
    repository: InsightsRepository;
    cipher: Pick<SocialTokenCipher, "decryptSecret">;
    facebookClient?: Pick<FacebookInsightsClient, "query">;
    instagramClient?: Pick<InstagramInsightsClient, "query">;
    now?: () => number;
};
export type InsightsServiceErrorCode = Exclude<MetaInsightsErrorCode, "invalid_response"> | "not_found";
const SAFE_ERROR_CODES: readonly InsightsServiceErrorCode[] = [
    "invalid_query", "permission_required", "token_expired", "rate_limited",
    "provider_unavailable", "timeout", "aborted", "transport_blocked", "unsupported_object", "not_found",
];
export class InsightsServiceError extends Error {
    readonly code: InsightsServiceErrorCode;
    readonly availability: Exclude<InsightsStatus, "available" | "not_available">;
    constructor(code: InsightsServiceErrorCode) {
        const safeCode = SAFE_ERROR_CODES.includes(code) ? code : "provider_unavailable";
        super(`Insights: ${safeCode}`);
        this.name = "InsightsServiceError";
        this.code = safeCode;
        this.availability = safeCode === "unsupported_object" ? "unsupported"
            : ["permission_required", "token_expired", "rate_limited"].includes(safeCode)
                ? safeCode as "permission_required" | "token_expired" | "rate_limited" : "provider_unavailable";
    }
}
function safeError(error: unknown): Error {
    if (error instanceof UnauthorizedError)
        return new UnauthorizedError();
    if (error instanceof InsightsServiceError)
        return new InsightsServiceError(error.code);
    if (error instanceof InvalidInsightsTargetError)
        return new InsightsServiceError("invalid_query");
    if (error instanceof MetaInsightsClientError)
        return new InsightsServiceError(error.code === "invalid_response" ? "provider_unavailable" : error.code);
    return new InsightsServiceError("provider_unavailable");
}
function stop(signal?: AbortSignal): void {
    // AbortSignal.reason may contain raw provider/database/credential information.
    if (signal?.aborted)
        throw new InsightsServiceError("aborted");
}
async function waitForRead<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal)
        return pending;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new InsightsServiceError("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted)
            onAbort();
    });
    try {
        // Promise.race observes late rejection, but never reflects its raw error.
        return await Promise.race([pending, aborted]);
    }
    finally {
        if (onAbort)
            signal.removeEventListener("abort", onAbort);
    }
}
function captureContext(context: AuthContext): AuthContext {
    if (![context?.sessionId, context?.membershipId, context?.tenant?.id, context?.user?.id].every(isUuid))
        throw new UnauthorizedError();
    return { sessionId: context.sessionId, membershipId: context.membershipId,
        tenant: { ...context.tenant }, user: { ...context.user } };
}
function captureRequest(request: InsightsServiceQuery): {
    request: InsightsServiceQuery;
    target: InsightsTarget;
} {
    if (!isInsightsRecord(request) || !isInsightsSelection({ scope: request.scope, period: request.period, metrics: request.metrics }))
        throw new InsightsServiceError("invalid_query");
    const account = request.scope === "facebook_page" || request.scope === "instagram_account";
    const allowed = ["scope", "period", "metrics", "socialAccountId", ...(account ? ["since", "until", ...(request.scope === "instagram_account" ? ["metricType"] : [])] : ["publicationId"])];
    if (Object.keys(request).some(key => !allowed.includes(key)) ||
        (account ? !isUuid(request.socialAccountId) : !isUuid(request.publicationId)) ||
        (!account && request.socialAccountId !== undefined && !isUuid(request.socialAccountId)))
        throw new InsightsServiceError("invalid_query");
    const copy = { ...request, metrics: [...request.metrics] } as InsightsServiceQuery;
    return { request: copy, target: account ? { kind: "account", socialAccountId: request.socialAccountId! }
            : { kind: "publication", publicationId: (request as Extract<InsightsServiceQuery, {
                    publicationId: string;
                }>).publicationId,
                ...(request.socialAccountId !== undefined ? { socialAccountId: request.socialAccountId } : {}) } };
}
function numeric(value: unknown): value is string { return typeof value === "string" && /^\d{1,32}$/.test(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(v => typeof v === "string"); }
function gate(snapshot: InsightsReadSnapshot, context: AuthContext, request: InsightsServiceQuery, target: InsightsTarget, now: number): FacebookInsightsQuery | InstagramInsightsQuery {
    if (snapshot.tenantId !== context.tenant.id || !isInsightsTimestamp(snapshot.authorizationExpiresAt) || Date.parse(snapshot.authorizationExpiresAt) <= now)
        throw new UnauthorizedError();
    const { account, connection, credential, pageLink } = snapshot;
    const facebook = request.scope === "facebook_page" || request.scope === "facebook_post";
    if (account.type !== (facebook ? "facebook_page" : "instagram_business") || !numeric(account.providerAccountId))
        throw new InsightsServiceError("unsupported_object");
    if (target.kind === "account" && target.socialAccountId !== account.id)
        throw new InsightsServiceError("not_found");
    if (target.kind === "publication" && target.socialAccountId !== undefined && target.socialAccountId !== account.id)
        throw new InsightsServiceError("not_found");
    if (!account.isActive || account.disconnectedAt !== null || connection.platform !== "meta" || connection.status !== "active" || connection.revokedAt !== null)
        throw new InsightsServiceError("permission_required");
    const required = facebook ? ["read_insights", "pages_read_engagement", "pages_show_list"] : ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"];
    if (!strings(connection.scopes) || !required.every(s => connection.scopes.includes(s)) || !credential || credential.kind !== (facebook ? "page" : "user") ||
        typeof credential.accessTokenEncrypted !== "string" || !credential.accessTokenEncrypted ||
        (facebook && (!strings(account.tasks) || !account.tasks.includes("ANALYZE"))))
        throw new InsightsServiceError("permission_required");
    if (!facebook && (!numeric(account.pageId) || !pageLink || pageLink.providerAccountId !== account.pageId || pageLink.connectionId !== connection.id || !pageLink.isActive || pageLink.disconnectedAt !== null))
        throw new InsightsServiceError("permission_required");
    if (credential.expiresAt !== null && (!isInsightsTimestamp(credential.expiresAt) || Date.parse(credential.expiresAt) <= now))
        throw new InsightsServiceError("token_expired");
    let objectId = account.providerAccountId;
    let mediaProof: Extract<InstagramInsightsQuery, {
        scope: "instagram_media";
    }> | undefined;
    if (target.kind === "publication") {
        const p = snapshot.publication;
        if (!p || p.id !== target.publicationId || p.socialAccountId !== account.id || p.status !== "published" || p.errorCode !== null || p.errorMessage !== null || !p.providerPostId)
            throw new InsightsServiceError("unsupported_object");
        objectId = p.providerPostId;
        if (facebook) {
            if (!/^\d{1,32}(?:_\d{1,32})?$/.test(objectId) || (objectId.includes("_") && objectId.split("_")[0] !== account.providerAccountId) ||
                p.operation !== null || p.media.length > 1 || p.media.some(m => m.position !== 0 || m.deletedAt !== null || m.mediaType !== "image" || !["image/jpeg", "image/png"].includes(m.mimeType)))
                throw new InsightsServiceError("unsupported_object");
        }
        else {
            const op = p.operation;
            const m = p.media[0];
            if (!numeric(objectId) || !op || op.stage !== "succeeded" || op.providerAccountId !== account.providerAccountId || op.graphApiVersion !== "v26.0" ||
                !["instagram_image", "instagram_reel"].includes(op.kind) || p.media.length !== 1 || !m || m.position !== 0 || m.deletedAt !== null ||
                op.mediaAssetId !== m.id || !op.media || !isDeepStrictEqual(op.media, { id: m.id, mediaType: m.mediaType, mimeType: m.mimeType, deletedAt: m.deletedAt }) ||
                (op.kind === "instagram_image" ? (m.mediaType !== "image" || m.mimeType !== "image/jpeg") : (m.mediaType !== "video" || !["video/mp4", "video/quicktime"].includes(m.mimeType))))
                throw new InsightsServiceError("unsupported_object");
            // Internal proof from the single-media publication workflow, not owner/MIME alone,
            // and never a verifier/bypass for caller-supplied or externally discovered media.
            mediaProof = { scope: "instagram_media", period: "lifetime", metrics: (request as Extract<InsightsServiceQuery, {
                    scope: "instagram_media";
                }>).metrics,
                objectId, graphApiVersion: "v26.0", expectedAccountId: account.providerAccountId,
                subject: { mediaId: objectId, ownerAccountId: account.providerAccountId, mediaType: op.kind === "instagram_image" ? "IMAGE" : "VIDEO", mediaProductType: op.kind === "instagram_image" ? "FEED" : "REELS", formatVerified: true, isAlbumChild: false },
                topLevelEvidence: { mediaId: objectId, accountId: account.providerAccountId, isTopLevel: true } };
        }
    }
    const input = { scope: request.scope, period: request.period, metrics: [...request.metrics], objectId, graphApiVersion: "v26.0",
        ...("metricType" in request ? { metricType: request.metricType } : {}),
        ...("since" in request ? { since: request.since } : {}), ...("until" in request ? { until: request.until } : {}) } as InsightsRequestInput;
    createInsightsRequestDescriptor(input);
    if (input.since !== undefined) {
        const oldest = new Date(now);
        oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
        if (input.until! * 1000 > now || (facebook ? (input.since * 1000 < oldest.getTime() || input.until! - input.since > 90 * 86400) : input.since * 1000 < now - 90 * 86400 * 1000))
            throw new InsightsServiceError("invalid_query");
    }
    return mediaProof ?? (request.scope === "facebook_post" ? { ...input, objectType: "feed_post" } : input) as FacebookInsightsQuery | InstagramInsightsQuery;
}
export class InsightsService {
    private readonly repository: InsightsRepository;
    private readonly cipher: Pick<SocialTokenCipher, "decryptSecret">;
    private readonly facebook: Pick<FacebookInsightsClient, "query">;
    private readonly instagram: Pick<InstagramInsightsClient, "query">;
    private readonly now: () => number;
    constructor(dependencies: InsightsServiceDependencies) {
        this.repository = dependencies.repository;
        this.cipher = dependencies.cipher;
        this.now = dependencies.now ?? Date.now;
        this.facebook = dependencies.facebookClient ?? new FacebookInsightsClient({ now: this.now });
        this.instagram = dependencies.instagramClient ?? new InstagramInsightsClient({ now: this.now });
    }
    private async load(context: AuthContext, target: InsightsTarget, signal?: AbortSignal): Promise<InsightsReadSnapshot> {
        stop(signal);
        const snapshot = await waitForRead(this.repository.load(context, target), signal);
        stop(signal);
        if (!snapshot)
            throw new InsightsServiceError("not_found");
        return structuredClone(snapshot);
    }
    async query(context: AuthContext, request: InsightsServiceQuery, options: {
        signal?: AbortSignal;
    } = {}): Promise<InsightsResponse> {
        try {
            const ctx = captureContext(context);
            const captured = captureRequest(request);
            const signal = options.signal;
            stop(signal);
            const snapshot = await this.load(ctx, captured.target, signal);
            const query = gate(snapshot, ctx, captured.request, captured.target, this.now());
            stop(signal);
            const credential = { tokenKind: snapshot.credential!.kind, accessToken: this.cipher.decryptSecret(snapshot.credential!.accessTokenEncrypted!),
                expiresAt: snapshot.credential!.expiresAt, grantedScopes: [...snapshot.connection.scopes], tasks: strings(snapshot.account.tasks) ? [...snapshot.account.tasks] : [] };
            let outcome: {
                response: InsightsResponse;
                error?: never;
            } | {
                error: unknown;
                response?: never;
            };
            try {
                outcome = { response: await (query.scope === "facebook_page" || query.scope === "facebook_post"
                        ? this.facebook.query(query, credential, { signal }) : this.instagram.query(query, credential, { signal })) };
            }
            catch (error) {
                outcome = { error };
            }
            // No transaction is held across the client. Reload for both success and error;
            // abort stops the wait and cannot release either data or a stale provider error.
            const latest = await this.load(ctx, captured.target, signal);
            gate(latest, ctx, captured.request, captured.target, this.now());
            if (!isDeepStrictEqual(snapshot, latest))
                throw new InsightsServiceError("provider_unavailable");
            stop(signal);
            if ("error" in outcome)
                throw outcome.error;
            return outcome.response;
        }
        catch (error) {
            throw safeError(error);
        }
    }
}
