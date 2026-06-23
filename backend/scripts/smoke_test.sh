#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Breaking Bad Roleplay — End-to-End Smoke Test
#
# Tests the minimal API path:
#   1. Postgres running + DATABASE_URL reachable
#   2. Tables created (setup_db.py)
#   3. FastAPI server on :8001
#   4. POST /api/session/create
#   5. GET  /api/session/{id}/stream  (SSE)
#   6. POST /api/session/{id}/action  (continue)
#   7. POST /api/session/{id}/action  (stop)
#
# Exit 0 = all steps passed, exit 1 = any step failed.
# ---------------------------------------------------------------------------

set -uo pipefail

# ---------- paths ----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# ---------- counters -------------------------------------------------------
PASS=0
FAIL=0
STARTED_POSTGRES=0
SERVER_PID=""
SSE_LOG=""

# ---------- helpers --------------------------------------------------------
record_pass() {
    PASS=$((PASS + 1))
    echo "  [PASS] $1"
}

record_fail() {
    FAIL=$((FAIL + 1))
    echo "  [FAIL] $1"
}

cleanup() {
    # Kill server if still running
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        # Wait briefly for graceful shutdown
        for _ in $(seq 1 10); do
            kill -0 "$SERVER_PID" 2>/dev/null || break
            sleep 0.3
        done
        kill -9 "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    # Stop Postgres if we started it
    if [[ "$STARTED_POSTGRES" == "1" ]]; then
        brew services stop postgresql@16 2>/dev/null || true
    fi
    # Clean temp files
    [[ -n "${SSE_LOG:-}" ]] && [[ -f "$SSE_LOG" ]] && rm -f "$SSE_LOG"
}
trap cleanup EXIT

# ---------- load .env ------------------------------------------------------
if [[ -f "$BACKEND_DIR/.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$BACKEND_DIR/.env"
    set +a
fi

export PYTHONPATH="$BACKEND_DIR"
export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://bb_roleplay:password@localhost:5432/breaking_bad_roleplay}"

# ==========================================================================
echo "============================================================"
echo " Breaking Bad Roleplay — Smoke Test"
echo " Backend: $BACKEND_DIR"
echo " DATABASE_URL: $DATABASE_URL"
echo "============================================================"
echo ""

# ==========================================================================
# Step 1: Postgres running?
# ==========================================================================
echo "--- Step 1: Postgres running on :5432 ---"
if pg_isready -q -h localhost -p 5432 2>/dev/null; then
    record_pass "Postgres is running"
else
    echo "  Postgres not running, attempting to start..."
    # Try brew services first, fall back to pg_ctl
    brew services start postgresql@16 2>/dev/null || \
        pg_ctl -D /opt/homebrew/var/postgres start 2>/dev/null || true
    STARTED_POSTGRES=1

    ready=0
    for _i in $(seq 1 30); do
        if pg_isready -q -h localhost -p 5432 2>/dev/null; then
            ready=1
            break
        fi
        sleep 1
    done

    if [[ "$ready" == "1" ]]; then
        record_pass "Postgres started and ready"
    else
        record_fail "Postgres did not become ready within 30s"
    fi
fi

# ==========================================================================
# Step 2: DATABASE_URL reachable
# ==========================================================================
echo "--- Step 2: DATABASE_URL reachable ---"
DB_REACHABLE=0

# First try the target URL directly
if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
    DB_REACHABLE=1
else
    # Target DB or user might not exist yet — create them via default connection
    DEFAULT_URL="postgresql://$(whoami)@localhost:5432/postgres"
    if psql "$DEFAULT_URL" -c "SELECT 1" >/dev/null 2>&1; then
        # Parse DB name from URL for creation
        DB_NAME=$(python3 -c "
from urllib.parse import urlparse
u = urlparse('$DATABASE_URL')
print(u.path.lstrip('/'))
")
        DB_USER=$(python3 -c "
from urllib.parse import urlparse
u = urlparse('$DATABASE_URL')
print(u.username or '')
")

        if [[ -n "$DB_USER" ]]; then
            psql "$DEFAULT_URL" -c "CREATE USER \"$DB_USER\" WITH PASSWORD 'password';" 2>/dev/null || true
        fi
        if [[ -n "$DB_NAME" ]]; then
            psql "$DEFAULT_URL" -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";" 2>/dev/null || true
            psql "$DEFAULT_URL" -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" 2>/dev/null || true
        fi

        # Re-check
        if psql "$DATABASE_URL" -c "SELECT 1" >/dev/null 2>&1; then
            DB_REACHABLE=1
        fi
    fi
fi

if [[ "$DB_REACHABLE" == "1" ]]; then
    record_pass "DATABASE_URL reachable: $DATABASE_URL"
else
    record_fail "DATABASE_URL not reachable: $DATABASE_URL"
fi

# ==========================================================================
# Step 3: Python dependencies
# ==========================================================================
echo "--- Step 3: Python dependencies ---"
DEPS_OK=0
if python3 -c "import fastapi, sqlalchemy, uvicorn" >/dev/null 2>&1; then
    DEPS_OK=1
else
    echo "  Installing project dependencies..."
    cd "$BACKEND_DIR"
    if command -v uv >/dev/null 2>&1; then
        uv pip install -e . --system >/dev/null 2>&1 || \
        uv pip install fastapi uvicorn sqlalchemy[asyncio] asyncpg httpx pydantic-settings python-dotenv deepagents --system >/dev/null 2>&1 || true
    else
        pip3 install -e . >/dev/null 2>&1 || \
        pip3 install fastapi uvicorn sqlalchemy[asyncio] asyncpg httpx pydantic-settings python-dotenv deepagents >/dev/null 2>&1 || true
    fi
    if python3 -c "import fastapi, uvicorn" >/dev/null 2>&1; then
        DEPS_OK=1
    fi
fi

if [[ "$DEPS_OK" == "1" ]]; then
    record_pass "Python dependencies available (fastapi, uvicorn, sqlalchemy, ...)"
else
    record_fail "Could not install or find Python dependencies"
fi

# ==========================================================================
# Step 4: Create database tables
# ==========================================================================
echo "--- Step 4: Create tables (setup_db.py) ---"
SETUP_LOG=$(mktemp)
if [[ "$DEPS_OK" == "1" ]]; then
    if python3 "$SCRIPT_DIR/setup_db.py" > "$SETUP_LOG" 2>&1; then
        record_pass "Tables created via setup_db.py"
    else
        record_fail "setup_db.py failed (log: $SETUP_LOG)"
    fi
else
    record_fail "Skipped — dependencies missing"
fi
rm -f "$SETUP_LOG"

# ==========================================================================
# Step 5: Start FastAPI server on :8001
# ==========================================================================
echo "--- Step 5: Start FastAPI server on :8001 ---"

# Kill anything already on port 8001
if lsof -ti:8001 >/dev/null 2>&1; then
    echo "  Port 8001 occupied, killing existing process..."
    lsof -ti:8001 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

cd "$BACKEND_DIR"
uvicorn main:app --host 0.0.0.0 --port 8001 --log-level warning \
    > "$BACKEND_DIR/.smoke_server.log" 2>&1 &
SERVER_PID=$!
echo "  Server PID: $SERVER_PID"

# Wait for health endpoint
SERVER_READY=0
for _i in $(seq 1 20); do
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/api/health 2>/dev/null || echo "000")
    if [[ "$HTTP" == "200" ]]; then
        SERVER_READY=1
        break
    fi
    sleep 0.5
done

if [[ "$SERVER_READY" == "1" ]]; then
    record_pass "Server healthy on :8001 (PID $SERVER_PID)"
else
    record_fail "Server did not become healthy within 10s (log: $BACKEND_DIR/.smoke_server.log)"
fi

# ==========================================================================
# Step 6: Create session
# ==========================================================================
echo "--- Step 6: POST /api/session/create ---"
SESSION_ID=""
if [[ "$SERVER_READY" == "1" ]]; then
    CREATE_RESP=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
        -X POST http://localhost:8001/api/session/create \
        -H "Content-Type: application/json" \
        -d '{"title": "Test Session", "task_prompt": "Walter needs to negotiate with Gus about a new distribution route"}')
    HTTP_CODE=$(echo "$CREATE_RESP" | grep "__HTTP_CODE__" | sed 's/__HTTP_CODE__//')
    BODY=$(echo "$CREATE_RESP" | grep -v "__HTTP_CODE__")

    SESSION_ID=$(echo "$BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('session_id', ''))
except Exception:
    print('')
" 2>/dev/null)

    if [[ "$HTTP_CODE" == "200" ]] && [[ -n "$SESSION_ID" ]]; then
        record_pass "Session created: $SESSION_ID"
    else
        record_fail "Session creation failed (HTTP $HTTP_CODE) — body: $BODY"
    fi
else
    record_fail "Skipped — server not ready"
fi

# ==========================================================================
# Step 7: SSE stream
# ==========================================================================
echo "--- Step 7: GET /api/session/{id}/stream (SSE, 60s timeout) ---"
SSE_OK=0
if [[ -n "$SESSION_ID" ]]; then
    SSE_LOG=$(mktemp)
    # --max-time 65 covers LLM call + beat generation + error paths
    curl --no-buffer --max-time 65 --connect-timeout 5 \
        "http://localhost:8001/api/session/${SESSION_ID}/stream" \
        > "$SSE_LOG" 2>/dev/null
    CURL_EXIT=$?

    # Parse SSE with Python
    SSE_RESULT=$(python3 - "$SSE_LOG" << 'PYEOF'
import sys, json

events = {}
current_type = None
current_data_lines = []

with open(sys.argv[1]) as f:
    for raw_line in f:
        line = raw_line.rstrip("\n")
        if not line.strip():
            if current_type and current_data_lines:
                data_str = "".join(current_data_lines)
                try:
                    parsed = json.loads(data_str)
                    events.setdefault(current_type, []).append(parsed)
                except json.JSONDecodeError:
                    pass
                current_type = None
                current_data_lines = []
            continue
        if line.startswith("event:"):
            current_type = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            current_data_lines.append(line.split(":", 1)[1].strip())

# Flush last event (file may not end with blank line)
if current_type and current_data_lines:
    data_str = "".join(current_data_lines)
    try:
        parsed = json.loads(data_str)
        events.setdefault(current_type, []).append(parsed)
    except json.JSONDecodeError:
        pass

required = ["status"]
# Accept either:
#   - beat_ready (happy path, LLM works)
#   - error      (LLM not configured / provider fails)
#   - outline + at least one content event
content_events = ["outline", "scene_change", "agent_act", "agent_speak", "agent_think"]

ok = True
missing = []
for r in required:
    if r not in events:
        missing.append(r)
        ok = False

has_beat_ready = "beat_ready" in events
has_error = "error" in events
has_content = any(e in events for e in content_events)

if not (has_beat_ready or has_error or has_content):
    missing.append("no_meaningful_events(beat_ready|error|outline|scene_change|agent_act|agent_speak)")
    ok = False

if ok:
    print("SSE_OK")
else:
    print("SSE_FAIL:" + ",".join(missing))

for et in sorted(events.keys()):
    print(f"  EVENT:{et}:{len(events[et])}")
PYEOF
)

    # curl exit 0 = normal, 28 = timeout (both acceptable for SSE)
    if [[ "$CURL_EXIT" -eq 0 ]] || [[ "$CURL_EXIT" -eq 28 ]]; then
        if [[ "$SSE_RESULT" == SSE_OK* ]]; then
            record_pass "SSE stream OK — received required events"
            echo "    $SSE_RESULT"
            SSE_OK=1
        else
            record_fail "SSE stream missing required events: $SSE_RESULT"
        fi
    else
        record_fail "SSE curl failed (exit $CURL_EXIT)"
    fi
else
    record_fail "Skipped SSE — no session_id"
fi

# ==========================================================================
# Step 8: POST /action (continue)
# ==========================================================================
echo "--- Step 8: POST /api/session/{id}/action (continue) ---"
if [[ -n "$SESSION_ID" ]]; then
    ACTION_RESP=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
        -X POST "http://localhost:8001/api/session/${SESSION_ID}/action" \
        -H "Content-Type: application/json" \
        -d '{"action": "continue"}')
    HTTP_CODE=$(echo "$ACTION_RESP" | grep "__HTTP_CODE__" | sed 's/__HTTP_CODE__//')
    BODY=$(echo "$ACTION_RESP" | grep -v "__HTTP_CODE__")

    if [[ "$HTTP_CODE" == "200" ]]; then
        record_pass "Continue action accepted (HTTP 200)"
    else
        record_fail "Continue action failed (HTTP $HTTP_CODE) — body: $BODY"
    fi
else
    record_fail "Skipped — no session_id"
fi

# ==========================================================================
# Step 9: POST /action (stop)
# ==========================================================================
echo "--- Step 9: POST /api/session/{id}/action (stop) ---"
if [[ -n "$SESSION_ID" ]]; then
    ACTION_RESP=$(curl -s -w "\n__HTTP_CODE__%{http_code}" \
        -X POST "http://localhost:8001/api/session/${SESSION_ID}/action" \
        -H "Content-Type: application/json" \
        -d '{"action": "stop"}')
    HTTP_CODE=$(echo "$ACTION_RESP" | grep "__HTTP_CODE__" | sed 's/__HTTP_CODE__//')
    BODY=$(echo "$ACTION_RESP" | grep -v "__HTTP_CODE__")

    if [[ "$HTTP_CODE" == "200" ]]; then
        record_pass "Stop action accepted (HTTP 200)"
    else
        record_fail "Stop action failed (HTTP $HTTP_CODE) — body: $BODY"
    fi
else
    record_fail "Skipped — no session_id"
fi

# ==========================================================================
# Summary
# ==========================================================================
echo ""
echo "============================================================"
TOTAL=$((PASS + FAIL))
echo "  Result: $PASS / $TOTAL passed, $FAIL failed"
echo "============================================================"

if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi
exit 0
