-- A migration 009 já está aplicada em produção e permanece imutável.
-- Garante a chave candidata exigida pela FK composta, inclusive em schemas
-- oficiais anteriores à migration 005.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND conname = 'social_accounts_tenant_id_id_key'
      AND pg_get_constraintdef(oid, true) <> 'UNIQUE (tenant_id, id)'
  ) THEN
    RAISE EXCEPTION 'social_accounts_tenant_id_id_key existe com definição incompatível';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_accounts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid, true) = 'UNIQUE (tenant_id, id)'
  ) THEN
    ALTER TABLE social_accounts
      ADD CONSTRAINT social_accounts_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TYPE post_publication_status AS ENUM (
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled'
);

CREATE TABLE post_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  social_account_id uuid NOT NULL,
  status post_publication_status NOT NULL DEFAULT 'scheduled',
  provider_post_id text,
  error_code text,
  error_message text,
  started_at timestamptz,
  published_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_publications_tenant_post_social_account_key
    UNIQUE (tenant_id, post_id, social_account_id),
  CONSTRAINT post_publications_post_fkey
    FOREIGN KEY (tenant_id, post_id)
    REFERENCES posts (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT post_publications_social_account_fkey
    FOREIGN KEY (tenant_id, social_account_id)
    REFERENCES social_accounts (tenant_id, id)
    ON DELETE RESTRICT
);

-- O scheduler filtra publicações agendadas e junta ao índice de posts
-- para cada post vencido. A busca global por prazo começa em posts.
CREATE INDEX idx_posts_due_scheduled_for
  ON posts (scheduled_for, tenant_id, id)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX idx_post_publications_status_tenant_post
  ON post_publications (status, tenant_id, post_id);
