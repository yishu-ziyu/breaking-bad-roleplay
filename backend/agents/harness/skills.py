"""Progressive disclosure skill registry (ch2).

Skills live as markdown files with YAML frontmatter under
``backend/agents/harness/skills/*.md``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SKILLS_DIR = Path(__file__).resolve().parent / "skills"

_FRONTMATTER_RE = re.compile(
    r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z",
    re.DOTALL,
)


@dataclass
class SkillSpec:
    """One progressive-disclosure skill document."""

    name: str
    description: str
    body: str
    when_to_use: str = ""

    def catalog_line(self) -> str:
        one = (self.description or "").strip().splitlines()[0] if self.description else ""
        return f"- {self.name}: {one}"


def _parse_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    """Parse simple YAML-ish frontmatter (key: value lines only)."""
    m = _FRONTMATTER_RE.match(raw)
    if not m:
        return {}, raw.strip()
    meta_block, body = m.group(1), m.group(2)
    meta: dict[str, str] = {}
    for line in meta_block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip().strip("\"'")
    return meta, body.strip()


class SkillRegistry:
    """Load, list, select skills from the on-disk skill library."""

    def __init__(self, skills_dir: Path | str | None = None) -> None:
        self.skills_dir = Path(skills_dir) if skills_dir else SKILLS_DIR
        self._skills: dict[str, SkillSpec] = {}
        self.reload()

    def reload(self) -> None:
        self._skills.clear()
        if not self.skills_dir.is_dir():
            return
        for path in sorted(self.skills_dir.glob("*.md")):
            try:
                raw = path.read_text(encoding="utf-8")
            except OSError:
                continue
            meta, body = _parse_frontmatter(raw)
            name = meta.get("name") or path.stem
            spec = SkillSpec(
                name=name,
                description=meta.get("description", ""),
                body=body,
                when_to_use=meta.get("when_to_use", ""),
            )
            self._skills[name] = spec

    def list_catalog(self) -> str:
        """Short catalog for system prompt injection (name + one-line)."""
        if not self._skills:
            return ""
        lines = ["Available skills:"]
        for spec in self._skills.values():
            lines.append(spec.catalog_line())
        return "\n".join(lines)

    def load_skill(self, name: str) -> str:
        """Return full skill body by name. Empty string if missing."""
        spec = self._skills.get(name)
        if spec is None:
            # allow stem-style lookup without exact frontmatter name
            for s in self._skills.values():
                if s.name == name or s.name.replace("-", "_") == name.replace("-", "_"):
                    return s.body
            return ""
        return spec.body

    def get(self, name: str) -> SkillSpec | None:
        return self._skills.get(name)

    def all_skills(self) -> list[SkillSpec]:
        return list(self._skills.values())

    def select_for_query(self, query: str, limit: int = 2) -> list[SkillSpec]:
        """Keyword match on name / when_to_use / description. Top-N by score.

        Empty query → []. Non-empty query always prefers safety + best domain match.
        """
        if not self._skills:
            return []
        if not query:
            return []
        tokens = _tokenize(query)
        q = query.lower()

        scored: list[tuple[int, SkillSpec]] = []
        for spec in self._skills.values():
            hay = " ".join(
                [
                    spec.name.replace("_", " ").replace("-", " "),
                    spec.when_to_use,
                    spec.description,
                    spec.body[:400],
                ]
            ).lower()
            hay_tokens = set(_tokenize(hay))
            score = 0
            for t in tokens:
                if t in hay_tokens:
                    score += 3
                elif t in hay:
                    score += 1
            for part in re.split(r"[_\-\s]+", spec.name.lower()):
                if part and part in tokens:
                    score += 2
            # Chinese / domain boosts
            if any(k in q for k in ("中文", "译制", "汉语", "zh")) and "zh" in spec.name:
                score += 4
            if any(k in q for k in ("安全", "制毒", "meth", "crime", "safety")) and "safety" in spec.name:
                score += 5
            if any(k in q for k in ("价值", "mckee", "节拍", "翻转", "story", "高潮")) and "mckee" in spec.name:
                score += 4
            if any(k in q for k in ("角色", "人设", "character", "一致性", "可玩")) and "character" in spec.name:
                score += 3
            if any(k in q for k in ("关系", "档案", "dossier", "recall", "连续", "continuity")) and (
                "character" in spec.name or "continuity" in spec.name
            ):
                score += 3
            if score > 0:
                scored.append((score, spec))

        scored.sort(key=lambda x: (-x[0], x[1].name))
        picked = [s for _, s in scored[: max(0, limit)]]

        # Always attach safety when anything is selected or when query is non-empty
        safety = self._skills.get("safety_fictional_only")
        if safety and safety not in picked and limit >= 1:
            if picked:
                if len(picked) >= limit:
                    picked[-1] = safety
                else:
                    picked.append(safety)
            else:
                # fallback defaults for generic RP turns
                defaults = [
                    n
                    for n in ("character_consistency", "safety_fictional_only", "zh_native_voice")
                    if n in self._skills
                ]
                picked = [self._skills[n] for n in defaults[:limit]]
        return picked


def _tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-zA-Z0-9_\u4e00-\u9fff]+", text.lower()) if len(t) > 1]


def load_default_registry() -> SkillRegistry:
    return SkillRegistry()


_default_registry: SkillRegistry | None = None


def get_skill_registry(skills_dir: Path | str | None = None) -> SkillRegistry:
    """Process-wide default SkillRegistry (lazy singleton).

    If ``skills_dir`` is provided, always returns a fresh registry for that dir
    (does not replace the default singleton).
    """
    global _default_registry
    if skills_dir is not None:
        return SkillRegistry(skills_dir=skills_dir)
    if _default_registry is None:
        _default_registry = SkillRegistry()
    return _default_registry


def reset_skill_registry_for_tests() -> SkillRegistry:
    """Replace the global registry (tests only)."""
    global _default_registry
    _default_registry = SkillRegistry()
    return _default_registry
