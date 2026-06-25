"""POST /api/story/next — Generate the next beat for a story session."""
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
Emit a JSON array of narrative events for the current beat. Each event has "type" and "data":
  scene_change, agent_act, agent_think, agent_speak, world_state_delta.
Characters: Walter White, Jesse Pinkman, Skyler White, Saul Goodman, Mike Ehrmantraut, Gus Fring.
emotion_state: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate.
gif_search_query: English, visually descriptive.
End with world_state_delta."""


def call_llm(messages, api_key):
    req = Request(
        LLM_URL,
        data=json.dumps({"model": LLM_MODEL, "messages": messages}).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())["choices"][0]["message"]["content"]


def supabase_query(table, params):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    req = Request(url, headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def supabase_insert(table, row):
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=json.dumps(row).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def supabase_update(table, data, where):
    req = Request(
        f"{SUPABASE_URL}/rest/v1/{table}?{where}",
        data=json.dumps(data).encode(),
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )
    with urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def parse_events(text):
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    raw = fenced.group(1) if fenced else text.strip()
    start, end = raw.find("["), raw.rfind("]")
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError:
            pass
    return []


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

        session_id = body.get("session_id", "")
        action = body.get("action", "continue")
        if not session_id:
            self._json(400, {"error": "session_id required"})
            return

        try:
            # Load session
            sessions = supabase_query("story_sessions", f"id=eq.{session_id}")
            if not sessions:
                self._json(404, {"error": "Session not found"})
                return
            session = sessions[0]

            if action == "stop":
                supabase_update("story_sessions", {"status": "paused"}, f"id=eq.{session_id}")
                self._json(200, {"status": "paused"})
                return

            if action == "redirect":
                new_prompt = body.get("redirect_prompt", "")
                if new_prompt:
                    supabase_update("story_sessions", {"task_prompt": new_prompt}, f"id=eq.{session_id}")
                    session["task_prompt"] = new_prompt

            task = session["task_prompt"]
            outline = session.get("outline", "")
            current_beat = session.get("current_beat", 0)
            scenes = self._parse_scenes(outline)

            if current_beat >= len(scenes):
                supabase_insert("story_events", {
                    "session_id": session_id,
                    "event_type": "complete",
                    "event_data": {"message": "All beats rendered."},
                    "beat_index": current_beat,
                })
                self._json(200, {"status": "complete"})
                return

            scene_desc = scenes[current_beat]

            # Generate beat events
            messages = [
                {"role": "system", "content": DIRECTOR_SYSTEM},
                {"role": "user", "content": f"Task: {task}\n\nOutline:\n{outline}\n\nCurrent scene (beat {current_beat + 1}): {scene_desc}\n\nGenerate events as a JSON array."},
            ]
            raw = call_llm(messages, api_key)
            events = parse_events(raw)

            # Insert each event into Supabase (Realtime will push to frontend)
            inserted = []
            for evt in events:
                row = supabase_insert("story_events", {
                    "session_id": session_id,
                    "event_type": evt.get("type", "unknown"),
                    "event_data": evt.get("data", {}),
                    "beat_index": current_beat,
                })
                inserted.append(evt.get("type", "unknown"))

            # Insert beat_ready event
            supabase_insert("story_events", {
                "session_id": session_id,
                "event_type": "beat_ready",
                "event_data": {"beat_id": f"beat_{current_beat + 1}", "beat_summary": scene_desc},
                "beat_index": current_beat,
            })

            # Advance beat counter
            supabase_update("story_sessions", {
                "current_beat": current_beat + 1,
                "updated_at": "now()",
            }, f"id=eq.{session_id}")

            self._json(200, {
                "beat": current_beat + 1,
                "events": inserted,
                "remaining": len(scenes) - current_beat - 1,
            })

        except Exception as e:
            self._json(500, {"error": str(e)})

    @staticmethod
    def _parse_scenes(text):
        if not text:
            return []
        scenes = []
        current = []
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if re.match(r"^\d+[\.\)]\s+", stripped):
                if current:
                    scenes.append(" ".join(current))
                current = [re.sub(r"^\d+[\.\)]\s+", "", stripped)]
            elif current:
                current.append(stripped)
        if current:
            scenes.append(" ".join(current))
        return scenes if scenes else [text.strip()]

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
