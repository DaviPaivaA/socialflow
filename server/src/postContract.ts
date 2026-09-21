import { isValidPostTimestamp } from "../../shared/postContract.ts";

export { isPost, isUuid } from "../../shared/postContract.ts";
export type { Post, PostStatus } from "../../shared/postContract.ts";

export type CreatePostInput = {
  caption: string;
  scheduledFor: string;
  status: "scheduled";
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
  if (!isValidScheduledFor(value.scheduledFor)) {
    invalidFields.push("scheduledFor");
  }
  if (value.status !== "scheduled") invalidFields.push("status");

  if (invalidFields.length > 0) {
    return { success: false, fields: invalidFields };
  }

  return {
    success: true,
    data: {
      caption: value.caption as string,
      scheduledFor: value.scheduledFor as string,
      status: "scheduled",
      ...(typeof value.title === "string" ? { title: value.title } : {}),
    },
  };
}
