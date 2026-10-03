import type { Pool, PoolClient, QueryResultRow } from "pg";
import { isPost, type CreatePostInput, type Post } from "./postContract.ts";
import { isPostPublication, type CreatePostResponse, type PostPublication } from "../../shared/postPublicationContract.ts";
import type { PostsContext } from "./postsContext.ts";

type PostRow = QueryResultRow & {
  author_user_id: unknown;
  caption: unknown;
  created_at: unknown;
  id: unknown;
  media_asset_ids: unknown;
  published_at: unknown;
  rag_run_id: unknown;
  scheduled_for: unknown;
  status: unknown;
  tenant_id: unknown;
  title: unknown;
  updated_at: unknown;
};

type ContextValidationRow = QueryResultRow & {
  author_exists: boolean;
  membership_exists: boolean;
  tenant_exists: boolean;
};

type DestinationRow = QueryResultRow & {
  id: string;
  account_type: string;
  is_active: boolean;
  disconnected_at: Date | null;
  metadata: unknown;
  platform: string;
  connection_status: string;
  revoked_at: Date | null;
  connection_token_present: boolean;
  connection_token_valid: boolean;
  page_token_present: boolean;
  page_token_valid: boolean;
  scopes: string[];
};

type PublicationRow = QueryResultRow & {
  created_at: unknown;
  error_code: unknown;
  error_message: unknown;
  failed_at: unknown;
  id: unknown;
  post_id: unknown;
  provider_post_id: unknown;
  published_at: unknown;
  social_account_id: unknown;
  started_at: unknown;
  status: unknown;
  tenant_id: unknown;
  updated_at: unknown;
};

const RETURNING_FIELDS = `
  id,
  tenant_id,
  author_user_id,
  rag_run_id,
  title,
  caption,
  status,
  scheduled_for,
  published_at,
  created_at,
  updated_at
`;

const SELECT_FIELDS = `${RETURNING_FIELDS},
  ARRAY(
    SELECT relation.media_asset_id
    FROM post_media relation
    WHERE relation.tenant_id = posts.tenant_id
      AND relation.post_id = posts.id
    ORDER BY relation.position
  ) AS media_asset_ids`;

export class InvalidPostsContextError extends Error {
  constructor() {
    super("O contexto de tenant e autor não é válido para publicações.");
    this.name = "InvalidPostsContextError";
  }
}

export class PostMediaAssetNotFoundError extends Error {
  constructor() {
    super("A mídia não foi encontrada.");
    this.name = "PostMediaAssetNotFoundError";
  }
}

export class PostMediaAssetUnsupportedError extends Error {
  constructor() {
    super("A mídia não é compatível com a publicação de Facebook nesta etapa.");
    this.name = "PostMediaAssetUnsupportedError";
  }
}

export class InvalidPostDestinationError extends Error {
  constructor() {
    super("Um ou mais destinos não estão disponíveis para publicação.");
    this.name = "InvalidPostDestinationError";
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

  if (date === null || !Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function mapPostRow(row: PostRow): Post {
  const post = {
    authorUserId: row.author_user_id,
    caption: row.caption,
    createdAt: normalizeTimestamp(row.created_at),
    id: row.id,
    mediaAssetIds: row.media_asset_ids,
    publishedAt: normalizeTimestamp(row.published_at),
    ragRunId: row.rag_run_id,
    scheduledFor: normalizeTimestamp(row.scheduled_for),
    status: row.status,
    tenantId: row.tenant_id,
    title: row.title,
    updatedAt: normalizeTimestamp(row.updated_at),
  };

  if (!isPost(post)) {
    throw new Error("O banco retornou uma publicação incompatível.");
  }

  return post;
}

function mapPublicationRow(row: PublicationRow): PostPublication {
  const publication = {
    createdAt: normalizeTimestamp(row.created_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    failedAt: normalizeTimestamp(row.failed_at),
    id: row.id,
    postId: row.post_id,
    providerPostId: row.provider_post_id,
    publishedAt: normalizeTimestamp(row.published_at),
    socialAccountId: row.social_account_id,
    startedAt: normalizeTimestamp(row.started_at),
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: normalizeTimestamp(row.updated_at),
  };
  if (!isPostPublication(publication)) {
    throw new Error("O banco retornou um destino incompatível.");
  }
  return publication;
}

function isValidDestination(row: DestinationRow): boolean {
  const metadata = row.metadata;
  const tasks = typeof metadata === "object" && metadata !== null && "tasks" in metadata
    ? metadata.tasks
    : null;
  return (
    row.account_type === "facebook_page" &&
    row.is_active &&
    row.disconnected_at === null &&
    row.platform === "meta" &&
    row.connection_status === "active" &&
    row.revoked_at === null &&
    row.connection_token_present &&
    row.connection_token_valid &&
    row.page_token_present &&
    row.page_token_valid &&
    ["pages_show_list", "pages_read_engagement", "pages_manage_posts"].every((scope) => row.scopes.includes(scope)) &&
    Array.isArray(tasks) &&
    tasks.includes("CREATE_CONTENT")
  );
}

export class PostgresPostsStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async assertContext(context: PostsContext, queryable: Pool | PoolClient = this.pool): Promise<void> {
    const result = await queryable.query<ContextValidationRow>(
      `
        SELECT
          EXISTS (
            SELECT 1 FROM tenants WHERE id = $1::uuid
          ) AS tenant_exists,
          EXISTS (
            SELECT 1 FROM users WHERE id = $2::uuid
          ) AS author_exists,
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
      !validation.author_exists ||
      !validation.membership_exists
    ) {
      throw new InvalidPostsContextError();
    }
  }

  async list(context: PostsContext): Promise<Post[]> {
    await this.assertContext(context);
    const result = await this.pool.query<PostRow>(
      `
        SELECT ${SELECT_FIELDS}
        FROM posts
        WHERE tenant_id = $1::uuid
        ORDER BY scheduled_for ASC NULLS LAST, created_at DESC
      `,
      [context.tenantId],
    );

    return result.rows.map(mapPostRow);
  }

  async create(context: PostsContext, input: CreatePostInput): Promise<CreatePostResponse> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await this.assertContext(context, client);

      const mediaAssetId = input.mediaAssetIds[0];
      if (mediaAssetId) {
        const media = await client.query<{ media_type: string; mime_type: string; size_bytes: string }>(
          `SELECT media_type, mime_type, size_bytes FROM media_assets
           WHERE tenant_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
           FOR SHARE`,
          [context.tenantId, mediaAssetId],
        );
        if (media.rowCount !== 1) throw new PostMediaAssetNotFoundError();
        const asset = media.rows[0]!;
        if (
          asset.media_type !== "image" ||
          !["image/jpeg", "image/png"].includes(asset.mime_type) ||
          Number(asset.size_bytes) > 4_000_000
        ) throw new PostMediaAssetUnsupportedError();
      }

      const destinations = await client.query<DestinationRow>(
        `SELECT
           account.id,
           account.account_type::text AS account_type,
           account.is_active,
           account.disconnected_at,
           account.metadata,
           connection.platform::text AS platform,
           connection.status::text AS connection_status,
           connection.revoked_at,
           coalesce(octet_length(connection.access_token_encrypted) > 0, false) AS connection_token_present,
           (connection.access_token_expires_at IS NULL OR connection.access_token_expires_at > now()) AS connection_token_valid,
           coalesce(octet_length(credential.access_token_encrypted) > 0, false) AS page_token_present,
           (credential.access_token_expires_at IS NULL OR credential.access_token_expires_at > now()) AS page_token_valid,
           connection.scopes
         FROM social_accounts account
         JOIN oauth_connections connection
           ON connection.tenant_id = account.tenant_id
          AND connection.id = account.oauth_connection_id
         JOIN social_account_credentials credential
           ON credential.tenant_id = account.tenant_id
          AND credential.social_account_id = account.id
         WHERE account.tenant_id = $1::uuid
           AND account.id = ANY($2::uuid[])
         FOR SHARE OF account, connection, credential`,
        [context.tenantId, input.socialAccountIds],
      );
      if (
        destinations.rows.length !== input.socialAccountIds.length ||
        !destinations.rows.every(isValidDestination)
      ) throw new InvalidPostDestinationError();

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO posts (tenant_id, author_user_id, title, caption, status, scheduled_for)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'scheduled'::post_status,
           CASE WHEN $5::text = 'now' THEN now() ELSE $6::timestamptz END)
         RETURNING id`,
        [context.tenantId, context.authorUserId, input.title ?? null, input.caption, input.publicationMode, input.scheduledFor],
      );
      const postId = inserted.rows[0]?.id;
      if (!postId) throw new Error("O banco não retornou a publicação criada.");

      if (mediaAssetId) {
        await client.query(
          `INSERT INTO post_media (tenant_id, post_id, media_asset_id, position)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 0)`,
          [context.tenantId, postId, mediaAssetId],
        );
      }

      await client.query(
        `INSERT INTO post_publications (tenant_id, post_id, social_account_id)
         SELECT $1::uuid, $2::uuid, destination_id
         FROM unnest($3::uuid[]) AS destination_id`,
        [context.tenantId, postId, input.socialAccountIds],
      );

      const selected = await client.query<PostRow>(
        `SELECT ${SELECT_FIELDS} FROM posts
         WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [context.tenantId, postId],
      );
      const createdPost = selected.rows[0];
      if (!createdPost) throw new Error("O banco não retornou a publicação criada.");
      const post = mapPostRow(createdPost);
      const publicationResult = await client.query<PublicationRow>(
        `SELECT * FROM post_publications
         WHERE tenant_id = $1::uuid AND post_id = $2::uuid
         ORDER BY array_position($3::uuid[], social_account_id)`,
        [context.tenantId, postId, input.socialAccountIds],
      );
      const publications = publicationResult.rows.map(mapPublicationRow);
      await client.query("COMMIT");
      return { post, publications };
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
