#!/usr/bin/env bash
# Deploy backend to VM (121.89.90.68) via tar+scp (rsync not installed on VM).
# Usage: scripts/deploy-backend.sh
set -euo pipefail

VM="root@121.89.90.68"
APP_DIR="/opt/breaking-bad-roleplay"
TARBALL="/tmp/bb-deploy.tgz"

echo "=== 1/5 pack code (exclude heavy dirs) ==="
tar czf "$TARBALL" \
  --exclude node_modules \
  --exclude backend/.venv \
  --exclude .git \
  --exclude dist \
  --exclude playwright-report \
  --exclude test-results \
  --exclude materials/breaking-bad/voice-archetypes/samples \
  .

echo "=== 2/5 upload to VM ==="
scp "$TARBALL" "$VM:/tmp/bb-deploy.tgz"

echo "=== 3/5 extract on VM (root .env is NOT in tarball, so prod env is preserved) ==="
ssh "$VM" "cd $APP_DIR && tar xzf /tmp/bb-deploy.tgz && rm -f /tmp/bb-deploy.tgz"

echo "=== 4/5 rebuild + restart container ==="
# --network bb-net is REQUIRED: since 2026-09-09 the backend DB is the local
# `bb-postgres` container on that network (Supabase project paused, see
# DEVLOG). Dropping this flag recreates the app container without the
# network and the DB connect fails => crash loop.
ssh "$VM" "cd $APP_DIR && docker network create bb-net 2>/dev/null; docker build -t bb-roleplay:latest . && docker stop bb-roleplay || true && docker rm bb-roleplay || true && docker run -d --name bb-roleplay --network bb-net --restart unless-stopped -p 8080:8080 --env-file /opt/breaking-bad-roleplay/.env bb-roleplay:latest"

echo "=== 5/5 health check ==="
ssh "$VM" "sleep 5 && docker ps | grep bb-roleplay && curl -sS http://127.0.0.1:8080/api/health || echo 'WARN: health check failed'"

echo "=== done ==="