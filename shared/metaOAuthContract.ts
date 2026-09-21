export const META_OAUTH_CALLBACK_ERRORS = [
  "cancelled",
  "invalid_state",
  "session_expired",
  "provider_error",
  "no_accounts",
] as const;

export type MetaOAuthCallbackError =
  (typeof META_OAUTH_CALLBACK_ERRORS)[number];

export type MetaOAuthStartResponse = {
  authorizationUrl: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMetaOAuthCallbackError(
  value: unknown,
): value is MetaOAuthCallbackError {
  return (
    typeof value === "string" &&
    META_OAUTH_CALLBACK_ERRORS.some((candidate) => candidate === value)
  );
}

export function isMetaOAuthStartResponse(
  value: unknown,
): value is MetaOAuthStartResponse {
  if (!isRecord(value) || typeof value.authorizationUrl !== "string") {
    return false;
  }

  try {
    const url = new URL(value.authorizationUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.facebook.com" &&
      /^\/v\d+\.\d+\/dialog\/oauth$/.test(url.pathname) &&
      Boolean(url.searchParams.get("client_id")) &&
      Boolean(url.searchParams.get("redirect_uri")) &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "")
    );
  } catch {
    return false;
  }
}
