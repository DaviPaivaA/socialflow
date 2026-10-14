ALTER TABLE post_publications
  ADD CONSTRAINT post_publications_tenant_id_id_key UNIQUE (tenant_id, id);

CREATE TABLE publication_operations (
  tenant_id uuid NOT NULL,
  publication_id uuid NOT NULL UNIQUE,
  media_asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('facebook_reel', 'instagram_image', 'instagram_reel')),
  stage text NOT NULL CHECK (stage IN (
    'prepared', 'creating', 'created', 'uploading', 'processing', 'ready',
    'publishing', 'verifying', 'succeeded', 'failed', 'unknown'
  )),
  provider_account_id text NOT NULL CHECK (provider_account_id ~ '^[0-9]{1,255}$'),
  graph_api_version text NOT NULL CHECK (graph_api_version ~ '^v[0-9]+\.[0-9]+$'),
  external_id text CHECK (external_id ~ '^[0-9]{1,255}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_action_at timestamptz,
  deadline_at timestamptz NOT NULL,
  stage_started_at timestamptz NOT NULL,
  poll_count integer NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
  delivery_issued_at timestamptz,
  delivery_expires_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  PRIMARY KEY (tenant_id, publication_id),
  FOREIGN KEY (tenant_id, publication_id)
    REFERENCES post_publications (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, media_asset_id)
    REFERENCES media_assets (tenant_id, id) ON DELETE RESTRICT,
  CHECK (deadline_at > created_at),
  CHECK (stage_started_at >= created_at AND updated_at >= stage_started_at),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (lease_expires_at IS NULL OR lease_expires_at > created_at),
  CHECK (stage IN ('prepared', 'creating', 'failed', 'unknown') OR external_id IS NOT NULL),
  CHECK (stage <> 'uploading' OR kind = 'facebook_reel'),
  CHECK ((delivery_issued_at IS NULL) = (delivery_expires_at IS NULL)),
  CHECK (delivery_issued_at IS NULL OR (
    kind IN ('instagram_image', 'instagram_reel') AND delivery_issued_at >= date_trunc('second', created_at)
    AND delivery_expires_at > delivery_issued_at
  ))
);

CREATE INDEX idx_publication_operations_due
  ON publication_operations (next_action_at, tenant_id, publication_id)
  WHERE next_action_at IS NOT NULL AND stage NOT IN ('succeeded', 'failed', 'unknown');

CREATE INDEX idx_publication_operations_lease
  ON publication_operations (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
