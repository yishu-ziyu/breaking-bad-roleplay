"""Product facade: full Harness pipeline for tryable Agent runs."""

from __future__ import annotations

import time
import uuid
from typing import Any

from agents.harness.context import AgentStatusBar, ContextAssembler, ContextBudget
from agents.harness.correct import CircuitBreaker
from agents.harness.evolution import get_lesson_store
from agents.harness.loop import AgentLoop
from agents.harness.memory_layers import LayeredMemory
from agents.harness.orchestrator import MultiAgentOrchestrator, default_bb_roles
from agents.harness.rp_tools import build_default_registry
from agents.harness.skills import get_skill_registry
from agents.harness.trajectory import TrajectoryEvent, get_trajectory_store
from agents.harness.verify import check_tool_call, check_user_input, run_guardrails

BOOK_COVERAGE = [
    "ch1_loop",
    "ch1_constrain_verify_correct",
    "ch2_context_status_compress",
    "ch2_skills",
    "ch3_memory_layers",
    "ch4_tools_perceive_execute_collab",
    "ch6_trajectory",
    "ch8_lessons",
    "ch10_multi_agent",
]

_CHARACTER_FLAVOR = {
    "walter": "我在听。把话说清楚。",
    "jesse": "Yo，你认真的？说重点。",
    "skyler": "别绕弯子。你到底想怎样？",
    "saul": "Better call… 先把风险讲明白。",
    "mike": "说事。少废话。",
    "gus": "请说明你的请求。",
    "hank": "哈，来吧，小子。怎么了？",
    "marie": "天啊……你说什么？",
}

_DOSSIER_FIELD_MARKERS = (
    "knowledge",
    "relationship_notes",
    "notes",
    "trust_level",
    "trust",
    "subject_id",
    "subject",
)


def _ingest_dossiers_map(mem: LayeredMemory, dossiers: dict) -> None:
    """Ingest CharacterDossier-shaped maps without DB.

    Supported shapes:
    - {owner_id: {subject_id, trust_level, knowledge, relationship_notes}}
    - {owner_id: {subject_id: {trust_level, ...} | notes_str}}
    - {"owner->subject": {trust_level, knowledge, relationship_notes}}
    """
    if not isinstance(dossiers, dict):
        return
    for owner_key, payload in dossiers.items():
        owner = str(owner_key)
        if not isinstance(payload, dict):
            if payload is not None and str(payload).strip():
                mem.ingest_dossier_snapshot(
                    owner, {"relationship_notes": str(payload)}
                )
            continue
        if any(k in payload for k in _DOSSIER_FIELD_MARKERS):
            mem.ingest_dossier_snapshot(owner, payload)
            continue
        # Nested subject → dossier fields / note string
        for subject, sub in payload.items():
            if isinstance(sub, dict):
                d = dict(sub)
                d.setdefault("subject_id", str(subject))
                mem.ingest_dossier_snapshot(owner, d)
            elif sub is not None and str(sub).strip():
                mem.ingest_dossier_snapshot(
                    owner,
                    {
                        "subject_id": str(subject),
                        "relationship_notes": str(sub),
                    },
                )


class AgentHarnessService:
    def __init__(self) -> None:
        self._memories: dict[str, LayeredMemory] = {}
        self._session_states: dict[str, dict[str, Any]] = {}
        self._circuit = CircuitBreaker(failure_threshold=3, reset_timeout_s=60)

    def _memory(self, session_id: str | None) -> LayeredMemory:
        key = session_id or "_default"
        if key not in self._memories:
            self._memories[key] = LayeredMemory()
        return self._memories[key]

    def _state(self, session_id: str | None) -> dict[str, Any]:
        key = session_id or "_default"
        if key not in self._session_states:
            self._session_states[key] = {}
        return self._session_states[key]

    async def run(
        self,
        user_message: str,
        *,
        character_id: str = "walter",
        mode: str = "direct",
        language: str = "zh",
        model_route: str | None = None,
        session_id: str | None = None,
        use_multi_agent: bool = False,
        provider: Any | None = None,
        offline: bool = False,
        dossiers: dict | None = None,
    ) -> dict[str, Any]:
        t0 = time.monotonic()
        traj = get_trajectory_store()
        lessons = get_lesson_store()
        skills = get_skill_registry()
        run_id = uuid.uuid4().hex[:12]
        traj.start(
            run_id,
            {
                "character_id": character_id,
                "mode": mode,
                "language": language,
                "offline": offline or provider is None,
            },
        )
        traj.append(
            run_id,
            TrajectoryEvent(type="user_message", data={"text": user_message}),
        )

        ok, reason = check_user_input(user_message)
        if not ok:
            gr = run_guardrails(user_message, "", [])
            traj.append(
                run_id,
                TrajectoryEvent(type="guardrail", data={"reason": reason or "blocked"}),
            )
            traj.finish(run_id, {"ok": False, "stopped_reason": "guardrail", "violations": gr.violations})
            lessons.extract_lessons_from_trajectory(traj.get(run_id) or {"run_id": run_id, "events": []})
            return {
                "reply": "这个请求触及现实世界危险操作，我只能在虚构戏剧里继续。换个戏剧性的问法吧。",
                "character_id": character_id,
                "mode": mode,
                "trajectory_id": run_id,
                "steps": [],
                "skills_used": [],
                "memory_preview": "",
                "tools_available": [],
                "guardrails": {"ok": False, "violations": gr.violations},
                "lessons_added": 1,
                "status_bar": "",
                "book_coverage": BOOK_COVERAGE,
                "meta": {"stopped_reason": "guardrail"},
            }

        selected = skills.select_for_query(user_message, limit=2)
        skill_names = [s.name for s in selected]
        skill_bodies = [f"## {s.name}\n{s.body}" for s in selected]
        traj.append(
            run_id,
            TrajectoryEvent(type="skills", data={"names": skill_names}),
        )

        mem = self._memory(session_id)
        if dossiers:
            _ingest_dossiers_map(mem, dossiers)
        mem.observe_turn("user", user_message)
        memory_block = mem.format_for_context(user_message)
        memory_hits = memory_block.count("\n- ")

        state = self._state(session_id)
        tools, registry = build_default_registry(state)
        tool_names = [t.name for t in tools]

        status = AgentStatusBar(
            turn=len(mem.working.recent()),
            mode=mode,
            character_id=character_id,
            language=language,
            tools_available=len(tools),
            memory_hits=memory_hits,
            flags=[
                "kv_friendly",
                "compress_ok",
                "offline" if (offline or not provider) else "live",
            ],
        )

        lessons_block = lessons.format_for_prompt(top_k=4)
        system_prompt = (
            f"You are the Breaking Bad character '{character_id}' inside ABQ Roleplay Lab.\n"
            f"Language: {'Chinese' if language.startswith('zh') else 'English'}.\n"
            "Use tools when they improve accuracy (cast, dossier, continuity).\n"
            "Stay fictional. No real-world crime instructions.\n"
            f"Skill catalog:\n{skills.list_catalog()}"
        )
        if lessons_block:
            system_prompt = system_prompt + "\n\n" + lessons_block

        assembler = ContextAssembler(ContextBudget())
        messages = assembler.assemble(
            system_prompt=system_prompt,
            status_bar=status,
            skill_snippets=skill_bodies,
            memory_blocks=[memory_block] if memory_block else [],
            history_messages=[],
            user_message=user_message,
        )
        status.elapsed_s = round(time.monotonic() - t0, 3)
        status.token_estimate = max(1, assembler.estimate_chars(messages) // 4)

        steps_out: list[dict[str, Any]] = []
        reply = ""
        stopped = "completed"
        multi_meta: dict[str, Any] = {}
        tool_log_for_guard: list[dict[str, Any]] = []

        if use_multi_agent or mode == "crew":
            orch = MultiAgentOrchestrator()
            ores = await orch.run(
                user_message,
                roles=default_bb_roles(character_id=character_id),
                mode="isolated",
                max_rounds=1,
            )
            reply = ores.final_text
            steps_out = list(ores.steps)
            multi_meta = {"role_outputs": ores.role_outputs, "orch_mode": ores.mode}
            traj.append(
                run_id,
                TrajectoryEvent(
                    type="multi_agent",
                    data={"final": reply[:500], **multi_meta},
                ),
            )
        elif provider is not None and not offline:
            loop = AgentLoop(
                provider,
                tools,
                registry,
                max_iterations=6,
                model_route=model_route or "stepfun/step-3.7-flash",
                system_prompt=system_prompt,
                circuit=self._circuit,
                constraint_checker=check_tool_call,
            )
            result = await loop.run(user_message, messages=messages, trajectory_id=run_id)
            reply = result.final_text
            stopped = result.stopped_reason
            # Live model hard-fail → offline tool stub (still book-complete plumbing)
            if stopped == "error" or (reply or "").startswith("Model call failed"):
                reply, offline_steps = await self._offline_stub(
                    user_message, character_id, language, registry
                )
                steps_out = offline_steps
                stopped = "completed_offline_fallback"
                for s in offline_steps:
                    tool_log_for_guard.append(
                        {"name": s.get("tool_name") or "", "args": s.get("args") or {}}
                    )
                    traj.append(
                        run_id,
                        TrajectoryEvent(
                            type=s.get("kind") or "step",
                            data={
                                "name": s.get("tool_name"),
                                "content": str(s.get("content", ""))[:500],
                                "is_error": bool(s.get("is_error")),
                                "fallback": True,
                            },
                        ),
                    )
            else:
                for s in result.steps:
                    steps_out.append(
                        {
                            "kind": s.kind,
                            "content": (s.content or "")[:500],
                            "tool_name": s.tool_name,
                        }
                    )
                    if s.kind == "tool_call":
                        tool_log_for_guard.append(
                            {"name": s.tool_name or "", "args": s.tool_args or {}}
                        )
                        traj.append(
                            run_id,
                            TrajectoryEvent(
                                type="tool_call",
                                data={
                                    "name": s.tool_name,
                                    "args": s.tool_args,
                                    "is_error": False,
                                },
                            ),
                        )
                    elif s.kind == "tool_result":
                        traj.append(
                            run_id,
                            TrajectoryEvent(
                                type="tool_result",
                                data={
                                    "name": s.tool_name,
                                    "is_error": bool((s.meta or {}).get("is_error")),
                                    "content": (s.tool_result or "")[:500],
                                },
                            ),
                        )
                    else:
                        traj.append(
                            run_id,
                            TrajectoryEvent(
                                type=s.kind, data={"text": (s.content or "")[:500]}
                            ),
                        )
        else:
            reply, offline_steps = await self._offline_stub(
                user_message, character_id, language, registry
            )
            steps_out = offline_steps
            for s in offline_steps:
                tool_log_for_guard.append(
                    {"name": s.get("tool_name") or "", "args": s.get("args") or {}}
                )
                traj.append(
                    run_id,
                    TrajectoryEvent(
                        type=s.get("kind") or "step",
                        data={
                            "name": s.get("tool_name"),
                            "content": str(s.get("content", ""))[:500],
                            "is_error": bool(s.get("is_error")),
                        },
                    ),
                )

        gr = run_guardrails(user_message, reply, tool_log_for_guard)
        if not gr.ok:
            reply = "输出触发安全护栏，已拦截。请改用虚构戏剧语境继续。"
            stopped = "guardrail"
            traj.append(
                run_id,
                TrajectoryEvent(type="guardrail", data={"violations": gr.violations}),
            )

        mem.observe_turn("assistant", reply)
        mem.remember_episode(
            f"{character_id}: {user_message[:60]} → {reply[:60]}",
            importance=1,
            tags=[character_id, mode],
        )

        status.elapsed_s = round(time.monotonic() - t0, 3)
        status_text = status.format_block()

        summary = {
            "ok": gr.ok and stopped in ("completed", "completed_offline_fallback"),
            "stopped_reason": stopped,
            "skills": skill_names,
            "violations": gr.violations,
        }
        traj.finish(run_id, summary)
        rec = traj.get(run_id)
        added = lessons.extract_lessons_from_trajectory(rec or {"run_id": run_id, "events": []})

        return {
            "reply": reply,
            "character_id": character_id,
            "mode": mode,
            "trajectory_id": run_id,
            "steps": steps_out,
            "skills_used": skill_names,
            "memory_preview": memory_block[:800],
            "tools_available": tool_names,
            "guardrails": {"ok": gr.ok, "violations": gr.violations},
            "lessons_added": len(added),
            "status_bar": status_text,
            "book_coverage": BOOK_COVERAGE,
            "meta": {
                "stopped_reason": stopped,
                "elapsed_s": status.elapsed_s,
                "token_estimate": status.token_estimate,
                **multi_meta,
            },
        }

    async def _offline_stub(
        self,
        user_message: str,
        character_id: str,
        language: str,
        registry: Any,
    ) -> tuple[str, list[dict[str, Any]]]:
        steps: list[dict[str, Any]] = []
        msg = user_message
        low = msg.lower()

        async def _exec(name: str, args: dict) -> str:
            tr = await registry.execute(name, args)
            steps.append(
                {
                    "kind": "tool_result" if not tr.is_error else "tool_error",
                    "tool_name": name,
                    "content": tr.content[:500],
                    "is_error": tr.is_error,
                    "args": args,
                }
            )
            return tr.content

        if any(k in low or k in msg for k in ("cast", "角色", "可玩", "名单")):
            content = await _exec("list_cast", {})
            preface = "可玩角色如下：" if language.startswith("zh") else "Playable cast:"
            return f"{preface}\n{content}", steps

        if any(k in low or k in msg for k in ("recall", "关系", "dossier", "档案")):
            about = ""
            mapping = {
                "杰西": "jesse",
                "沃尔特": "walter",
                "汉克": "hank",
                "斯凯勒": "skyler",
                "玛丽": "marie",
                "索尔": "saul",
                "麦克": "mike",
                "古斯": "gus",
            }
            # Prefer other cast members as the *about* focus; never default
            # about=self just because the speaker's Chinese name appears in the line.
            candidates = [
                "jesse",
                "hank",
                "skyler",
                "marie",
                "saul",
                "mike",
                "gus",
                "walter",
                "杰西",
                "汉克",
                "斯凯勒",
                "玛丽",
                "索尔",
                "麦克",
                "古斯",
                "沃尔特",
            ]
            for cand in candidates:
                if cand in low or cand in msg:
                    resolved = mapping.get(cand, cand)
                    if resolved != character_id:
                        about = resolved
                        break
            # If only self is mentioned, leave about empty → full dossier
            content = await _exec(
                "recall_dossier",
                {"character_id": character_id, **({"about": about} if about else {})},
            )
            return f"({character_id}) {content}", steps

        if any(
            k in low or k in msg
            for k in (
                "director",
                "导演",
                "节拍",
                "价值",
                "翻转",
                "对峙",
                "mckee",
                "climax",
                "beat",
            )
        ):
            content = await _exec("ask_director", {"question": msg})
            await _exec("propose_action", {"verb": "look_at", "target_id": "opponent"})
            await _exec("set_emotion", {"emotion": "tense"})
            if language.startswith("zh"):
                return (
                    f"[director-offline] 价值压力：安全↔暴露 / 信任↔背叛。\n"
                    f"角色 {character_id} 必须在不丢脸与保家人之间选一个。\n"
                    f"工具简报：{content}"
                ), steps
            return (
                f"[director-offline] Value pressure: safety↔exposure / trust↔betrayal.\n"
                f"{character_id} must choose pride or family.\n"
                f"Tool brief: {content}"
            ), steps

        if any(k in low or k in msg for k in ("continuity", "连续", "horizon", "era", "pollos")):
            content = await _exec("search_continuity", {"query": msg[:80]})
            return f"[continuity] {content}", steps

        flavor = _CHARACTER_FLAVOR.get(character_id, "…")
        await _exec("update_working_note", {"note": f"user asked: {msg[:100]}"})
        await _exec("set_emotion", {"emotion": "tense"})
        return f"{flavor} （offline harness / book loop）你说：{msg[:120]}\n[status] tools ready: list_cast, recall_dossier, ask_director", steps


_SERVICE: AgentHarnessService | None = None


def get_harness_service() -> AgentHarnessService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = AgentHarnessService()
    return _SERVICE


def capabilities_payload() -> dict[str, Any]:
    from pathlib import Path

    root = Path(__file__).resolve().parent
    module_names = [
        "loop",
        "context",
        "skills",
        "memory_layers",
        "rp_tools",
        "verify",
        "correct",
        "trajectory",
        "evolution",
        "orchestrator",
        "service",
    ]
    modules = {name: (root / f"{name}.py").exists() for name in module_names}
    return {
        "formula": "Agent = Model + Harness; Harness = Context + Tools + Constrain + Verify + Correct",
        "book_source": "~/Desktop/AI产品经理/ai-agent-book",
        "book_coverage": BOOK_COVERAGE,
        "modules": modules,
        "endpoints": [
            "GET /api/agent/capabilities",
            "POST /api/agent/run",
            "GET /api/agent/trajectories",
            "GET /api/agent/lessons",
            "GET /api/agent/stats",
        ],
        "try": {
            "offline": True,
            "example": {
                "message": "列出可玩角色",
                "character_id": "walter",
                "offline": True,
            },
        },
    }


# Alias used by some route drafts
module_capability_map = capabilities_payload
