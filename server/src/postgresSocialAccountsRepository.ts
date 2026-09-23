import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  isSocialAccount,
  type SocialAccount,
  type SocialAccountProvider,
  type SocialAccountStatus,
  type UpdateSocialAccountInput,
} from "../../shared/socialAccountContract.ts";
import type {
  MetaAuthorizationContext,
  PersistMetaAuthorizationInput,
  PersistSocialAccountInput,
  SocialAccountsContext,
  SocialAccountsRepository,
} from "./socialAccountsRepository.ts";
import { InvalidMetaAuthorizationContextError } from "./socialAccountsRepository.ts";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type SocialAccountRow = QueryResultRow & {
  access_token_expires_at: unknown;
  account_type: unknown;
  avatar_url: unknown;
  connection_status: unknown;
  created_at: unknown;
  disconnected_at: unknown;
  display_name: unknown;
  external_account_id: unknown;
  id: unknown;
  is_active: unknown;
  oauth_connection_id: unknown;
  scopes: unknown;
  updated_at: unknown;
  username: unknown;
};

type ContextValidationRow = QueryResultRow & {
  membership_exists: boolean;
  tenant_exists: boolean;
  user_exists: boolean;
};

type CreatedConnectionRow = QueryResultRow & { id: string };
type AccountConnectionRow = QueryResultRow & { oauth_connection_id: string };
type CreatedAccountRow = QueryResultRow & { id: string };

const PUBLIC_SELECT = `
  account_row.id,
  account_row.oauth_connection_id,
  account_row.account_type,
  account_row.external_account_id,
  account_row.username,
  account_row.display_name,
  account_row.avatar_url,
  account_row.is_active,
  account_row.created_at,
  account_row.updated_at,
  account_row.disconnected_at,
  connection_row.status AS connection_status,
  connection_row.scopes,
  credential_row.access_token_expires_at
`;

export class InvalidSocialAccountsContextError extends Error {
  constructor() {
    super("O contexto autenticado não é válido para contas sociais.");
    this.name = "InvalidSocialAccountsContextError";
  }
}

export class DuplicateSocialAccountError extends Error {
  constructor() {
    super("Esta conta social já foi registrada neste Workspace.");
    this.name = "DuplicateSocialAccountError";
  }
}

function normalizeTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function providerFromAccountType(value: unknown): SocialAccountProvider | null {
  if (value === "instagram_business") return "instagram";
  if (value === "facebook_page") return "facebook";
  if (value === "tiktok_account") return "tiktok";
  return null;
}

function accountTypeFromProvider(provider: SocialAccountProvider): string {
  if (provider === "instagram") return "instagram_business";
  if (provider === "facebook") return "facebook_page";
  return "tiktok_account";
}

function platformFromProvider(provider: SocialAccountProvider): string {
  return provider === "tiktok" ? "tiktok" : "meta";
}

function controlledConnectionSubject(
  provider: SocialAccountProvider,
  providerAccountId: string,
): string {
  return createHash("sha256")
    .update(`${provider}:${providerAccountId}`, "utf8")
    .digest("hex");
}

function databaseStatus(status: Exclude<SocialAccountStatus, "revoked">): string {
  return status === "connected" ? "active" : status;
}

export function deriveSocialAccountStatus(
  value: unknown,
  active: unknown,
  disconnectedAt: string | null,
  tokenExpiresAt: string | null,
  now = Date.now(),
): SocialAccountStatus | null {
  if (active === false) return disconnectedAt ? "revoked" : "error";
  if (value === "active") {
    return tokenExpiresAt !== null && Date.parse(tokenExpiresAt) <= now
      ? "expired"
      : "connected";
  }
  if (
    value === "pending" ||
    value === "expired" ||
    value === "revoked" ||
    value === "error"
  ) {
    return value;
  }
  return null;
}

function mapSocialAccountRow(row: SocialAccountRow): SocialAccount {
  const provider = providerFromAccountType(row.account_type);
  const disconnectedAt = normalizeTimestamp(row.disconnected_at);
  const tokenExpiresAt = normalizeTimestamp(row.access_token_expires_at);
  const status = deriveSocialAccountStatus(
    row.connection_status,
    row.is_active,
    disconnectedAt,
    tokenExpiresAt,
  );
  const displayName =
    typeof row.display_name === "string" && row.display_name.trim()
      ? row.display_name
      : typeof row.username === "string" && row.username.trim()
        ? row.username
        : row.external_account_id;
  const socialAccount = {
    createdAt: normalizeTimestamp(row.created_at),
    disconnectedAt,
    displayName,
    id: row.id,
    profileImageUrl: row.avatar_url,
    provider,
    providerAccountId: row.external_account_id,
    scopes: row.scopes,
    status,
    tokenExpiresAt,
    updatedAt: normalizeTimestamp(row.updated_at),
    username: row.username,
  };

  if (!isSocialAccount(socialAccount)) {
    throw new Error("O banco retornou uma conta social incompatível.");
  }
  return socialAccount;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

async function assertContextWith(
  queryable: Queryable,
  context: SocialAccountsContext,
): Promise<void> {
  const result = await queryable.query<ContextValidationRow>(
    `
      SELECT
        EXISTS (SELECT 1 FROM tenants WHERE id = $1::uuid) AS tenant_exists,
        EXISTS (SELECT 1 FROM users WHERE id = $2::uuid) AS user_exists,
        EXISTS (
          SELECT 1
          FROM tenant_members
          WHERE tenant_id = $1::uuid
            AND user_id = $2::uuid
        ) AS membership_exists
    `,
    [context.tenantId, context.authorUserId],
  );
  const validation = result.rows[0];
  if (
    !validation?.tenant_exists ||
    !validation.user_exists ||
    !validation.membership_exists
  ) {
    throw new InvalidSocialAccountsContextError();
  }
}

async function lockMetaAuthorizationContextWith(
  client: PoolClient,
  context: MetaAuthorizationContext,
): Promise<void> {
  const result = await client.query(
    `
      SELECT session.id
      FROM auth_sessions session
      JOIN tenant_members member
        ON member.id = session.membership_id
      JOIN users app_user
        ON app_user.id = member.user_id
      JOIN oauth_authorization_requests request_row
        ON request_row.auth_session_id = session.id
       AND request_row.membership_id = session.membership_id
      WHERE session.id = $3::uuid
        AND session.membership_id = $4::uuid
        AND session.expires_at > now()
        AND member.tenant_id = $1::uuid
        AND member.user_id = $2::uuid
        AND app_user.is_active
        AND request_row.provider = 'meta'::social_platform
        AND request_row.state_hash = $5
        AND request_row.consumed_at IS NOT NULL
        AND request_row.expires_at > now()
      FOR UPDATE OF session, request_row
    `,
    [
      context.tenantId,
      context.authorUserId,
      context.sessionId,
      context.membershipId,
      context.stateHash,
    ],
  );
  if (result.rowCount !== 1) {
    throw new InvalidMetaAuthorizationContextError();
  }
}

async function findByIdWith(
  queryable: Queryable,
  context: SocialAccountsContext,
  id: string,
): Promise<SocialAccount | null> {
  const result = await queryable.query<SocialAccountRow>(
    `
      SELECT ${PUBLIC_SELECT}
      FROM social_accounts account_row
      JOIN oauth_connections connection_row
        ON connection_row.tenant_id = account_row.tenant_id
       AND connection_row.id = account_row.oauth_connection_id
      LEFT JOIN social_account_credentials credential_row
        ON credential_row.tenant_id = account_row.tenant_id
       AND credential_row.social_account_id = account_row.id
      WHERE account_row.tenant_id = $1::uuid
        AND account_row.id = $2::uuid
    `,
    [context.tenantId, id],
  );
  return result.rows[0] ? mapSocialAccountRow(result.rows[0]) : null;
}

export class PostgresSocialAccountsRepository
  implements SocialAccountsRepository
{
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  assertContext(context: SocialAccountsContext): Promise<void> {
    return assertContextWith(this.pool, context);
  }

  async list(context: SocialAccountsContext): Promise<SocialAccount[]> {
    await this.assertContext(context);
    const result = await this.pool.query<SocialAccountRow>(
      `
        SELECT ${PUBLIC_SELECT}
        FROM social_accounts account_row
        JOIN oauth_connections connection_row
          ON connection_row.tenant_id = account_row.tenant_id
         AND connection_row.id = account_row.oauth_connection_id
        LEFT JOIN social_account_credentials credential_row
          ON credential_row.tenant_id = account_row.tenant_id
         AND credential_row.social_account_id = account_row.id
        WHERE account_row.tenant_id = $1::uuid
        ORDER BY account_row.created_at ASC, account_row.id ASC
      `,
      [context.tenantId],
    );
    return result.rows.map(mapSocialAccountRow);
  }

  async findById(
    context: SocialAccountsContext,
    id: string,
  ): Promise<SocialAccount | null> {
    await this.assertContext(context);
    return findByIdWith(this.pool, context, id);
  }

  async register(
    context: SocialAccountsContext,
    input: PersistSocialAccountInput,
  ): Promise<SocialAccount> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await assertContextWith(client, context);
      const connection = await client.query<CreatedConnectionRow>(
        `
          INSERT INTO oauth_connections (
            tenant_id,
            created_by_user_id,
            platform,
            external_user_id,
            access_token_encrypted,
            refresh_token_encrypted,
            access_token_expires_at,
            scopes,
            status,
            metadata
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            $3::social_platform,
            $4,
            $5::bytea,
            $6::bytea,
            $7::timestamptz,
            $8::text[],
            $9::oauth_connection_status,
            $10::jsonb
          )
          RETURNING id
        `,
        [
          context.tenantId,
          context.authorUserId,
          platformFromProvider(input.provider),
          controlledConnectionSubject(input.provider, input.providerAccountId),
          input.accessTokenEncrypted
            ? Buffer.from(input.accessTokenEncrypted, "utf8")
            : null,
          input.refreshTokenEncrypted
            ? Buffer.from(input.refreshTokenEncrypted, "utf8")
            : null,
          input.tokenExpiresAt ?? null,
          input.scopes ?? [],
          databaseStatus(input.status ?? "pending"),
          JSON.stringify(input.providerMetadata ?? {}),
        ],
      );
      const connectionId = connection.rows[0]?.id;
      if (!connectionId) {
        throw new Error("O banco não retornou a conexão social criada.");
      }

      const account = await client.query<QueryResultRow & { id: string }>(
        `
          INSERT INTO social_accounts (
            tenant_id,
            oauth_connection_id,
            account_type,
            external_account_id,
            username,
            display_name,
            avatar_url,
            metadata
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            $3::social_account_type,
            $4,
            $5,
            $6,
            $7,
            '{}'::jsonb
          )
          RETURNING id
        `,
        [
          context.tenantId,
          connectionId,
          accountTypeFromProvider(input.provider),
          input.providerAccountId,
          input.username ?? null,
          input.displayName,
          input.profileImageUrl ?? null,
        ],
      );
      const accountId = account.rows[0]?.id;
      if (!accountId) {
        throw new Error("O banco não retornou a conta social criada.");
      }

      await client.query(
        `
          INSERT INTO social_account_credentials (
            tenant_id,
            social_account_id,
            access_token_encrypted,
            refresh_token_encrypted,
            access_token_expires_at
          )
          VALUES ($1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::timestamptz)
        `,
        [
          context.tenantId,
          accountId,
          input.accessTokenEncrypted
            ? Buffer.from(input.accessTokenEncrypted, "utf8")
            : null,
          input.refreshTokenEncrypted
            ? Buffer.from(input.refreshTokenEncrypted, "utf8")
            : null,
          input.tokenExpiresAt ?? null,
        ],
      );

      const created = await findByIdWith(client, context, accountId);
      if (!created) throw new Error("A conta social criada não foi localizada.");
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) throw new DuplicateSocialAccountError();
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertMetaAuthorization(
    context: MetaAuthorizationContext,
    input: PersistMetaAuthorizationInput,
  ): Promise<SocialAccount[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await lockMetaAuthorizationContextWith(client, context);
      const connection = await client.query<CreatedConnectionRow>(
        `
          INSERT INTO oauth_connections (
            tenant_id,
            created_by_user_id,
            platform,
            external_user_id,
            access_token_encrypted,
            refresh_token_encrypted,
            access_token_expires_at,
            refresh_token_expires_at,
            scopes,
            status,
            metadata,
            revoked_at
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            'meta'::social_platform,
            $3,
            $4::bytea,
            NULL,
            $5::timestamptz,
            NULL,
            $6::text[],
            'active'::oauth_connection_status,
            '{"flow":"facebook_login"}'::jsonb,
            NULL
          )
          ON CONFLICT (tenant_id, platform, external_user_id)
          DO UPDATE SET
            created_by_user_id = EXCLUDED.created_by_user_id,
            access_token_encrypted = EXCLUDED.access_token_encrypted,
            refresh_token_encrypted = NULL,
            access_token_expires_at = EXCLUDED.access_token_expires_at,
            refresh_token_expires_at = NULL,
            scopes = EXCLUDED.scopes,
            status = 'active'::oauth_connection_status,
            metadata = EXCLUDED.metadata,
            revoked_at = NULL,
            updated_at = now()
          RETURNING id
        `,
        [
          context.tenantId,
          context.authorUserId,
          input.externalUserId,
          Buffer.from(input.userAccessTokenEncrypted, "utf8"),
          input.userAccessTokenExpiresAt,
          input.grantedScopes,
        ],
      );
      const connectionId = connection.rows[0]?.id;
      if (!connectionId) {
        throw new Error("A conexão Meta persistida não foi retornada.");
      }

      const accountIds: string[] = [];
      for (const inputAccount of input.accounts) {
        const account = await client.query<CreatedAccountRow>(
          `
            INSERT INTO social_accounts (
              tenant_id,
              oauth_connection_id,
              account_type,
              external_account_id,
              username,
              display_name,
              avatar_url,
              is_active,
              metadata,
              disconnected_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::social_account_type,
              $4,
              $5,
              $6,
              $7,
              true,
              $8::jsonb,
              NULL
            )
            ON CONFLICT ON CONSTRAINT social_accounts_external_account_unique
            DO UPDATE SET
              oauth_connection_id = EXCLUDED.oauth_connection_id,
              username = EXCLUDED.username,
              display_name = EXCLUDED.display_name,
              avatar_url = EXCLUDED.avatar_url,
              is_active = true,
              metadata = EXCLUDED.metadata,
              disconnected_at = NULL,
              updated_at = now()
            RETURNING id
          `,
          [
            context.tenantId,
            connectionId,
            accountTypeFromProvider(inputAccount.provider),
            inputAccount.providerAccountId,
            inputAccount.username,
            inputAccount.displayName,
            inputAccount.profileImageUrl,
            JSON.stringify(inputAccount.metadata),
          ],
        );
        const accountId = account.rows[0]?.id;
        if (!accountId) {
          throw new Error("A conta social Meta persistida não foi retornada.");
        }
        accountIds.push(accountId);

        await client.query(
          `
            INSERT INTO social_account_credentials (
              tenant_id,
              social_account_id,
              access_token_encrypted,
              refresh_token_encrypted,
              access_token_expires_at,
              refresh_token_expires_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::bytea,
              NULL,
              $4::timestamptz,
              NULL
            )
            ON CONFLICT (social_account_id)
            DO UPDATE SET
              tenant_id = EXCLUDED.tenant_id,
              access_token_encrypted = EXCLUDED.access_token_encrypted,
              refresh_token_encrypted = NULL,
              access_token_expires_at = EXCLUDED.access_token_expires_at,
              refresh_token_expires_at = NULL,
              updated_at = now()
          `,
          [
            context.tenantId,
            accountId,
            Buffer.from(inputAccount.accessTokenEncrypted, "utf8"),
            inputAccount.tokenExpiresAt,
          ],
        );
      }

      const staleAccounts = await client.query<CreatedAccountRow>(
        `
          UPDATE social_accounts
          SET
            is_active = false,
            disconnected_at = COALESCE(disconnected_at, now()),
            updated_at = now()
          WHERE tenant_id = $1::uuid
            AND oauth_connection_id = $2::uuid
            AND NOT (id = ANY($3::uuid[]))
            AND NOT (
              account_type = 'instagram_business'::social_account_type
              AND external_account_id = ANY($4::text[])
            )
            AND is_active
          RETURNING id
        `,
        [
          context.tenantId,
          connectionId,
          accountIds,
          input.unverifiedInstagramAccountIds,
        ],
      );
      if (staleAccounts.rows.length > 0) {
        await client.query(
          `
            UPDATE social_account_credentials
            SET
              access_token_encrypted = NULL,
              refresh_token_encrypted = NULL,
              updated_at = now()
            WHERE tenant_id = $1::uuid
              AND social_account_id = ANY($2::uuid[])
          `,
          [
            context.tenantId,
            staleAccounts.rows.map((account) => account.id),
          ],
        );
      }

      await client.query(
        `
          UPDATE oauth_connections connection_row
          SET
            status = 'revoked'::oauth_connection_status,
            access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            revoked_at = COALESCE(revoked_at, now()),
            updated_at = now()
          WHERE connection_row.tenant_id = $1::uuid
            AND connection_row.platform = 'meta'::social_platform
            AND connection_row.id <> $2::uuid
            AND connection_row.status <> 'revoked'::oauth_connection_status
            AND NOT EXISTS (
              SELECT 1
              FROM social_accounts account_row
              WHERE account_row.tenant_id = connection_row.tenant_id
                AND account_row.oauth_connection_id = connection_row.id
                AND account_row.is_active
            )
        `,
        [context.tenantId, connectionId],
      );

      const persisted: SocialAccount[] = [];
      for (const accountId of accountIds) {
        const account = await findByIdWith(client, context, accountId);
        if (!account) {
          throw new Error("A conta social Meta criada não foi localizada.");
        }
        persisted.push(account);
      }
      await client.query("COMMIT");
      return persisted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    context: SocialAccountsContext,
    id: string,
    input: UpdateSocialAccountInput,
  ): Promise<SocialAccount | null> {
    await this.assertContext(context);
    const result = await this.pool.query(
      `
        UPDATE social_accounts
        SET
          display_name = COALESCE($3, display_name),
          username = CASE WHEN $4::boolean THEN $5 ELSE username END,
          avatar_url = CASE WHEN $6::boolean THEN $7 ELSE avatar_url END
        WHERE tenant_id = $1::uuid AND id = $2::uuid
        RETURNING id
      `,
      [
        context.tenantId,
        id,
        input.displayName ?? null,
        Object.hasOwn(input, "username"),
        input.username ?? null,
        Object.hasOwn(input, "profileImageUrl"),
        input.profileImageUrl ?? null,
      ],
    );
    if (result.rowCount === 0) return null;
    return findByIdWith(this.pool, context, id);
  }

  async disconnect(
    context: SocialAccountsContext,
    id: string,
  ): Promise<SocialAccount | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await assertContextWith(client, context);
      const lockedConnection = await client.query<AccountConnectionRow>(
        `
          SELECT account_row.oauth_connection_id
          FROM social_accounts account_row
          JOIN oauth_connections connection_row
            ON connection_row.tenant_id = account_row.tenant_id
           AND connection_row.id = account_row.oauth_connection_id
          WHERE account_row.tenant_id = $1::uuid
            AND account_row.id = $2::uuid
          FOR UPDATE OF connection_row
        `,
        [context.tenantId, id],
      );
      const connectionId = lockedConnection.rows[0]?.oauth_connection_id;
      if (!connectionId) {
        await client.query("ROLLBACK");
        return null;
      }

      const account = await client.query(
        `
          UPDATE social_accounts
          SET
            is_active = false,
            disconnected_at = COALESCE(disconnected_at, now()),
            updated_at = now()
          WHERE tenant_id = $1::uuid
            AND id = $2::uuid
            AND oauth_connection_id = $3::uuid
          RETURNING id
        `,
        [context.tenantId, id, connectionId],
      );
      if (account.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `
          UPDATE social_account_credentials
          SET
            access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            updated_at = now()
          WHERE tenant_id = $1::uuid AND social_account_id = $2::uuid
        `,
        [context.tenantId, id],
      );
      await client.query(
        `
          UPDATE oauth_connections connection_row
          SET
            status = 'revoked'::oauth_connection_status,
            access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            revoked_at = COALESCE(revoked_at, now()),
            updated_at = now()
          WHERE connection_row.tenant_id = $1::uuid
            AND connection_row.id = $2::uuid
            AND NOT EXISTS (
              SELECT 1
              FROM social_accounts account_row
              WHERE account_row.tenant_id = connection_row.tenant_id
                AND account_row.oauth_connection_id = connection_row.id
                AND account_row.is_active
            )
        `,
        [context.tenantId, connectionId],
      );
      const disconnected = await findByIdWith(client, context, id);
      await client.query("COMMIT");
      return disconnected;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
