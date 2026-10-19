import type { TenantRole } from "./authContract.ts";
import { isUuid } from "./postContract.ts";

/** Author-only policy: callers must independently authorize tenant access and state. */
export function canManagePostAuthor(
  actor: { userId: string; role: TenantRole },
  authorUserId: unknown,
): boolean {
  return (
    actor.role === "owner" || actor.role === "admin" ||
    (actor.role === "member" && isUuid(authorUserId) && actor.userId === authorUserId)
  );
}
