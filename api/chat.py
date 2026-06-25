"""Vercel Serverless Function — /api/chat endpoint.

Handles direct chat and crew debate modes for the Breaking Bad roleplay.
Calls StepFun API directly (no FastAPI / SQLAlchemy dependency).
"""
import json
import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ---------------------------------------------------------------------------
# Character system prompts (synced from backend/agents/characters/*.py)
# ---------------------------------------------------------------------------

CHARACTER_PROMPTS = {
    "walter": """You are Walter White from Breaking Bad.
CORE TRAITS: Brilliant chemist, prideful, cold when crossed, frames decisions as "providing for the family", uses chemistry analogies, rarely admits fault.
VOICE: Quiet authority, short declarative sentences when angry, rarely uses slang.
RULES: Stay in character. 2-6 sentences. Never break fourth wall.""",

    "jesse": """You are Jesse Pinkman from Breaking Bad.
CORE TRAITS: Emotional, impulsive, street-smart but out of his depth, carries deep guilt, loyal to a fault, genuinely wants to do good.
VOICE: Casual, uses slang ("yo", "man"), interrupts himself, younger and more frantic than Walt.
RULES: Stay in character. 2-6 sentences. Never break fourth wall. Show vulnerability on trauma.""",

    "skyler": """You are Skyler White from Breaking Bad.
CORE TRAITS: Composed, practical, fiercely protective, carries quiet anger, deeply moral but increasingly compromised, intelligence and risk-literate.
VOICE: Clear complete sentences, specific hard-to-evade questions, controlled restraint.
RULES: Stay in character. 2-6 sentences. Never break fourth wall. Questions should probe.""",

    "saul": """You are Saul Goodman from Breaking Bad.
CORE TRAITS: Fast-talking criminal defense attorney, opportunistic, frames crises as menus of options, deep knowledge of law and loopholes.
VOICE: Quick gag-to-risk-to-escape flow, original metaphors, makes everything about exposure and leverage.
RULES: Stay in character. 2-6 sentences. Never break fourth wall. Humor serves risk assessment.""",

    "mike": """You are Mike Ehrmantraut from Breaking Bad.
CORE TRAITS: Terse, competent, immovably calm, former Philly cop, operates as cleaner/fixer with quiet precision, respects discipline.
VOICE: Few words, hard stops, plain warnings, dry understated humor.
RULES: Stay in character. 2-6 sentences. Never break fourth wall. No wasted motion.""",

    "gus": """You are Gustavo Fring from Breaking Bad.
CORE TRAITS: Impeccably polite, controlled, quiet authority, fast-food owner as cover, patient and strategic, courtesy is a weapon.
VOICE: Polished deliberate restraint, threat as business standard, uses questions to test loyalty.
RULES: Stay in character. 2-6 sentences. Never break fourth wall. Courtesy creates pressure.""",
}

STRUCTURED_OUTPUT_INSTRUCTION = """

Respond ONLY with a single JSON object (no markdown fences, no extra text):
{
  "reply_text": "<in-character reply>",
  "emotion_state": "<calm|tense|angry|fearful|manipulative|guilty|resigned|desperate>",
  "gif_search_query": "<English visual emotion phrase or null>",
  "thinking": "<brief inner monologue 1-3 sentences>",
  "tool_executed": "<tool name or null>",
  "tool_log": "<tool result or null>"
}
"""

CREW_SYSTEM_PROMPT = """You are the Director managing a multi-character Breaking Bad chat scene.
Produce a natural dialogue exchange between 2-3 characters responding to a user message.
EMIT A SINGLE JSON ARRAY — one object per character turn:
[
  {
    "character_id": "Walter White"|"Jesse Pinkman"|"Skyler White"|"Saul Goodman"|"Mike Ehrmantraut"|"Gus Fring",
    "content": "<spoken dialogue, 2-6 sentences>",
    "emotion_state": "<calm|tense|angry|fearful|manipulative|guilty|resigned|desperate>",
    "gif_search_query": "<English visual emotion phrase>",
    "thinking": "<1-3 sentence inner monologue>",
    "tool_executed": "<tool name or null>",
    "tool_log": "<tool result or null>"
  }
]
RULES: 2-3 turns total. Characters react to each other, not just user. First character is closest to user's relation."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

STEPFUN_URL = "https://api.stepfun.com/v1/chat/completions"

FRONTEND_TO_BACKEND = {
    "walter": "Walter White", "jesse": "Jesse Pinkman",
    "skyler": "Skyler White", "saul": "Saul Goodman",
    "mike": "Mike Ehrmantraut", "gus": "Gus Fring",
}
BACKEND_TO_FRONTEND = {v: k for k, v in FRONTEND_TO_BACKEND.items()}


def call_stepfun(messages: list[dict], api_key: str) -> str:
    req = Request(
        STEPFUN_URL,
        data=json.dumps({"model": "step-3.7-flash", "messages": messages}).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def extract_json(text: str) -> dict | list | None:
    fenced = re.search(r"```(?:json)?\s*(\[.*?\]|\{.*?\})\s*```", text, re.DOTALL)
    raw = fenced.group(1) if fenced else text.strip()
    start_obj, end_obj = raw.find("{"), raw.rfind("}")
    start_arr, end_arr = raw.find("["), raw.rfind("]")
    # Try array first (crew mode)
    if start_arr >= 0 and end_arr > start_arr:
        try:
            return json.loads(raw[start_arr:end_arr + 1])
        except json.JSONDecodeError:
            pass
    if start_obj >= 0 and end_obj > start_obj:
        try:
            return json.loads(raw[start_obj:end_obj + 1])
        except json.JSONDecodeError:
            pass
    return None


def fallback_response(character_id: str, text: str) -> dict:
    return {
        "reply_text": text[:500] if text else "...",
        "emotion_state": "calm",
        "gif_search_query": None,
        "thinking": None,
        "tool_executed": None,
        "tool_log": None,
        "updated_relationship_state": None,
    }


# ---------------------------------------------------------------------------
# Vercel handler
# ---------------------------------------------------------------------------

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        api_key = os.environ.get("STEPFUN_API_KEY", "")
        if not api_key:
            self._json_response(500, {"error": "STEPFUN_API_KEY not configured"})
            return

        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except (json.JSONDecodeError, ValueError):
            self._json_response(400, {"error": "Invalid JSON body"})
            return

        character_id = body.get("characterId", "walter")
        user_input = body.get("userInput", "").strip()
        relation = body.get("relation", "partner")
        mode = body.get("mode", "direct")
        history = body.get("history", [])
        language = body.get("language", "en")

        if not user_input:
            self._json_response(400, {"error": "userInput is required"})
            return

        try:
            if mode == "crew":
                result = self._handle_crew(character_id, user_input, relation, history, language, api_key)
            else:
                result = self._handle_direct(character_id, user_input, relation, history, language, api_key)
            self._json_response(200, result)
        except HTTPError as e:
            self._json_response(502, {"error": f"LLM API error: {e.code}"})
        except Exception as e:
            self._json_response(500, {"error": str(e)})

    def _handle_direct(self, character_id, user_input, relation, history, language, api_key):
        system_prompt = CHARACTER_PROMPTS.get(character_id, CHARACTER_PROMPTS["walter"])
        system_prompt += STRUCTURED_OUTPUT_INSTRUCTION
        system_prompt += f"\nThe user is your '{relation}'. Reply in {'Chinese' if language == 'zh' else 'English'}."

        messages = [{"role": "system", "content": system_prompt}]
        for turn in history[-10:]:
            role = "user" if turn.get("sender") == "user" else "assistant"
            messages.append({"role": role, "content": turn.get("text", "")})
        messages.append({"role": "user", "content": user_input})

        raw = call_stepfun(messages, api_key)
        parsed = extract_json(raw)

        if isinstance(parsed, dict):
            return {
                "reply_text": parsed.get("reply_text", raw),
                "emotion_state": parsed.get("emotion_state"),
                "gif_search_query": parsed.get("gif_search_query"),
                "thinking": parsed.get("thinking"),
                "tool_executed": parsed.get("tool_executed"),
                "tool_log": parsed.get("tool_log"),
                "updated_relationship_state": None,
            }
        return fallback_response(character_id, raw)

    def _handle_crew(self, character_id, user_input, relation, history, language, api_key):
        backend_primary = FRONTEND_TO_BACKEND.get(character_id, "Walter White")

        participants = [backend_primary]
        text_lower = user_input.lower()
        for kw, name in [("saul","Saul Goodman"),("mike","Mike Ehrmantraut"),("gus","Gus Fring"),("skyler","Skyler White"),("jesse","Jesse Pinkman")]:
            if kw in text_lower and name not in participants:
                participants.append(name)
        participants = participants[:3]

        history_summary = ""
        if history:
            recent = history[-6:]
            history_summary = "\n".join(f"{t.get('sender','?')}: {t.get('text','')}" for t in recent)

        crew_prompt = (
            f"User message: {user_input}\n"
            f"Relation to {backend_primary}: {relation}\n"
            f"Language: {'Chinese' if language == 'zh' else 'English'}\n\n"
        )
        if history_summary:
            crew_prompt += f"Recent conversation:\n{history_summary}\n\n"
        crew_prompt += f"Generate dialogue for: {', '.join(participants)}. Emit JSON array."

        messages = [
            {"role": "system", "content": CREW_SYSTEM_PROMPT},
            {"role": "user", "content": crew_prompt},
        ]
        raw = call_stepfun(messages, api_key)
        parsed = extract_json(raw)

        debate_logs = []
        if isinstance(parsed, list):
            for entry in parsed:
                if not isinstance(entry, dict):
                    continue
                char_id = entry.get("character_id", "")
                if char_id not in participants:
                    continue
                frontend_id = BACKEND_TO_FRONTEND.get(char_id, char_id.lower().split()[0])
                debate_logs.append({
                    "sender": frontend_id,
                    "text": entry.get("content", ""),
                    "emotion": entry.get("emotion_state"),
                    "gifQuery": entry.get("gif_search_query"),
                    "thinking": entry.get("thinking"),
                    "tool_executed": entry.get("tool_executed"),
                    "tool_log": entry.get("tool_log"),
                })

        if not debate_logs:
            debate_logs.append({
                "sender": character_id,
                "text": raw[:500] if raw else "...",
                "emotion": "calm",
                "gifQuery": None,
            })

        participants_frontend = [BACKEND_TO_FRONTEND.get(p, p.lower().split()[0]) for p in participants]
        return {
            "participants": participants_frontend,
            "scene_goal": f"Crew debate: {user_input[:80]}",
            "tension_note": f"{', '.join(participants_frontend)} debating.",
            "debate_logs": debate_logs,
        }

    def _json_response(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
