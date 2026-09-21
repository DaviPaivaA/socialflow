import {
  isHttpUrl,
  type UpdateSocialAccountInput,
} from "../../shared/socialAccountContract.ts";

type ValidationResult =
  | { data: UpdateSocialAccountInput; success: true }
  | { fields: string[]; success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateUpdateSocialAccount(
  value: unknown,
): ValidationResult {
  if (!isRecord(value)) return { fields: ["body"], success: false };

  const allowedFields = new Set(["displayName", "username", "profileImageUrl"]);
  const invalidFields = Object.keys(value).filter(
    (field) => !allowedFields.has(field),
  );
  const data: UpdateSocialAccountInput = {};

  if (Object.hasOwn(value, "displayName")) {
    const displayName =
      typeof value.displayName === "string" ? value.displayName.trim() : "";
    if (displayName.length === 0 || displayName.length > 120) {
      invalidFields.push("displayName");
    } else {
      data.displayName = displayName;
    }
  }
  if (Object.hasOwn(value, "username")) {
    if (value.username === null) {
      data.username = null;
    } else {
      const username =
        typeof value.username === "string" ? value.username.trim() : "";
      if (username.length === 0 || username.length > 100) {
        invalidFields.push("username");
      } else {
        data.username = username;
      }
    }
  }
  if (Object.hasOwn(value, "profileImageUrl")) {
    if (value.profileImageUrl === null) {
      data.profileImageUrl = null;
    } else if (isHttpUrl(value.profileImageUrl)) {
      data.profileImageUrl = value.profileImageUrl;
    } else {
      invalidFields.push("profileImageUrl");
    }
  }

  if (Object.keys(data).length === 0 && invalidFields.length === 0) {
    invalidFields.push("body");
  }
  if (invalidFields.length > 0) {
    return { fields: [...new Set(invalidFields)], success: false };
  }
  return { data, success: true };
}
