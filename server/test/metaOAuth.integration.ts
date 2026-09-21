import { createHash, randomUUID } from "node:crypto";
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
  type AuthSession,
} from "../../shared/authContract.ts";
import {
  isSocialAccountsResponse,
  type SocialAccount,
  type SocialAccountsResponse,
} from "../../shared/socialAccountContract.ts";
import { createApiServer } from "../src/app.ts";
import type {
  MetaAccessToken,
  MetaInstagramAccount,
  MetaOAuthConfig,
  MetaOAuthProviderClient,
  MetaPage,
  MetaPermission,
} from "../src/metaOAuthClient.ts";
import { MetaOAuthClientError } from "../src/metaOAuthClient.ts";
import { runMigrations } from "../src/migrations.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

const CORS_ORIGIN = "http://localhost:5173";
const META_CONFIG: MetaOAuthConfig = {
  appId: "123456789012345",
  appSecret: "segredo-meta-de-integracao-123456",
  enabled: true,
  graphApiVersion: "v26.0",
  redirectUri: "http://localhost:3001/auth/meta/callback",
  stateTtlSeconds: 600,
};

type RegisteredAccount = {
  cookie: string;
  session: AuthSession;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type MetaListPagesBarrier = {
  entered: ReturnType<typeof deferred<void>>;
  release: ReturnType<typeof deferred<void>>;
};

class ControlledMetaClient implements MetaOAuthProviderClient {
  instagramAccounts = new Map<string, MetaInstagramAccount>();
  pages: MetaPage[] = [];
  permissions: MetaPermission[] = [
    { name: "pages_show_list", status: "granted" },
    { name: "pages_read_engagement", status: "granted" },
    { name: "instagram_basic", status: "granted" },
  ];
  listPagesBarrier: MetaListPagesBarrier | null = null;
  shortToken = "meta-short-token";
  userToken = "meta-long-user-token";
  userTokenExpiresAt: string | null = "2026-12-31T23:59:59.000Z";

  buildAuthorizationUrl(state: string): string {
    const url = new URL("https://www.facebook.com/v26.0/dialog/oauth");
    url.searchParams.set("client_id", "123456789012345");
    url.searchParams.set("redirect_uri", META_CONFIG.redirectUri!);
    url.searchParams.set(
      "scope",
      "pages_show_list,pages_read_engagement,instagram_basic",
    );
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(): Promise<MetaAccessToken> {
    return { accessToken: this.shortToken, expiresAt: null };
  }

  async exchangeForLongLivedToken(): Promise<MetaAccessToken> {
    return {
      accessToken: this.userToken,
      expiresAt: this.userTokenExpiresAt,
    };
  }

  async getIdentity(): Promise<{ id: string }> {
    return { id: "998877665544332211" };
  }

  async getInstagramAccount(id: string): Promise<MetaInstagramAccount> {
    const account = this.instagramAccounts.get(id);
    if (!account) {
      throw new MetaOAuthClientError("invalid_response", "instagram_profile");
    }
    return account;
  }

  async getPermissions(): Promise<MetaPermission[]> {
    return this.permissions;
  }

  async listPages(): Promise<MetaPage[]> {
    if (this.listPagesBarrier) {
      this.listPagesBarrier.entered.resolve();
      await this.listPagesBarrier.release.promise;
    }
    return this.pages;
  }

  reset() {
    this.instagramAccounts.clear();
    this.pages = [];
    this.permissions = [
      { name: "pages_show_list", status: "granted" },
      { name: "pages_read_engagement", status: "granted" },
      { name: "instagram_basic", status: "granted" },
    ];
    this.listPagesBarrier = null;
    this.shortToken = "meta-short-token";
    this.userToken = "meta-long-user-token";
    this.userTokenExpiresAt = "2026-12-31T23:59:59.000Z";
  }
}

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
  if (method !== "GET" && method !== "HEAD" && !headers.has("Origin")) {
    headers.set("Origin", CORS_ORIGIN);
  }
  return fetch(input, { ...init, headers });
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("A resposta não criou cookie de sessão.");
  return cookie;
}

describe("OAuth Meta HTTP com PostgreSQL", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("usa TEST_DATABASE_URL para executar a integração", () => undefined);
    return;
  }

  const databaseUrl = requireTestDatabaseUrl();
  const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
  const metaClient = new ControlledMetaClient();
  const cipher = new SocialTokenCipher(Buffer.alloc(32, 29));
  let adminPool: Pool;
  let pool: Pool;
  let server: Server;
  let baseUrl: string;

  async function register(): Promise<RegisteredAccount> {
    const response = await apiFetch(`${baseUrl}/auth/register`, {
      body: JSON.stringify({
        displayName: "Pessoa Meta",
        email: `meta-${randomUUID()}@example.test`,
        password: "senha-segura-123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(isAuthSession(body)).toBe(true);
    return { cookie: cookieFrom(response), session: body as AuthSession };
  }

  async function startOAuth(cookie: string): Promise<string> {
    const response = await apiFetch(`${baseUrl}/auth/meta/start`, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { authorizationUrl: string };
    const authorizationUrl = new URL(body.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://www.facebook.com");
    return authorizationUrl.searchParams.get("state")!;
  }

  function callback(
    cookie: string,
    state: string,
    parameters: Record<string, string> = { code: "authorization-code" },
  ) {
    const url = new URL(`${baseUrl}/auth/meta/callback`);
    url.searchParams.set("state", state);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    return apiFetch(url, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
  }

  async function listAccounts(cookie: string): Promise<SocialAccount[]> {
    const response = await apiFetch(`${baseUrl}/social-accounts`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(isSocialAccountsResponse(body)).toBe(true);
    return (body as SocialAccountsResponse).socialAccounts;
  }

  async function addWorkspace(userId: string) {
    const tenantId = randomUUID();
    const membershipId = randomUUID();
    await pool.query(
      `
        INSERT INTO tenants (id, name, slug)
        VALUES ($1::uuid, 'Workspace Meta B', $2)
      `,
      [tenantId, `workspace-meta-b-${tenantId}`],
    );
    await pool.query(
      `
        INSERT INTO tenant_members (id, tenant_id, user_id, role, created_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'admin', now() + interval '1 minute')
      `,
      [membershipId, tenantId, userId],
    );
    return { membershipId, tenantId };
  }

  async function selectWorkspace(cookie: string, tenantId: string) {
    const response = await apiFetch(`${baseUrl}/auth/workspaces/select`, {
      body: JSON.stringify({ tenantId }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    const session: unknown = await response.json();
    expect(isAuthSession(session)).toBe(true);
    return { cookie: cookieFrom(response), session: session as AuthSession };
  }

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl });
    assertSafeSchema(schema);
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = schemaPool(databaseUrl, schema);
    await runMigrations(pool);
    server = createApiServer({
      authRateLimit: { maxAttempts: 1_000, windowMs: 60_000 },
      corsOrigin: CORS_ORIGIN,
      logger: { error: vi.fn() },
      metaOAuth: META_CONFIG,
      metaOAuthClient: metaClient,
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
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    metaClient.reset();
    await pool.query(`
      TRUNCATE
        oauth_authorization_requests,
        social_account_credentials,
        social_accounts,
        oauth_connections,
        auth_sessions,
        posts,
        tenant_members,
        tenants,
        users
      CASCADE
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

  it("protege o start, armazena somente hash e torna state expirável e single-use", async () => {
    const unauthenticated = await apiFetch(`${baseUrl}/auth/meta/start`, {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(unauthenticated.status).toBe(401);

    const account = await register();
    const wrongOrigin = await apiFetch(`${baseUrl}/auth/meta/start`, {
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Cookie: account.cookie,
        Origin: "https://evil.example",
      },
      method: "POST",
    });
    expect(wrongOrigin.status).toBe(403);

    const manipulatedContext = await apiFetch(`${baseUrl}/auth/meta/start`, {
      body: JSON.stringify({ tenantId: randomUUID() }),
      headers: {
        "Content-Type": "application/json",
        Cookie: account.cookie,
      },
      method: "POST",
    });
    expect(manipulatedContext.status).toBe(400);
    await expect(manipulatedContext.json()).resolves.toEqual({
      error: {
        code: "invalid_meta_oauth_start",
        fields: ["body"],
        message: "O início da conexão Meta não aceita parâmetros.",
      },
    });

    const disabledServer = createApiServer({
      authRateLimit: { maxAttempts: 1_000, windowMs: 60_000 },
      corsOrigin: CORS_ORIGIN,
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
    try {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        disabledServer.once("error", rejectPromise);
        disabledServer.listen(0, "127.0.0.1", resolvePromise);
      });
      const disabledAddress = disabledServer.address() as AddressInfo;
      const disabled = await apiFetch(
        `http://127.0.0.1:${disabledAddress.port}/auth/meta/start`,
        {
          body: "{}",
          headers: {
            "Content-Type": "application/json",
            Cookie: account.cookie,
          },
          method: "POST",
        },
      );
      expect(disabled.status).toBe(503);
      await expect(disabled.json()).resolves.toEqual({
        error: {
          code: "meta_oauth_not_configured",
          message: "A conexão Meta não está disponível neste ambiente.",
        },
      });
    } finally {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        disabledServer.close((error) =>
          error ? rejectPromise(error) : resolvePromise(),
        );
      });
    }

    const state = await startOAuth(account.cookie);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await pool.query<{
      auth_session_id: string;
      membership_id: string;
      state_hash: string;
    }>(`
      SELECT state_hash, auth_session_id, membership_id
      FROM oauth_authorization_requests
    `);
    const activeSession = await pool.query<{
      id: string;
      membership_id: string;
    }>(`
      SELECT session.id, session.membership_id
      FROM auth_sessions session
      JOIN tenant_members member ON member.id = session.membership_id
      WHERE member.user_id = $1::uuid
    `, [account.session.user.id]);
    expect(stored.rows[0]).toEqual({
      auth_session_id: activeSession.rows[0]?.id,
      membership_id: activeSession.rows[0]?.membership_id,
      state_hash: createHash("sha256").update(state).digest("hex"),
    });
    expect(JSON.stringify(stored.rows)).not.toContain(state);

    const cancelled = await callback(account.cookie, state, {
      error: "access_denied",
      error_description: "texto externo que não pode vazar",
    });
    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=cancelled`,
    );
    expect(cancelled.headers.get("location")).not.toContain("description");

    const replay = await callback(account.cookie, state);
    expect(replay.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=invalid_state`,
    );

    const expiredState = await startOAuth(account.cookie);
    await pool.query(
      `
        UPDATE oauth_authorization_requests
        SET created_at = now() - interval '2 minutes',
            expires_at = now() - interval '1 minute'
        WHERE state_hash = $1
      `,
      [createHash("sha256").update(expiredState).digest("hex")],
    );
    const expired = await callback(account.cookie, expiredState);
    expect(expired.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=invalid_state`,
    );

    const logoutState = await startOAuth(account.cookie);
    const logout = await apiFetch(`${baseUrl}/auth/logout`, {
      headers: { Cookie: account.cookie },
      method: "POST",
    });
    expect(logout.status).toBe(204);
    const removed = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM oauth_authorization_requests
      WHERE state_hash = $1
    `, [createHash("sha256").update(logoutState).digest("hex")]);
    expect(removed.rows[0]?.count).toBe(0);
    const afterLogout = await callback(account.cookie, logoutState);
    expect(afterLogout.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=session_expired`,
    );

    const expiringAccount = await register();
    const sessionExpiryState = await startOAuth(expiringAccount.cookie);
    await pool.query(
      `
        UPDATE auth_sessions session
        SET created_at = now() - interval '2 minutes',
            expires_at = now() - interval '1 minute'
        FROM tenant_members member
        WHERE member.id = session.membership_id
          AND member.user_id = $1::uuid
      `,
      [expiringAccount.session.user.id],
    );
    const afterSessionExpiry = await callback(
      expiringAccount.cookie,
      sessionExpiryState,
    );
    expect(afterSessionExpiry.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=session_expired`,
    );
  });

  it("descobre Pages e Instagram, cifra tokens e reconecta sem duplicação", async () => {
    const account = await register();
    metaClient.pages = [
      {
        accessToken: "page-token-one-plaintext",
        id: "100000000000001",
        instagramBusinessAccountId: null,
        name: "Página Um",
        profileImageUrl: "https://images.example/page-one.jpg",
        tasks: ["ANALYZE"],
        username: "pagina_um",
      },
      {
        accessToken: "page-token-two-plaintext",
        id: "100000000000002",
        instagramBusinessAccountId: "200000000000002",
        name: "Página Dois",
        profileImageUrl: null,
        tasks: ["MODERATE"],
        username: null,
      },
    ];
    metaClient.instagramAccounts.set("200000000000002", {
      displayName: "Instagram Profissional",
      id: "200000000000002",
      profileImageUrl: "https://images.example/instagram.jpg",
      username: "instagram_profissional",
    });

    const state = await startOAuth(account.cookie);
    const completed = await callback(account.cookie, state);
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta=connected`,
    );
    expect(completed.headers.get("location")).not.toMatch(/code|state|token/i);

    const publicAccounts = await listAccounts(account.cookie);
    expect(publicAccounts).toHaveLength(3);
    expect(publicAccounts.map((item) => item.provider).sort()).toEqual([
      "facebook",
      "facebook",
      "instagram",
    ]);
    const publicPayload = JSON.stringify(publicAccounts);
    expect(publicPayload).not.toContain("plaintext");
    expect(publicPayload).not.toContain("Encrypted");

    const connection = await pool.query<{
      access_token_encrypted: Buffer;
      access_token_expires_at: Date;
      external_user_id: string;
      scopes: string[];
      tenant_id: string;
    }>(`
      SELECT tenant_id, external_user_id, access_token_encrypted,
             access_token_expires_at, scopes
      FROM oauth_connections
      WHERE platform = 'meta'
    `);
    expect(connection.rows).toHaveLength(1);
    expect(connection.rows[0]?.tenant_id).toBe(account.session.tenant.id);
    expect(connection.rows[0]?.external_user_id).toBe("998877665544332211");
    expect(connection.rows[0]?.scopes).toEqual([
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
    ]);
    const encryptedUserToken = connection.rows[0]!.access_token_encrypted.toString(
      "utf8",
    );
    expect(encryptedUserToken).not.toBe(metaClient.userToken);
    expect(cipher.decryptSecret(encryptedUserToken)).toBe(metaClient.userToken);
    expect(connection.rows[0]?.access_token_expires_at.toISOString()).toBe(
      metaClient.userTokenExpiresAt,
    );

    const credentials = await pool.query<{
      account_type: string;
      access_token_encrypted: Buffer;
      access_token_expires_at: Date | null;
      external_account_id: string;
      tenant_id: string;
    }>(`
      SELECT account_row.tenant_id,
             account_row.account_type::text AS account_type,
             account_row.external_account_id,
             credential_row.access_token_encrypted,
             credential_row.access_token_expires_at
      FROM social_accounts account_row
      JOIN social_account_credentials credential_row
        ON credential_row.social_account_id = account_row.id
      ORDER BY account_row.external_account_id
    `);
    expect(credentials.rows).toHaveLength(3);
    expect(credentials.rows.every((row) => row.tenant_id === account.session.tenant.id)).toBe(
      true,
    );
    expect(credentials.rows.map((row) => row.account_type).sort()).toEqual([
      "facebook_page",
      "facebook_page",
      "instagram_business",
    ]);
    expect(
      credentials.rows.map((row) =>
        cipher.decryptSecret(row.access_token_encrypted.toString("utf8")),
      ),
    ).toEqual([
      "page-token-one-plaintext",
      "page-token-two-plaintext",
      "page-token-two-plaintext",
    ]);
    expect(
      credentials.rows.every((row) => row.access_token_expires_at === null),
    ).toBe(true);

    const replay = await callback(account.cookie, state);
    expect(replay.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=invalid_state`,
    );

    const instagram = publicAccounts.find(
      (item) => item.provider === "instagram",
    )!;
    const disconnected = await apiFetch(
      `${baseUrl}/social-accounts/${instagram.id}`,
      { headers: { Cookie: account.cookie }, method: "DELETE" },
    );
    expect(disconnected.status).toBe(200);

    metaClient.userToken = "meta-long-user-token-reconnected";
    metaClient.pages[1] = {
      ...metaClient.pages[1]!,
      accessToken: "page-token-two-reconnected",
    };
    const reconnectState = await startOAuth(account.cookie);
    expect((await callback(account.cookie, reconnectState)).status).toBe(302);

    const reconnected = (await listAccounts(account.cookie)).find(
      (item) => item.provider === "instagram",
    )!;
    expect(reconnected.id).toBe(instagram.id);
    expect(reconnected.status).toBe("connected");
    expect(reconnected.disconnectedAt).toBeNull();
    const reconnectedCredential = await pool.query<{
      access_token_encrypted: Buffer;
    }>(`
      SELECT access_token_encrypted
      FROM social_account_credentials
      WHERE social_account_id = $1::uuid
    `, [instagram.id]);
    expect(
      cipher.decryptSecret(
        reconnectedCredential.rows[0]!.access_token_encrypted.toString("utf8"),
      ),
    ).toBe("page-token-two-reconnected");
    const count = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM social_accounts
    `);
    expect(count.rows[0]?.count).toBe(3);
  });

  it("preserva Instagram existente quando o enriquecimento falha transitoriamente", async () => {
    const account = await register();
    metaClient.pages = [
      {
        accessToken: "page-token-preserved",
        id: "100000000000010",
        instagramBusinessAccountId: "200000000000010",
        name: "Página com Instagram",
        profileImageUrl: null,
        tasks: ["ANALYZE"],
        username: null,
      },
    ];
    metaClient.instagramAccounts.set("200000000000010", {
      displayName: "Instagram preservado",
      id: "200000000000010",
      profileImageUrl: null,
      username: "instagram_preservado",
    });

    const initialState = await startOAuth(account.cookie);
    expect((await callback(account.cookie, initialState)).status).toBe(302);
    const initialAccounts = await listAccounts(account.cookie);
    const initialInstagram = initialAccounts.find(
      (item) => item.provider === "instagram",
    )!;
    expect(initialInstagram.status).toBe("connected");

    const credentialBefore = await pool.query<{
      access_token_encrypted: Buffer | null;
    }>(
      `
        SELECT access_token_encrypted
        FROM social_account_credentials
        WHERE social_account_id = $1::uuid
      `,
      [initialInstagram.id],
    );
    const encryptedBefore = credentialBefore.rows[0]?.access_token_encrypted;
    expect(encryptedBefore).not.toBeNull();

    metaClient.instagramAccounts.clear();
    const retryState = await startOAuth(account.cookie);
    expect((await callback(account.cookie, retryState)).status).toBe(302);

    const afterTransientFailure = await listAccounts(account.cookie);
    const preservedInstagram = afterTransientFailure.find(
      (item) => item.provider === "instagram",
    )!;
    const preservedFacebook = afterTransientFailure.find(
      (item) => item.provider === "facebook",
    )!;
    expect(preservedInstagram).toEqual(
      expect.objectContaining({
        disconnectedAt: null,
        id: initialInstagram.id,
        status: "connected",
      }),
    );
    expect(preservedFacebook.status).toBe("connected");
    expect(afterTransientFailure).toHaveLength(2);

    const credentialAfter = await pool.query<{
      access_token_encrypted: Buffer | null;
    }>(
      `
        SELECT access_token_encrypted
        FROM social_account_credentials
        WHERE social_account_id = $1::uuid
      `,
      [initialInstagram.id],
    );
    expect(credentialAfter.rows[0]?.access_token_encrypted).toEqual(
      encryptedBefore,
    );
    expect(
      cipher.decryptSecret(
        credentialAfter.rows[0]!.access_token_encrypted!.toString("utf8"),
      ),
    ).toBe("page-token-preserved");

    metaClient.pages[0] = {
      ...metaClient.pages[0]!,
      instagramBusinessAccountId: null,
    };
    const confirmedAbsentState = await startOAuth(account.cookie);
    expect((await callback(account.cookie, confirmedAbsentState)).status).toBe(
      302,
    );

    const afterConfirmedAbsence = await listAccounts(account.cookie);
    const revokedInstagram = afterConfirmedAbsence.find(
      (item) => item.id === initialInstagram.id,
    )!;
    expect(revokedInstagram.status).toBe("revoked");
    expect(revokedInstagram.disconnectedAt).not.toBeNull();
    const clearedCredential = await pool.query<{
      access_token_encrypted: Buffer | null;
    }>(
      `
        SELECT access_token_encrypted
        FROM social_account_credentials
        WHERE social_account_id = $1::uuid
      `,
      [initialInstagram.id],
    );
    expect(clearedCredential.rows[0]?.access_token_encrypted).toBeNull();
  });

  it.each(["logout", "workspace_rotation", "expiry"] as const)(
    "não persiste credenciais quando a sessão sofre %s durante chamadas Meta",
    async (invalidation) => {
      const account = await register();
      const workspaceB =
        invalidation === "workspace_rotation"
          ? await addWorkspace(account.session.user.id)
          : null;
      metaClient.pages = [
        {
          accessToken: "page-token-that-must-not-persist",
          id: "100000000000020",
          instagramBusinessAccountId: null,
          name: "Página não persistida",
          profileImageUrl: null,
          tasks: [],
          username: null,
        },
      ];
      const state = await startOAuth(account.cookie);
      const barrier: MetaListPagesBarrier = {
        entered: deferred<void>(),
        release: deferred<void>(),
      };
      metaClient.listPagesBarrier = barrier;

      const pendingCallback = callback(account.cookie, state);
      await barrier.entered.promise;

      try {
        if (invalidation === "logout") {
          const response = await apiFetch(`${baseUrl}/auth/logout`, {
            headers: { Cookie: account.cookie },
            method: "POST",
          });
          expect(response.status).toBe(204);
        } else if (invalidation === "workspace_rotation") {
          await selectWorkspace(account.cookie, workspaceB!.tenantId);
        } else {
          await pool.query(
            `
              UPDATE auth_sessions session
              SET created_at = now() - interval '2 minutes',
                  expires_at = now() - interval '1 second'
              FROM tenant_members member
              WHERE member.id = session.membership_id
                AND member.user_id = $1::uuid
            `,
            [account.session.user.id],
          );
        }
      } finally {
        barrier.release.resolve();
      }
      const completed = await pendingCallback;
      expect(completed.headers.get("location")).toBe(
        `${CORS_ORIGIN}/#/canais?meta_error=session_expired`,
      );

      const persisted = await pool.query<{
        connections: number;
        credentials: number;
        social_accounts: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM oauth_connections) AS connections,
          (SELECT count(*)::int FROM social_accounts) AS social_accounts,
          (SELECT count(*)::int FROM social_account_credentials) AS credentials
      `);
      expect(persisted.rows[0]).toEqual({
        connections: 0,
        credentials: 0,
        social_accounts: 0,
      });
    },
  );

  it("serializa desconexões da mesma conexão e revoga o último token", async () => {
    const account = await register();
    metaClient.pages = [
      {
        accessToken: "shared-page-token",
        id: "100000000000030",
        instagramBusinessAccountId: "200000000000030",
        name: "Página compartilhada",
        profileImageUrl: null,
        tasks: [],
        username: null,
      },
    ];
    metaClient.instagramAccounts.set("200000000000030", {
      displayName: "Instagram compartilhado",
      id: "200000000000030",
      profileImageUrl: null,
      username: "instagram_compartilhado",
    });

    const initialState = await startOAuth(account.cookie);
    expect((await callback(account.cookie, initialState)).status).toBe(302);
    const initialAccounts = await listAccounts(account.cookie);
    expect(initialAccounts).toHaveLength(2);

    const facebook = initialAccounts.find(
      (socialAccount) => socialAccount.provider === "facebook",
    )!;
    const oneDisconnected = await apiFetch(
      `${baseUrl}/social-accounts/${facebook.id}`,
      { headers: { Cookie: account.cookie }, method: "DELETE" },
    );
    expect(oneDisconnected.status).toBe(200);
    const stillActive = await pool.query<{
      access_token_encrypted: Buffer | null;
      active_accounts: number;
      status: string;
    }>(`
      SELECT connection_row.status::text AS status,
             connection_row.access_token_encrypted,
             count(account_row.id) FILTER (WHERE account_row.is_active)::int AS active_accounts
      FROM oauth_connections connection_row
      LEFT JOIN social_accounts account_row
        ON account_row.oauth_connection_id = connection_row.id
      GROUP BY connection_row.id
    `);
    expect(stillActive.rows[0]?.status).toBe("active");
    expect(stillActive.rows[0]?.active_accounts).toBe(1);
    expect(stillActive.rows[0]?.access_token_encrypted).not.toBeNull();

    const reconnectState = await startOAuth(account.cookie);
    expect((await callback(account.cookie, reconnectState)).status).toBe(302);
    const reconnectedAccounts = await listAccounts(account.cookie);
    expect(reconnectedAccounts.every((item) => item.status === "connected")).toBe(
      true,
    );

    const disconnectResponses = await Promise.all(
      reconnectedAccounts.map((socialAccount) =>
        apiFetch(`${baseUrl}/social-accounts/${socialAccount.id}`, {
          headers: { Cookie: account.cookie },
          method: "DELETE",
        }),
      ),
    );
    expect(disconnectResponses.map((response) => response.status)).toEqual([
      200,
      200,
    ]);

    const finalState = await pool.query<{
      access_token_encrypted: Buffer | null;
      active_accounts: number;
      refresh_token_encrypted: Buffer | null;
      revoked_accounts: number;
      residual_account_credentials: number;
      status: string;
    }>(`
      SELECT connection_row.status::text AS status,
             connection_row.access_token_encrypted,
             connection_row.refresh_token_encrypted,
             count(account_row.id) FILTER (WHERE account_row.is_active)::int AS active_accounts,
             count(account_row.id) FILTER (
               WHERE NOT account_row.is_active
                 AND account_row.disconnected_at IS NOT NULL
             )::int AS revoked_accounts,
             count(credential_row.social_account_id) FILTER (
               WHERE credential_row.access_token_encrypted IS NOT NULL
                  OR credential_row.refresh_token_encrypted IS NOT NULL
             )::int AS residual_account_credentials
      FROM oauth_connections connection_row
      LEFT JOIN social_accounts account_row
        ON account_row.oauth_connection_id = connection_row.id
      LEFT JOIN social_account_credentials credential_row
        ON credential_row.social_account_id = account_row.id
      GROUP BY connection_row.id
    `);
    expect(finalState.rows[0]).toEqual({
      access_token_encrypted: null,
      active_accounts: 0,
      refresh_token_encrypted: null,
      revoked_accounts: 2,
      residual_account_credentials: 0,
      status: "revoked",
    });
  });

  it("rejeita falhas seguras e invalida OAuth quando a sessão troca de Workspace", async () => {
    const account = await register();
    const noCodeState = await startOAuth(account.cookie);
    const noCode = await callback(account.cookie, noCodeState, {});
    expect(noCode.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=provider_error`,
    );

    const noAccountsState = await startOAuth(account.cookie);
    const noAccounts = await callback(account.cookie, noAccountsState);
    expect(noAccounts.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=no_accounts`,
    );

    const invalid = await callback(account.cookie, "a".repeat(43));
    expect(invalid.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=invalid_state`,
    );

    const workspaceB = await addWorkspace(account.session.user.id);
    const stateA = await startOAuth(account.cookie);
    const selectedB = await selectWorkspace(account.cookie, workspaceB.tenantId);
    expect(selectedB.session.tenant.id).toBe(workspaceB.tenantId);
    const staleStateCount = await pool.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM oauth_authorization_requests
      WHERE state_hash = $1
    `, [createHash("sha256").update(stateA).digest("hex")]);
    expect(staleStateCount.rows[0]?.count).toBe(0);

    const oldSessionCallback = await callback(account.cookie, stateA);
    expect(oldSessionCallback.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=session_expired`,
    );
    const newSessionCallback = await callback(selectedB.cookie, stateA);
    expect(newSessionCallback.headers.get("location")).toBe(
      `${CORS_ORIGIN}/#/canais?meta_error=invalid_state`,
    );

    metaClient.pages = [
      {
        accessToken: "workspace-b-page-token",
        id: "300000000000003",
        instagramBusinessAccountId: null,
        name: "Página Workspace B",
        profileImageUrl: null,
        tasks: [],
        username: null,
      },
    ];
    const stateB = await startOAuth(selectedB.cookie);
    expect((await callback(selectedB.cookie, stateB)).status).toBe(302);
    const accountsB = await listAccounts(selectedB.cookie);
    expect(accountsB.map((item) => item.displayName)).toEqual([
      "Página Workspace B",
    ]);

    const selectedA = await selectWorkspace(
      selectedB.cookie,
      account.session.tenant.id,
    );
    await expect(listAccounts(selectedA.cookie)).resolves.toEqual([]);
    const revokedB = await apiFetch(`${baseUrl}/auth/me`, {
      headers: { Cookie: selectedB.cookie },
    });
    expect(revokedB.status).toBe(401);
  });
});
