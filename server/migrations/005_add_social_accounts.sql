-- Preserva o modelo oficial já presente em alguns bancos e cria o mesmo
-- modelo em instalações novas. Perfis, conexões OAuth e credenciais permanecem
-- separados; esta migration não implementa o fluxo OAuth.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = current_schema()
      AND type_row.typname = 'social_platform'
  ) THEN
    CREATE TYPE social_platform AS ENUM ('meta', 'tiktok');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = current_schema()
      AND type_row.typname = 'oauth_connection_status'
  ) THEN
    CREATE TYPE oauth_connection_status AS ENUM (
      'active',
      'expired',
      'revoked',
      'error'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type type_row
    JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
    WHERE namespace_row.nspname = current_schema()
      AND type_row.typname = 'social_account_type'
  ) THEN
    CREATE TYPE social_account_type AS ENUM (
      'facebook_page',
      'instagram_business',
      'tiktok_account'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS oauth_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  platform social_platform NOT NULL,
  external_user_id text NOT NULL,
  access_token_encrypted bytea,
  refresh_token_encrypted bytea,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status oauth_connection_status NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, platform, external_user_id),
  CONSTRAINT oauth_connections_external_user_id_valid CHECK (
    length(btrim(external_user_id)) BETWEEN 1 AND 255
  ),
  CONSTRAINT oauth_connections_scopes_limit CHECK (cardinality(scopes) <= 50),
  CONSTRAINT oauth_connections_metadata_object CHECK (
    jsonb_typeof(metadata) = 'object'
  ),
  CONSTRAINT oauth_connections_revoked_state CHECK (
    status <> 'revoked'::oauth_connection_status
    OR (
      revoked_at IS NOT NULL
      AND access_token_encrypted IS NULL
      AND refresh_token_encrypted IS NULL
    )
  )
);

-- O schema oficial anterior exigia ciphertext mesmo para uma conexão que
-- ainda seria marcada pending e impedia apagar o segredo na revogação.
ALTER TABLE oauth_connections
  ALTER COLUMN access_token_encrypted DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'oauth_connections'::regclass
      AND conname = 'oauth_connections_external_user_id_valid'
  ) THEN
    ALTER TABLE oauth_connections
      ADD CONSTRAINT oauth_connections_external_user_id_valid CHECK (
        length(btrim(external_user_id)) BETWEEN 1 AND 255
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'oauth_connections'::regclass
      AND conname = 'oauth_connections_scopes_limit'
  ) THEN
    ALTER TABLE oauth_connections
      ADD CONSTRAINT oauth_connections_scopes_limit
      CHECK (cardinality(scopes) <= 50);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'oauth_connections'::regclass
      AND conname = 'oauth_connections_metadata_object'
  ) THEN
    ALTER TABLE oauth_connections
      ADD CONSTRAINT oauth_connections_metadata_object
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'oauth_connections'::regclass
      AND conname = 'oauth_connections_revoked_state'
  ) THEN
    ALTER TABLE oauth_connections
      ADD CONSTRAINT oauth_connections_revoked_state CHECK (
        status <> 'revoked'::oauth_connection_status
        OR (
          revoked_at IS NOT NULL
          AND access_token_encrypted IS NULL
          AND refresh_token_encrypted IS NULL
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  oauth_connection_id uuid NOT NULL,
  account_type social_account_type NOT NULL,
  external_account_id text NOT NULL,
  username text,
  display_name text,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, oauth_connection_id, external_account_id),
  FOREIGN KEY (tenant_id, oauth_connection_id)
    REFERENCES oauth_connections(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT social_accounts_external_account_id_valid CHECK (
    length(btrim(external_account_id)) BETWEEN 1 AND 255
  ),
  CONSTRAINT social_accounts_username_valid CHECK (
    username IS NULL OR length(btrim(username)) BETWEEN 1 AND 100
  ),
  CONSTRAINT social_accounts_display_name_valid CHECK (
    display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120
  ),
  CONSTRAINT social_accounts_avatar_url_length CHECK (
    avatar_url IS NULL OR length(avatar_url) <= 2048
  ),
  CONSTRAINT social_accounts_metadata_object CHECK (
    jsonb_typeof(metadata) = 'object'
  )
);

ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM social_accounts
    GROUP BY tenant_id, account_type, external_account_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Existem contas sociais externas duplicadas no mesmo tenant. A migration foi interrompida sem descartar registros.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_external_account_unique'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_external_account_unique
      UNIQUE (tenant_id, account_type, external_account_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_external_account_id_valid'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_external_account_id_valid CHECK (
        length(btrim(external_account_id)) BETWEEN 1 AND 255
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_username_valid'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_username_valid CHECK (
        username IS NULL OR length(btrim(username)) BETWEEN 1 AND 100
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_display_name_valid'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_display_name_valid CHECK (
        display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_avatar_url_length'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_avatar_url_length CHECK (
        avatar_url IS NULL OR length(avatar_url) <= 2048
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_metadata_object'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_metadata_object
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS social_account_credentials (
  tenant_id uuid NOT NULL,
  social_account_id uuid PRIMARY KEY,
  access_token_encrypted bytea,
  refresh_token_encrypted bytea,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, social_account_id)
    REFERENCES social_accounts(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE social_account_credentials
  ALTER COLUMN access_token_encrypted DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_connections_tenant
  ON oauth_connections (tenant_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant
  ON social_accounts (tenant_id, account_type, is_active);

CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant_provider
  ON social_accounts (tenant_id, account_type);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'oauth_connections'::regclass
      AND tgname = 'trg_oauth_connections_updated_at'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_oauth_connections_updated_at
    BEFORE UPDATE ON oauth_connections
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'social_accounts'::regclass
      AND tgname = 'trg_social_accounts_updated_at'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_social_accounts_updated_at
    BEFORE UPDATE ON social_accounts
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'social_account_credentials'::regclass
      AND tgname = 'trg_social_account_credentials_updated_at'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_social_account_credentials_updated_at
    BEFORE UPDATE ON social_account_credentials
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
