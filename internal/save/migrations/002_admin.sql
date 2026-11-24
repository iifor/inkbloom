BEGIN;
CREATE TABLE admin_accounts (name text PRIMARY KEY);
CREATE TABLE admin_sessions (
 token_hash bytea PRIMARY KEY, account text NOT NULL REFERENCES admin_accounts,
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_expiration ON admin_sessions(expires_at);
CREATE TABLE admin_operations (
 id uuid PRIMARY KEY, account text NOT NULL REFERENCES admin_accounts, action text NOT NULL,
 target text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE world_backups (
 id uuid PRIMARY KEY REFERENCES admin_operations, world_id text NOT NULL, save_sequence bigint NOT NULL,
 format_version integer NOT NULL, snapshot jsonb NOT NULL, digest text NOT NULL
);
COMMIT;
