import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE_NAME = "socialflow_session";

export type SessionCookieConfig = {
  maxAgeSeconds: number;
  sameSite: "Lax" | "None" | "Strict";
  secure: boolean;
};

function encodeCookieValue(value: string): string {
  return encodeURIComponent(value);
}

export function readSessionToken(request: IncomingMessage): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    try {
      const token = decodeURIComponent(part.slice(separator + 1).trim());
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function createSessionCookie(
  token: string,
  config: SessionCookieConfig,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeCookieValue(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.sameSite}`,
    `Max-Age=${config.maxAgeSeconds}`,
  ];
  if (config.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(config: SessionCookieConfig): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.sameSite}`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (config.secure) parts.push("Secure");
  return parts.join("; ");
}
