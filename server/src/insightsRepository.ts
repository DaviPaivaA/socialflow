import type { Pool } from "pg";
import { isUuid } from "../../shared/postContract.ts";
import { UnauthorizedError, type AuthContext } from "./authService.ts";

export type InsightsTarget = { kind: "account"; socialAccountId: string }
  | { kind: "publication"; publicationId: string; socialAccountId?: string };

// Server-private evidence, never an HTTP DTO. No credential is decrypted here.
export type InsightsCredential = {
  kind: "page" | "user";
  accessTokenEncrypted: string | null;
  expiresAt: string | null;
};
export type InsightsMediaEvidence = {
  id: string;
  mediaType: "image" | "video";
  mimeType: string;
  deletedAt: string | null;
};
export type InsightsOperationEvidence = {
  kind: "facebook_reel" | "instagram_image" | "instagram_reel";
  stage: string;
  providerAccountId: string;
  externalId: string | null;
  graphApiVersion: string;
  mediaAssetId: string;
  media: InsightsMediaEvidence | null;
};
export type InsightsPublicationEvidence = {
  id: string;
  postId: string;
  socialAccountId: string;
  status: string;
  postStatus: string;
  providerPostId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
  operation: InsightsOperationEvidence | null;
  media: (InsightsMediaEvidence & { position: number })[];
};
export type InsightsReadSnapshot = {
  tenantId: string;
  authorizationExpiresAt: string;
  account: {
    id: string;
    type: "facebook_page" | "instagram_business" | "tiktok_account";
    providerAccountId: string;
    isActive: boolean;
    disconnectedAt: string | null;
    // Retain malformed/missing evidence without inferring grants or bindings.
    pageId: unknown;
    tasks: unknown;
  };
  connection: {
    id: string;
    platform: "meta" | "tiktok";
    status: string;
    revokedAt: string | null;
    scopes: string[];
  };
  credential: InsightsCredential | null;
  pageLink: {
    id: string;
    connectionId: string;
    providerAccountId: string;
    isActive: boolean;
    disconnectedAt: string | null;
    tasks: unknown;
  } | null;
  publication: InsightsPublicationEvidence | null;
};
export interface InsightsRepository {
  load(context: AuthContext, target: InsightsTarget): Promise<InsightsReadSnapshot | null>;
}

export class InvalidInsightsTargetError extends Error {
  constructor() { super("O alvo de Insights é inválido."); this.name = "InvalidInsightsTargetError"; }
}

// Fixed SQL expressions only; no caller-controlled identifiers are interpolated.
function timestamp(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}
function media(column: string): string {
  return `jsonb_build_object('id', ${column}.id, 'mediaType', ${column}.media_type,
    'mimeType', ${column}.mime_type, 'deletedAt', ${timestamp(`${column}.deleted_at`)})`;
}

const READ_SNAPSHOT = `
  WITH reader AS MATERIALIZED (
    SELECT member.tenant_id, session.expires_at
    FROM auth_sessions session
    JOIN tenant_members member ON member.id = session.membership_id
    JOIN users app_user ON app_user.id = member.user_id AND app_user.is_active
    JOIN tenants tenant ON tenant.id = member.tenant_id
    WHERE session.id = $1::uuid AND session.membership_id = $2::uuid
      AND session.expires_at > clock_timestamp()
      AND member.id = $2::uuid AND member.tenant_id = $3::uuid
      AND member.user_id = $4::uuid AND member.role IN ('owner', 'admin', 'member')
  )
  SELECT reader.tenant_id IS NOT NULL AS authorized, target.snapshot, target.ciphertext
  FROM (SELECT 1) seed
  LEFT JOIN reader ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'tenantId', account.tenant_id,
      'authorizationExpiresAt', ${timestamp("reader.expires_at")},
      'account', jsonb_build_object(
        'id', account.id, 'type', account.account_type, 'providerAccountId', account.external_account_id,
        'isActive', account.is_active, 'disconnectedAt', ${timestamp("account.disconnected_at")},
        'pageId', account.metadata->'pageId', 'tasks', account.metadata->'tasks'),
      'connection', jsonb_build_object(
        'id', connection.id, 'platform', connection.platform, 'status', connection.status,
        'revokedAt', ${timestamp("connection.revoked_at")}, 'scopes', connection.scopes),
      'credential', CASE WHEN connection.platform = 'meta'
        AND account.account_type IN ('facebook_page', 'instagram_business') THEN jsonb_build_object(
          'kind', CASE WHEN account.account_type = 'facebook_page' THEN 'page' ELSE 'user' END,
          'accessTokenEncrypted', NULL,
          'expiresAt', CASE WHEN account.account_type = 'facebook_page'
            THEN ${timestamp("credential.access_token_expires_at")}
            ELSE ${timestamp("connection.access_token_expires_at")} END) ELSE NULL END,
      'pageLink', CASE WHEN page.id IS NOT NULL THEN jsonb_build_object(
        'id', page.id, 'connectionId', page.oauth_connection_id, 'providerAccountId', page.external_account_id,
        'isActive', page.is_active, 'disconnectedAt', ${timestamp("page.disconnected_at")},
        'tasks', page.metadata->'tasks') ELSE NULL END,
      'publication', CASE WHEN publication.id IS NOT NULL THEN jsonb_build_object(
        'id', publication.id, 'postId', post.id, 'socialAccountId', publication.social_account_id,
        'status', publication.status, 'postStatus', post.status, 'providerPostId', publication.provider_post_id,
        'errorCode', publication.error_code, 'errorMessage', publication.error_message,
        'publishedAt', ${timestamp("publication.published_at")},
        'operation', CASE WHEN operation.publication_id IS NOT NULL THEN jsonb_build_object(
          'kind', operation.kind, 'stage', operation.stage, 'providerAccountId', operation.provider_account_id,
          'externalId', operation.external_id, 'graphApiVersion', operation.graph_api_version,
          'mediaAssetId', operation.media_asset_id,
          'media', CASE WHEN operation_media.id IS NOT NULL THEN ${media("operation_media")} ELSE NULL END
        ) ELSE NULL END,
        'media', COALESCE((
          SELECT jsonb_agg(${media("asset")} || jsonb_build_object('position', relation.position)
            ORDER BY relation.position, asset.id)
          FROM post_media relation
          JOIN media_assets asset ON asset.tenant_id = relation.tenant_id AND asset.id = relation.media_asset_id
          WHERE relation.tenant_id = post.tenant_id AND relation.post_id = post.id
        ), '[]'::jsonb)
      ) ELSE NULL END
    ) AS snapshot,
    CASE WHEN account.is_active AND account.disconnected_at IS NULL
      AND connection.platform = 'meta' AND connection.status = 'active' AND connection.revoked_at IS NULL
      THEN CASE WHEN account.account_type = 'facebook_page' THEN credential.access_token_encrypted
        WHEN account.account_type = 'instagram_business' THEN connection.access_token_encrypted END
      ELSE NULL END AS ciphertext
    FROM social_accounts account
    JOIN oauth_connections connection
      ON connection.tenant_id = account.tenant_id AND connection.id = account.oauth_connection_id
    LEFT JOIN social_account_credentials credential
      ON credential.tenant_id = account.tenant_id AND credential.social_account_id = account.id
        AND account.account_type = 'facebook_page'
    LEFT JOIN social_accounts page
      ON page.tenant_id = account.tenant_id AND page.oauth_connection_id = account.oauth_connection_id
        AND page.account_type = 'facebook_page' AND account.account_type = 'instagram_business'
        AND jsonb_typeof(account.metadata->'pageId') = 'string'
        AND page.external_account_id = account.metadata->>'pageId'
    LEFT JOIN post_publications publication
      ON publication.tenant_id = account.tenant_id AND publication.social_account_id = account.id
        AND $5 = 'publication' AND publication.id = $6::uuid
    LEFT JOIN posts post ON post.tenant_id = publication.tenant_id AND post.id = publication.post_id
    LEFT JOIN publication_operations operation
      ON operation.tenant_id = publication.tenant_id AND operation.publication_id = publication.id
    LEFT JOIN media_assets operation_media
      ON operation_media.tenant_id = operation.tenant_id AND operation_media.id = operation.media_asset_id
    WHERE account.tenant_id = reader.tenant_id
      AND (($5 = 'account' AND account.id = $6::uuid)
        OR ($5 = 'publication' AND publication.id IS NOT NULL AND post.id IS NOT NULL
          AND ($7::uuid IS NULL OR account.id = $7::uuid)))
  ) target ON true
`;

export class PostgresInsightsRepository implements InsightsRepository {
  private readonly pool: Pick<Pool, "query">;

  constructor(pool: Pick<Pool, "query">) { this.pool = pool; }

  async load(context: AuthContext, target: InsightsTarget): Promise<InsightsReadSnapshot | null> {
    if (![context?.sessionId, context?.membershipId, context?.tenant?.id, context?.user?.id].every(isUuid)) {
      throw new UnauthorizedError();
    }
    if (!target || (target.kind !== "account" && target.kind !== "publication") ||
      !isUuid(target.kind === "account" ? target.socialAccountId : target.publicationId) ||
      (target.kind === "publication" && target.socialAccountId !== undefined && !isUuid(target.socialAccountId))) {
      throw new InvalidInsightsTargetError();
    }
    const result = await this.pool.query<{
      authorized: boolean;
      snapshot: InsightsReadSnapshot | null;
      ciphertext: Buffer | null;
    }>(READ_SNAPSHOT, [context.sessionId, context.membershipId, context.tenant.id, context.user.id,
      target.kind, target.kind === "account" ? target.socialAccountId : target.publicationId,
      target.kind === "publication" ? target.socialAccountId ?? null : null]);
    const row = result.rows[0];
    if (!row?.authorized) throw new UnauthorizedError();
    if (row.snapshot?.credential) {
      row.snapshot.credential.accessTokenEncrypted = row.ciphertext?.toString("utf8") ?? null;
    }
    return row.snapshot;
  }
}
