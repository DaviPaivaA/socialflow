import type { Pool, QueryResultRow } from "pg";
import { isMediaAsset, type MediaAsset, type MediaType } from "../../shared/mediaContract.ts";
import type { PostsContext } from "./postsContext.ts";

export type CreateMediaAssetRecord = {
  id: string;
  mediaType: MediaType;
  mimeType: string;
  originalFilename: string;
  sha256: string;
  sizeBytes: number;
  storageKey: string;
};

export type StoredMediaAsset = {
  id: string;
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
};

export interface MediaAssetsRepository {
  create(context: PostsContext, input: CreateMediaAssetRecord): Promise<MediaAsset>;
  findById(context: PostsContext, id: string): Promise<MediaAsset | null>;
  findStoredById(context: PostsContext, id: string): Promise<StoredMediaAsset | null>;
  list(context: PostsContext): Promise<MediaAsset[]>;
}

type MediaRow = QueryResultRow & {
  created_at: Date;
  duration_ms: string | null;
  height: number | null;
  id: string;
  media_type: MediaType;
  mime_type: string;
  original_filename: string;
  size_bytes: string;
  tenant_id: string;
  updated_at: Date;
  uploaded_by_user_id: string;
  width: number | null;
};

type StoredMediaRow = QueryResultRow & {
  id: string;
  media_type: MediaType;
  mime_type: string;
  size_bytes: string;
  storage_key: string;
};

const PUBLIC_FIELDS = `
  id, tenant_id, uploaded_by_user_id, original_filename, media_type,
  mime_type, size_bytes, width, height, duration_ms, created_at, updated_at
`;

function mapMediaRow(row: MediaRow): MediaAsset {
  const media = {
    createdAt: row.created_at.toISOString(),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    height: row.height,
    id: row.id,
    mediaType: row.media_type,
    mimeType: row.mime_type,
    originalFilename: row.original_filename,
    sizeBytes: Number(row.size_bytes),
    tenantId: row.tenant_id,
    updatedAt: row.updated_at.toISOString(),
    uploadedByUserId: row.uploaded_by_user_id,
    width: row.width,
  };
  if (!isMediaAsset(media)) throw new Error("O banco retornou uma mídia incompatível.");
  return media;
}

export class PostgresMediaAssetsRepository implements MediaAssetsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(context: PostsContext, input: CreateMediaAssetRecord): Promise<MediaAsset> {
    const result = await this.pool.query<MediaRow>(`
      INSERT INTO media_assets (
        id, tenant_id, uploaded_by_user_id, storage_key,
        original_filename, media_type, mime_type, size_bytes, sha256
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::bigint, $9)
      RETURNING ${PUBLIC_FIELDS}
    `, [
      input.id, context.tenantId, context.authorUserId, input.storageKey,
      input.originalFilename, input.mediaType, input.mimeType, input.sizeBytes,
      input.sha256,
    ]);
    if (!result.rows[0]) throw new Error("O banco não retornou a mídia criada.");
    return mapMediaRow(result.rows[0]);
  }

  async list(context: PostsContext): Promise<MediaAsset[]> {
    const result = await this.pool.query<MediaRow>(`
      SELECT ${PUBLIC_FIELDS}
      FROM media_assets
      WHERE tenant_id = $1::uuid AND deleted_at IS NULL
      ORDER BY created_at DESC, id
    `, [context.tenantId]);
    return result.rows.map(mapMediaRow);
  }

  async findById(context: PostsContext, id: string): Promise<MediaAsset | null> {
    const result = await this.pool.query<MediaRow>(`
      SELECT ${PUBLIC_FIELDS}
      FROM media_assets
      WHERE tenant_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
    `, [context.tenantId, id]);
    return result.rows[0] ? mapMediaRow(result.rows[0]) : null;
  }

  async findStoredById(context: PostsContext, id: string): Promise<StoredMediaAsset | null> {
    const result = await this.pool.query<StoredMediaRow>(`
      SELECT id, media_type, mime_type, size_bytes, storage_key
      FROM media_assets
      WHERE tenant_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
    `, [context.tenantId, id]);
    const row = result.rows[0];
    return row ? {
      id: row.id,
      mediaType: row.media_type,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      storageKey: row.storage_key,
    } : null;
  }
}
