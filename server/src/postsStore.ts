import type { Pool, PoolClient, QueryResultRow } from "pg";
import { isPost, type CreatePostInput, type Post } from "./postContract.ts";
import { isPostPublication, type CreatePostResponse, type PostPublication } from "../../shared/postPublicationContract.ts";
import type { PostsContext } from "./postsContext.ts";
import { requiredPublishingScopes, validatePublicationCompatibility, type PublicationMedia, type PublishingProvider } from "../../shared/publicationPolicy.ts";
import type { AuthContext } from "./authService.ts";
import type { PostDetail, UpdateScheduledPostInput } from "../../shared/postManagementContract.ts";
import { InvalidPostUpdateError, PostForbiddenError, PostNotCancellableError, PostNotEditableError, PostNotFoundError } from "./postManagementErrors.ts";
import { isPostDetail } from "../../shared/postManagementContract.ts";
import { canManagePostAuthor } from "../../shared/postManagementPolicy.ts";
import { assertPostActorSession, isUntouchedSchedule, lockPostActor, readPostActor } from "./postManagementAuthorization.ts";
import { validateUpdateScheduledPost } from "./postManagementContract.ts";

type PostSelection = Pick<CreatePostInput, "caption" | "mediaAssetIds" | "socialAccountIds">;

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
  connection_token_expires_at: Date | null;
  page_token_present: boolean;
  page_token_expires_at: Date | null;
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
    super("A mídia não é compatível com os destinos selecionados.");
    this.name = "PostMediaAssetUnsupportedError";
  }
}

export class InstagramPublishingUnavailableError extends Error {
  constructor() {
    super("A publicação no Instagram não está disponível neste ambiente.");
    this.name = "InstagramPublishingUnavailableError";
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

function publishingProvider(row: DestinationRow): PublishingProvider | null {
  if (row.account_type === "facebook_page") return "facebook";
  if (row.account_type === "instagram_business") return "instagram";
  return null;
}

function isValidDestination(row: DestinationRow, checkedAt: Date): boolean {
  const provider = publishingProvider(row);
  if (!provider) return false;
  const metadata = row.metadata;
  const tasks = typeof metadata === "object" && metadata !== null && "tasks" in metadata
    ? metadata.tasks
    : null;
  return (
    row.is_active &&
    row.disconnected_at === null &&
    row.platform === "meta" &&
    row.connection_status === "active" &&
    row.revoked_at === null &&
    row.connection_token_present &&
    (row.connection_token_expires_at === null || row.connection_token_expires_at.getTime() > checkedAt.getTime()) &&
    row.page_token_present &&
    (row.page_token_expires_at === null || row.page_token_expires_at.getTime() > checkedAt.getTime()) &&
    requiredPublishingScopes(provider).every((scope) => row.scopes.includes(scope)) &&
    Array.isArray(tasks) &&
    (tasks.includes("CREATE_CONTENT") || (provider === "instagram" && tasks.includes("MANAGE")))
  );
}

export class PostgresPostsStore {
  private readonly pool: Pool;
  private readonly maxVideoBytes: number;
  private readonly instagramPublishingAvailable: boolean;

  constructor(pool: Pool, options: { maxVideoBytes?: number; instagramPublishingAvailable?: boolean } = {}) {
    this.pool = pool;
    this.maxVideoBytes = options.maxVideoBytes ?? 262_144_000;
    this.instagramPublishingAvailable = options.instagramPublishingAvailable ?? false;
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
        WHERE tenant_id = $1::uuid AND status <> 'cancelled'
        ORDER BY scheduled_for ASC NULLS LAST, created_at DESC
      `,
      [context.tenantId],
    );

    return result.rows.map(mapPostRow);
  }

  async get(context: AuthContext, postId: string): Promise<PostDetail> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionStarted = true;
      const actor = await readPostActor(client, context);
      const result = await client.query<PostRow>(
        `SELECT ${SELECT_FIELDS} FROM posts WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [actor.tenantId, postId],
      );
      // Tenant visibility precedes any author/state evaluation.
      if (!result.rows[0]) throw new PostNotFoundError();
      const post = mapPostRow(result.rows[0]);
      const destinations = await client.query<PublicationRow>(
        `SELECT id, tenant_id, post_id, social_account_id, status, provider_post_id,
           error_code, error_message, started_at, published_at, failed_at, created_at, updated_at
         FROM post_publications WHERE tenant_id = $1::uuid AND post_id = $2::uuid
         ORDER BY created_at, id`,
        [actor.tenantId, postId],
      );
      const publications = destinations.rows.map(mapPublicationRow);
      const operations = await client.query<{ has_operation: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM publication_operations operation
           JOIN post_publications publication
             ON publication.tenant_id = operation.tenant_id AND publication.id = operation.publication_id
           WHERE publication.tenant_id = $1::uuid AND publication.post_id = $2::uuid
         ) AS has_operation`,
        [actor.tenantId, postId],
      );
      const allowed = canManagePostAuthor(actor, post.authorUserId) &&
        isUntouchedSchedule({ post, publications, hasOperation: operations.rows[0]!.has_operation });
      const detail: PostDetail = {
        post, publications, permissions: { canEditSchedule: allowed, canCancelSchedule: allowed },
      };
      if (!isPostDetail(detail)) throw new Error("O banco retornou um detalhe de publicação incompatível.");
      await client.query("COMMIT");
      transactionStarted = false;
      return detail;
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelScheduled(context: AuthContext, postId: string): Promise<void> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const actor = await lockPostActor(client, context);
      const selected = await client.query<PostRow>(
        `SELECT ${SELECT_FIELDS} FROM posts WHERE tenant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
        [actor.tenantId, postId],
      );
      await assertPostActorSession(client, context);
      if (!selected.rows[0]) throw new PostNotFoundError();
      const post = mapPostRow(selected.rows[0]);
      if (!canManagePostAuthor(actor, post.authorUserId)) throw new PostForbiddenError();
      const destinations = await client.query<PublicationRow>(
        `SELECT * FROM post_publications WHERE tenant_id=$1::uuid AND post_id=$2::uuid
         ORDER BY id FOR UPDATE`,
        [actor.tenantId, postId],
      );
      const publications = destinations.rows.map(mapPublicationRow);
      const operations = await client.query<{ has_operation: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM publication_operations operation
           JOIN post_publications destination ON destination.tenant_id=operation.tenant_id
             AND destination.id=operation.publication_id
           WHERE destination.tenant_id=$1::uuid AND destination.post_id=$2::uuid
         ) AS has_operation`,
        [actor.tenantId, postId],
      );
      const hasOperation = operations.rows[0]!.has_operation;
      const alreadyCancelled = post.status === "cancelled" && post.publishedAt === null && !hasOperation &&
        publications.every(publication => publication.status === "cancelled" &&
          publication.startedAt === null && publication.publishedAt === null && publication.failedAt === null &&
          publication.providerPostId === null && publication.errorCode === null && publication.errorMessage === null);
      if (!alreadyCancelled && !isUntouchedSchedule({ post, publications, hasOperation })) {
        throw new PostNotCancellableError();
      }
      // Destination locks can also wait. Authorization must still be live immediately before any write/no-op.
      await assertPostActorSession(client, context);
      if (!alreadyCancelled) {
        await client.query(`UPDATE post_publications SET status='cancelled',updated_at=clock_timestamp()
          WHERE tenant_id=$1::uuid AND post_id=$2::uuid AND status='scheduled'`, [actor.tenantId, postId]);
        await client.query(`UPDATE posts SET status='cancelled',updated_at=clock_timestamp()
          WHERE tenant_id=$1::uuid AND id=$2::uuid`, [actor.tenantId, postId]);
      }
      await client.query("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async updateScheduled(context: AuthContext, postId: string, input: UpdateScheduledPostInput): Promise<PostDetail> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const actor = await lockPostActor(client, context);
      const locked = await client.query(
        "SELECT id FROM posts WHERE tenant_id=$1::uuid AND id=$2::uuid FOR UPDATE",
        [actor.tenantId, postId],
      );
      await assertPostActorSession(client, context);
      if (locked.rowCount !== 1) throw new PostNotFoundError();
      // A new statement after the lock sees relation changes committed by a preceding PATCH.
      const selected = await client.query<PostRow>(
        `SELECT ${SELECT_FIELDS} FROM posts WHERE tenant_id=$1::uuid AND id=$2::uuid`,
        [actor.tenantId, postId],
      );
      const post = mapPostRow(selected.rows[0]!);
      if (!canManagePostAuthor(actor, post.authorUserId)) throw new PostForbiddenError();
      const destinations = await client.query<PublicationRow>(
        `SELECT * FROM post_publications WHERE tenant_id=$1::uuid AND post_id=$2::uuid ORDER BY id FOR UPDATE`,
        [actor.tenantId, postId],
      );
      const publications = destinations.rows.map(mapPublicationRow);
      const operations = await client.query<{ has_operation: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM publication_operations operation
           JOIN post_publications destination ON destination.tenant_id=operation.tenant_id
             AND destination.id=operation.publication_id
           WHERE destination.tenant_id=$1::uuid AND destination.post_id=$2::uuid
         ) AS has_operation`,
        [actor.tenantId, postId],
      );
      if (!isUntouchedSchedule({ post, publications, hasOperation: operations.rows[0]!.has_operation })) {
        throw new PostNotEditableError();
      }
      const validation = validateUpdateScheduledPost(input);
      if (!validation.success) throw new InvalidPostUpdateError(validation.fields);
      const patch = validation.data;
      const currentAccounts = publications.filter(row => row.status === "scheduled").map(row => row.socialAccountId);
      // PostgreSQL UUIDs are canonical; spelling/case and destination order are not relation changes.
      const selection: PostSelection = {
        caption: patch.caption ?? post.caption,
        mediaAssetIds: (patch.mediaAssetIds ?? post.mediaAssetIds).map(id => id.toLowerCase()),
        socialAccountIds: (patch.socialAccountIds ?? currentAccounts).map(id => id.toLowerCase()),
      };
      const title = Object.hasOwn(patch, "title") ? patch.title! : post.title;
      const scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor).toISOString() : post.scheduledFor;
      await this.validatePostSelection(client, actor.tenantId, selection,
        publications.length === 0 && patch.socialAccountIds === undefined);
      // Selection row locks may have waited. Use the current DB clock after every blocking read.
      await assertPostActorSession(client, context);
      const future = await client.query<{ valid: boolean }>(
        "SELECT $1::timestamptz > clock_timestamp() AS valid", [scheduledFor],
      );
      if (!future.rows[0]!.valid) throw new InvalidPostUpdateError(["scheduledFor"]);

      const mediaChanged = selection.mediaAssetIds.length !== post.mediaAssetIds.length ||
        selection.mediaAssetIds.some((id, index) => id !== post.mediaAssetIds[index]);
      const accountsChanged = currentAccounts.length !== selection.socialAccountIds.length ||
        currentAccounts.some(id => !selection.socialAccountIds.includes(id));
      if (title !== post.title || selection.caption !== post.caption || scheduledFor !== post.scheduledFor || mediaChanged || accountsChanged) {
        // Identity, original author, creation/RAG/history fields are deliberately absent from SET.
        await client.query(`UPDATE posts SET title=$3,caption=$4,
          scheduled_for=CASE WHEN $6::boolean THEN $5::timestamptz ELSE scheduled_for END,updated_at=clock_timestamp()
          WHERE tenant_id=$1::uuid AND id=$2::uuid`,
        [actor.tenantId, postId, title, selection.caption, scheduledFor, scheduledFor !== post.scheduledFor]);
        if (mediaChanged) {
          await client.query("DELETE FROM post_media WHERE tenant_id=$1::uuid AND post_id=$2::uuid", [actor.tenantId, postId]);
          if (selection.mediaAssetIds[0]) await client.query(`INSERT INTO post_media (tenant_id,post_id,media_asset_id,position)
            VALUES ($1::uuid,$2::uuid,$3::uuid,0)`, [actor.tenantId, postId, selection.mediaAssetIds[0]]);
        }
        if (accountsChanged) {
          await client.query(`UPDATE post_publications SET status='cancelled',updated_at=clock_timestamp()
            WHERE tenant_id=$1::uuid AND post_id=$2::uuid AND status='scheduled'
              AND NOT (social_account_id=ANY($3::uuid[]))`, [actor.tenantId, postId, selection.socialAccountIds]);
          await client.query(`UPDATE post_publications SET status='scheduled',updated_at=clock_timestamp()
            WHERE tenant_id=$1::uuid AND post_id=$2::uuid AND status='cancelled'
              AND social_account_id=ANY($3::uuid[])`, [actor.tenantId, postId, selection.socialAccountIds]);
          await client.query(`INSERT INTO post_publications (tenant_id,post_id,social_account_id)
            SELECT $1::uuid,$2::uuid,account_id FROM unnest($3::uuid[]) AS account_id
            WHERE NOT EXISTS (SELECT 1 FROM post_publications existing
              WHERE existing.tenant_id=$1::uuid AND existing.post_id=$2::uuid AND existing.social_account_id=account_id)`,
          [actor.tenantId, postId, selection.socialAccountIds]);
        }
      }
      const finalPost = await client.query<PostRow>(
        `SELECT ${SELECT_FIELDS} FROM posts WHERE tenant_id=$1::uuid AND id=$2::uuid`, [actor.tenantId, postId]);
      const finalPublications = await client.query<PublicationRow>(
        `SELECT * FROM post_publications WHERE tenant_id=$1::uuid AND post_id=$2::uuid ORDER BY created_at,id`,
        [actor.tenantId, postId]);
      const detail: PostDetail = { post: mapPostRow(finalPost.rows[0]!), publications: finalPublications.rows.map(mapPublicationRow),
        permissions: { canEditSchedule: true, canCancelSchedule: true } };
      if (!isPostDetail(detail)) throw new Error("O banco retornou um detalhe de publicação incompatível.");
      await client.query("COMMIT");
      transactionStarted = false;
      return detail;
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async validatePostSelection(client: PoolClient, tenantId: string, selection: PostSelection,
    allowLegacyEmpty: boolean): Promise<void> {
      const mediaAssetId = selection.mediaAssetIds[0];
      let publicationMedia: PublicationMedia | null = null;
      if (mediaAssetId) {
        const media = await client.query<{ media_type: PublicationMedia["mediaType"]; mime_type: string; size_bytes: string }>(
          `SELECT media_type, mime_type, size_bytes FROM media_assets
           WHERE tenant_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
           FOR SHARE`,
          [tenantId, mediaAssetId],
        );
        if (media.rowCount !== 1) throw new PostMediaAssetNotFoundError();
        const asset = media.rows[0]!;
        publicationMedia = { mediaType: asset.media_type, mimeType: asset.mime_type, sizeBytes: Number(asset.size_bytes) };
      }

      // No destinations is an explicit legacy preservation, never an invented publishing provider.
      if (selection.socialAccountIds.length === 0) {
        if (allowLegacyEmpty) return;
        throw new InvalidPostDestinationError();
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
           connection.access_token_expires_at AS connection_token_expires_at,
           coalesce(octet_length(credential.access_token_encrypted) > 0, false) AS page_token_present,
           credential.access_token_expires_at AS page_token_expires_at,
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
        [tenantId, selection.socialAccountIds],
      );
      // SELECT expressions can run before FOR SHARE waits. Check expiry only after all
      // selected account/connection/credential locks are owned, using a fresh DB clock.
      const clock = await client.query<{ checked_at: Date }>("SELECT clock_timestamp() AS checked_at");
      const checkedAt = clock.rows[0]!.checked_at;
      if (
        destinations.rows.length !== selection.socialAccountIds.length ||
        !destinations.rows.every(row => isValidDestination(row, checkedAt))
      ) throw new InvalidPostDestinationError();

      // Providers and media are derived only from tenant-qualified, locked rows.
      const providers = destinations.rows.map(row => publishingProvider(row)!);
      if (providers.includes("instagram") && !this.instagramPublishingAvailable) {
        throw new InstagramPublishingUnavailableError();
      }
      if (!validatePublicationCompatibility({ providers, media: publicationMedia,
        caption: selection.caption, maxVideoBytes: this.maxVideoBytes }).valid) {
        throw new PostMediaAssetUnsupportedError();
      }
  }

  async create(context: PostsContext, input: CreatePostInput): Promise<CreatePostResponse> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await this.assertContext(context, client);
      await this.validatePostSelection(client, context.tenantId, input, false);
      const mediaAssetId = input.mediaAssetIds[0];

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
