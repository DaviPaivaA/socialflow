CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key text NOT NULL UNIQUE,
  original_filename varchar(255) NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  mime_type text NOT NULL CHECK (
    (media_type = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp'))
    OR (media_type = 'video' AND mime_type IN ('video/mp4', 'video/quicktime'))
  ),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width > 0),
  height integer CHECK (height > 0),
  duration_ms bigint CHECK (duration_ms > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT media_assets_storage_key_format CHECK (
    storage_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov)$'
  ),
  CONSTRAINT media_assets_original_filename_valid CHECK (
    length(btrim(original_filename)) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_id
  ON media_assets (tenant_id);

CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_created_at
  ON media_assets (tenant_id, created_at DESC, id);
