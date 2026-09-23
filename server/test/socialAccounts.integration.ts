import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  isAuthSession,
  type AuthSession,
} from "../../shared/authContract.ts";
import {
  isSocialAccount,
  isSocialAccountsResponse,
  type SocialAccount,
  type SocialAccountsResponse,
} from "../../shared/socialAccountContract.ts";
import { createApiServer } from "../src/app.ts";
import { runMigrations } from "../src/migrations.ts";
import { PostgresSocialAccountsRepository } from "../src/postgresSocialAccountsRepository.ts";
import { SocialAccountsService } from "../src/socialAccountsService.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

type RegisteredAccount = {
  cookie: string;
  session: AuthSession;
};

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL não foi definida.");
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!name.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL deve apontar para um banco terminado em _test.");
  }
  const production = process.env.DATABASE_URL?.trim();
  if (production && new URL(production).href === parsed.href) {
    throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL.");
  }
  return value;
}

function assertSafeSchema(schema: string) {
  if (!/^socialflow_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error("Nome de schema de teste inválido.");
  }
}

function schemaPool(databaseUrl: string, schema: string) {
  assertSafeSchema(schema);
  return new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
  });
}

function apiFetch(input: string | URL | Request, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set("Origin", "http://localhost:5173");
  }
  return fetch(input, { ...init, headers });
}

function withCookie(cookie: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  return { ...init, headers };
}

function responseCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("A resposta não retornou cookie de sessão.");
  return cookie;
}

async function register(
  baseUrl: string,
  displayName: string,
  email: string,
): Promise<RegisteredAccount> {
  const response = await apiFetch(`${baseUrl}/auth/register`, {
    body: JSON.stringify({
      displayName,
      email,
      password: "senha-segura-123",
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  expect(isAuthSession(body)).toBe(true);
  return {
    cookie: responseCookie(response),
    session: body as AuthSession,
  };
}

async function listAccounts(
  baseUrl: string,
  cookie: string,
): Promise<SocialAccount[]> {
  const response = await apiFetch(
    `${baseUrl}/social-accounts`,
    withCookie(cookie),
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(isSocialAccountsResponse(body)).toBe(true);
  return (body as SocialAccountsResponse).socialAccounts;
}

describe("contas sociais HTTP com PostgreSQL", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("usa TEST_DATABASE_URL para executar a integração", () => undefined);
    return;
  }

  it("persiste segredos cifrados e isola contas por Workspace", async () => {
    const databaseUrl = requireTestDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    assertSafeSchema(schema);
    const adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const pool = schemaPool(databaseUrl, schema);
    const cipher = new SocialTokenCipher(Buffer.alloc(32, 19));
    const service = new SocialAccountsService(
      new PostgresSocialAccountsRepository(pool),
      cipher,
    );
    let server: Server | undefined;

    try {
      await runMigrations(pool);
      server = createApiServer({
        authRateLimit: { maxAttempts: 1_000, windowMs: 60_000 },
        corsOrigin: "http://localhost:5173",
        logger: { error: vi.fn() },
        pool,
        sessionCookie: {
          maxAgeSeconds: 3_600,
          sameSite: "Lax",
          secure: false,
        },
        sessionTtlSeconds: 3_600,
        socialTokenCipher: cipher,
      });
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server?.once("error", rejectPromise);
        server?.listen(0, "127.0.0.1", resolvePromise);
      });
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const user1 = await register(
        baseUrl,
        "Usuário Um",
        `user-1-${randomUUID()}@example.test`,
      );
      const user2 = await register(
        baseUrl,
        "Usuário Dois",
        `user-2-${randomUUID()}@example.test`,
      );
      const tenantA = user1.session.tenant.id;
      const tenantC = user2.session.tenant.id;
      const tenantB = randomUUID();
      await expect(listAccounts(baseUrl, user1.cookie)).resolves.toEqual([]);
      await pool.query(
        `
          INSERT INTO tenants (id, name, slug)
          VALUES ($1::uuid, 'Workspace B', $2)
        `,
        [tenantB, `workspace-b-${tenantB}`],
      );
      await pool.query(
        `
          INSERT INTO tenant_members (tenant_id, user_id, role, created_at)
          VALUES ($1::uuid, $2::uuid, 'admin', now() + interval '1 minute')
        `,
        [tenantB, user1.session.user.id],
      );

      const contextA = {
        authorUserId: user1.session.user.id,
        tenantId: tenantA,
      };
      const contextB = {
        authorUserId: user1.session.user.id,
        tenantId: tenantB,
      };
      const contextC = {
        authorUserId: user2.session.user.id,
        tenantId: tenantC,
      };
      const instagramA = await service.register(contextA, {
        accessToken: "plaintext-instagram-a",
        displayName: "Instagram A",
        provider: "instagram",
        providerAccountId: "instagram-a",
        providerMetadata: { accountType: "business" },
        refreshToken: "refresh-instagram-a",
        scopes: ["instagram_basic"],
        status: "connected",
        tokenExpiresAt: "2027-01-01T00:00:00.000Z",
        username: "instagram_a",
      });
      const facebookA = await service.register(contextA, {
        accessToken: "plaintext-facebook-a",
        displayName: "Facebook A",
        provider: "facebook",
        providerAccountId: "facebook-a",
        scopes: ["pages_show_list"],
        status: "connected",
      });
      const tiktokB = await service.register(contextB, {
        accessToken: "plaintext-tiktok-b",
        displayName: "TikTok B",
        provider: "tiktok",
        providerAccountId: "tiktok-b",
        status: "connected",
      });
      const instagramC = await service.register(contextC, {
        accessToken: "plaintext-instagram-c",
        displayName: "Instagram C",
        provider: "instagram",
        providerAccountId: "instagram-c",
        status: "connected",
      });
      await expect(
        service.register(contextA, {
          displayName: "Duplicada",
          provider: "instagram",
          providerAccountId: "instagram-a",
        }),
      ).rejects.toThrow("já foi registrada neste Workspace");

      const unauthenticated = await apiFetch(`${baseUrl}/social-accounts`);
      expect(unauthenticated.status).toBe(401);

      const accountsA = await listAccounts(baseUrl, user1.cookie);
      expect(accountsA.map((account) => account.id)).toEqual([
        instagramA.id,
        facebookA.id,
      ]);
      const serializedA = JSON.stringify(accountsA);
      expect(serializedA).not.toContain("plaintext");
      expect(serializedA).not.toContain("Encrypted");
      expect(serializedA).not.toContain("providerMetadata");

      const ownById = await apiFetch(
        `${baseUrl}/social-accounts/${instagramA.id}`,
        withCookie(user1.cookie),
      );
      expect(ownById.status).toBe(200);
      expect(isSocialAccount(await ownById.json())).toBe(true);

      for (const method of ["GET", "DELETE"]) {
        const crossTenant = await apiFetch(
          `${baseUrl}/social-accounts/${instagramC.id}`,
          withCookie(user1.cookie, { method }),
        );
        expect(crossTenant.status).toBe(404);
        await expect(crossTenant.json()).resolves.toEqual({
          error: {
            code: "social_account_not_found",
            message: "A conta social não foi encontrada.",
          },
        });
      }

      const invalidId = await apiFetch(
        `${baseUrl}/social-accounts/not-a-uuid`,
        withCookie(user1.cookie),
      );
      expect(invalidId.status).toBe(400);
      const missing = await apiFetch(
        `${baseUrl}/social-accounts/${randomUUID()}`,
        withCookie(user1.cookie),
      );
      expect(missing.status).toBe(404);

      const manipulated = await apiFetch(
        `${baseUrl}/social-accounts/${facebookA.id}`,
        withCookie(user1.cookie, {
          body: JSON.stringify({ tenantId: tenantB }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
      expect(manipulated.status).toBe(400);

      const update = await apiFetch(
        `${baseUrl}/social-accounts/${facebookA.id}`,
        withCookie(user1.cookie, {
          body: JSON.stringify({
            displayName: "Facebook atualizado",
            username: "facebook_atualizado",
          }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        }),
      );
      expect(update.status).toBe(200);
      await expect(update.json()).resolves.toEqual(
        expect.objectContaining({
          displayName: "Facebook atualizado",
          id: facebookA.id,
          username: "facebook_atualizado",
        }),
      );

      const selectB = await apiFetch(
        `${baseUrl}/auth/workspaces/select`,
        withCookie(user1.cookie, {
          body: JSON.stringify({ tenantId: tenantB }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      expect(selectB.status).toBe(200);
      const cookieB = responseCookie(selectB);
      expect((await listAccounts(baseUrl, cookieB)).map((account) => account.id)).toEqual([
        tiktokB.id,
      ]);
      const staleSession = await apiFetch(
        `${baseUrl}/social-accounts`,
        withCookie(user1.cookie),
      );
      expect(staleSession.status).toBe(401);

      const selectA = await apiFetch(
        `${baseUrl}/auth/workspaces/select`,
        withCookie(cookieB, {
          body: JSON.stringify({ tenantId: tenantA }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      );
      expect(selectA.status).toBe(200);
      const cookieA2 = responseCookie(selectA);
      const disconnect = await apiFetch(
        `${baseUrl}/social-accounts/${instagramA.id}`,
        withCookie(cookieA2, { method: "DELETE" }),
      );
      expect(disconnect.status).toBe(200);
      await expect(disconnect.json()).resolves.toEqual(
        expect.objectContaining({
          disconnectedAt: expect.any(String),
          id: instagramA.id,
          status: "revoked",
        }),
      );

      const accountsAfterDisconnect = await listAccounts(baseUrl, cookieA2);
      expect(accountsAfterDisconnect).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: instagramA.id, status: "revoked" }),
          expect.objectContaining({ id: facebookA.id, status: "connected" }),
        ]),
      );
      expect((await listAccounts(baseUrl, user2.cookie)).map((account) => account.id)).toEqual([
        instagramC.id,
      ]);

      const stored = await pool.query<{
        access_token_encrypted: Buffer | null;
        disconnected_at: Date | null;
        refresh_token_encrypted: Buffer | null;
        status: string;
        tenant_id: string;
      }>(
        `
          SELECT
            account_row.tenant_id,
            connection_row.status::text,
            credential_row.access_token_encrypted,
            credential_row.refresh_token_encrypted,
            account_row.disconnected_at
          FROM social_accounts account_row
          JOIN oauth_connections connection_row
            ON connection_row.tenant_id = account_row.tenant_id
           AND connection_row.id = account_row.oauth_connection_id
          JOIN social_account_credentials credential_row
            ON credential_row.tenant_id = account_row.tenant_id
           AND credential_row.social_account_id = account_row.id
          WHERE account_row.id = $1::uuid
        `,
        [instagramA.id],
      );
      expect(stored.rows[0]).toEqual(
        expect.objectContaining({
          access_token_encrypted: null,
          disconnected_at: expect.any(Date),
          refresh_token_encrypted: null,
          status: "revoked",
          tenant_id: tenantA,
        }),
      );

      const encryptedFacebook = await pool.query<{
        access_token_encrypted: Buffer;
      }>(
        `
          SELECT access_token_encrypted
          FROM social_account_credentials
          WHERE social_account_id = $1::uuid
        `,
        [facebookA.id],
      );
      const encrypted = encryptedFacebook.rows[0]?.access_token_encrypted;
      expect(encrypted).toBeInstanceOf(Buffer);
      const encryptedPayload = encrypted?.toString("utf8") ?? "";
      expect(encryptedPayload).toMatch(/^v1\./);
      expect(encryptedPayload).not.toContain("plaintext-facebook-a");
      expect(cipher.decryptSecret(encryptedPayload)).toBe("plaintext-facebook-a");

      await pool.query(
        `UPDATE social_account_credentials
         SET access_token_expires_at = now() - interval '1 second'
         WHERE social_account_id = $1::uuid`,
        [facebookA.id],
      );
      const expiredResponse = await apiFetch(
        `${baseUrl}/social-accounts/${facebookA.id}`,
        withCookie(cookieA2),
      );
      expect(expiredResponse.status).toBe(200);
      const expiredPayload: unknown = await expiredResponse.json();
      expect(expiredPayload).toEqual(expect.objectContaining({ status: "expired" }));
      expect(isSocialAccount(expiredPayload)).toBe(true);
      expect(JSON.stringify(expiredPayload)).not.toMatch(/accessToken|refreshToken|Encrypted|providerMetadata/);
      expect((await listAccounts(baseUrl, cookieA2)).find((account) => account.id === facebookA.id)?.status).toBe("expired");

      await pool.query(
        `UPDATE social_account_credentials
         SET access_token_expires_at = NULL
         WHERE social_account_id = $1::uuid`,
        [facebookA.id],
      );
      const noExpiry = await apiFetch(
        `${baseUrl}/social-accounts/${facebookA.id}`,
        withCookie(cookieA2),
      );
      expect(noExpiry.status).toBe(200);
      await expect(noExpiry.json()).resolves.toEqual(
        expect.objectContaining({ status: "connected", tokenExpiresAt: null }),
      );

      const indexes = await pool.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'social_accounts'
      `);
      expect(indexes.rows.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          "idx_social_accounts_tenant",
          "idx_social_accounts_tenant_provider",
          "social_accounts_external_account_unique",
        ]),
      );
    } finally {
      if (server) {
        await new Promise<void>((resolvePromise, rejectPromise) => {
          server?.close((error) =>
            error ? rejectPromise(error) : resolvePromise(),
          );
        });
      }
      await pool.end();
      assertSafeSchema(schema);
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });
});
