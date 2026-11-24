BEGIN;
CREATE TABLE traveller_traces (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id text NOT NULL UNIQUE,
    parent_id text REFERENCES traveller_traces(id),
    mode text NOT NULL,
    record jsonb NOT NULL
);
CREATE INDEX traveller_traces_mode_seq ON traveller_traces(mode, seq DESC);
COMMIT;
