import type { Pool, QueryResultRow } from "pg";
import { isPost, type CreatePostInput, type Post } from "./postContract.ts";
import type { PostsContext } from "./postsContext.ts";

type PostRow = QueryResultRow & {
  author_user_id: unknown;
  caption: unknown;
  created_at: unknown;
  id: unknown;
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

export class InvalidPostsContextError extends Error {
  constructor() {
    super("O contexto de tenant e autor não é válido para publicações.");
    this.name = "InvalidPostsContextError";
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

export class PostgresPostsStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async assertContext(context: PostsContext): Promise<void> {
    const result = await this.pool.query<ContextValidationRow>(
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
        SELECT ${RETURNING_FIELDS}
        FROM posts
        WHERE tenant_id = $1::uuid
        ORDER BY scheduled_for ASC NULLS LAST, created_at DESC
      `,
      [context.tenantId],
    );

    return result.rows.map(mapPostRow);
  }

  async create(context: PostsContext, input: CreatePostInput): Promise<Post> {
    await this.assertContext(context);
    const result = await this.pool.query<PostRow>(
      `
        INSERT INTO posts (
          tenant_id,
          author_user_id,
          title,
          caption,
          status,
          scheduled_for
        )
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::post_status, $6::timestamptz)
        RETURNING ${RETURNING_FIELDS}
      `,
      [
        context.tenantId,
        context.authorUserId,
        input.title ?? null,
        input.caption,
        input.status,
        input.scheduledFor,
      ],
    );

    const createdPost = result.rows[0];
    if (!createdPost) {
      throw new Error("O banco não retornou a publicação criada.");
    }

    return mapPostRow(createdPost);
  }
}
