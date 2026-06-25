"""POST /api/story — Generate all story beats in one call."""
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen

LLM_URL = os.environ.get("LLM_URL", "https://apihub.agnes-ai.com/v1/chat/completions")
LLM_MODEL = os.environ.get("LLM_MODEL", "agnes-2.0-flash")

DIRECTOR_SYSTEM = """You are the Director of a Breaking Bad interactive roleplay.
Known characters: Walter White, Jesse Pinkman, Skyler White, Saul Goodman, Mike Ehrmantraut, Gus Fring.

Output a JSON object with two keys:
- "outline": a plain-text numbered list of 3-5 scenes (each line: "1. Scene title — description")
- "beats": an array of 3-5 beat objects. Each beat has:
    - "scene": string, scene title
    - "events": array of event objects. Each event has:
        - "type": one of "scene_change", "agent_act", "agent_think", "agent_speak", "world_state_delta"
        - "data": object with event-specific fields:
            scene_change: { "from_scene": "...", "to_scene": "...", "description": "..." }
            agent_act: { "character_id": "...", "action": "...", "target": "..." }
            agent_think: { "character_id": "...", "thought_content": "..." }
            agent_speak: { "character_id": "...", "content": "...", "emotion_state": "...", "gif_search_query": "..." }
            world_state_delta: { "deltas": [{ "target": "...", "field": "...", "old_value": "...", "new_value": "..." }] }
    - "director_note": string, brief note about what's happening in this beat

Rules:
- character_id must be exactly one of: Walter White, Jesse Pinkman, Skyler White, Saul Goodman, Mike Ehrmantraut, Gus Fring
- emotion_state: calm, tense, angry, fearful, manipulative, guilty, resigned, desperate
- gif_search_query: English, visually descriptive (e.g. "man in hazmat suit cooking in desert")
- End the last beat with world_state_delta
- Make it feel like Breaking Bad — tense, consequential, dark humor
- IMPORTANT: Return ONLY the JSON object, no markdown fences, no explanation text.
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


def extract_json(text):
    fenced = __import__("re").search(r"```(?:json)?\s*(\{.*?\})\s*```", text, __import__("re").DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {"outline": text[:500], "beats": []}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
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
            messages = [
                {"role": "system", "content": DIRECTOR_SYSTEM},
                {"role": "user", "content": f"Task: {task}\nActive character focus: {character_id}"},
            ]
            raw = call_llm(messages, api_key)
            result = extract_json(raw)

            # Ensure structure
            if "beats" not in result:
                result["beats"] = []
            if "outline" not in result:
                result["outline"] = ""

            self._json(200, result)
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
