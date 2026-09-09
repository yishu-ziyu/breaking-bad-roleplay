#!/usr/bin/env bash
# Run on the VM after uploading code. Never trace this script: env contains keys.
set -euo pipefail
cd "${BB_APP_DIR:-/opt/breaking-bad-roleplay}"

# The existing VM .env.local holds the public browser credentials. Keep runtime
# DATABASE_URL in .env: restoring Auth must not switch the canonical story DB.
if [[ -f .env.local ]]; then
  source .env.local
fi
: "${VITE_SUPABASE_URL:?Set VITE_SUPABASE_URL in the VM .env.local}"
: "${VITE_SUPABASE_PUBLISHABLE_KEY:?Set the public Supabase key in the VM .env.local}"
export VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY
export SUPABASE_URL="$VITE_SUPABASE_URL"
export SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY"

docker network inspect bb-net >/dev/null 2>&1 || docker network create bb-net
docker build --build-arg VITE_SUPABASE_URL \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY -t bb-roleplay:latest .
# With set -e, build failure never reaches the stop/remove steps.
if docker container inspect bb-roleplay >/dev/null 2>&1; then
  docker stop bb-roleplay
  docker rm bb-roleplay
fi
docker run -d --name bb-roleplay --network bb-net --restart unless-stopped \
  -p 8080:8080 --env-file .env \
  --env SUPABASE_URL --env SUPABASE_PUBLISHABLE_KEY bb-roleplay:latest
