import type { PoolClient } from "pg";
import type { TenantRole } from "../../shared/authContract.ts";
import type { Post } from "../../shared/postContract.ts";
import type { PostPublication } from "../../shared/postPublicationContract.ts";
import { UnauthorizedError, type AuthContext } from "./authService.ts";

export type PostActor = { userId: string; tenantId: string; role: TenantRole };

/** Caller must BEGIN first, then acquire its post lock only after these auth locks. */
export async function lockPostActor(client: PoolClient, context: AuthContext): Promise<PostActor> {
  const actor = await queryPostActor(client, context, true);
  // A membership/user lock may have waited beyond the session's expiration.
  await assertPostActorSession(client, context);
  return actor;
}

/** Call again after waiting for the post lock; auth row locks remain caller-owned. */
export async function assertPostActorSession(client: PoolClient, context: AuthContext): Promise<void> {
  await queryActorSession(client, context, false);
}

/** Read-only authorization lookup; caller owns the consistent snapshot. */
export async function readPostActor(client: PoolClient, context: AuthContext): Promise<PostActor> {
  return queryPostActor(client, context, false);
}

async function queryActorSession(client: PoolClient, context: AuthContext, lock: boolean): Promise<void> {
  const session = await client.query(
    `SELECT id FROM auth_sessions
     WHERE id = $1::uuid AND membership_id = $2::uuid AND expires_at > clock_timestamp()
     ${lock ? "FOR SHARE" : ""}`,
    [context.sessionId, context.membershipId],
  );
  if (session.rowCount !== 1) throw new UnauthorizedError();
}

async function queryPostActor(client: PoolClient, context: AuthContext, lock: boolean): Promise<PostActor> {
  // Explicit queries establish one lock order: session, membership, user, then caller's post.
  await queryActorSession(client, context, lock);
  const membership = await client.query<{ role: TenantRole }>(
    `SELECT role FROM tenant_members
     WHERE id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
     ${lock ? "FOR SHARE" : ""}`,
    [context.membershipId, context.tenant.id, context.user.id],
  );
  if (!membership.rows[0]) throw new UnauthorizedError();
  const user = await client.query(
    `SELECT id FROM users WHERE id = $1::uuid AND is_active ${lock ? "FOR SHARE" : ""}`,
    [context.user.id],
  );
  if (user.rowCount !== 1) throw new UnauthorizedError();
  return { userId: context.user.id, tenantId: context.tenant.id, role: membership.rows[0].role };
}

export function isUntouchedSchedule(evidence: {
  post: Pick<Post, "status" | "publishedAt">;
  publications: readonly PostPublication[];
  hasOperation: boolean;
}): boolean {
  return evidence.post.status === "scheduled" && evidence.post.publishedAt === null &&
    !evidence.hasOperation &&
    (evidence.publications.length === 0 || evidence.publications.some((publication) => publication.status === "scheduled")) &&
    evidence.publications.every((publication) =>
      (publication.status === "scheduled" || publication.status === "cancelled") &&
      publication.providerPostId === null && publication.startedAt === null &&
      publication.publishedAt === null && publication.failedAt === null &&
      publication.errorCode === null && publication.errorMessage === null
    );
}
