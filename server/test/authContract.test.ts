import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  validateLoginInput,
  validateRegisterInput,
  validateSelectWorkspaceInput,
} from "../src/authContract.ts";
import { loadServerConfig } from "../src/config.ts";
import { InMemoryRateLimiter } from "../src/rateLimiter.ts";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionToken,
} from "../src/sessionCookie.ts";

describe("contrato de autenticação", () => {
  it("normaliza email e nome no cadastro", () => {
    expect(
      validateRegisterInput({
        displayName: "  Davi Alvares  ",
        email: "  DAVI@EXAMPLE.COM  ",
        password: "senha-segura-123",
      }),
    ).toEqual({
      data: {
        displayName: "Davi Alvares",
        email: "davi@example.com",
        password: "senha-segura-123",
      },
      success: true,
    });
  });

  it("rejeita nome, email e senha inválidos", () => {
    expect(
      validateRegisterInput({
        displayName: "D",
        email: "email-invalido",
        password: "curta",
      }),
    ).toEqual({
      fields: ["displayName", "email", "password"],
      success: false,
    });
  });

  it("usa a mesma validação de credenciais no login", () => {
    expect(
      validateLoginInput({
        email: " USUARIO@EXAMPLE.COM ",
        password: "senha-segura-123",
      }),
    ).toEqual({
      data: {
        email: "usuario@example.com",
        password: "senha-segura-123",
      },
      success: true,
    });
  });

  it("aceita somente UUID no seletor de workspace", () => {
    const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(validateSelectWorkspaceInput({ tenantId })).toEqual({
      data: { tenantId },
      success: true,
    });
    expect(validateSelectWorkspaceInput({ tenantId: "tenant-a" })).toEqual({
      fields: ["tenantId"],
      success: false,
    });
    expect(validateSelectWorkspaceInput(null)).toEqual({
      fields: ["tenantId"],
      success: false,
    });
  });
});

describe("cookie de sessão", () => {
  const token = "a".repeat(43);

  it("cria cookie HttpOnly com atributos locais seguros", () => {
    expect(
      createSessionCookie(token, {
        maxAgeSeconds: 3_600,
        sameSite: "Lax",
        secure: false,
      }),
    ).toBe(
      `socialflow_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
    );
  });

  it("lê apenas tokens no formato esperado e expira o cookie", () => {
    const request = {
      headers: { cookie: `outro=valor; socialflow_session=${token}` },
    } as IncomingMessage;
    expect(readSessionToken(request)).toBe(token);
    expect(
      clearSessionCookie({
        maxAgeSeconds: 3_600,
        sameSite: "None",
        secure: true,
      }),
    ).toContain("Max-Age=0");
    expect(
      clearSessionCookie({
        maxAgeSeconds: 3_600,
        sameSite: "None",
        secure: true,
      }),
    ).toContain("Secure");
  });
});

describe("configuração de sessão", () => {
  const baseEnvironment = {
    DATABASE_URL: "postgresql://example.test/socialflow",
    SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
  };

  it("exige storage absoluto em produção e valida os limites de mídia", () => {
    const production = {
      ...baseEnvironment,
      CORS_ORIGIN: "https://app.example.com",
      NODE_ENV: "production",
    };
    expect(() => loadServerConfig(production)).toThrow("MEDIA_STORAGE_PATH deve ser definida em produção");
    expect(() => loadServerConfig({ ...production, MEDIA_STORAGE_PATH: "./data/media" })).toThrow("MEDIA_STORAGE_PATH deve ser um caminho absoluto");
    const config = loadServerConfig({ ...production, MEDIA_STORAGE_PATH: "/srv/socialflow/media" });
    expect(config.mediaLimits).toEqual({ imageBytes: 25 * 1024 * 1024, videoBytes: 250 * 1024 * 1024 });
    expect(() => loadServerConfig({ ...baseEnvironment, MEDIA_MAX_IMAGE_BYTES: "0" })).toThrow("MEDIA_MAX_IMAGE_BYTES");
    expect(() => loadServerConfig({ ...baseEnvironment, MEDIA_MAX_IMAGE_BYTES: "100", MEDIA_MAX_VIDEO_BYTES: "50" })).toThrow("não pode exceder");
  });

  it("exige cookie Secure em produção", () => {
    expect(() =>
      loadServerConfig({
        CORS_ORIGIN: "https://app.example.com",
        DATABASE_URL: "postgresql://example.test/socialflow",
        NODE_ENV: "production",
        SESSION_COOKIE_SECURE: "false",
      }),
    ).toThrow("SESSION_COOKIE_SECURE não pode ser false em produção");
  });

  it("exige CORS_ORIGIN explícita em produção", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        SESSION_COOKIE_SECURE: "true",
      }),
    ).toThrow("CORS_ORIGIN deve ser definida em produção");
  });

  it("rejeita DATABASE_URL incompatível antes de iniciar o servidor", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        DATABASE_URL: "https://database.example.test/socialflow",
      }),
    ).toThrow("DATABASE_URL deve ser uma URL PostgreSQL válida");
  });

  it("não aceita SameSite=None sem Secure", () => {
    expect(() =>
      loadServerConfig({
        DATABASE_URL: "postgresql://example.test/socialflow",
        SESSION_COOKIE_SAME_SITE: "none",
        SESSION_COOKIE_SECURE: "false",
      }),
    ).toThrow('SameSite="None" exige SESSION_COOKIE_SECURE=true');
  });

  it("carrega limites de autenticação configuráveis", () => {
    const config = loadServerConfig({
      AUTH_RATE_LIMIT_MAX_ATTEMPTS: "7",
      AUTH_RATE_LIMIT_WINDOW_SECONDS: "90",
      DATABASE_URL: "postgresql://example.test/socialflow",
      SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
    });
    expect(config.authRateLimit).toEqual({
      maxAttempts: 7,
      windowMs: 90_000,
    });
    expect(config.socialTokenEncryptionKey).toEqual(Buffer.alloc(32, 4));
  });

  it("só confia no proxy quando configurado explicitamente", () => {
    expect(loadServerConfig(baseEnvironment).trustProxy).toBe(false);
    expect(
      loadServerConfig({ ...baseEnvironment, TRUST_PROXY: "true" }).trustProxy,
    ).toBe(true);
    expect(() =>
      loadServerConfig({ ...baseEnvironment, TRUST_PROXY: "yes" }),
    ).toThrow('TRUST_PROXY deve ser "true" ou "false"');
  });

  it("mantém OAuth Meta desabilitado sem exigir credenciais", () => {
    const config = loadServerConfig(baseEnvironment);

    expect(config.metaOAuth).toEqual({
      appId: null,
      appSecret: null,
      enabled: false,
      graphApiVersion: "v26.0",
      redirectUri: null,
      stateTtlSeconds: 600,
    });
  });

  it("valida e centraliza a configuração OAuth Meta habilitada", () => {
    const config = loadServerConfig({
      ...baseEnvironment,
      META_APP_ID: "123456789012345",
      META_APP_SECRET: "segredo-meta-exclusivo-123456",
      META_GRAPH_API_VERSION: "v26.0",
      META_OAUTH_ENABLED: "true",
      META_OAUTH_REDIRECT_URI:
        "http://localhost:3001/auth/meta/callback",
      OAUTH_STATE_TTL_SECONDS: "900",
      SESSION_COOKIE_SAME_SITE: "lax",
    });

    expect(config.metaOAuth).toEqual({
      appId: "123456789012345",
      appSecret: "segredo-meta-exclusivo-123456",
      enabled: true,
      graphApiVersion: "v26.0",
      redirectUri: "http://localhost:3001/auth/meta/callback",
      stateTtlSeconds: 900,
    });
    expect(config.sessionCookie.sameSite).toBe("Lax");
  });

  it("rejeita SameSite=Strict quando OAuth Meta está habilitado", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        META_APP_ID: "123456789012345",
        META_APP_SECRET: "segredo-meta-exclusivo-123456",
        META_OAUTH_ENABLED: "true",
        META_OAUTH_REDIRECT_URI:
          "http://localhost:3001/auth/meta/callback",
        SESSION_COOKIE_SAME_SITE: "strict",
      }),
    ).toThrow(
      'SESSION_COOKIE_SAME_SITE="strict" é incompatível com o callback OAuth Meta',
    );
  });

  it("rejeita configuração Meta parcial ou versão inválida", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        META_APP_ID: "123456789012345",
      }),
    ).toThrow(
      "META_APP_ID, META_APP_SECRET e META_OAUTH_REDIRECT_URI devem ser configurados juntos",
    );

    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        META_GRAPH_API_VERSION: "latest",
      }),
    ).toThrow('META_GRAPH_API_VERSION deve usar o formato "v26.0"');
  });
});

describe("rate limiting", () => {
  it("reinicia a janela e mantém chaves independentes", () => {
    const limiter = new InMemoryRateLimiter({
      maxAttempts: 2,
      windowMs: 1_000,
    });
    expect(limiter.consume("login:ip", 1_000)).toEqual({ allowed: true });
    expect(limiter.consume("login:ip", 1_100)).toEqual({ allowed: true });
    expect(limiter.consume("login:ip", 1_200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("register:ip", 1_200)).toEqual({ allowed: true });
    expect(limiter.consume("login:ip", 2_000)).toEqual({ allowed: true });
  });
});
