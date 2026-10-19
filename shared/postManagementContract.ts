import type { Post } from "./postContract.ts";
import { isCreatePostResponse, type PostPublication } from "./postPublicationContract.ts";

export type UpdateScheduledPostInput = {
  title?: string | null;
  caption?: string;
  scheduledFor?: string;
  socialAccountIds?: string[];
  mediaAssetIds?: string[];
};

export type PostManagementPermissions = {
  canEditSchedule: boolean;
  canCancelSchedule: boolean;
};

export type PostDetail = {
  post: Post;
  publications: PostPublication[];
  permissions: PostManagementPermissions;
};

function hasOnlyOwnFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

export function isPostDetail(value: unknown): value is PostDetail {
  if (!hasOnlyOwnFields(value, ["post", "publications", "permissions"])) return false;

  const response = { post: value.post, publications: value.publications };
  if (!isCreatePostResponse(response)) return false;

  return (
    hasOnlyOwnFields(value.permissions, ["canEditSchedule", "canCancelSchedule"]) &&
    typeof value.permissions.canEditSchedule === "boolean" &&
    typeof value.permissions.canCancelSchedule === "boolean" &&
    response.publications.every((publication) =>
      publication.postId === response.post.id && publication.tenantId === response.post.tenantId
    )
  );
}
