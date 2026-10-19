import { isUuid, isValidPostTimestamp } from "../../shared/postContract.ts";
import type { UpdateScheduledPostInput } from "../../shared/postManagementContract.ts";

export type { UpdateScheduledPostInput } from "../../shared/postManagementContract.ts";

function isUniqueUuidArray(value: unknown, min: number, max = Infinity): value is string[] {
  return (
    Array.isArray(value) && value.length >= min && value.length <= max &&
    value.every(isUuid) && new Set(value.map((id) => id.toLowerCase())).size === value.length
  );
}

export function validateUpdateScheduledPost(value: unknown):
  | { success: true; data: UpdateScheduledPostInput }
  | { success: false; fields: string[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { success: false, fields: ["body"] };
  }

  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) return { success: false, fields: ["body"] };

  const fields = keys.filter((field) => {
    const supplied = input[field];
    switch (field) {
      case "title":
        return supplied !== null && (
          typeof supplied !== "string" || supplied.trim().length === 0 || supplied.length > 255
        );
      case "caption":
        return typeof supplied !== "string" || supplied.trim().length === 0;
      case "scheduledFor":
        return !isValidPostTimestamp(supplied);
      case "socialAccountIds":
        return !isUniqueUuidArray(supplied, 1);
      case "mediaAssetIds":
        return !isUniqueUuidArray(supplied, 0, 1);
      default:
        return true;
    }
  });
  if (fields.length > 0) return { success: false, fields };

  return {
    success: true,
    data: {
      ...(Object.hasOwn(input, "title") ? { title: input.title as string | null } : {}),
      ...(Object.hasOwn(input, "caption") ? { caption: input.caption as string } : {}),
      ...(Object.hasOwn(input, "scheduledFor") ? { scheduledFor: input.scheduledFor as string } : {}),
      ...(Object.hasOwn(input, "socialAccountIds") ? { socialAccountIds: [...input.socialAccountIds as string[]] } : {}),
      ...(Object.hasOwn(input, "mediaAssetIds") ? { mediaAssetIds: [...input.mediaAssetIds as string[]] } : {}),
    },
  };
}
