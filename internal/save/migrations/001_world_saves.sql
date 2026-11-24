BEGIN;

CREATE TABLE world_saves (
    world_id text PRIMARY KEY,
    world_type text NOT NULL CHECK (world_type IN ('persistent', 'temporary')),
    format_version integer NOT NULL CHECK (format_version > 0),
    save_sequence bigint NOT NULL CHECK (save_sequence >= 0),
    shared_state jsonb NOT NULL CHECK (jsonb_typeof(shared_state) = 'object')
);

CREATE TABLE player_saves (
    world_id text NOT NULL REFERENCES world_saves ON DELETE CASCADE,
    identity_key bytea NOT NULL CHECK (octet_length(identity_key) = 32),
    name text NOT NULL,
    appearance jsonb NOT NULL,
    personal_state jsonb NOT NULL CHECK (jsonb_typeof(personal_state) = 'object'),
    last_seen double precision NOT NULL,
    PRIMARY KEY (world_id, identity_key)
);

CREATE TABLE legacy_imports (
    world_id text PRIMARY KEY REFERENCES world_saves ON DELETE CASCADE,
    source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32)
);

COMMIT;
