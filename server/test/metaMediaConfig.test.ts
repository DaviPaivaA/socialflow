import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/config.ts";

const key = Buffer.alloc(32, 31).toString("base64");
const base = { DATABASE_URL: "postgres://localhost/socialflow_test", SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
const enabled = { ...base, NODE_ENV: "test", META_OAUTH_ENABLED: "true", META_APP_ID: "123456", META_APP_SECRET: "a".repeat(32), META_OAUTH_REDIRECT_URI: "https://app.example.com/auth/meta/callback", META_MEDIA_PUBLIC_ORIGIN: "https://media.example.com", META_MEDIA_SIGNING_KEY: key };

describe("Meta media configuration", () => {
  it("keeps existing Facebook configuration usable without the pair", () => {
    expect(loadServerConfig(base).metaMedia).toBeNull();
  });
  it("loads a dedicated key and bounded default TTL", () => {
    expect(loadServerConfig(enabled).metaMedia).toEqual({ publicOrigin: "https://media.example.com", signingKey: Buffer.alloc(32, 31), ttlSeconds: 3600 });
  });
  it.each([
    { META_MEDIA_PUBLIC_ORIGIN: "" }, { META_MEDIA_SIGNING_KEY: "" },
    { META_MEDIA_SIGNING_KEY: "private-invalid-key" }, { META_MEDIA_SIGNING_KEY: key.replace(/=$/, "") },
    { META_MEDIA_SIGNING_KEY: base.SOCIAL_TOKEN_ENCRYPTION_KEY },
    { META_MEDIA_SIGNING_KEY: base.SOCIAL_TOKEN_ENCRYPTION_KEY, SOCIAL_TOKEN_ENCRYPTION_KEY: ` ${base.SOCIAL_TOKEN_ENCRYPTION_KEY} ` },
    { META_APP_SECRET: ` ${key} ` },
    { META_OAUTH_ENABLED: "false" }, { META_MEDIA_URL_TTL_SECONDS: "1799" },
    { META_MEDIA_URL_TTL_SECONDS: "7201" }, { META_MEDIA_URL_TTL_SECONDS: "3600.1" },
    { META_MEDIA_PUBLIC_ORIGIN: "https://media.example.com/path" },
    { META_MEDIA_PUBLIC_ORIGIN: "https://media.example.com/a/.." },
    { META_MEDIA_PUBLIC_ORIGIN: "https://media.example.com/?" },
    { META_MEDIA_PUBLIC_ORIGIN: "https://media.example.com/#" },
    { META_MEDIA_PUBLIC_ORIGIN: "https://media.example.com/?ticket=secret" },
    { META_MEDIA_PUBLIC_ORIGIN: "https://user:secret@media.example.com" },
    { META_MEDIA_PUBLIC_ORIGIN: "http://media.example.com" },
  ])("rejects unsafe configuration without exposing values %j", overrides => {
    expect(() => loadServerConfig({ ...enabled, ...overrides })).toThrow();
    try { loadServerConfig({ ...enabled, ...overrides }); } catch (error) {
      expect(String(error)).not.toContain(key);
      expect(String(error)).not.toContain("private-invalid-key");
      expect(String(error)).not.toContain("ticket=secret");
    }
  });
  it.each(["https://localhost", "https://localhost.", "https://127.0.0.1", "https://10.0.0.1", "https://192.168.1.1", "https://172.16.0.1", "https://[::1]", "https://[fc00::1]", "https://169.254.1.1", "https://media.local", "https://media.local.", "https://media.internal", "https://media.home", "https://media.lan", "https://media"])("rejects local production origin %s", origin => {
    expect(() => loadServerConfig({ ...enabled, NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com", MEDIA_STORAGE_PATH: "/tmp/media", META_MEDIA_PUBLIC_ORIGIN: origin })).toThrow();
  });
  it.each(["https://8.8.8.8", "https://[2606:4700:4700::1111]"])("does not confuse a public IP with a private address %s", origin => {
    expect(loadServerConfig({ ...enabled, NODE_ENV: "production", CORS_ORIGIN: "https://app.example.com", MEDIA_STORAGE_PATH: "/tmp/media", META_MEDIA_PUBLIC_ORIGIN: origin }).metaMedia?.publicOrigin).toBe(origin);
  });
  it("allows HTTP loopback only with explicit development/test environment", () => {
    expect(loadServerConfig({ ...enabled, META_MEDIA_PUBLIC_ORIGIN: "http://127.0.0.1:3333" }).metaMedia?.publicOrigin).toBe("http://127.0.0.1:3333");
    expect(() => loadServerConfig({ ...enabled, NODE_ENV: undefined, META_MEDIA_PUBLIC_ORIGIN: "http://127.0.0.1:3333" })).toThrow();
  });
  it.each(["1800", "7200"])("accepts TTL boundary %s", ttl => {
    expect(loadServerConfig({ ...enabled, META_MEDIA_URL_TTL_SECONDS: ttl }).metaMedia?.ttlSeconds).toBe(Number(ttl));
  });
});
