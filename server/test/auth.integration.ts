import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  isAuthSession,
  isAuthWorkspacesResponse,
  type AuthSession,
  type AuthWorkspacesResponse,
} from "../../shared/authContract.ts";
import { createApiServer } from "../src/app.ts";
import { runMigrations } from "../src/migrations.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

type RegisteredAccount = {
  cookie: string;
  session: AuthSession;
};

const VALID_PASSWORD = "senha-segura-123";

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL não foi definida.");
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!name.endsWith("_test")) {
    throw new Error("TEST_DATABASE_URL deve apontar para um banco terminado em _test.");
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

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("A resposta não criou o cookie de sessão.");
  return cookie;
}

async function jsonBody(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

function apiFetch(input: string | URL | Request, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set("Origin", "http://localhost:5173");
  }
  return fetch(input, { ...init, headers });
}

describe("autenticação HTTP com PostgreSQL", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("usa TEST_DATABASE_URL para executar a integração", () => undefined);
    return;
  }

  const databaseUrl = requireTestDatabaseUrl();
  const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
  let adminPool: Pool;
  let pool: Pool;
  let server: Server;
  let baseUrl: string;

  async function register(
    email = `davi-${randomUUID()}@example.test`,
    displayName = "Davi Alvares",
    password = VALID_PASSWORD,
  ): Promise<RegisteredAccount> {
    const response = await apiFetch(`${baseUrl}/auth/register`, {
      body: JSON.stringify({ displayName, email, password }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const body: unknown = await jsonBody(response);
    expect(isAuthSession(body)).toBe(true);
    return { cookie: cookieFrom(response), session: body as AuthSession };
  }

  async function addWorkspace(
    userId: string,
    name: string,
    createdAt = new Date(),
  ) {
    const tenantId = randomUUID();
    const membershipId = randomUUID();
    await pool.query(
      `
        INSERT INTO tenants (id, name, slug)
        VALUES ($1::uuid, $2, $3)
      `,
      [tenantId, name, `${name.toLowerCase().replaceAll(" ", "-")}-${tenantId}`],
    );
    await pool.query(
      `
        INSERT INTO tenant_members (
          id,
          tenant_id,
          user_id,
          role,
          created_at
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'member', $4::timestamptz)
      `,
      [membershipId, tenantId, userId, createdAt.toISOString()],
    );
    return { membershipId, tenantId };
  }

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl });
    assertSafeSchema(schema);
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = schemaPool(databaseUrl, schema);
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
      socialTokenCipher: new SocialTokenCipher(Buffer.alloc(32, 7)),
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE social_accounts, auth_sessions, posts, tenant_members, tenants, users CASCADE
    `);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) =>
          error ? rejectPromise(error) : resolvePromise(),
        );
      });
    }
    if (pool) await pool.end();
    if (adminPool) {
      assertSafeSchema(schema);
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  it("cadastra usuário, tenant, owner e sessão em uma transação", async () => {
    const email = `DAVI-${randomUUID()}@Example.Test`;
    const response = await apiFetch(`${baseUrl}/auth/register`, {
      body: JSON.stringify({
        displayName: "  Davi Alvares  ",
        email: `  ${email}  `,
        password: VALID_PASSWORD,
      }),
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).not.toContain("Secure");
    const body: unknown = await jsonBody(response);
    expect(body).toEqual({
      tenant: expect.objectContaining({ role: "owner" }),
      user: expect.objectContaining({
        displayName: "Davi Alvares",
        email: email.trim().toLowerCase(),
      }),
    });
    expect(JSON.stringify(body)).not.toContain("password");

    const stored = await pool.query<{
      memberships: number;
      password_hash: string;
      sessions: number;
      tenants: number;
      token_hash: string;
    }>(`
      SELECT
        (SELECT count(*)::int FROM tenants) AS tenants,
        (SELECT count(*)::int FROM tenant_members) AS memberships,
        (SELECT count(*)::int FROM auth_sessions) AS sessions,
        (SELECT password_hash FROM users LIMIT 1) AS password_hash,
        (SELECT token_hash FROM auth_sessions LIMIT 1) AS token_hash
    `);
    expect(stored.rows[0]).toEqual({
      memberships: 1,
      password_hash: expect.stringMatching(/^\$argon2id\$/),
      sessions: 1,
      tenants: 1,
      token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(stored.rows[0]?.password_hash).not.toContain(VALID_PASSWORD);
    expect(setCookie).not.toContain(stored.rows[0]?.token_hash ?? "missing");
  });

  it("rejeita email duplicado sem criar outro tenant", async () => {
    const email = `duplicado-${randomUUID()}@example.test`;
    await register(email);
    const response = await apiFetch(`${baseUrl}/auth/register`, {
      body: JSON.stringify({
        displayName: "Outra pessoa",
        email: email.toUpperCase(),
        password: VALID_PASSWORD,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(409);
    await expect(jsonBody(response)).resolves.toEqual({
      error: {
        code: "email_already_registered",
        message: "Já existe uma conta com este email.",
      },
    });
    const counts = await pool.query<{ tenants: number; users: number }>(`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM tenants) AS tenants
    `);
    expect(counts.rows[0]).toEqual({ tenants: 1, users: 1 });
  });

  it("rejeita senha curta antes de persistir o cadastro", async () => {
    const response = await apiFetch(`${baseUrl}/auth/register`, {
      body: JSON.stringify({
        displayName: "Davi",
        email: "davi@example.test",
        password: "curta",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    await expect(jsonBody(response)).resolves.toEqual({
      error: {
        code: "invalid_registration",
        fields: ["password"],
        message: "Os dados de cadastro são inválidos.",
      },
    });
    const users = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM users",
    );
    expect(users.rows[0]?.count).toBe(0);
  });

  it("faz rollback de usuário e tenant quando o membership falha", async () => {
    await pool.query(`
      CREATE FUNCTION reject_test_membership() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'falha controlada de membership';
      END;
      $$;
      CREATE TRIGGER reject_test_membership
      BEFORE INSERT ON tenant_members
      FOR EACH ROW EXECUTE FUNCTION reject_test_membership();
    `);
    try {
      const response = await apiFetch(`${baseUrl}/auth/register`, {
        body: JSON.stringify({
          displayName: "Rollback",
          email: "rollback@example.test",
          password: VALID_PASSWORD,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(500);
      const counts = await pool.query<{
        memberships: number;
        tenants: number;
        users: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM tenants) AS tenants,
          (SELECT count(*)::int FROM tenant_members) AS memberships
      `);
      expect(counts.rows[0]).toEqual({
        memberships: 0,
        tenants: 0,
        users: 0,
      });
    } finally {
      await pool.query(`
        DROP TRIGGER reject_test_membership ON tenant_members;
        DROP FUNCTION reject_test_membership();
      `);
    }
  });

  it("faz login sem revelar se email ou senha estavam errados", async () => {
    const email = `login-${randomUUID()}@example.test`;
    const account = await register(email);
    const valid = await apiFetch(`${baseUrl}/auth/login`, {
      body: JSON.stringify({ email, password: VALID_PASSWORD }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(valid.status).toBe(200);
    expect(cookieFrom(valid)).toMatch(/^socialflow_session=/);

    for (const credentials of [
      { email, password: "senha-incorreta-123" },
      { email: "inexistente@example.test", password: VALID_PASSWORD },
    ]) {
      const invalid = await apiFetch(`${baseUrl}/auth/login`, {
        body: JSON.stringify(credentials),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(invalid.status).toBe(401);
      await expect(jsonBody(invalid)).resolves.toEqual({
        error: {
          code: "invalid_credentials",
          message: "Email ou senha inválidos.",
        },
      });
    }

    await pool.query("UPDATE users SET is_active = false WHERE id = $1::uuid", [
      account.session.user.id,
    ]);
    const inactive = await apiFetch(`${baseUrl}/auth/login`, {
      body: JSON.stringify({ email, password: VALID_PASSWORD }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(inactive.status).toBe(401);
  });

  it("limita login e cadastro por rota sem revelar dados da conta", async () => {
    const limitedServer = createApiServer({
      authRateLimit: { maxAttempts: 1, windowMs: 60_000 },
      corsOrigin: "http://localhost:5173",
      logger: { error: vi.fn() },
      pool,
      sessionCookie: {
        maxAgeSeconds: 3_600,
        sameSite: "Lax",
        secure: false,
      },
      sessionTtlSeconds: 3_600,
      socialTokenCipher: new SocialTokenCipher(Buffer.alloc(32, 7)),
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      limitedServer.once("error", rejectPromise);
      limitedServer.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = limitedServer.address() as AddressInfo;
    const limitedBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const firstLogin = await apiFetch(`${limitedBaseUrl}/auth/login`, {
        body: JSON.stringify({
          email: "inexistente@example.test",
          password: VALID_PASSWORD,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(firstLogin.status).toBe(401);
      const limitedLogin = await apiFetch(`${limitedBaseUrl}/auth/login`, {
        body: JSON.stringify({
          email: "outro@example.test",
          password: VALID_PASSWORD,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(limitedLogin.status).toBe(429);
      expect(limitedLogin.headers.get("retry-after")).toBe("60");
      await expect(jsonBody(limitedLogin)).resolves.toEqual({
        error: {
          code: "rate_limited",
          message:
            "Muitas tentativas. Aguarde um instante antes de tentar novamente.",
        },
      });

      const firstRegister = await apiFetch(`${limitedBaseUrl}/auth/register`, {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(firstRegister.status).toBe(400);
      const limitedRegister = await apiFetch(
        `${limitedBaseUrl}/auth/register`,
        {
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(limitedRegister.status).toBe(429);
    } finally {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        limitedServer.close((error) =>
          error ? rejectPromise(error) : resolvePromise(),
        );
      });
    }
  });

  it("exige a origem configurada em operações que alteram estado", async () => {
    const account = await register();
    for (const origin of [undefined, "https://evil.example"]) {
      const response = await fetch(`${baseUrl}/auth/logout`, {
        headers: {
          Cookie: account.cookie,
          ...(origin ? { Origin: origin } : {}),
        },
        method: "POST",
      });
      expect(response.status).toBe(403);
    }

    const stillAuthenticated = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: account.cookie },
    });
    expect(stillAuthenticated.status).toBe(200);
  });

  it("retorna somente dados seguros em /auth/me", async () => {
    const unauthenticated = await apiFetch(`${baseUrl}/auth/me`);
    expect(unauthenticated.status).toBe(401);

    const account = await register();
    const authenticated = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: account.cookie },
    });
    expect(authenticated.status).toBe(200);
    await expect(jsonBody(authenticated)).resolves.toEqual(account.session);
    expect(JSON.stringify(await account.session)).not.toContain("password");
  });

  it("invalida a sessão no logout", async () => {
    const account = await register();
    const logout = await apiFetch(`${baseUrl}/auth/logout`, {
      headers: { Cookie: account.cookie },
      method: "POST",
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");

    const me = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: account.cookie },
    });
    expect(me.status).toBe(401);
    const sessions = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM auth_sessions",
    );
    expect(sessions.rows[0]?.count).toBe(0);
  });

  it("rejeita e remove uma sessão expirada", async () => {
    const account = await register();
    await pool.query(`
      UPDATE auth_sessions
      SET created_at = now() - interval '2 hours',
          expires_at = now() - interval '1 hour'
    `);

    const me = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: account.cookie },
    });
    expect(me.status).toBe(401);
    const sessions = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM auth_sessions",
    );
    expect(sessions.rows[0]?.count).toBe(0);
  });

  it("lista um ou vários workspaces autorizados em ordem determinística", async () => {
    const account = await register();
    const otherAccount = await register();
    const older = await addWorkspace(
      account.session.user.id,
      "Workspace anterior",
      new Date("2020-01-01T00:00:00.000Z"),
    );

    const unauthenticated = await apiFetch(`${baseUrl}/auth/workspaces`);
    expect(unauthenticated.status).toBe(401);

    const response = await apiFetch(`${baseUrl}/auth/workspaces`, {
      headers: { Cookie: account.cookie },
    });
    expect(response.status).toBe(200);
    const body: unknown = await jsonBody(response);
    expect(isAuthWorkspacesResponse(body)).toBe(true);
    const workspaces = (body as AuthWorkspacesResponse).workspaces;
    expect(workspaces.map((workspace) => workspace.tenantId)).toEqual([
      older.tenantId,
      account.session.tenant.id,
    ]);
    expect(workspaces).toEqual([
      expect.objectContaining({
        name: "Workspace anterior",
        role: "member",
        selected: false,
      }),
      expect.objectContaining({
        name: account.session.tenant.name,
        role: "owner",
        selected: true,
      }),
    ]);
    expect(
      workspaces.some(
        (workspace) => workspace.tenantId === otherAccount.session.tenant.id,
      ),
    ).toBe(false);

    const singleResponse = await apiFetch(`${baseUrl}/auth/workspaces`, {
      headers: { Cookie: otherAccount.cookie },
    });
    const singleBody: unknown = await jsonBody(singleResponse);
    expect(singleBody).toEqual({
      workspaces: [
        expect.objectContaining({
          selected: true,
          tenantId: otherAccount.session.tenant.id,
        }),
      ],
    });
  });

  it("recusa seleção inválida ou alheia sem alterar a sessão atual", async () => {
    const account = await register();
    const otherAccount = await register();

    for (const body of [{}, { tenantId: "não-é-uuid" }]) {
      const invalid = await apiFetch(`${baseUrl}/auth/workspaces/select`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Cookie: account.cookie,
        },
        method: "POST",
      });
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get("set-cookie")).toBeNull();
    }

    const forbidden = await apiFetch(`${baseUrl}/auth/workspaces/select`, {
      body: JSON.stringify({ tenantId: otherAccount.session.tenant.id }),
      headers: {
        "Content-Type": "application/json",
        Cookie: account.cookie,
      },
      method: "POST",
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("set-cookie")).toBeNull();
    await expect(jsonBody(forbidden)).resolves.toEqual({
      error: {
        code: "workspace_forbidden",
        message: "O workspace solicitado não está disponível para este usuário.",
      },
    });

    const stillCurrent = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: account.cookie },
    });
    await expect(jsonBody(stillCurrent)).resolves.toEqual(account.session);
  });

  it("rotaciona a sessão e isola posts ao alternar A -> B -> A", async () => {
    const account = await register();
    const otherAccount = await register();
    const workspaceB = await addWorkspace(
      account.session.user.id,
      "Workspace B",
    );
    const postInput = {
      caption: "Conteúdo isolado por workspace.",
      scheduledFor: "2027-08-13T13:30:00.000Z",
      status: "scheduled",
      title: "Post do workspace A",
    };

    const postAResponse = await apiFetch(`${baseUrl}/posts`, {
      body: JSON.stringify(postInput),
      headers: {
        "Content-Type": "application/json",
        Cookie: account.cookie,
      },
      method: "POST",
    });
    expect(postAResponse.status).toBe(201);
    const postCResponse = await apiFetch(`${baseUrl}/posts`, {
      body: JSON.stringify({ ...postInput, title: "Post do workspace C" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: otherAccount.cookie,
      },
      method: "POST",
    });
    expect(postCResponse.status).toBe(201);

    const switchToB = await apiFetch(`${baseUrl}/auth/workspaces/select`, {
      body: JSON.stringify({
        authorUserId: otherAccount.session.user.id,
        membershipId: randomUUID(),
        tenantId: workspaceB.tenantId,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: account.cookie,
      },
      method: "POST",
    });
    expect(switchToB.status).toBe(200);
    const cookieB = cookieFrom(switchToB);
    expect(cookieB).not.toBe(account.cookie);
    await expect(jsonBody(switchToB)).resolves.toEqual(
      expect.objectContaining({
        tenant: expect.objectContaining({ id: workspaceB.tenantId }),
      }),
    );

    const oldToken = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: account.cookie },
    });
    expect(oldToken.status).toBe(401);
    const meB = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: cookieB },
    });
    expect(meB.status).toBe(200);
    await expect(jsonBody(meB)).resolves.toEqual(
      expect.objectContaining({
        tenant: expect.objectContaining({ id: workspaceB.tenantId }),
      }),
    );
    const workspacesB = await apiFetch(`${baseUrl}/auth/workspaces`, {
      headers: { Cookie: cookieB },
    });
    const workspacesBBody = (await jsonBody(
      workspacesB,
    )) as AuthWorkspacesResponse;
    expect(
      workspacesBBody.workspaces.find((workspace) => workspace.selected)
        ?.tenantId,
    ).toBe(workspaceB.tenantId);

    const postsBeforeCreateB = await apiFetch(`${baseUrl}/posts`, {
      headers: { Cookie: cookieB },
    });
    await expect(jsonBody(postsBeforeCreateB)).resolves.toEqual([]);

    const createB = await apiFetch(`${baseUrl}/posts`, {
      body: JSON.stringify({
        ...postInput,
        authorUserId: otherAccount.session.user.id,
        tenantId: otherAccount.session.tenant.id,
        title: "Post do workspace B",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieB,
      },
      method: "POST",
    });
    expect(createB.status).toBe(201);
    await expect(jsonBody(createB)).resolves.toEqual(
      expect.objectContaining({
        authorUserId: account.session.user.id,
        tenantId: workspaceB.tenantId,
        title: "Post do workspace B",
      }),
    );

    const switchBackToA = await apiFetch(
      `${baseUrl}/auth/workspaces/select`,
      {
        body: JSON.stringify({ tenantId: account.session.tenant.id }),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieB,
        },
        method: "POST",
      },
    );
    expect(switchBackToA.status).toBe(200);
    const cookieA2 = cookieFrom(switchBackToA);
    expect(cookieA2).not.toBe(cookieB);
    const revokedB = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: cookieB },
    });
    expect(revokedB.status).toBe(401);

    const postsA = await apiFetch(`${baseUrl}/posts`, {
      headers: { Cookie: cookieA2 },
    });
    const postsABody = (await jsonBody(postsA)) as Array<{
      tenantId: string;
      title: string;
    }>;
    expect(postsABody).toHaveLength(1);
    expect(postsABody[0]).toEqual(
      expect.objectContaining({
        tenantId: account.session.tenant.id,
        title: "Post do workspace A",
      }),
    );

    const logout = await apiFetch(`${baseUrl}/auth/logout`, {
      headers: { Cookie: cookieA2 },
      method: "POST",
    });
    expect(logout.status).toBe(204);
    const revokedA2 = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: cookieA2 },
    });
    expect(revokedA2.status).toBe(401);
    const sessions = await pool.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM auth_sessions session
        JOIN tenant_members member ON member.id = session.membership_id
        WHERE member.user_id = $1::uuid
      `,
      [account.session.user.id],
    );
    expect(sessions.rows[0]?.count).toBe(0);
  });

  it("seleciona deterministicamente o membership mais antigo no login", async () => {
    const email = `multi-${randomUUID()}@example.test`;
    const account = await register(email);
    const secondTenantId = randomUUID();
    const secondMembershipId = randomUUID();
    await pool.query(
      `
        INSERT INTO tenants (id, name, slug)
        VALUES ($1::uuid, 'Tenant anterior', $2)
      `,
      [secondTenantId, `tenant-${secondTenantId}`],
    );
    await pool.query(
      `
        INSERT INTO tenant_members (
          id,
          tenant_id,
          user_id,
          role,
          created_at
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'admin', now() - interval '1 day')
      `,
      [secondMembershipId, secondTenantId, account.session.user.id],
    );

    const login = await apiFetch(`${baseUrl}/auth/login`, {
      body: JSON.stringify({ email, password: VALID_PASSWORD }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(login.status).toBe(200);
    await expect(jsonBody(login)).resolves.toEqual(
      expect.objectContaining({
        tenant: expect.objectContaining({
          id: secondTenantId,
          role: "admin",
        }),
      }),
    );
  });
});
