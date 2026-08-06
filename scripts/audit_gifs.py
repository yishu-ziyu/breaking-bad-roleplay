#!/usr/bin/env python3
"""GIF face audit automation.

Parses src/roleAssets.ts to extract all character GIF URLs, downloads each
GIF's first frame, and compares it against a reference face image using
face_recognition. Outputs a JSON report to stdout and exits with code 1 if
any GIF fails the audit.

Usage:
    cd backend && uv run python ../scripts/audit_gifs.py
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageSequence

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# Resolve project root (scripts/ is one level below)
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
ROLE_ASSETS_PATH = PROJECT_ROOT / "src" / "roleAssets.ts"
REF_FACES_DIR = SCRIPT_DIR / "ref-faces"

# Face distance threshold — below this value means the face matches
THRESHOLD = 0.5

# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_role_assets(ts_path: str | Path) -> dict[str, list[dict[str, str]]]:
    """Parse roleAssets.ts and return {character: [{id, url}, ...]}.

    Uses regex to extract character blocks — no TypeScript import needed.
    """
    text = Path(ts_path).read_text(encoding="utf-8")

    # Find all character blocks: ``walter: {`` ... ``},`` at the top level.
    # Strategy: match each ``characterId: 'xxx'`` and capture the block
    # between ``gifPools: [`` and the matching ``],`` that closes it.
    characters: dict[str, list[dict[str, str]]] = {}

    # Step 1: find all characterId declarations
    char_id_pat = re.compile(r"characterId:\s*'(\w+)'")
    char_matches = list(char_id_pat.finditer(text))
    if not char_matches:
        logger.warning("No characterId entries found in %s", ts_path)
        return characters

    for m in char_matches:
        char_name = m.group(1)
        # Start searching for gifPools from this characterId position
        block_start = m.end()

        # Find the gifPools: [ that belongs to this character
        gif_pools_match = re.search(
            r"gifPools:\s*\[", text[block_start:], re.DOTALL
        )
        if not gif_pools_match:
            characters[char_name] = []
            continue

        pools_start = block_start + gif_pools_match.end()

        # Find the matching closing ], for this gifPools array.
        # We need to count brace/paren nesting to handle nested objects.
        closing = _find_matching_bracket(text, pools_start, "[", "]")
        if closing is None:
            logger.warning(
                "Could not find closing bracket for %s gifPools", char_name
            )
            characters[char_name] = []
            continue

        pools_text = text[pools_start:closing]

        # Extract all url entries within this pool
        urls = re.findall(r"url:\s*'([^']+)'", pools_text)
        ids = re.findall(r"id:\s*'([^']+)'", pools_text)

        gifs: list[dict[str, str]] = []
        for i, url in enumerate(urls):
            gif_id = ids[i] if i < len(ids) else f"{char_name}-gif-{i}"
            gifs.append({"id": gif_id, "url": url})

        characters[char_name] = gifs

    return characters


def _find_matching_bracket(
    text: str, start: int, open_b: str, close_b: str
) -> int | None:
    """Find the matching closing bracket starting from ``start``.

    Handles nested brackets of the same type and skips string literals.
    """
    depth = 1
    pos = start
    in_string = False
    string_char: str | None = None
    while pos < len(text):
        ch = text[pos]
        if in_string:
            if ch == "\\":
                pos += 2  # skip escaped char
                continue
            if ch == string_char:
                in_string = False
                string_char = None
            pos += 1
            continue
        if ch in ("'", '"', "`"):
            in_string = True
            string_char = ch
            pos += 1
            continue
        if ch == open_b:
            depth += 1
        elif ch == close_b:
            depth -= 1
            if depth == 0:
                return pos
        pos += 1
    return None


# ---------------------------------------------------------------------------
# GIF first-frame extraction
# ---------------------------------------------------------------------------


def extract_first_frame(gif_url: str) -> Image.Image | None:
    """Download a GIF and return its first frame as a PIL Image.

    Returns None on download failure or if the content is not a valid image.
    """
    try:
        resp = requests.get(gif_url, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("Download failed for %s: %s", gif_url, exc)
        return None

    try:
        img = Image.open(io.BytesIO(resp.content))
        # If it's an animated GIF, seek to the first frame
        if getattr(img, "is_animated", False):
            for frame in ImageSequence.Iterator(img):
                return frame.convert("RGB")
        # Static image (could be a GIF or other format)
        return img.convert("RGB")
    except Exception as exc:
        logger.warning("Failed to decode image from %s: %s", gif_url, exc)
        return None


# ---------------------------------------------------------------------------
# Face comparison
# ---------------------------------------------------------------------------


def load_reference_face(char_name: str) -> Any | None:
    """Load the reference face encoding for a character.

    Expects a file at ``scripts/ref-faces/{char_name}.jpg``.
    Returns the face encoding (numpy array) or None if no reference exists
    or no face is detected.
    """
    ref_path = REF_FACES_DIR / f"{char_name}.jpg"
    if not ref_path.exists():
        logger.warning("No reference face for %s (expected at %s)", char_name, ref_path)
        return None

    try:
        import face_recognition

        image = face_recognition.load_image_file(str(ref_path))
        encodings = face_recognition.face_encodings(image)
        if not encodings:
            logger.warning("No face detected in reference image %s", ref_path)
            return None
        return encodings[0]
    except ImportError:
        logger.error("face_recognition is not installed")
        return None
    except Exception as exc:
        logger.warning("Failed to load reference face for %s: %s", char_name, exc)
        return None


def audit_gif_frame(
    frame: Image.Image, ref_encoding: Any, gif_id: str, url: str, char_name: str
) -> dict[str, Any]:
    """Compare a GIF frame against a reference face encoding.

    Returns a result dict with ``passed``, ``face_distance``, etc.
    """
    import face_recognition
    import numpy as np

    # Convert PIL to numpy array for face_recognition
    frame_array = np.array(frame)
    face_locations = face_recognition.face_locations(frame_array)

    if not face_locations:
        return {
            "character": char_name,
            "gif_id": gif_id,
            "url": url,
            "passed": False,
            "face_distance": None,
            "reason": "no_face_detected",
        }

    # Take the largest face (by area) — most likely the subject
    largest = max(
        face_locations,
        key=lambda loc: (loc[2] - loc[0]) * (loc[1] - loc[3]),
    )
    frame_encodings = face_recognition.face_encodings(frame_array, [largest])
    if not frame_encodings:
        return {
            "character": char_name,
            "gif_id": gif_id,
            "url": url,
            "passed": False,
            "face_distance": None,
            "reason": "encoding_failed",
        }

    distance = face_recognition.face_distance([ref_encoding], frame_encodings[0])[0]
    distance = float(round(distance, 4))
    passed = distance < THRESHOLD

    return {
        "character": char_name,
        "gif_id": gif_id,
        "url": url,
        "passed": passed,
        "face_distance": distance,
        "reason": None if passed else f"face_distance_{distance}_>=_threshold_{THRESHOLD}",
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    # Parse role assets
    if not ROLE_ASSETS_PATH.exists():
        logger.error("roleAssets.ts not found at %s", ROLE_ASSETS_PATH)
        print(json.dumps({"error": f"File not found: {ROLE_ASSETS_PATH}"}))
        return 1

    characters = parse_role_assets(ROLE_ASSETS_PATH)
    if not characters:
        print(json.dumps({"error": "No characters found in roleAssets.ts", "results": []}))
        return 1

    all_results: list[dict[str, Any]] = []
    total_gifs = 0
    skipped_characters = 0
    failed_gifs = 0

    for char_name, gifs in characters.items():
        if not gifs:
            continue

        ref_encoding = load_reference_face(char_name)
        if ref_encoding is None:
            # No reference — skip all GIFs for this character with a warning
            for gif in gifs:
                all_results.append(
                    {
                        "character": char_name,
                        "gif_id": gif["id"],
                        "url": gif["url"],
                        "passed": False,
                        "face_distance": None,
                        "reason": "no_reference_face",
                    }
                )
                failed_gifs += 1
            skipped_characters += 1
            total_gifs += len(gifs)
            continue

        for gif in gifs:
            total_gifs += 1
            result = {
                "character": char_name,
                "gif_id": gif["id"],
                "url": gif["url"],
                "passed": False,
                "face_distance": None,
                "reason": None,
            }

            frame = extract_first_frame(gif["url"])
            if frame is None:
                result["reason"] = "download_or_decode_failed"
                all_results.append(result)
                failed_gifs += 1
                continue

            audit_result = audit_gif_frame(frame, ref_encoding, gif["id"], gif["url"], char_name)
            if not audit_result["passed"]:
                failed_gifs += 1
            all_results.append(audit_result)

    report = {
        "summary": {
            "total_gifs": total_gifs,
            "passed": total_gifs - failed_gifs,
            "failed": failed_gifs,
            "characters_without_reference": skipped_characters,
            "threshold": THRESHOLD,
        },
        "results": all_results,
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))

    # Exit code: 0 if all passed, 1 if any failed
    return 0 if failed_gifs == 0 else 1


if __name__ == "__main__":
    sys.exit(main())