import type { SessionCookieConfig } from "./sessionCookie.ts";
import type { RateLimitConfig } from "./rateLimiter.ts";
import { parseSocialTokenEncryptionKey } from "./socialTokenCrypto.ts";
import type { MetaOAuthConfig } from "./metaOAuthClient.ts";
import { isAbsolute, resolve } from "node:path";
import type { MediaLimits } from "./mediaStorage.ts";

export type DatabaseConfig = {
  databaseUrl: string;
};

export type ServerConfig = DatabaseConfig & {
  authRateLimit: RateLimitConfig;
  corsOrigin: string;
  host: string;
  mediaLimits: MediaLimits;
  mediaStoragePath: string;
  metaOAuth: MetaOAuthConfig;
  port: number;
  sessionCookie: SessionCookieConfig;
  sessionTtlSeconds: number;
  socialTokenEncryptionKey: Buffer;
  trustProxy: boolean;
};

function parseInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} deve ser um inteiro entre 1 e ${maximum}.`);
  }

  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new Error(`${name} deve ser um inteiro entre 1 e ${maximum}.`);
  }
  return parsed;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return 3001;
  if (!/^\d+$/.test(value)) {
    throw new Error("PORT deve ser um número inteiro entre 1 e 65535.");
  }

  const port = Number(value);
  if (port < 1 || port > 65_535) {
    throw new Error("PORT deve ser um número inteiro entre 1 e 65535.");
  }

  return port;
}

function parseCorsOrigin(value: string | undefined): string {
  const configuredOrigin = value?.trim() || "http://localhost:5173";

  try {
    const url = new URL(configuredOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw null;
    return url.origin;
  } catch {
    throw new Error("CORS_ORIGIN deve ser uma origem HTTP válida.");
  }
}

function parseBoolean(
  name: string,
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} deve ser "true" ou "false".`);
}

function parseSessionTtlHours(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 24 * 7;
  if (!/^\d+$/.test(value)) {
    throw new Error("SESSION_TTL_HOURS deve ser um inteiro entre 1 e 720.");
  }
  const hours = Number(value);
  if (hours < 1 || hours > 720) {
    throw new Error("SESSION_TTL_HOURS deve ser um inteiro entre 1 e 720.");
  }
  return hours;
}

function parseSameSite(
  value: string | undefined,
): SessionCookieConfig["sameSite"] {
  const normalized = value?.trim().toLowerCase() || "lax";
  if (normalized === "lax") return "Lax";
  if (normalized === "strict") return "Strict";
  if (normalized === "none") return "None";
  throw new Error(
    'SESSION_COOKIE_SAME_SITE deve ser "lax", "strict" ou "none".',
  );
}

function parseMetaGraphApiVersion(value: string | undefined): string {
  const version = value?.trim() || "v26.0";
  if (!/^v\d{1,3}\.\d{1,3}$/.test(version)) {
    throw new Error('META_GRAPH_API_VERSION deve usar o formato "v26.0".');
  }
  return version;
}

function parseMetaRedirectUri(value: string | undefined): string | null {
  const configured = value?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      throw null;
    }
    return url.toString();
  } catch {
    throw new Error(
      "META_OAUTH_REDIRECT_URI deve ser uma URL HTTP sem query ou fragmento.",
    );
  }
}

function loadMetaOAuthConfig(
  environment: NodeJS.ProcessEnv,
): MetaOAuthConfig {
  const enabled = parseBoolean(
    "META_OAUTH_ENABLED",
    environment.META_OAUTH_ENABLED,
    false,
  );
  const appId = environment.META_APP_ID?.trim() || null;
  const appSecret = environment.META_APP_SECRET?.trim() || null;
  const redirectUri = parseMetaRedirectUri(environment.META_OAUTH_REDIRECT_URI);
  const configuredCredentials = [appId, appSecret, redirectUri].filter(Boolean);
  if (configuredCredentials.length > 0 && configuredCredentials.length < 3) {
    throw new Error(
      "META_APP_ID, META_APP_SECRET e META_OAUTH_REDIRECT_URI devem ser configurados juntos.",
    );
  }
  if (enabled && configuredCredentials.length !== 3) {
    throw new Error(
      "META_OAUTH_ENABLED=true exige META_APP_ID, META_APP_SECRET e META_OAUTH_REDIRECT_URI.",
    );
  }
  if (appId && !/^\d{5,64}$/.test(appId)) {
    throw new Error("META_APP_ID deve conter somente dígitos.");
  }
  if (
    appSecret &&
    (appSecret.length < 16 ||
      appSecret.length > 256 ||
      /\s/.test(appSecret))
  ) {
    throw new Error("META_APP_SECRET possui formato inválido.");
  }

  return {
    appId,
    appSecret,
    enabled,
    graphApiVersion: parseMetaGraphApiVersion(
      environment.META_GRAPH_API_VERSION,
    ),
    redirectUri,
    stateTtlSeconds: parseInteger(
      "OAUTH_STATE_TTL_SECONDS",
      environment.OAUTH_STATE_TTL_SECONDS,
      600,
      3_600,
    ),
  };
}

export function loadDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL deve ser definida para iniciar o backend.");
  }

  try {
    const parsed = new URL(databaseUrl);
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      parsed.pathname.replace(/^\/+/, "").length === 0
    ) {
      throw null;
    }
  } catch {
    throw new Error("DATABASE_URL deve ser uma URL PostgreSQL válida.");
  }

  return { databaseUrl };
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const production = environment.NODE_ENV === "production";
  if (production && !environment.CORS_ORIGIN?.trim()) {
    throw new Error("CORS_ORIGIN deve ser definida em produção.");
  }
  const secure = parseBoolean(
    "SESSION_COOKIE_SECURE",
    environment.SESSION_COOKIE_SECURE,
    production,
  );
  const sameSite = parseSameSite(environment.SESSION_COOKIE_SAME_SITE);
  if (production && !secure) {
    throw new Error(
      "SESSION_COOKIE_SECURE não pode ser false em produção.",
    );
  }
  if (sameSite === "None" && !secure) {
    throw new Error('SameSite="None" exige SESSION_COOKIE_SECURE=true.');
  }
  const metaOAuth = loadMetaOAuthConfig(environment);
  if (metaOAuth.enabled && sameSite === "Strict") {
    throw new Error(
      'SESSION_COOKIE_SAME_SITE="strict" é incompatível com o callback OAuth Meta; use "lax" ou "none" com cookie Secure.',
    );
  }
  const sessionTtlHours = parseSessionTtlHours(environment.SESSION_TTL_HOURS);
  const mediaStoragePath = environment.MEDIA_STORAGE_PATH?.trim();
  if (production && !mediaStoragePath) {
    throw new Error("MEDIA_STORAGE_PATH deve ser definida em produção.");
  }
  if (production && mediaStoragePath && !isAbsolute(mediaStoragePath)) {
    throw new Error("MEDIA_STORAGE_PATH deve ser um caminho absoluto em produção.");
  }
  const imageBytes = parseInteger("MEDIA_MAX_IMAGE_BYTES", environment.MEDIA_MAX_IMAGE_BYTES, 25 * 1024 * 1024, 250 * 1024 * 1024);
  const videoBytes = parseInteger("MEDIA_MAX_VIDEO_BYTES", environment.MEDIA_MAX_VIDEO_BYTES, 250 * 1024 * 1024, 1024 * 1024 * 1024);
  if (imageBytes > videoBytes) {
    throw new Error("MEDIA_MAX_IMAGE_BYTES não pode exceder MEDIA_MAX_VIDEO_BYTES.");
  }
  const rateLimitWindowSeconds = parseInteger(
    "AUTH_RATE_LIMIT_WINDOW_SECONDS",
    environment.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    60,
    86_400,
  );

  return {
    ...loadDatabaseConfig(environment),
    authRateLimit: {
      maxAttempts: parseInteger(
        "AUTH_RATE_LIMIT_MAX_ATTEMPTS",
        environment.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
        10,
        10_000,
      ),
      windowMs: rateLimitWindowSeconds * 1000,
    },
    corsOrigin: parseCorsOrigin(environment.CORS_ORIGIN),
    host: environment.HOST?.trim() || "127.0.0.1",
    mediaLimits: {
      imageBytes,
      videoBytes,
    },
    mediaStoragePath: resolve(mediaStoragePath || "data/media"),
    metaOAuth,
    port: parsePort(environment.PORT),
    sessionCookie: {
      maxAgeSeconds: sessionTtlHours * 60 * 60,
      sameSite,
      secure,
    },
    sessionTtlSeconds: sessionTtlHours * 60 * 60,
    socialTokenEncryptionKey: parseSocialTokenEncryptionKey(
      environment.SOCIAL_TOKEN_ENCRYPTION_KEY,
    ),
    trustProxy: parseBoolean(
      "TRUST_PROXY",
      environment.TRUST_PROXY,
      false,
    ),
  };
}
