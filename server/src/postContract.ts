import { isUuid, isValidPostTimestamp } from "../../shared/postContract.ts";

export { isPost, isUuid } from "../../shared/postContract.ts";
export type { Post, PostStatus } from "../../shared/postContract.ts";

export type CreatePostInput = {
  caption: string;
  mediaAssetIds: string[];
  publicationMode: "now" | "scheduled";
  scheduledFor: string | null;
  socialAccountIds: string[];
  title?: string;
};

export type PostValidationResult =
  | { success: true; data: CreatePostInput }
  | { success: false; fields: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidScheduledFor(value: unknown): value is string {
  return isValidPostTimestamp(value);
}

export function validateCreatePost(value: unknown): PostValidationResult {
  if (!isRecord(value)) {
    return { success: false, fields: ["body"] };
  }

  const invalidFields: string[] = [];
  if (
    value.title !== undefined &&
    value.title !== null &&
    (typeof value.title !== "string" ||
      value.title.trim().length === 0 ||
      value.title.length > 255)
  ) {
    invalidFields.push("title");
  }
  if (typeof value.caption !== "string" || value.caption.trim().length === 0) {
    invalidFields.push("caption");
  }
  if (value.publicationMode !== "now" && value.publicationMode !== "scheduled") {
    invalidFields.push("publicationMode");
  }
  if (
    (value.publicationMode === "scheduled" && !isValidScheduledFor(value.scheduledFor)) ||
    (value.publicationMode === "now" && value.scheduledFor !== undefined) ||
    (value.publicationMode !== "now" && value.publicationMode !== "scheduled" &&
      value.scheduledFor !== undefined && !isValidScheduledFor(value.scheduledFor))
  ) {
    invalidFields.push("scheduledFor");
  }
  if (Object.hasOwn(value, "status")) invalidFields.push("status");
  if (
    !Array.isArray(value.socialAccountIds) ||
    value.socialAccountIds.length === 0 ||
    !value.socialAccountIds.every(isUuid) ||
    new Set(value.socialAccountIds).size !== value.socialAccountIds.length
  ) {
    invalidFields.push("socialAccountIds");
  }
  const mediaAssetIds = value.mediaAssetIds === undefined ? [] : value.mediaAssetIds;
  if (
    !Array.isArray(mediaAssetIds) ||
    mediaAssetIds.length > 1 ||
    !mediaAssetIds.every(isUuid) ||
    new Set(mediaAssetIds).size !== mediaAssetIds.length
  ) {
    invalidFields.push("mediaAssetIds");
  }

  if (invalidFields.length > 0) {
    return { success: false, fields: invalidFields };
  }

  return {
    success: true,
    data: {
      caption: value.caption as string,
      mediaAssetIds: [...(mediaAssetIds as string[])],
      publicationMode: value.publicationMode as "now" | "scheduled",
      scheduledFor: value.publicationMode === "now" ? null : value.scheduledFor as string,
      socialAccountIds: [...(value.socialAccountIds as string[])],
      ...(typeof value.title === "string" ? { title: value.title } : {}),
    },
  };
}
