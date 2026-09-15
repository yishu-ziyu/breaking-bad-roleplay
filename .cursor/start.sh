#!/usr/bin/env bash
# Per-boot reconciliation: start Postgres, ensure the dev role/database exist,
# and apply migrations. Idempotent and safe to re-run on every boot.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

# Start the PostgreSQL 16 cluster (no-op if already running).
sudo pg_ctlcluster 16 main start 2>/dev/null || true

# Wait for the server to accept connections.
for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -q; then break; fi
  sleep 1
done

# Ensure the dev role and database exist (idempotent).
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='bb_roleplay'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE bb_roleplay LOGIN PASSWORD 'password'"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='breaking_bad_roleplay'" | grep -q 1 \
  || sudo -u postgres createdb -O bb_roleplay breaking_bad_roleplay

# Apply Alembic migrations (no-op when already at head).
cd "$ROOT/backend"
uv run alembic upgrade head

echo "start.sh: Postgres ready, schema at head"
