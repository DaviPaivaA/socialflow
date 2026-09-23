-- A migration 008 já está aplicada em produção e permanece imutável.
-- Alguns bancos oficiais já possuem esta chave candidata; instalações novas
-- precisam recebê-la aqui para a FK composta abaixo.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'media_assets'::regclass
      AND conname = 'media_assets_tenant_id_id_key'
      AND pg_get_constraintdef(oid, true) <> 'UNIQUE (tenant_id, id)'
  ) THEN
    RAISE EXCEPTION 'media_assets_tenant_id_id_key existe com definição incompatível';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'media_assets'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid, true) = 'UNIQUE (tenant_id, id)'
  ) THEN
    ALTER TABLE media_assets
      ADD CONSTRAINT media_assets_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE post_media (
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_media_pkey
    PRIMARY KEY (tenant_id, post_id, media_asset_id),
  CONSTRAINT post_media_tenant_post_position_key
    UNIQUE (tenant_id, post_id, position),
  CONSTRAINT post_media_position_nonnegative
    CHECK (position >= 0),
  CONSTRAINT post_media_post_fkey
    FOREIGN KEY (tenant_id, post_id)
    REFERENCES posts (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT post_media_media_asset_fkey
    FOREIGN KEY (tenant_id, media_asset_id)
    REFERENCES media_assets (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_post_media_tenant_media_asset
  ON post_media (tenant_id, media_asset_id);
