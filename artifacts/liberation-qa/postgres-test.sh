#!/bin/sh
set -eu
# Disposable test database; the running world's database is never used by this suite.
INKBLOOM_TEST_DATABASE_URL="${DATABASE_URL%/*}/inkbloom_liberation_qa_20261126?sslmode=disable"
export INKBLOOM_TEST_DATABASE_URL
go test ./internal/multiplayer -run TestLivePostgres -count=1 -timeout=90s
