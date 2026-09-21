-- PostgreSQL só permite usar um novo valor de enum depois do commit da
-- transação que o adicionou. Por isso este ajuste fica separado da criação e
-- reconciliação estrutural da migration 005.
ALTER TYPE oauth_connection_status
  ADD VALUE IF NOT EXISTS 'pending' BEFORE 'active';
