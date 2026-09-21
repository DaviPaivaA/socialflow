-- Requests OAuth efêmeros e reutilizáveis por providers futuros. O state em
-- plaintext existe somente no navegador; o PostgreSQL armazena seu SHA-256.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'auth_sessions'::regclass
      AND conname = 'auth_sessions_id_membership_id_key'
  ) THEN
    ALTER TABLE auth_sessions
      ADD CONSTRAINT auth_sessions_id_membership_id_key
      UNIQUE (id, membership_id);
  END IF;
END $$;

CREATE TABLE oauth_authorization_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider social_platform NOT NULL,
  state_hash char(64) NOT NULL UNIQUE,
  auth_session_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CONSTRAINT oauth_authorization_requests_state_hash_format CHECK (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT oauth_authorization_requests_expiration CHECK (
    expires_at > created_at
  ),
  CONSTRAINT oauth_authorization_requests_consumed_at_valid CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  ),
  CONSTRAINT oauth_authorization_requests_session_fkey
    FOREIGN KEY (auth_session_id, membership_id)
    REFERENCES auth_sessions(id, membership_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_oauth_authorization_requests_session
  ON oauth_authorization_requests (auth_session_id);

CREATE INDEX idx_oauth_authorization_requests_pending_expiration
  ON oauth_authorization_requests (expires_at)
  WHERE consumed_at IS NULL;
