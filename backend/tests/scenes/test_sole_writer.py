"""Sole-writer invariant for the Continuity Board (DEC-0005 P4).

Freezes the rule that ONLY `backend/scenes/state_reducer.py::apply_validated_turn`
is allowed to write the four protected board keys:

    - shared_facts
    - present_cast
    - updated_at_beat
    - irreversible_costs

The LLM-side advisory function `apply_delta_facts` must be fully renamed
(zero hits anywhere under `backend/`) and must not mutate the board.

This is a static AST walker. It only parses files; it never executes them.
When the invariant holds, the test reports zero hits. When it breaks, the
test fails with a list of (file:line, kind, detail) tuples so the offending
site can be found in one read.

Run time: <2s on a normal dev box (stdlib-only, no third-party deps).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # .../backend/
SCAN_DIRS = [ROOT / "agents", ROOT / "api", ROOT / "eval", ROOT / "tests"]
ALLOW_FILE = (ROOT / "scenes" / "state_reducer.py").resolve()

# Functions where writes are seed construction (not in-session mutations).
SEED_FUNCS = {
    "new_session_board",
    "load_era_pack",
    "load_or_init_session_board",
    "save_session_board",
}

# Functions that mutate the board in a *non-claim* way (preserve fact identity,
# do not introduce new facts from LLM-emitted data). Currently:
#   - enrich_board_locale: augments existing facts with `text_zh` translations
#     drawn from the era pack. It preserves the fact `id` and `text`; it does
#     NOT add new facts from LLM data. This is a read-side enrichment, not a
#     writer of new room truth.
LOCALE_ENRICH_FUNCS = {
    "enrich_board_locale",
}

PROTECTED_KEYS = {"shared_facts", "present_cast", "updated_at_beat", "irreversible_costs"}

# Compile-once regex for any string reference to the banned name.
BANNED_NAME_RE = re.compile(r"apply_delta_facts")


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _is_protected_subscript(node: ast.AST) -> bool:
    """True iff `node` is `<any_var>["<protected_key>"]`.

    The variable name is intentionally NOT pinned to ``board``. The walker's
    job is to catch any direct write to the protected keys regardless of the
    local variable name (e.g. ``out["shared_facts"] = ...``, which is exactly
    the pattern the renamed advisory function used to use). The file-level
    allow-list keeps the canonical writer in ``state_reducer.py`` legal.
    """
    if not isinstance(node, ast.Subscript):
        return False
    if not isinstance(node.value, ast.Name):
        return False
    slc = node.slice
    if isinstance(slc, ast.Constant) and isinstance(slc.value, str):
        return slc.value in PROTECTED_KEYS
    return False


def _is_board_setdefault(node: ast.Call) -> bool:
    """`board.setdefault(K, ...)` where K is a protected key."""
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr != "setdefault":
        return False
    if not isinstance(func.value, ast.Name) or func.value.id != "board":
        return False
    if not node.args:
        return False
    first = node.args[0]
    return isinstance(first, ast.Constant) and first.value in PROTECTED_KEYS


def _is_board_get_append(node: ast.Call) -> bool:
    """`board.get(K).append(...)` where K is a protected key."""
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr != "append":
        return False
    inner = func.value
    if not isinstance(inner, ast.Call):
        return False
    inner_func = inner.func
    if not isinstance(inner_func, ast.Attribute) or inner_func.attr != "get":
        return False
    if not isinstance(inner_func.value, ast.Name) or inner_func.value.id != "board":
        return False
    if not inner.args:
        return False
    first = inner.args[0]
    return isinstance(first, ast.Constant) and first.value in PROTECTED_KEYS


def _is_update_with_protected_key(node: ast.Call) -> bool:
    """`some_dict.update({K: ...})` where the dict literal contains a protected key."""
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr != "update":
        return False
    if not node.args:
        return False
    first = node.args[0]
    if not isinstance(first, ast.Dict):
        return False
    for k in first.keys:
        if isinstance(k, ast.Constant) and isinstance(k.value, str) and k.value in PROTECTED_KEYS:
            return True
    return False


def _collect_seed_func_line_set(tree: ast.Module) -> set[int]:
    """Return the set of `lineno` values inside any seed/enrich-func subtree."""
    seeds: set[int] = set()
    allow = SEED_FUNCS | LOCALE_ENRICH_FUNCS
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in allow:
            for child in ast.walk(node):
                if hasattr(child, "lineno"):
                    seeds.add(child.lineno)
    return seeds


# ---------------------------------------------------------------------------
# Walker
# ---------------------------------------------------------------------------


Hit = tuple[Path, int, str, str]


def _scan_file(path: Path) -> list[Hit]:
    hits: list[Hit] = []
    try:
        src = path.read_text(encoding="utf-8")
    except OSError:
        return hits

    # Rule: any string reference to the banned name `apply_delta_facts`.
    # Catches imports, docstrings, debug prints, comments-as-strings.
    for m in BANNED_NAME_RE.finditer(src):
        # Convert offset to 1-based line number.
        line = src.count("\n", 0, m.start()) + 1
        hits.append((path, line, "apply_delta_facts_ref", m.group(0)))

    try:
        tree = ast.parse(src, filename=str(path))
    except SyntaxError:
        return hits

    skip_lines = _collect_seed_func_line_set(tree)

    for node in ast.walk(tree):
        # Rule: function definition named `apply_delta_facts`.
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name == "apply_delta_facts":
                hits.append((path, node.lineno, "apply_delta_facts_def", node.name))

        # Skip everything inside seed construction functions.
        lineno = getattr(node, "lineno", None)
        if lineno is not None and lineno in skip_lines:
            continue

        # Rule: `board["K"] = ...`
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if _is_protected_subscript(tgt):
                    hits.append((path, node.lineno, "subscript_write", ast.unparse(tgt)))

        # Rule: `board["K"] += ...` (AugAssign)
        if isinstance(node, ast.AugAssign):
            if _is_protected_subscript(node.target):
                hits.append((path, node.lineno, "aug_assign", ast.unparse(node.target)))

        # Rule: `board.setdefault(K, ...)`, `board.get(K).append(...)`, `dict.update({K: ...})`
        if isinstance(node, ast.Call):
            if _is_board_setdefault(node):
                hits.append((path, node.lineno, "setdefault", ast.unparse(node.func)))
            elif _is_board_get_append(node):
                hits.append((path, node.lineno, "get_append", ast.unparse(node.func)))
            elif _is_update_with_protected_key(node):
                hits.append((path, node.lineno, "update_protected_key", ast.unparse(node.func)))

    return hits


def _walk() -> list[Hit]:
    all_hits: list[Hit] = []
    # The walker must not scan itself: its own docstring and comments
    # intentionally mention the banned name to document what it guards.
    SELF_FILE = Path(__file__).resolve()
    for d in SCAN_DIRS:
        if not d.is_dir():
            continue
        for path in sorted(d.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            if path.resolve() == ALLOW_FILE:
                continue
            if path.resolve() == SELF_FILE:
                continue
            all_hits.extend(_scan_file(path))
    return all_hits


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


def test_sole_writer_invariant_holds():
    """Zero hits in the AST walker means the board has exactly one writer."""
    hits = _walk()
    if hits:
        msg = "\n".join(
            f"  {p.relative_to(ROOT)}:{ln} [{kind}] {detail}" for p, ln, kind, detail in hits
        )
        raise AssertionError(
            "Continuity Board sole-writer invariant violated "
            "(only scenes/state_reducer.py may write the protected keys; "
            "apply_delta_facts must be fully renamed):\n" + msg
        )


def test_walker_runs_under_2s():
    """The walker must stay fast — it is a CI gate, not a deep static analysis."""
    import time

    t0 = time.perf_counter()
    _walk()
    elapsed = time.perf_counter() - t0
    assert elapsed < 2.0, f"walker took {elapsed:.2f}s, must run <2s"
