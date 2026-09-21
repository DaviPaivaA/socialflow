import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/data/api/apiClient.ts";
import { HttpPostsRepository } from "../../src/data/posts/HttpPostsRepository.ts";
import type { CreatePostInput } from "../../src/data/posts/PostsRepository.ts";
import {
  isAuthSession,
  type AuthSession,
} from "../../shared/authContract.ts";
import { createApiServer } from "../src/app.ts";
import { runMigrations } from "../src/migrations.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

type RunningApi = {
  baseUrl: string;
  pool: Pool;
  server: Server;
};

const INPUT: CreatePostInput = {
  caption: "Conteúdo que deve sobreviver ao reinício.",
  scheduledFor: "2027-08-13T10:30:00-03:00",
  status: "scheduled",
  title: "Publicação persistente",
};

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL não foi definida.");

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL deve apontar para um banco terminado em _test.");
  }

  const databaseIdentity = (url: URL) => {
    const host = url.searchParams.get("host") ?? url.hostname.toLowerCase();
    const port = url.port || "5432";
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    return `${host}:${port}/${name}`;
  };
  const productionUrl = process.env.DATABASE_URL?.trim();
  if (
    productionUrl &&
    databaseIdentity(new URL(productionUrl)) === databaseIdentity(parsed)
  ) {
    throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL.");
  }

  return value;
}

function assertSafeSchemaName(schema: string) {
  if (!/^socialflow_test_[a-z0-9_]+$/.test(schema)) {
    throw new Error("Nome de schema de teste inválido.");
  }
}

function schemaPool(databaseUrl: string, schema: string) {
  assertSafeSchemaName(schema);
  return new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
  });
}

async function startApi(
  databaseUrl: string,
  schema: string,
): Promise<RunningApi> {
  const pool = schemaPool(databaseUrl, schema);
  const server = createApiServer({
    authRateLimit: { maxAttempts: 1_000, windowMs: 60_000 },
    corsOrigin: "http://localhost:5173",
    logger: { error: vi.fn() },
    pool,
    sessionCookie: {
      maxAgeSeconds: 60 * 60,
      sameSite: "Lax",
      secure: false,
    },
    sessionTtlSeconds: 60 * 60,
    socialTokenCipher: new SocialTokenCipher(Buffer.alloc(32, 7)),
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => rejectPromise(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });

  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, pool, server };
}

function apiFetch(input: string | URL | Request, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set("Origin", "http://localhost:5173");
  }
  return fetch(input, { ...init, headers });
}

function cookieFetch(cookie: string): typeof fetch {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", cookie);
    return apiFetch(input, { ...init, headers });
  };
}

async function registerUser(
  baseUrl: string,
  displayName: string,
  email: string,
): Promise<{ cookie: string; session: AuthSession }> {
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
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toMatch(/^socialflow_session=/);
  const body: unknown = await response.json();
  expect(isAuthSession(body)).toBe(true);
  return { cookie: cookie!, session: body as AuthSession };
}

async function stopApi(api: RunningApi): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    api.server.close((error) =>
      error ? rejectPromise(error) : resolvePromise(),
    );
  });
  await api.pool.end();
}

async function createSchema(databaseUrl: string, schema: string) {
  assertSafeSchemaName(schema);
  const adminPool = new Pool({ connectionString: databaseUrl });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  return adminPool;
}

async function dropSchema(adminPool: Pool, schema: string) {
  assertSafeSchemaName(schema);
  await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
}

async function expectOfficialSchema(pool: Pool) {
  const columns = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: "NO" | "YES";
    table_name: string;
    udt_name: string;
  }>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ANY (
        ARRAY[
          'users',
          'tenants',
          'tenant_members',
          'posts',
          'oauth_connections',
          'oauth_authorization_requests',
          'social_accounts',
          'social_account_credentials'
        ]
      )
  `);
  const byColumn = new Map(
    columns.rows.map((column) => [
      `${column.table_name}.${column.column_name}`,
      column,
    ]),
  );

  expect(byColumn.get("users.id")?.data_type).toBe("uuid");
  expect(byColumn.get("users.password_hash")?.is_nullable).toBe("NO");
  expect(byColumn.get("tenants.id")?.data_type).toBe("uuid");
  expect(byColumn.get("tenant_members.id")?.data_type).toBe("uuid");
  expect(byColumn.get("tenant_members.tenant_id")?.data_type).toBe("uuid");
  expect(byColumn.get("tenant_members.user_id")?.data_type).toBe("uuid");
  expect(byColumn.get("posts.id")?.data_type).toBe("uuid");
  expect(byColumn.get("posts.tenant_id")?.data_type).toBe("uuid");
  expect(byColumn.get("posts.author_user_id")?.data_type).toBe("uuid");
  expect(byColumn.get("posts.author_user_id")?.is_nullable).toBe("NO");
  expect(byColumn.get("posts.scheduled_for")?.data_type).toBe(
    "timestamp with time zone",
  );
  expect(byColumn.has("posts.created_by_user_id")).toBe(false);
  expect(byColumn.has("posts.scheduled_at")).toBe(false);
  expect(byColumn.has("posts.channels")).toBe(false);
  expect(byColumn.has("posts.color")).toBe(false);
  expect(byColumn.get("social_accounts.id")?.data_type).toBe("uuid");
  expect(byColumn.get("social_accounts.tenant_id")?.data_type).toBe("uuid");
  expect(byColumn.get("social_accounts.oauth_connection_id")?.data_type).toBe(
    "uuid",
  );
  expect(byColumn.get("social_accounts.metadata")?.data_type).toBe(
    "jsonb",
  );
  expect(byColumn.get("social_accounts.disconnected_at")?.data_type).toBe(
    "timestamp with time zone",
  );
  expect(byColumn.get("oauth_connections.created_by_user_id")?.data_type).toBe(
    "uuid",
  );
  expect(byColumn.get("oauth_connections.access_token_encrypted")?.data_type).toBe(
    "bytea",
  );
  expect(byColumn.get("oauth_connections.access_token_encrypted")?.is_nullable).toBe(
    "YES",
  );
  expect(byColumn.get("oauth_connections.scopes")?.data_type).toBe("ARRAY");
  expect(byColumn.get("oauth_authorization_requests.id")?.data_type).toBe(
    "uuid",
  );
  expect(
    byColumn.get("oauth_authorization_requests.auth_session_id")?.data_type,
  ).toBe("uuid");
  expect(
    byColumn.get("oauth_authorization_requests.membership_id")?.data_type,
  ).toBe("uuid");
  expect(
    byColumn.get("oauth_authorization_requests.expires_at")?.data_type,
  ).toBe("timestamp with time zone");
  expect(
    byColumn.get("oauth_authorization_requests.consumed_at")?.is_nullable,
  ).toBe("YES");
  expect(
    byColumn.get("social_account_credentials.access_token_encrypted")?.data_type,
  ).toBe("bytea");
  expect(
    byColumn.get("social_account_credentials.access_token_encrypted")?.is_nullable,
  ).toBe("YES");
  expect(
    byColumn.get("social_account_credentials.social_account_id")?.data_type,
  ).toBe("uuid");

  const sessionColumns = await pool.query<{
    column_name: string;
    data_type: string;
  }>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'auth_sessions'
  `);
  const sessionsByColumn = new Map(
    sessionColumns.rows.map((column) => [column.column_name, column.data_type]),
  );
  expect(sessionsByColumn.get("id")).toBe("uuid");
  expect(sessionsByColumn.get("membership_id")).toBe("uuid");
  expect(sessionsByColumn.get("expires_at")).toBe("timestamp with time zone");

  const statuses = await pool.query<{ enumlabel: string }>(`
    SELECT enum_row.enumlabel
    FROM pg_type type_row
    JOIN pg_enum enum_row ON enum_row.enumtypid = type_row.oid
    JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = current_schema()
      AND type_row.typname = 'post_status'
    ORDER BY enum_row.enumsortorder
  `);
  expect(statuses.rows.map((row) => row.enumlabel)).toEqual([
    "draft",
    "scheduled",
    "publishing",
    "published",
    "partially_failed",
    "failed",
    "cancelled",
  ]);

  const constraints = await pool.query<{
    conname: string;
    definition: string;
  }>(`
    SELECT conname, pg_get_constraintdef(oid, true) AS definition
    FROM pg_constraint
    WHERE conrelid IN ('tenant_members'::regclass, 'posts'::regclass)
  `);
  const byName = new Map(
    constraints.rows.map((constraint) => [
      constraint.conname,
      constraint.definition,
    ]),
  );
  expect(byName.get("tenant_members_pkey")).toBe("PRIMARY KEY (id)");
  expect(byName.get("posts_tenant_id_fkey")).toContain(
    "FOREIGN KEY (tenant_id) REFERENCES tenants(id)",
  );
  expect(byName.get("posts_author_user_id_fkey")).toContain(
    "FOREIGN KEY (author_user_id) REFERENCES users(id)",
  );

  const socialConstraints = await pool.query<{
    conname: string;
    definition: string;
  }>(`
    SELECT conname, pg_get_constraintdef(oid, true) AS definition
    FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
  `);
  const socialByName = new Map(
    socialConstraints.rows.map((constraint) => [
      constraint.conname,
      constraint.definition,
    ]),
  );
  expect(
    socialByName.get(
      "social_accounts_tenant_id_oauth_connection_id_fkey",
    ),
  ).toContain(
    "REFERENCES oauth_connections(tenant_id, id) ON DELETE CASCADE",
  );
  expect(socialByName.get("social_accounts_external_account_unique")).toContain(
    "UNIQUE (tenant_id, account_type, external_account_id)",
  );

  const oauthRequestConstraints = await pool.query<{
    conname: string;
    definition: string;
  }>(`
    SELECT conname, pg_get_constraintdef(oid, true) AS definition
    FROM pg_constraint
    WHERE conrelid = 'oauth_authorization_requests'::regclass
  `);
  const oauthRequestByName = new Map(
    oauthRequestConstraints.rows.map((constraint) => [
      constraint.conname,
      constraint.definition,
    ]),
  );
  expect(
    oauthRequestByName.get("oauth_authorization_requests_state_hash_key"),
  ).toContain("UNIQUE (state_hash)");
  expect(
    oauthRequestByName.get("oauth_authorization_requests_session_fkey"),
  ).toContain(
    "FOREIGN KEY (auth_session_id, membership_id) REFERENCES auth_sessions(id, membership_id) ON DELETE CASCADE",
  );

  const socialEnums = await pool.query<{
    enumlabel: string;
    typname: string;
  }>(`
    SELECT type_row.typname, enum_row.enumlabel
    FROM pg_type type_row
    JOIN pg_enum enum_row ON enum_row.enumtypid = type_row.oid
    JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = current_schema()
      AND type_row.typname IN (
        'social_platform',
        'social_account_type',
        'oauth_connection_status'
      )
    ORDER BY type_row.typname, enum_row.enumsortorder
  `);
  expect(
    socialEnums.rows
      .filter((row) => row.typname === "social_account_type")
      .map((row) => row.enumlabel),
  ).toEqual(["facebook_page", "instagram_business", "tiktok_account"]);
  expect(
    socialEnums.rows
      .filter((row) => row.typname === "oauth_connection_status")
      .map((row) => row.enumlabel),
  ).toEqual(["pending", "active", "expired", "revoked", "error"]);
}

describe("API com PostgreSQL e schema oficial", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("usa TEST_DATABASE_URL para executar a integração", () => undefined);
    return;
  }

  it("migra instalação nova, usa UUID e isola criação/listagem por tenant", async () => {
    const databaseUrl = requireTestDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const adminPool = await createSchema(databaseUrl, schema);
    const migrationPool = schemaPool(databaseUrl, schema);
    const runningApis: RunningApi[] = [];

    try {
      await runMigrations(migrationPool);
      await runMigrations(migrationPool);
      await expectOfficialSchema(migrationPool);

      const migrationResult = await migrationPool.query<{ count: string }>(`
        SELECT count(*)::text AS count FROM schema_migrations
      `);
      expect(migrationResult.rows[0]?.count).toBe("7");

      const apiA = await startApi(databaseUrl, schema);
      runningApis.push(apiA);
      const accountA = await registerUser(
        apiA.baseUrl,
        "Autora A",
        `author-a-${randomUUID()}@example.test`,
      );
      const accountB = await registerUser(
        apiA.baseUrl,
        "Autor B",
        `author-b-${randomUUID()}@example.test`,
      );
      const repositoryA = new HttpPostsRepository(
        new ApiClient({
          baseUrl: apiA.baseUrl,
          fetchImpl: cookieFetch(accountA.cookie),
        }),
      );
      const repositoryB = new HttpPostsRepository(
        new ApiClient({
          baseUrl: apiA.baseUrl,
          fetchImpl: cookieFetch(accountB.cookie),
        }),
      );

      const healthResponse = await apiFetch(`${apiA.baseUrl}/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toEqual({ status: "ok" });

      const invalidResponse = await apiFetch(`${apiA.baseUrl}/posts`, {
        body: JSON.stringify({
          ...INPUT,
          scheduledFor: "2027-02-30T10:30:00-03:00",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: accountA.cookie,
        },
        method: "POST",
      });
      expect(invalidResponse.status).toBe(400);
      await expect(invalidResponse.json()).resolves.toEqual({
        error: {
          code: "invalid_post",
          fields: ["scheduledFor"],
          message: "Os dados da publicação são inválidos.",
        },
      });

      for (const scheduledFor of [
        "2027-08-13T10:30:00+16:00",
        "9999-12-31T23:59:59-03:00",
      ]) {
        const invalidTimestampResponse = await apiFetch(
          `${apiA.baseUrl}/posts`,
          {
            body: JSON.stringify({ ...INPUT, scheduledFor }),
            headers: {
              "Content-Type": "application/json",
              Cookie: accountA.cookie,
            },
            method: "POST",
          },
        );
        expect(invalidTimestampResponse.status).toBe(400);
        await expect(invalidTimestampResponse.json()).resolves.toEqual({
          error: {
            code: "invalid_post",
            fields: ["scheduledFor"],
            message: "Os dados da publicação são inválidos.",
          },
        });
      }

      const postA = await repositoryA.create(INPUT);
      expect(postA).toEqual(
        expect.objectContaining({
          authorUserId: accountA.session.user.id,
          id: expect.stringMatching(/^[0-9a-f-]{36}$/),
          scheduledFor: "2027-08-13T13:30:00.000Z",
          tenantId: accountA.session.tenant.id,
        }),
      );

      const postB = await repositoryB.create({
        ...INPUT,
        caption: "Conteúdo exclusivo do Tenant B.",
        title: "Post B",
      });

      await expect(repositoryA.list()).resolves.toEqual([postA]);
      await expect(repositoryB.list()).resolves.toEqual([postB]);

      const privatePostsResponse = await apiFetch(`${apiA.baseUrl}/posts`, {
        headers: { Cookie: accountA.cookie },
      });
      expect(privatePostsResponse.status).toBe(200);
      expect(privatePostsResponse.headers.get("cache-control")).toBe(
        "no-store",
      );
      await expect(privatePostsResponse.json()).resolves.toEqual([postA]);

      const unauthenticatedResponse = await apiFetch(`${apiA.baseUrl}/posts`);
      expect(unauthenticatedResponse.status).toBe(401);

      const manipulatedResponse = await apiFetch(`${apiA.baseUrl}/posts`, {
        body: JSON.stringify({
          ...INPUT,
          authorUserId: accountB.session.user.id,
          tenantId: accountB.session.tenant.id,
          title: "Tentativa de trocar tenant",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: accountA.cookie,
        },
        method: "POST",
      });
      expect(manipulatedResponse.status).toBe(201);
      await expect(manipulatedResponse.json()).resolves.toEqual(
        expect.objectContaining({
          authorUserId: accountA.session.user.id,
          tenantId: accountA.session.tenant.id,
        }),
      );

      const stored = await migrationPool.query<{
        author_user_id: string;
        id_type: string;
        scheduled_type: string;
        tenant_id: string;
      }>(
        `
          SELECT
            tenant_id,
            author_user_id,
            pg_typeof(id)::text AS id_type,
            pg_typeof(scheduled_for)::text AS scheduled_type
          FROM posts
          WHERE id = $1::uuid
        `,
        [postA.id],
      );
      expect(stored.rows[0]).toEqual({
        author_user_id: accountA.session.user.id,
        id_type: "uuid",
        scheduled_type: "timestamp with time zone",
        tenant_id: accountA.session.tenant.id,
      });

      await stopApi(apiA);
      runningApis.splice(runningApis.indexOf(apiA), 1);
      const restartedApiA = await startApi(databaseUrl, schema);
      runningApis.push(restartedApiA);
      const repositoryAfterRestart = new HttpPostsRepository(
        new ApiClient({
          baseUrl: restartedApiA.baseUrl,
          fetchImpl: cookieFetch(accountA.cookie),
        }),
      );
      await expect(repositoryAfterRestart.list()).resolves.toEqual(
        expect.arrayContaining([postA]),
      );
    } finally {
      for (const api of runningApis) await stopApi(api);
      await migrationPool.end();
      await dropSchema(adminPool, schema);
    }
  });

  it("valida e baselineia o schema preexistente antes de reconciliar", async () => {
    const databaseUrl = requireTestDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const adminPool = await createSchema(databaseUrl, schema);
    const pool = schemaPool(databaseUrl, schema);

    try {
      const baselineSql = await readFile(
        resolve(process.cwd(), "server/migrations/001_create_posts.sql"),
        "utf8",
      );
      await pool.query(baselineSql);

      await runMigrations(pool);
      await expectOfficialSchema(pool);

      const migrations = await pool.query<{ name: string }>(`
        SELECT name FROM schema_migrations ORDER BY name
      `);
      expect(migrations.rows.map((row) => row.name)).toEqual([
        "001_create_posts.sql",
        "002_enforce_post_content.sql",
        "003_reconcile_official_multitenant_schema.sql",
        "004_add_auth_sessions.sql",
        "005_add_social_accounts.sql",
        "006_add_pending_social_connection_status.sql",
        "007_add_oauth_authorization_requests.sql",
      ]);
    } finally {
      await pool.end();
      await dropSchema(adminPool, schema);
    }
  });

  it.each([
    [
      "tabela referenciada incorreta",
      `
        ALTER TABLE posts DROP CONSTRAINT posts_tenant_id_fkey;
        ALTER TABLE posts
          ADD CONSTRAINT posts_tenant_id_fkey
          FOREIGN KEY (tenant_id) REFERENCES users(id) ON DELETE CASCADE;
      `,
    ],
    [
      "coluna referenciada incorreta",
      `
        ALTER TABLE tenants
          ADD COLUMN alternate_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
        ALTER TABLE posts DROP CONSTRAINT posts_tenant_id_fkey;
        ALTER TABLE posts
          ADD CONSTRAINT posts_tenant_id_fkey
          FOREIGN KEY (tenant_id)
          REFERENCES tenants(alternate_id) ON DELETE CASCADE;
      `,
    ],
    [
      "ON DELETE incompatível",
      `
        ALTER TABLE posts DROP CONSTRAINT posts_tenant_id_fkey;
        ALTER TABLE posts
          ADD CONSTRAINT posts_tenant_id_fkey
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
      `,
    ],
  ])("rejeita baseline com %s", async (_label, incompatibleForeignKey) => {
    const databaseUrl = requireTestDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const adminPool = await createSchema(databaseUrl, schema);
    const pool = schemaPool(databaseUrl, schema);

    try {
      const baselineSql = await readFile(
        resolve(process.cwd(), "server/migrations/001_create_posts.sql"),
        "utf8",
      );
      await pool.query(baselineSql);
      await pool.query(incompatibleForeignKey);

      await expect(runMigrations(pool)).rejects.toThrow(
        "O schema existente não corresponde ao baseline oficial validado",
      );
      const recorded = await pool.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM schema_migrations
      `);
      expect(recorded.rows[0]?.count).toBe(0);
    } finally {
      await pool.end();
      await dropSchema(adminPool, schema);
    }
  });

  it("preserva usuário legado sem senha e mantém password_hash nullable", async () => {
    const databaseUrl = requireTestDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const adminPool = await createSchema(databaseUrl, schema);
    const pool = schemaPool(databaseUrl, schema);

    try {
      const baselineSql = await readFile(
        resolve(process.cwd(), "server/migrations/001_create_posts.sql"),
        "utf8",
      );
      await pool.query(baselineSql);
      const legacyUser = await pool.query<{ id: string }>(`
        INSERT INTO users (email, display_name)
        VALUES ('legado@example.test', 'Usuário legado')
        RETURNING id
      `);

      await runMigrations(pool);

      const stored = await pool.query<{
        is_nullable: "NO" | "YES";
        password_hash: string | null;
      }>(`
        SELECT
          app_user.password_hash,
          column_row.is_nullable
        FROM users app_user
        CROSS JOIN information_schema.columns column_row
        WHERE app_user.id = $1::uuid
          AND column_row.table_schema = current_schema()
          AND column_row.table_name = 'users'
          AND column_row.column_name = 'password_hash'
      `, [legacyUser.rows[0]?.id]);
      expect(stored.rows[0]).toEqual({
        is_nullable: "YES",
        password_hash: null,
      });
      const sessionsTable = await pool.query<{ exists: boolean }>(`
        SELECT to_regclass(format('%I.auth_sessions', current_schema())) IS NOT NULL
          AS exists
      `);
      expect(sessionsTable.rows[0]?.exists).toBe(true);
    } finally {
      await pool.end();
      await dropSchema(adminPool, schema);
    }
  });
});
