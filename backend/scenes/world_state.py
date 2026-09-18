"""Small authoritative Story world. Language proposes; these rules settle.

No model-authored effects, trust scores or ownership enter this reducer. The
scope is deliberately finite: conversation, known objects and authored places.
"""

from __future__ import annotations

import hashlib
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


_ACTOR_ALIASES = {
    "walter white": "walter",
    "jesse pinkman": "jesse",
    "skyler white": "skyler",
    "saul goodman": "saul",
    "jimmy mcgill": "saul",
    "mike ehrmantraut": "mike",
    "gus fring": "gus",
    "hank schrader": "hank",
    "marie schrader": "marie",
}

MAX_RECENT_CLAIMS = 48
MAX_OPEN_PROMISES = 16
MAX_RESOLVED_PROMISES = 24


def normalize_actor_id(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    return _ACTOR_ALIASES.get(raw, raw.replace(" ", "_"))


class Item(BaseModel):
    label: str
    holder: str
    condition: Literal["intact", "damaged", "destroyed"] = "intact"
    known_by: list[str] = Field(default_factory=list)


class WorldState(BaseModel):
    schema_version: int = 1
    scenario_id: str = "conversation"
    player_id: str = "walter"
    location: str = "desert"
    locations: list[str] = Field(default_factory=lambda: ["desert", "rv"])
    present: list[str] = Field(default_factory=lambda: ["walter", "jesse"])
    items: dict[str, Item] = Field(default_factory=dict)
    clock: int = 0
    claims: list[dict[str, Any]] = Field(default_factory=list)
    promises: list[dict[str, Any]] = Field(default_factory=list)
    trust: dict[str, float] = Field(default_factory=dict)

    def player_view(self) -> dict[str, Any]:
        viewer = normalize_actor_id(self.player_id)
        data = self.model_dump()
        data["player_id"] = viewer
        data["present"] = list(dict.fromkeys(
            normalized for value in self.present
            if (normalized := normalize_actor_id(value))
        ))
        data["items"] = {
            key: {
                "label": item.label,
                "holder": normalize_actor_id(item.holder) or item.holder,
                "condition": item.condition,
            }
            for key, item in self.items.items()
            if not item.known_by
            or viewer in {normalize_actor_id(actor) for actor in item.known_by}
        }
        data["claims"] = [
            {
                "speaker": normalize_actor_id(str(c.get("speaker") or "")),
                "text": c.get("text"),
            }
            for c in self.claims
            if viewer in {
                normalize_actor_id(str(actor))
                for actor in (c.get("heard_by") or [])
            }
        ]
        data["promises"] = [
            {
                **promise,
                "from": normalize_actor_id(str(promise.get("from") or "")),
                "to": normalize_actor_id(str(promise.get("to") or "")),
            }
            for promise in self.promises
            if viewer in {
                normalize_actor_id(str(promise.get("from") or "")),
                normalize_actor_id(str(promise.get("to") or "")),
            }
        ]
        # Internal scores are not a player-facing trust progress bar.
        data.pop("trust")
        return data


class ActionIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verb: Literal["observe", "say", "give", "take", "move", "promise", "leave", "wait", "unsupported"]
    item_id: str | None = Field(default=None, max_length=80)
    target_id: str | None = Field(default=None, max_length=80)
    destination: str | None = Field(default=None, max_length=80)
    text: str = Field(default="", max_length=4000)


class Resolution(BaseModel):
    accepted: bool
    reason: str
    state: WorldState
    effects: list[dict[str, Any]] = Field(default_factory=list)


def compact_world_state(state: WorldState) -> WorldState:
    """Bound transient history without dropping unresolved commitments."""
    state.claims = state.claims[-MAX_RECENT_CLAIMS:]
    offered = [promise for promise in state.promises if promise.get("status") == "offered"]
    resolved = [promise for promise in state.promises if promise.get("status") != "offered"]
    keep_ids = {
        str(promise.get("id"))
        for promise in [*offered, *resolved[-MAX_RESOLVED_PROMISES:]]
    }
    state.promises = [
        promise for promise in state.promises
        if str(promise.get("id")) in keep_ids
    ]
    return state


def seed_world(player_id: str = "walter", scenario_id: str = "conversation") -> WorldState:
    player_id = normalize_actor_id(player_id) or "walter"
    if scenario_id == "desert_crisis":
        return WorldState(
            scenario_id=scenario_id, player_id=player_id,
            present=list(dict.fromkeys([player_id, "jesse"])),
            items={
                "cash_bag": Item(label="杰西带走的现金袋", holder="jesse"),
                "phone": Item(label="手机", holder=player_id),
                "rv_tire": Item(label="房车轮胎", holder="rv"),
            },
        )
    return WorldState(
        player_id=player_id, scenario_id="conversation", location="scene",
        locations=["scene"], present=[player_id],
    )


def resolve_action(world: WorldState, intent: ActionIntent) -> Resolution:
    """Pure, deterministic preconditions/effects. Rejections never mutate state."""
    state = world.model_copy(deep=True)
    effects: list[dict[str, Any]] = []
    actor = normalize_actor_id(state.player_id) or "walter"
    state.player_id = actor
    state.present = list(dict.fromkeys(
        normalized for value in state.present
        if (normalized := normalize_actor_id(value))
    ))
    for world_item in state.items.values():
        world_item.holder = normalize_actor_id(world_item.holder) or world_item.holder
        world_item.known_by = list(dict.fromkeys(
            normalized for value in world_item.known_by
            if (normalized := normalize_actor_id(value))
        ))
    for claim in state.claims:
        claim["speaker"] = normalize_actor_id(str(claim.get("speaker") or ""))
        claim["heard_by"] = list(dict.fromkeys(
            normalized for value in (claim.get("heard_by") or [])
            if (normalized := normalize_actor_id(str(value)))
        ))
    for promise in state.promises:
        promise["from"] = normalize_actor_id(str(promise.get("from") or ""))
        promise["to"] = normalize_actor_id(str(promise.get("to") or ""))
    state.trust = {
        normalized: value
        for key, value in state.trust.items()
        if (normalized := normalize_actor_id(key))
    }
    target_id = normalize_actor_id(intent.target_id)

    def reject(reason: str) -> Resolution:
        return Resolution(accepted=False, reason=reason, state=world.model_copy(deep=True))

    item = state.items.get(intent.item_id or "")
    if intent.item_id and (item is None or (item.known_by and actor not in item.known_by)):
        return reject("unknown_item")
    if target_id and target_id not in state.present:
        return reject("target_absent")

    if intent.verb == "unsupported":
        return reject("unsupported_action")
    if intent.verb in ("say", "promise"):
        if not intent.text.strip():
            return reject("empty_speech")
        if intent.verb == "promise":
            if not target_id or target_id == actor:
                return reject("target_required")
            promise_id = hashlib.sha256(
                f"{actor}|{target_id}|{intent.item_id}|{intent.text.strip()}".encode()
            ).hexdigest()[:20]
            if any(p["id"] == promise_id for p in state.promises):
                return reject("promise_already_recorded")
            if sum(
                1 for promise in state.promises
                if promise.get("status") == "offered"
            ) >= MAX_OPEN_PROMISES:
                return reject("too_many_open_promises")
            promise = {
                "id": promise_id, "from": actor, "to": target_id,
                "item_id": intent.item_id, "text": intent.text.strip(), "status": "offered",
            }
            state.promises.append(promise)
            effects.append({"kind": "promise_offered", **promise})
        else:
            claim = {"speaker": actor, "text": intent.text.strip(), "heard_by": list(state.present)}
            state.claims.append(claim)
            effects.append({"kind": "claim_made", **claim})
    elif intent.verb in ("give", "take"):
        if item is None:
            return reject("item_required")
        if intent.verb == "give":
            if item.holder != actor:
                return reject("not_held")
            if not target_id or target_id == actor:
                return reject("target_required")
            new_holder = target_id
        else:
            # Taking another person's possessions needs a separate contested rule.
            if item.holder != state.location:
                return reject("not_reachable")
            new_holder = actor
        effects.append({"kind": "item_transferred", "item_id": intent.item_id,
                        "from": item.holder, "to": new_holder})
        item.holder = new_holder
        for promise in state.promises:
            if (promise["status"] != "offered" or promise["from"] != actor
                    or not promise["item_id"] or promise["item_id"] != intent.item_id):
                continue
            fulfilled = promise["to"] == new_holder
            promise["status"] = "fulfilled" if fulfilled else "broken"
            effects.append({"kind": "promise_changed", "id": promise["id"], "status": promise["status"]})
            # Only an observed action changes trust; saying 'trust me' does not.
            observer = promise["to"]
            if observer in state.present:
                old = state.trust.get(observer, 0.3)
                delta = min(0.05, (1 - old) * 0.1) if fulfilled else -0.15
                state.trust[observer] = max(0.0, min(1.0, old + delta))
                effects.append({"kind": "trust_changed", "actor": observer,
                                "cause_promise_id": promise["id"], "value": state.trust[observer]})
    elif intent.verb in ("move", "leave"):
        if not intent.destination or intent.destination not in state.locations:
            return reject("unknown_destination")
        if intent.destination == state.location:
            return reject("already_there")
        effects.append({"kind": "player_moved", "from": state.location, "to": intent.destination})
        state.location = intent.destination
        state.present = [actor]  # Nobody silently follows the player.
    elif intent.verb == "observe":
        if item and item.holder not in [state.location, *state.present]:
            return reject("not_reachable")
        effects.append({"kind": "observed", "item_id": intent.item_id, "location": state.location})
    elif intent.verb == "wait":
        effects.append({"kind": "waited"})

    state.clock += 1
    effects.append({"kind": "time_passed", "amount": 1})
    return Resolution(
        accepted=True,
        reason="accepted",
        state=compact_world_state(state),
        effects=effects,
    )


def resolution_text(result: Resolution, language: str) -> str:
    """Safe fallback when no character can speak or an action is unsupported."""
    zh = language.startswith("zh")
    if result.accepted:
        for effect in result.effects:
            if effect["kind"] == "item_transferred":
                label = result.state.items[effect["item_id"]].label
                recipient = effect["to"]
                return (f"{label}已经交到{actor_label(recipient, language)}手里。" if zh else
                        f"{label} is now held by {actor_label(recipient, language)}.")
            if effect["kind"] == "claim_made":
                return f"你说：“{effect['text']}”" if zh else f"You said: “{effect['text']}”"
            if effect["kind"] == "promise_offered":
                return ("你提出了承诺。对方尚未接受；说过的话已经留下记录。" if zh else
                        "You offered a promise. It is recorded, not yet a mutual agreement.")
            if effect["kind"] == "player_moved":
                label = location_label(effect["to"], language)
                return f"你到了{label}。没有人自动跟来。" if zh else f"You moved to {label}. Nobody followed automatically."
            if effect["kind"] == "observed":
                item = result.state.items.get(effect.get("item_id"))
                if item:
                    condition = ({"intact": "完好", "damaged": "受损", "destroyed": "损毁"}[item.condition]
                                 if zh else item.condition)
                    return (f"{item.label}：{condition}，目前在 {actor_label(item.holder, language)} 处。" if zh
                            else f"{item.label}: {condition}, held by {actor_label(item.holder, language)}.")
        return "你的行动已记录。眼前的局面等待下一步。" if zh else "Your action is recorded. The next move is yours."
    reasons = {
        "not_held": ("那件东西不在你手里。", "You are not holding that item."),
        "target_absent": ("对方不在这里。", "That person is not here."),
        "unknown_item": ("你还没有见到那件东西。", "That item is not known to you."),
        "not_reachable": ("你现在拿不到那件东西。", "That item is not within reach."),
        "unknown_destination": ("这里还没有通往那个地点的行动路径。", "That destination is not available in this scene."),
        "promise_already_recorded": ("这句话已经说过了。再次保证不会改变对方的信任。", "That promise is already recorded; repetition is not new evidence."),
        "too_many_open_promises": ("尚未兑现的承诺已经太多。先处理旧账。", "There are too many unresolved promises. Settle an old one first."),
    }
    pair = reasons.get(result.reason, (
        "这一步还无法结算。可以观察、说话，或对已知物品采取行动；事情尚未改变。",
        "That action cannot be settled yet. Observe, speak, or use a known item; nothing has changed.",
    ))
    return pair[0 if zh else 1]


# --- Player-facing presentation -------------------------------------------
# The snapshot keeps canonical machine ids (location="scene",
# present=["walter"]). Everything a player reads goes through these maps so
# internal tokens never reach the manuscript, HUD or lore panel. Presentation
# only: nothing here feeds resolve_action or the persisted snapshot.

_LANG_EN = "en"
_LANG_ZH = "zh"

_ACTOR_LABELS: dict[str, dict[str, str]] = {
    "walter": {_LANG_ZH: "沃尔特", _LANG_EN: "Walter"},
    "jesse": {_LANG_ZH: "杰西", _LANG_EN: "Jesse"},
    "skyler": {_LANG_ZH: "斯凯勒", _LANG_EN: "Skyler"},
    "saul": {_LANG_ZH: "索尔", _LANG_EN: "Saul"},
    "mike": {_LANG_ZH: "迈克", _LANG_EN: "Mike"},
    "gus": {_LANG_ZH: "古斯", _LANG_EN: "Gus"},
    "hank": {_LANG_ZH: "汉克", _LANG_EN: "Hank"},
    "marie": {_LANG_ZH: "玛丽", _LANG_EN: "Marie"},
}

_LOCATION_LABELS: dict[str, dict[str, str]] = {
    "scene": {_LANG_ZH: "现场", _LANG_EN: "Story scene"},
    "desert": {_LANG_ZH: "荒漠", _LANG_EN: "the desert"},
    "rv": {_LANG_ZH: "房车", _LANG_EN: "the RV"},
}


def _lang_key(language: str) -> str:
    return _LANG_ZH if str(language or "").startswith("zh") else _LANG_EN


def _humanize(value: str | None) -> str:
    """Last-resort readable fallback: never echo an underscore machine token."""
    return str(value or "").replace("_", " ").strip().title()


def actor_label(value: str | None, language: str = "en") -> str:
    """Player-facing name for an actor id."""
    actor = normalize_actor_id(value)
    labels = _ACTOR_LABELS.get(actor)
    if labels:
        return labels[_lang_key(language)]
    return _humanize(actor or value)


def location_label(value: str | None, language: str = "en") -> str:
    """Player-facing name for a location id."""
    raw = str(value or "").strip()
    labels = _LOCATION_LABELS.get(raw.lower())
    if labels:
        return labels[_lang_key(language)]
    return _humanize(raw)


def _cast_line(world: WorldState, language: str) -> str:
    """On-stage cast with the player marked as you; ids are never printed."""
    zh = _lang_key(language) == _LANG_ZH
    player = normalize_actor_id(world.player_id)
    names: list[str] = []
    for actor in world.present:
        if normalize_actor_id(actor) == player:
            labelled = actor_label(actor, language)
            names.append(f"你（{labelled}）" if zh else f"you ({labelled})")
        else:
            names.append(actor_label(actor, language))
    if not names:
        names.append(actor_label(world.player_id, language))
    return "、".join(names) if zh else ", ".join(names)


def opening_scene_text(world: WorldState, language: str) -> str:
    """Player-facing opening prose derived only from committed world state."""
    zh = _lang_key(language) == _LANG_ZH
    if world.scenario_id == "desert_crisis":
        return (
            "新墨西哥荒漠，深夜。房车停在黑地里，杰西和你都在场；远处的车灯正在逼近。"
            if zh else
            "New Mexico desert, deep night. The RV sits in the dark with Jesse and you beside it; headlights are climbing closer."
        )
    cast = _cast_line(world, language)
    if str(world.location).strip().lower() == "scene":
        # "scene" is the placeholder for an un-authored custom story, not a
        # place name: say the story opens here instead of naming the token.
        return (f"故事在此刻展开。此刻在场：{cast}。" if zh else
                f"The story opens here. On stage: {cast}.")
    where = location_label(world.location, language)
    return (f"故事从{where}开始。此刻在场：{cast}。" if zh else
            f"The story opens at {where}. On stage: {cast}.")
