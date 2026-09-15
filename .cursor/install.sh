#!/usr/bin/env bash
# Idempotent dependency refresh for the Cloud Agent environment.
# Runs after checkout. Installs system toolchains (once) and project deps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

# uv — Python dependency manager (installs to ~/.local/bin).
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# PostgreSQL — the backend requires a Postgres DATABASE_URL to boot.
# apt install is a no-op when the package is already present (snapshot reuse).
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib
fi

# Frontend deps. Use `npm install` (not `npm ci`): the committed lockfile was
# generated on macOS and omits the Linux native bindings (npm/cli#4828), so a
# fresh resolve is required to pull the linux rolldown + lightningcss bindings
# pinned in optionalDependencies.
cd "$ROOT"
npm install --no-audit --no-fund

# Backend deps into a project-local .venv.
cd "$ROOT/backend"
uv sync

# Local dev config. Only create when absent so real keys are never clobbered.
if [ ! -f "$ROOT/backend/.env" ]; then
  cat > "$ROOT/backend/.env" <<'ENV'
# Local Cloud Agent dev config. DATABASE_URL points at the VM-local Postgres.
DATABASE_URL=postgresql+asyncpg://bb_roleplay:password@localhost:5432/breaking_bad_roleplay
APP_ENV=development
LOG_LEVEL=INFO
ALLOWED_ORIGINS=*
# The config validator requires at least one LLM key to boot. This placeholder
# enables the offline agent harness / health / catalog endpoints. Add a real
# MINIMAX_API_KEY (or STEPFUN_API_KEY) as a Cloud Agent secret to enable live
# chat + story generation — an injected env var overrides this .env value.
MINIMAX_API_KEY=dev-offline-placeholder
ENV
fi

echo "install.sh: done"
