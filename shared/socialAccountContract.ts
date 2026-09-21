import { isUuid, isValidPostTimestamp } from "./postContract.ts";

export const SOCIAL_ACCOUNT_PROVIDERS = [
  "instagram",
  "facebook",
  "tiktok",
] as const;

export const SOCIAL_ACCOUNT_STATUSES = [
  "pending",
  "connected",
  "expired",
  "revoked",
  "error",
] as const;

export type SocialAccountProvider =
  (typeof SOCIAL_ACCOUNT_PROVIDERS)[number];
export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export type SocialAccount = {
  createdAt: string;
  disconnectedAt: string | null;
  displayName: string;
  id: string;
  profileImageUrl: string | null;
  provider: SocialAccountProvider;
  providerAccountId: string;
  scopes: string[];
  status: SocialAccountStatus;
  tokenExpiresAt: string | null;
  updatedAt: string;
  username: string | null;
};

export type SocialAccountsResponse = {
  socialAccounts: SocialAccount[];
};

export type UpdateSocialAccountInput = {
  displayName?: string;
  profileImageUrl?: string | null;
  username?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSocialAccountProvider(
  value: unknown,
): value is SocialAccountProvider {
  return (
    typeof value === "string" &&
    SOCIAL_ACCOUNT_PROVIDERS.some((provider) => provider === value)
  );
}

export function isSocialAccountStatus(
  value: unknown,
): value is SocialAccountStatus {
  return (
    typeof value === "string" &&
    SOCIAL_ACCOUNT_STATUSES.some((status) => status === value)
  );
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isSocialAccount(value: unknown): value is SocialAccount {
  if (!isRecord(value)) return false;

  const sensitiveFields = [
    "accessToken",
    "refreshToken",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
    "access_token_encrypted",
    "refresh_token_encrypted",
    "providerMetadata",
    "provider_metadata",
  ];
  if (sensitiveFields.some((field) => Object.hasOwn(value, field))) {
    return false;
  }

  return (
    isUuid(value.id) &&
    isSocialAccountProvider(value.provider) &&
    typeof value.providerAccountId === "string" &&
    value.providerAccountId.trim().length > 0 &&
    value.providerAccountId.length <= 255 &&
    typeof value.displayName === "string" &&
    value.displayName.trim().length > 0 &&
    value.displayName.length <= 120 &&
    (value.username === null ||
      (typeof value.username === "string" &&
        value.username.trim().length > 0 &&
        value.username.length <= 100)) &&
    (value.profileImageUrl === null || isHttpUrl(value.profileImageUrl)) &&
    isSocialAccountStatus(value.status) &&
    (value.tokenExpiresAt === null ||
      isValidPostTimestamp(value.tokenExpiresAt)) &&
    Array.isArray(value.scopes) &&
    value.scopes.length <= 50 &&
    value.scopes.every(
      (scope) =>
        typeof scope === "string" &&
        scope.trim().length > 0 &&
        scope.length <= 100,
    ) &&
    isValidPostTimestamp(value.createdAt) &&
    isValidPostTimestamp(value.updatedAt) &&
    (value.disconnectedAt === null ||
      isValidPostTimestamp(value.disconnectedAt)) &&
    (value.status !== "revoked" || value.disconnectedAt !== null)
  );
}

export function isSocialAccountsResponse(
  value: unknown,
): value is SocialAccountsResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.socialAccounts) &&
    value.socialAccounts.every(isSocialAccount)
  );
}
