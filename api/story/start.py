"""POST /api/story/start — Create a story session and generate outline."""
import json
import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen

LLM_URL = os.environ.get("LLM_URL", "https://apihub.agnes-ai.com/v1/chat/completions")
LLM_MODEL = os.environ.get("LLM_MODEL", "agnes-2.0-flash")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

DIRECTOR_SYSTEM = """You are the Director of a Breaking Bad interactive roleplay.
Known characters: Walter White, Jesse Pinkman, Skyler White, Saul Goodman, Mike Ehrmantraut, Gus Fring.
Your job is to orchestrate character agents and emit structured events.

For every narrative beat emit a JSON array of events:
  scene_change:     { "from_scene": "...", "to_scene": "...", "description": "..." }
  agent_act:        { "character_id": "...", "action": "...", "target": "..." }
  agent_think:      { "character_id": "...", "thought_content": "..." }
  agent_speak:      { "character_id": "...", "content": "...", "emotion_state": "...", "gif_search_query": "..." }
  world_state_delta:{ "deltas": [{ "target": "...", "field": "...", "old_value": "...", "new_value": "..." }] }

RULES:
- Each event has "type" and "data" fields.
- emotion_state: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
- gif_search_query: English, visually descriptive.
- character_id must be exactly one of the 6 known names.
- End each beat with world_state_delta.
"""


def call_llm(messages, api_key):
    req = Request(
        LLM_URL,
        data=json.dumps({"model": LLM_MODEL, "messages": messages}).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"]


def supabase_insert(table, row):
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=json.dumps(row).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="POST",
    )
    with urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not all([SUPABASE_URL, SUPABASE_KEY]):
            self._json(500, {"error": "Supabase not configured"})
            return
        api_key = os.environ.get("LLM_API_KEY", "")
        if not api_key:
            self._json(500, {"error": "LLM_API_KEY not configured"})
            return

        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except (json.JSONDecodeError, ValueError):
            self._json(400, {"error": "Invalid JSON"})
            return

        task = body.get("task_prompt", "").strip()
        character_id = body.get("active_character_id", "walter")
        if not task:
            self._json(400, {"error": "task_prompt required"})
            return

        try:
            # Generate outline
            messages = [
                {"role": "system", "content": DIRECTOR_SYSTEM},
                {"role": "user", "content": f"Task: {task}\n\nOutput a PLAIN TEXT numbered list of scenes. Each line: '1. Scene title — description'. 3-5 scenes."},
            ]
            outline = call_llm(messages, api_key)

            # Clean outline
            if outline.strip().startswith(("[", "{")):
                try:
                    data = json.loads(outline)
                    if isinstance(data, list):
                        outline = "\n".join(f"{i+1}. {item}" if isinstance(item, str) else f"{i+1}. {item.get('scene','')} — {item.get('description','')}" for i, item in enumerate(data))
                except json.JSONDecodeError:
                    pass

            # Create session in Supabase
            rows = supabase_insert("story_sessions", {
                "title": task[:60],
                "task_prompt": task,
                "outline": outline,
                "active_character_id": character_id,
            })
            session = rows[0] if rows else {}

            # Insert outline event
            supabase_insert("story_events", {
                "session_id": session["id"],
                "event_type": "outline",
                "event_data": {"content": outline},
                "beat_index": 0,
            })

            self._json(200, {
                "session_id": session["id"],
                "outline": outline,
            })

        except Exception as e:
            self._json(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
