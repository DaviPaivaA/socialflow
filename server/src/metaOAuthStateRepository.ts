import type { Pool, QueryResultRow } from "pg";
import type { AuthContext } from "./authService.ts";

export type OAuthStateConsumeFailure =
  | "expired"
  | "invalid"
  | "session_invalid";

export type OAuthStateConsumeResult =
  | { success: true }
  | { reason: OAuthStateConsumeFailure; success: false };

export interface MetaOAuthStateRepository {
  consume(
    context: AuthContext,
    stateHash: string,
  ): Promise<OAuthStateConsumeResult>;
  create(
    context: AuthContext,
    stateHash: string,
    expiresAt: string,
  ): Promise<boolean>;
}

type StateStatusRow = QueryResultRow & {
  consumed: boolean;
  expired: boolean;
  same_session: boolean;
  session_valid: boolean;
};

function assertStateHash(stateHash: string): void {
  if (!/^[0-9a-f]{64}$/.test(stateHash)) {
    throw new Error("O hash do state OAuth possui formato inválido.");
  }
}

export class PostgresMetaOAuthStateRepository
  implements MetaOAuthStateRepository
{
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(
    context: AuthContext,
    stateHash: string,
    expiresAt: string,
  ): Promise<boolean> {
    assertStateHash(stateHash);
    await this.pool.query(`
      DELETE FROM oauth_authorization_requests
      WHERE expires_at < now() - interval '1 day'
         OR consumed_at < now() - interval '1 day'
    `);
    const result = await this.pool.query(
      `
        INSERT INTO oauth_authorization_requests (
          provider,
          state_hash,
          auth_session_id,
          membership_id,
          expires_at
        )
        SELECT
          'meta'::social_platform,
          $4,
          session.id,
          session.membership_id,
          $5::timestamptz
        FROM auth_sessions session
        JOIN tenant_members member ON member.id = session.membership_id
        JOIN users app_user ON app_user.id = member.user_id
        WHERE session.id = $1::uuid
          AND session.membership_id = $2::uuid
          AND member.user_id = $3::uuid
          AND session.expires_at > now()
          AND app_user.is_active
        RETURNING id
      `,
      [
        context.sessionId,
        context.membershipId,
        context.user.id,
        stateHash,
        expiresAt,
      ],
    );
    return result.rowCount === 1;
  }

  async consume(
    context: AuthContext,
    stateHash: string,
  ): Promise<OAuthStateConsumeResult> {
    assertStateHash(stateHash);
    const consumed = await this.pool.query(
      `
        UPDATE oauth_authorization_requests request_row
        SET consumed_at = now()
        FROM auth_sessions session,
             tenant_members member,
             users app_user
        WHERE request_row.state_hash = $1
          AND request_row.provider = 'meta'::social_platform
          AND request_row.auth_session_id = $2::uuid
          AND request_row.membership_id = $3::uuid
          AND request_row.consumed_at IS NULL
          AND request_row.expires_at > now()
          AND session.id = request_row.auth_session_id
          AND session.membership_id = request_row.membership_id
          AND session.expires_at > now()
          AND member.id = session.membership_id
          AND member.user_id = $4::uuid
          AND app_user.id = member.user_id
          AND app_user.is_active
        RETURNING request_row.id
      `,
      [stateHash, context.sessionId, context.membershipId, context.user.id],
    );
    if (consumed.rowCount === 1) return { success: true };

    const status = await this.pool.query<StateStatusRow>(
      `
        SELECT
          request_row.consumed_at IS NOT NULL AS consumed,
          request_row.expires_at <= now() AS expired,
          request_row.auth_session_id = $2::uuid
            AND request_row.membership_id = $3::uuid AS same_session,
          EXISTS (
            SELECT 1
            FROM auth_sessions session
            JOIN tenant_members member ON member.id = session.membership_id
            JOIN users app_user ON app_user.id = member.user_id
            WHERE session.id = request_row.auth_session_id
              AND session.membership_id = request_row.membership_id
              AND member.user_id = $4::uuid
              AND session.expires_at > now()
              AND app_user.is_active
          ) AS session_valid
        FROM oauth_authorization_requests request_row
        WHERE request_row.state_hash = $1
          AND request_row.provider = 'meta'::social_platform
        LIMIT 1
      `,
      [stateHash, context.sessionId, context.membershipId, context.user.id],
    );
    const row = status.rows[0];
    if (!row || row.consumed) return { reason: "invalid", success: false };
    if (row.expired) return { reason: "expired", success: false };
    if (!row.same_session || !row.session_valid) {
      return { reason: "session_invalid", success: false };
    }
    return { reason: "invalid", success: false };
  }
}
