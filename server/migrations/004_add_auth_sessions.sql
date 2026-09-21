-- Autenticação da Etapa 4. Preserva usuários legados sem senha e só torna
-- password_hash obrigatório quando todos os registros já são compatíveis.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE password_hash IS NULL) THEN
    RAISE NOTICE
      'users.password_hash permanece nullable: existem usuários legados sem senha.';
  ELSE
    ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
  END IF;
END $$;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash char(64) NOT NULL UNIQUE,
  membership_id uuid NOT NULL
    REFERENCES tenant_members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_token_hash_format CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT auth_sessions_expiration CHECK (expires_at > created_at)
);

CREATE INDEX idx_auth_sessions_membership
  ON auth_sessions (membership_id);

CREATE INDEX idx_auth_sessions_expires_at
  ON auth_sessions (expires_at);
