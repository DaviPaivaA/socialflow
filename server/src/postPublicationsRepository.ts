import type { Pool } from "pg";
import { isPostPublication, type PostPublication } from "../../shared/postPublicationContract.ts";
import { isPost, type Post } from "./postContract.ts";

export type ClaimedPublication = { id: string; postId: string; socialAccountId: string; tenantId: string };

export interface PostPublicationsRepository {
  claimPost(tenantId: string, postId: string, now: Date, limit?: number): Promise<ClaimedPublication[]>;
  claimDue(now: Date, limit: number): Promise<ClaimedPublication[]>;
  failStalePublishing(cutoff: Date, failedAt: Date): Promise<Array<{ tenantId: string; postId: string }>>;
  listForPost(tenantId: string, postId: string): Promise<PostPublication[]>;
  markPublished(input: { id: string; providerPostId: string; publishedAt: Date; tenantId: string }): Promise<void>;
  markFailed(input: { errorCode: string; errorMessage: string; failedAt: Date; id: string; tenantId: string }): Promise<void>;
  refreshPostAggregate(tenantId: string, postId: string, now: Date): Promise<Post>;
  listAggregateRefreshCandidates(limit: number): Promise<Array<{ tenantId: string; postId: string }>>;
  findPostForPublication(tenantId: string, postId: string): Promise<Post | null>;
}

function mapPost(row: Record<string, unknown>): Post {
  const timestamp = (value: unknown) => value instanceof Date ? value.toISOString() : null;
  const post = {
    id: row.id, tenantId: row.tenant_id, authorUserId: row.author_user_id,
    ragRunId: row.rag_run_id, title: row.title, caption: row.caption,
    status: row.status, scheduledFor: timestamp(row.scheduled_for),
    publishedAt: timestamp(row.published_at), createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at), mediaAssetIds: row.media_asset_ids,
  };
  if (!isPost(post)) throw new Error("Publicação persistida inválida.");
  return post;
}

const POST_SELECT = `SELECT post.*,
  ARRAY(SELECT media_asset_id FROM post_media WHERE tenant_id=post.tenant_id
    AND post_id=post.id ORDER BY position) AS media_asset_ids
  FROM posts post WHERE post.tenant_id=$1 AND post.id=$2`;

export class PostgresPostPublicationsRepository implements PostPublicationsRepository {
  constructor(private readonly pool: Pool) {}

  async claimPost(tenantId: string, postId: string, now: Date, limit?: number): Promise<ClaimedPublication[]> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("Limite de publicações inválido.");
    return this.claim(now, limit ?? null, tenantId, postId);
  }

  async claimDue(now: Date, limit: number): Promise<ClaimedPublication[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Limite de publicações inválido.");
    return this.claim(now, limit, null, null);
  }

  private async claim(now: Date, limit: number | null, tenantId: string | null, postId: string | null): Promise<ClaimedPublication[]> {
    const result = await this.pool.query<ClaimedPublication>(`
      WITH candidates AS (
        SELECT destination.id FROM post_publications destination
        JOIN posts post ON post.tenant_id = destination.tenant_id AND post.id = destination.post_id
        WHERE destination.status = 'scheduled' AND post.scheduled_for <= $1
          AND post.status IN ('scheduled', 'publishing')
          AND ($3::uuid IS NULL OR destination.tenant_id = $3)
          AND ($4::uuid IS NULL OR destination.post_id = $4)
        ORDER BY post.scheduled_for, destination.id
        LIMIT $2 FOR UPDATE OF destination SKIP LOCKED
      )
      UPDATE post_publications destination SET status = 'publishing', started_at = $1, updated_at = $1
      FROM candidates WHERE destination.id = candidates.id
      RETURNING destination.id, destination.post_id AS "postId",
        destination.social_account_id AS "socialAccountId", destination.tenant_id AS "tenantId"
    `, [now, limit, tenantId, postId]);
    return result.rows;
  }

  async listForPost(tenantId: string, postId: string): Promise<PostPublication[]> {
    const result = await this.pool.query(`SELECT * FROM post_publications WHERE tenant_id=$1 AND post_id=$2 ORDER BY created_at, id`, [tenantId, postId]);
    return result.rows.map(row => {
      const value = {
        id: row.id, tenantId: row.tenant_id, postId: row.post_id, socialAccountId: row.social_account_id,
        status: row.status, providerPostId: row.provider_post_id, errorCode: row.error_code, errorMessage: row.error_message,
        createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
        startedAt: row.started_at?.toISOString() ?? null, publishedAt: row.published_at?.toISOString() ?? null,
        failedAt: row.failed_at?.toISOString() ?? null,
      };
      if (!isPostPublication(value)) throw new Error("Destino persistido inválido.");
      return value;
    });
  }

  async failStalePublishing(cutoff: Date, failedAt: Date): Promise<Array<{tenantId: string; postId: string}>> {
    const result = await this.pool.query<{tenantId: string; postId: string}>(`
      WITH failed AS (
        UPDATE post_publications SET status='failed', error_code='publication_state_unknown',
          error_message='Não foi possível confirmar o resultado da publicação.', failed_at=$2, updated_at=$2
        WHERE status='publishing' AND started_at < $1 RETURNING tenant_id, post_id
      ) SELECT DISTINCT tenant_id AS "tenantId", post_id AS "postId" FROM failed
    `, [cutoff, failedAt]);
    return result.rows;
  }

  async markPublished(input: { id: string; providerPostId: string; publishedAt: Date; tenantId: string }): Promise<void> {
    await this.pool.query(`UPDATE post_publications SET status='published', provider_post_id=$3,
      published_at=$4, updated_at=$4 WHERE tenant_id=$1 AND id=$2 AND status='publishing'`,
    [input.tenantId, input.id, input.providerPostId, input.publishedAt]);
  }

  async markFailed(input: { errorCode: string; errorMessage: string; failedAt: Date; id: string; tenantId: string }): Promise<void> {
    await this.pool.query(`UPDATE post_publications SET status='failed', error_code=$3,
      error_message=$4, failed_at=$5, updated_at=$5
      WHERE tenant_id=$1 AND id=$2 AND status='publishing'`,
    [input.tenantId, input.id, input.errorCode, input.errorMessage, input.failedAt]);
  }

  async findPostForPublication(tenantId: string, postId: string): Promise<Post | null> {
    const result = await this.pool.query(POST_SELECT, [tenantId, postId]);
    return result.rows[0] ? mapPost(result.rows[0]) : null;
  }

  async listAggregateRefreshCandidates(limit: number): Promise<Array<{ tenantId: string; postId: string }>> {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Limite de publicações inválido.");
    const result = await this.pool.query<{ tenantId: string; postId: string }>(`
      SELECT post.tenant_id AS "tenantId", post.id AS "postId"
      FROM posts post
      WHERE (
        post.status = 'scheduled' AND EXISTS (
          SELECT 1 FROM post_publications destination
          WHERE destination.tenant_id = post.tenant_id AND destination.post_id = post.id
            AND destination.status <> 'scheduled'
        )
      ) OR (
        post.status = 'publishing'
        AND EXISTS (
          SELECT 1 FROM post_publications destination
          WHERE destination.tenant_id = post.tenant_id AND destination.post_id = post.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM post_publications destination
          WHERE destination.tenant_id = post.tenant_id AND destination.post_id = post.id
            AND destination.status IN ('scheduled', 'publishing')
        )
      )
      ORDER BY post.scheduled_for NULLS LAST, post.tenant_id, post.id
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async refreshPostAggregate(tenantId: string, postId: string, now: Date): Promise<Post> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const post = await client.query("SELECT id FROM posts WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, postId]);
      if (post.rowCount === 0) throw new Error("Publicação não encontrada.");
      const rows = await client.query<{status: string}>("SELECT status FROM post_publications WHERE tenant_id=$1 AND post_id=$2", [tenantId, postId]);
      const statuses = rows.rows.map(row => row.status);
      let status: Post["status"];
      if (statuses.length === 0 || statuses.every(value => value === "scheduled")) status = "scheduled";
      else if (statuses.some(value => value === "publishing" || value === "scheduled")) status = "publishing";
      else if (statuses.every(value => value === "published")) status = "published";
      else if (statuses.some(value => value === "published")) status = "partially_failed";
      else if (statuses.every(value => value === "cancelled")) status = "cancelled";
      else status = "failed";
      await client.query(`UPDATE posts SET status=$3,
        published_at=CASE WHEN $4 AND published_at IS NULL THEN $5 ELSE published_at END,
        updated_at=$5 WHERE tenant_id=$1 AND id=$2`,
      [tenantId, postId, status, status === "published" || status === "partially_failed", now]);
      const result = await client.query(POST_SELECT, [tenantId, postId]);
      await client.query("COMMIT");
      return mapPost(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
