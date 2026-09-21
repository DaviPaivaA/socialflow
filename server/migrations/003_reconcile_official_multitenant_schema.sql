-- Reconcilia o estado-base com o contrato oficial sem recriar tabelas nem
-- descartar dados. Renames preservam valores, FKs, checks, índices e triggers.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active boolean;

UPDATE users
SET is_active = true
WHERE is_active IS NULL;

ALTER TABLE users
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

DO $$
DECLARE
  has_author boolean;
  has_created_by boolean;
  has_scheduled_at boolean;
  has_scheduled_for boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'posts'
      AND column_name = 'author_user_id'
  ) INTO has_author;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'posts'
      AND column_name = 'created_by_user_id'
  ) INTO has_created_by;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'posts'
      AND column_name = 'scheduled_at'
  ) INTO has_scheduled_at;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'posts'
      AND column_name = 'scheduled_for'
  ) INTO has_scheduled_for;

  IF has_author AND has_created_by THEN
    RAISE EXCEPTION
      'posts possui author_user_id e created_by_user_id simultaneamente; a migração foi interrompida para não duplicar nem sobrescrever autoria.';
  ELSIF NOT has_author AND has_created_by THEN
    ALTER TABLE posts RENAME COLUMN created_by_user_id TO author_user_id;
  ELSIF NOT has_author THEN
    ALTER TABLE posts ADD COLUMN author_user_id uuid;
  END IF;

  IF has_scheduled_for AND has_scheduled_at THEN
    RAISE EXCEPTION
      'posts possui scheduled_for e scheduled_at simultaneamente; a migração foi interrompida para não duplicar nem sobrescrever agendamentos.';
  ELSIF NOT has_scheduled_for AND has_scheduled_at THEN
    ALTER TABLE posts RENAME COLUMN scheduled_at TO scheduled_for;
  ELSIF NOT has_scheduled_for THEN
    ALTER TABLE posts ADD COLUMN scheduled_for timestamptz;
  END IF;
END $$;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS title varchar(255);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM posts WHERE author_user_id IS NULL) THEN
    RAISE EXCEPTION
      'Existem posts sem autor. A migração foi interrompida para preservar os registros; associe cada post a um membro válido do tenant antes de continuar.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM posts post_row
    LEFT JOIN tenant_members member_row
      ON member_row.tenant_id = post_row.tenant_id
     AND member_row.user_id = post_row.author_user_id
    WHERE member_row.user_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Existem posts cujo autor não pertence ao tenant. A migração foi interrompida para preservar a integridade multi-tenant.';
  END IF;
END $$;

ALTER TABLE posts
  ALTER COLUMN author_user_id SET NOT NULL;

DO $$
DECLARE
  author_fk_name text;
BEGIN
  SELECT constraint_row.conname
  INTO author_fk_name
  FROM pg_constraint constraint_row
  JOIN pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = ANY (constraint_row.conkey)
  WHERE constraint_row.conrelid = 'posts'::regclass
    AND constraint_row.contype = 'f'
    AND attribute_row.attname = 'author_user_id'
  LIMIT 1;

  IF author_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE posts DROP CONSTRAINT %I', author_fk_name);
  END IF;

  ALTER TABLE posts
    ADD CONSTRAINT posts_author_user_id_fkey
    FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT;
END $$;

DO $$
BEGIN
  IF to_regclass(format('%I.idx_posts_scheduled', current_schema())) IS NOT NULL
     AND to_regclass(format('%I.idx_posts_tenant_scheduled_for', current_schema())) IS NULL THEN
    ALTER INDEX idx_posts_scheduled RENAME TO idx_posts_tenant_scheduled_for;
  END IF;

  IF to_regclass(format('%I.idx_posts_status', current_schema())) IS NOT NULL
     AND to_regclass(format('%I.idx_posts_tenant_status', current_schema())) IS NULL THEN
    ALTER INDEX idx_posts_status RENAME TO idx_posts_tenant_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'posts'::regclass AND conname = 'posts_check'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'posts'::regclass AND conname = 'posts_schedule_required'
  ) THEN
    ALTER TABLE posts RENAME CONSTRAINT posts_check TO posts_schedule_required;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_tenant_scheduled_for
  ON posts (tenant_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_tenant_status
  ON posts (tenant_id, status);

ALTER TABLE tenant_members
  ADD COLUMN IF NOT EXISTS id uuid;

UPDATE tenant_members
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE tenant_members
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_tenant_id_user_id_key
  ON tenant_members (tenant_id, user_id);

DO $$
DECLARE
  members_table regclass := 'tenant_members'::regclass;
  primary_key_name text;
  primary_key_columns text[];
BEGIN
  SELECT constraint_row.conname,
         array_agg(attribute_row.attname ORDER BY key_column.ordinality)
  INTO primary_key_name, primary_key_columns
  FROM pg_constraint constraint_row
  JOIN unnest(constraint_row.conkey) WITH ORDINALITY
    AS key_column(attnum, ordinality) ON true
  JOIN pg_attribute attribute_row
    ON attribute_row.attrelid = constraint_row.conrelid
   AND attribute_row.attnum = key_column.attnum
  WHERE constraint_row.conrelid = members_table
    AND constraint_row.contype = 'p'
  GROUP BY constraint_row.conname;

  IF primary_key_name IS NULL THEN
    ALTER TABLE tenant_members
      ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);
  ELSIF primary_key_columns <> ARRAY['id'] THEN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      WHERE constraint_row.contype = 'f'
        AND constraint_row.confrelid = members_table
    ) THEN
      RAISE EXCEPTION
        'tenant_members possui chaves estrangeiras dependentes da chave primária composta; a migração foi interrompida para preservar os dados.';
    END IF;

    EXECUTE format(
      'ALTER TABLE tenant_members DROP CONSTRAINT %I',
      primary_key_name
    );
    ALTER TABLE tenant_members
      ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
DECLARE
  invalid_column text;
BEGIN
  SELECT format('%s.%s', column_row.table_name, column_row.column_name)
  INTO invalid_column
  FROM information_schema.columns column_row
  WHERE column_row.table_schema = current_schema()
    AND (column_row.table_name, column_row.column_name) IN (
      ('users', 'id'),
      ('tenants', 'id'),
      ('tenant_members', 'id'),
      ('tenant_members', 'tenant_id'),
      ('tenant_members', 'user_id'),
      ('posts', 'id'),
      ('posts', 'tenant_id'),
      ('posts', 'author_user_id'),
      ('posts', 'rag_run_id')
    )
    AND column_row.data_type <> 'uuid'
  LIMIT 1;

  IF invalid_column IS NOT NULL THEN
    RAISE EXCEPTION
      'O schema usa % em tipo incompatível. A migração foi interrompida sem converter nem descartar dados.',
      invalid_column;
  END IF;
END $$;
