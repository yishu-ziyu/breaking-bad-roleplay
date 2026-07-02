# Breaking Bad Roleplay — Demo-Ready Implementation Plan

> **For agentic workers:** Use /ship:dev to implement this plan task-by-task.
> Steps use checkbox syntax for tracking.

**Goal:** Get the Director-driven roleplay + chat + SSE end-to-end working with StepFun-only routing, so the hackathon demo can run.

**Architecture:** The fix is surgical — disable MiniMax routing (key is dead), make the Director's beat JSON parsing tolerant of model output variations, and ensure the frontend only references StepFun. No new files, no refactoring.

**Tech Stack:** Python 3.11 + FastAPI + SQLAlchemy + httpx (backend), React 19 + Vite (frontend), StepFun step-3.7-flash (LLM).

---

### Task 1: Fix Director beat JSON parsing

**Files:**
- Modify: `backend/agents/director.py:515-533`

- [ ] **Step 1: Write failing test**

```python
# backend/tests/test_director_beat_parsing.py
import pytest
from agents.director import DirectorAgent

class TestBeatParsing:
    def test_parse_plain_json_array(self):
        """Standard JSON array should parse."""
        raw = '[{"type":"agent_speak","data":{"character_id":"Walter White","content":"test"}}]'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_speak"

    def test_parse_json_with_code_fence(self):
        """JSON wrapped in ```json fence should parse."""
        raw = '```json\n[{"type":"agent_think","data":{"character_id":"Jesse","thought_content":"test"}}]\n```'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_think"

    def test_parse_json_with_extra_text_before(self):
        """JSON preceded by explanation text should still extract."""
        raw = 'Here are the events:\n[{"type":"agent_act","data":{"character_id":"Walter","action":"test"}}]\nHope this helps!'
        events = DirectorAgent._parse_beat_events(raw)
        assert len(events) == 1
        assert events[0]["type"] == "agent_act"

    def test_parse_empty_returns_empty(self):
        """Non-JSON text returns empty list."""
        raw = 'Walter walks into the room and says hello.'
        events = DirectorAgent._parse_beat_events(raw)
        assert events == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest backend/tests/test_director_beat_parsing.py -v`
Expected: The third test (extra text before JSON) fails — current parser requires JSON at start of string.

- [ ] **Step 3: Write minimal implementation**

Update `_parse_beat_events()` to:
1. First try fenced JSON (existing)
2. Then try finding `[...]` anywhere in the text (not just at start)
3. Then try finding `{...}` object and wrapping in array
4. Return empty list only if all fail

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest backend/tests/test_director_beat_parsing.py -v`
Expected: All 4 tests pass

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `.venv/bin/python -m pytest backend/tests/ -v`
Expected: All existing tests pass

---

### Task 2: Fix scene name extraction from outline

**Files:**
- Modify: `backend/agents/director.py:242`

- [ ] **Step 1: Verify the bug**

The outline returns full scene descriptions like:
`1. Superlab supply closet — Walt inventories his chemistry equipment...`

`current_scene = scene_desc.split("–")[0].split(":")[0].strip()` extracts "Superlab supply closet" correctly, but the scene_change event's `to_scene` field receives the full `scene_desc` (line 388-396).

- [ ] **Step 2: Fix the scene_change to_scene field**

```python
# In _generate_beat, line ~388:
scene_name = scene_desc.split("–")[0].split(":")[0].strip()
yield AgentEvent(
    type="scene_change",
    data={
        "from_scene": previous_scene or "unknown",
        "to_scene": scene_name,
        "description": scene_desc,
    },
)
```

Separate `to_scene` (short name for comparison) from `description` (full text for display).

- [ ] **Step 3: Verify by running the stream**

```bash
curl -s -N "http://localhost:8001/api/session/{session_id}/stream" | head -20
```

Expected: `scene_change` events have short `to_scene` values like "Superlab supply closet" instead of the full paragraph.

---

### Task 3: Verify MiniMax references are fully removed

**Files:**
- Modify: `backend/agents/provider.py` (ROUTING_RULES can stay as dead code, no need to delete)
- Already done: `src/App.tsx`

- [ ] **Step 1: Grep for remaining MiniMax references in frontend**

```bash
grep -rn "minimax\|MiniMax\|MINIMAX" src/ --include="*.ts" --include="*.tsx"
```

Expected: No matches (or only in comments).

- [ ] **Step 2: Verify frontend default is stepfun**

Check `src/App.tsx:218` — `usePersistedState<string>('abq_llm', 'stepfun')`

- [ ] **Step 3: Verify backend default route is stepfun**

Check `backend/agents/director.py:197` — `model_route="stepfun/step-3.7-flash"`

---

### Task 4: Manual end-to-end verification

- [ ] **Step 1: Start backend**

```bash
cd backend && .venv/bin/uvicorn main:app --reload --port 8001
```

- [ ] **Step 2: Start frontend**

```bash
npm run dev
```

- [ ] **Step 3: Verify golden journey 1 (Director-driven)**

1. Open `http://localhost:5173`
2. Select character + relation
3. Switch to story mode
4. Enter task: "Walter and Jesse cook in the RV"
5. Verify: status → outline (3+ scenes) → beat 1 events (scene_change, agent_think, agent_speak, world_state_delta) → beat_ready
6. Click "继续" → beat 2 starts

- [ ] **Step 4: Verify golden journey 2 (chat mode)**

1. Switch to chat mode
2. Select Walter, relation "former student"
3. Send "What's your name?"
4. Verify: reply_text appears, emotion_state is set, gif_search_query is English

- [ ] **Step 5: Verify golden journey 3 (crew mode)**

1. Switch to crew mode
2. Send "Who's responsible for the money?"
3. Verify: 2-3 participants, debate_logs with sender + text + emotion

- [ ] **Step 6: Screenshot for demo**

Save screenshots to `/tmp/bb-demo-*.png` for each journey.

---

### Verification Checklist

| AC | How to verify |
|----|---------------|
| AC1: Director 大纲 | SSE 流中 outline 事件内容是纯文本编号列表 |
| AC2: Beat 完整输出 | 至少 3 个 beat，每个含 agent_speak/agent_think + world_state_delta + beat_ready |
| AC3: Beat JSON 容错 | 新写的 4 个单元测试全过 |
| AC4: 前端 chat | 手动发送消息，5 秒内收到完整回复 |
| AC5: Crew 模式 | 手动发送消息，收到 2-3 条 debate_logs |
| AC6: 决策循环 | beat_ready 后 POST /action continue，下一 beat 正常推送 |
| AC7: 无 MiniMax 残留 | grep 确认 src/ 和 backend/ 无硬编码 MiniMax fallback |
