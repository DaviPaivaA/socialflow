import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  type AuthWorkspace,
  isAuthSession,
  type AuthSession,
  type LoginInput,
  type RegisterInput,
  type TenantRole,
} from "../../shared/authContract.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { readSessionToken } from "./sessionCookie.ts";

type SafeAuthUserRow = QueryResultRow & {
  display_name: string;
  email: string;
  id: string;
  is_active: boolean;
};

type AuthUserRow = SafeAuthUserRow & {
  password_hash: string | null;
};

type MembershipRow = QueryResultRow & {
  membership_id: string;
  role: TenantRole;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
};

type AuthenticatedRow = SafeAuthUserRow & MembershipRow & {
  session_id: string;
};

type Queryable = Pick<Pool | PoolClient, "query">;

export type AuthContext = AuthSession & {
  membershipId: string;
  sessionId: string;
};

export type CreatedAuthSession = {
  context: AuthContext;
  token: string;
};

export class DuplicateEmailError extends Error {
  constructor() {
    super("Já existe uma conta com este email.");
    this.name = "DuplicateEmailError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Email ou senha inválidos.");
    this.name = "InvalidCredentialsError";
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Autenticação necessária.");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenWorkspaceError extends Error {
  constructor() {
    super("O workspace solicitado não está disponível para este usuário.");
    this.name = "ForbiddenWorkspaceError";
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createTenantSlug(displayName: string): string {
  const base = displayName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

  return `${base}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function mapContext(row: AuthenticatedRow): AuthContext {
  const session: AuthSession = {
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      role: row.role,
      slug: row.tenant_slug,
    },
    user: {
      displayName: row.display_name,
      email: row.email,
      id: row.id,
    },
  };

  if (!isAuthSession(session)) {
    throw new Error("O banco retornou um contexto de autenticação inválido.");
  }

  return {
    ...session,
    membershipId: row.membership_id,
    sessionId: row.session_id,
  };
}

function isUniqueEmailError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "uq_users_email"
  );
}

export class PostgresAuthService {
  private readonly pool: Pool;
  private readonly sessionTtlSeconds: number;

  constructor(
    pool: Pool,
    sessionTtlSeconds: number,
  ) {
    this.pool = pool;
    this.sessionTtlSeconds = sessionTtlSeconds;
  }

  private async cleanupExpiredSessions(queryable: Queryable): Promise<void> {
    await queryable.query("DELETE FROM auth_sessions WHERE expires_at <= now()");
  }

  private async createSession(
    queryable: Queryable,
    user: SafeAuthUserRow,
    membership: MembershipRow,
  ): Promise<CreatedAuthSession> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000);
    const result = await queryable.query<{ id: string }>(
      `
        INSERT INTO auth_sessions (token_hash, membership_id, expires_at)
        VALUES ($1, $2::uuid, $3::timestamptz)
        RETURNING id
      `,
      [tokenHash, membership.membership_id, expiresAt.toISOString()],
    );
    const sessionId = result.rows[0]?.id;
    if (!sessionId) throw new Error("A sessão criada não foi retornada.");

    return {
      context: mapContext({ ...user, ...membership, session_id: sessionId }),
      token,
    };
  }

  async register(input: RegisterInput): Promise<CreatedAuthSession> {
    const passwordHash = await hashPassword(input.password);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await this.cleanupExpiredSessions(client);
      const userResult = await client.query<AuthUserRow>(
        `
          INSERT INTO users (
            email,
            password_hash,
            display_name,
            is_active
          )
          VALUES ($1, $2, $3, true)
          RETURNING id, email, password_hash, display_name, is_active
        `,
        [input.email, passwordHash, input.displayName],
      );
      const user = userResult.rows[0];
      if (!user) throw new Error("O usuário criado não foi retornado.");

      const tenantResult = await client.query<{
        id: string;
        name: string;
        slug: string;
      }>(
        `
          INSERT INTO tenants (name, slug)
          VALUES ($1, $2)
          RETURNING id, name, slug
        `,
        [`Workspace de ${input.displayName}`, createTenantSlug(input.displayName)],
      );
      const tenant = tenantResult.rows[0];
      if (!tenant) throw new Error("O tenant criado não foi retornado.");

      const membershipResult = await client.query<{
        id: string;
        role: TenantRole;
      }>(
        `
          INSERT INTO tenant_members (tenant_id, user_id, role)
          VALUES ($1::uuid, $2::uuid, 'owner')
          RETURNING id, role
        `,
        [tenant.id, user.id],
      );
      const membershipResultRow = membershipResult.rows[0];
      if (!membershipResultRow) {
        throw new Error("O membership criado não foi retornado.");
      }
      const membership: MembershipRow = {
        membership_id: membershipResultRow.id,
        role: membershipResultRow.role,
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        tenant_slug: tenant.slug,
      };
      const session = await this.createSession(client, user, membership);

      await client.query("COMMIT");
      return session;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueEmailError(error)) throw new DuplicateEmailError();
      throw error;
    } finally {
      client.release();
    }
  }

  async login(input: LoginInput): Promise<CreatedAuthSession> {
    await this.cleanupExpiredSessions(this.pool);
    const userResult = await this.pool.query<AuthUserRow>(
      `
        SELECT id, email, password_hash, display_name, is_active
        FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1
      `,
      [input.email],
    );
    const user = userResult.rows[0];
    const validPassword = await verifyPassword(user?.password_hash, input.password);
    if (!user || !user.is_active || !validPassword) {
      throw new InvalidCredentialsError();
    }

    const membershipResult = await this.pool.query<MembershipRow>(
      `
        SELECT
          member.id AS membership_id,
          member.role,
          tenant.id AS tenant_id,
          tenant.name AS tenant_name,
          tenant.slug AS tenant_slug
        FROM tenant_members member
        JOIN tenants tenant ON tenant.id = member.tenant_id
        WHERE member.user_id = $1::uuid
        ORDER BY member.created_at ASC, member.id ASC
        LIMIT 1
      `,
      [user.id],
    );
    const membership = membershipResult.rows[0];
    if (!membership) throw new InvalidCredentialsError();

    return this.createSession(this.pool, user, membership);
  }

  async authenticate(request: IncomingMessage): Promise<AuthContext | null> {
    const token = readSessionToken(request);
    if (!token) return null;
    const tokenHash = hashSessionToken(token);

    const result = await this.pool.query<AuthenticatedRow>(
      `
        SELECT
          session.id AS session_id,
          member.id AS membership_id,
          member.role,
          tenant.id AS tenant_id,
          tenant.name AS tenant_name,
          tenant.slug AS tenant_slug,
          app_user.id,
          app_user.email,
          app_user.display_name,
          app_user.is_active
        FROM auth_sessions session
        JOIN tenant_members member ON member.id = session.membership_id
        JOIN tenants tenant ON tenant.id = member.tenant_id
        JOIN users app_user ON app_user.id = member.user_id
        WHERE session.token_hash = $1
          AND session.expires_at > now()
          AND app_user.is_active
        LIMIT 1
      `,
      [tokenHash],
    );
    const row = result.rows[0];
    if (row) return mapContext(row);

    await this.pool.query(
      "DELETE FROM auth_sessions WHERE token_hash = $1 OR expires_at <= now()",
      [tokenHash],
    );
    return null;
  }

  async require(request: IncomingMessage): Promise<AuthContext> {
    const context = await this.authenticate(request);
    if (!context) throw new UnauthorizedError();
    return context;
  }

  async logout(request: IncomingMessage): Promise<void> {
    const token = readSessionToken(request);
    if (!token) return;
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
      hashSessionToken(token),
    ]);
  }

  async listWorkspaces(request: IncomingMessage): Promise<AuthWorkspace[]> {
    const context = await this.require(request);
    const result = await this.pool.query<MembershipRow>(
      `
        SELECT
          member.id AS membership_id,
          member.role,
          tenant.id AS tenant_id,
          tenant.name AS tenant_name,
          tenant.slug AS tenant_slug
        FROM tenant_members member
        JOIN tenants tenant ON tenant.id = member.tenant_id
        WHERE member.user_id = $1::uuid
        ORDER BY member.created_at ASC, member.id ASC
      `,
      [context.user.id],
    );

    const workspaces = result.rows.map((membership) => ({
      name: membership.tenant_name,
      role: membership.role,
      selected: membership.membership_id === context.membershipId,
      slug: membership.tenant_slug,
      tenantId: membership.tenant_id,
    }));
    if (workspaces.filter((workspace) => workspace.selected).length !== 1) {
      throw new UnauthorizedError();
    }
    return workspaces;
  }

  async selectWorkspace(
    request: IncomingMessage,
    tenantId: string,
  ): Promise<CreatedAuthSession> {
    const current = await this.require(request);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const currentSession = await client.query<{ id: string }>(
        `
          SELECT session.id
          FROM auth_sessions session
          JOIN tenant_members member ON member.id = session.membership_id
          WHERE session.id = $1::uuid
            AND session.membership_id = $2::uuid
            AND member.user_id = $3::uuid
            AND session.expires_at > now()
          FOR UPDATE OF session
        `,
        [current.sessionId, current.membershipId, current.user.id],
      );
      if (!currentSession.rows[0]) throw new UnauthorizedError();

      const membershipResult = await client.query<AuthenticatedRow>(
        `
          SELECT
            ''::text AS session_id,
            member.id AS membership_id,
            member.role,
            tenant.id AS tenant_id,
            tenant.name AS tenant_name,
            tenant.slug AS tenant_slug,
            app_user.id,
            app_user.email,
            app_user.display_name,
            app_user.is_active
          FROM users app_user
          JOIN tenant_members member ON member.user_id = app_user.id
          JOIN tenants tenant ON tenant.id = member.tenant_id
          WHERE app_user.id = $1::uuid
            AND tenant.id = $2::uuid
            AND app_user.is_active
          ORDER BY member.created_at ASC, member.id ASC
          LIMIT 1
        `,
        [current.user.id, tenantId],
      );
      const membership = membershipResult.rows[0];
      if (!membership) throw new ForbiddenWorkspaceError();

      await this.cleanupExpiredSessions(client);
      const rotated = await this.createSession(client, membership, membership);
      const revoked = await client.query(
        "DELETE FROM auth_sessions WHERE id = $1::uuid",
        [current.sessionId],
      );
      if (revoked.rowCount !== 1) throw new UnauthorizedError();

      await client.query("COMMIT");
      return rotated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
