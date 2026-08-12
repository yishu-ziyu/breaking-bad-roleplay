#!/usr/bin/env python3
"""Resumable Stepfun ASR for long audio. Saves per-chunk progress."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


def run(cmd, **kwargs):
    r = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if r.returncode != 0:
        raise RuntimeError(f"cmd failed ({r.returncode}): {cmd[:3]}...\n{r.stderr[:800]}")
    return r.stdout


def probe_duration(audio_path: str) -> float:
    out = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1",
            audio_path,
        ]
    )
    m = re.search(r"duration=(\S+)", out)
    if not m:
        raise RuntimeError(f"duration parse fail: {out[:200]}")
    return float(m.group(1))


def ensure_chunks(audio_path: str, chunks_dir: Path, chunk_seconds: int) -> list[Path]:
    chunks_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(chunks_dir.glob("chunk_*.wav"))
    if existing:
        return existing
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            audio_path,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-sample_fmt",
            "s16",
            "-f",
            "segment",
            "-segment_time",
            str(chunk_seconds),
            "-reset_timestamps",
            "1",
            str(chunks_dir / "chunk_%03d.wav"),
        ]
    )
    return sorted(chunks_dir.glob("chunk_*.wav"))


def asr_once(wav: Path, api_key: str, timeout: int = 180) -> str:
    b64 = run(["base64", "-i", str(wav)]).replace("\n", "")
    req = {
        "audio": {
            "data": b64,
            "input": {
                "transcription": {
                    "model": "stepaudio-2.5-asr",
                    "language": "zh",
                    "enable_itn": True,
                },
                "format": {
                    "type": "wav",
                    "codec": "pcm_s16le",
                    "rate": 16000,
                    "bits": 16,
                    "channel": 1,
                },
            },
        }
    }
    req_path = wav.with_suffix(".req.json")
    req_path.write_text(json.dumps(req), encoding="utf-8")
    try:
        r = subprocess.run(
            [
                "curl",
                "-sS",
                "--max-time",
                str(timeout),
                "-X",
                "POST",
                "https://api.stepfun.com/step_plan/v1/audio/asr/sse",
                "-H",
                "Content-Type: application/json",
                "-H",
                "Accept: text/event-stream",
                "-H",
                f"Authorization: Bearer {api_key}",
                "--data",
                f"@{req_path}",
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            raise RuntimeError(r.stderr[:500] or f"curl exit {r.returncode}")
        text = ""
        for line in r.stdout.split("\n"):
            if not line.startswith("data:"):
                continue
            try:
                ev = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "transcript.text.delta":
                text += ev.get("delta", "")
            elif ev.get("type") == "transcript.text.done":
                text = ev.get("text", text)
                break
        return text
    finally:
        if req_path.exists():
            req_path.unlink()


def asr_with_retry(wav: Path, api_key: str, retries: int = 6) -> str:
    last = None
    for i in range(retries):
        try:
            return asr_once(wav, api_key)
        except Exception as e:
            last = e
            wait = min(2 ** i, 60)
            print(f"  retry {i+1}/{retries} after {wait}s: {e}", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"ASR failed after {retries} retries: {last}")


def save_final(out_dir: Path, raw_text: str, meta: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    fm = "\n".join(
        [
            "---",
            f'source: "{meta["source"]}"',
            f'source_path: "{meta["source_path"]}"',
            f'duration_s: {meta["duration"]:.2f}',
            f'chunk_seconds: {meta["chunk_seconds"]}',
            "asr_engine: stepaudio-2.5-asr",
            f'asr_chunks: {meta["chunks"]}/{meta["chunks"]} ok',
            f'speaker_mode: {meta["speaker"]}',
            f'date: {meta["date"]}',
            "status: raw — needs cleanup",
            "---",
            "",
        ]
    )
    (out_dir / "transcript_raw.md").write_text(fm + raw_text + "\n", encoding="utf-8")
    (out_dir / "transcript.md").write_text(fm + raw_text + "\n", encoding="utf-8")
    result = {
        "status": "asr_complete",
        "out_dir": str(out_dir),
        "transcript_path": str(out_dir / "transcript.md"),
        "raw_path": str(out_dir / "transcript_raw.md"),
        "duration": round(meta["duration"], 2),
        "chunks": meta["chunks"],
        "chars_raw": len(raw_text),
        "slug": meta["slug"],
        "date": meta["date"],
    }
    (out_dir / "_result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--chunks", type=int, default=180)
    ap.add_argument("--date", default="")
    ap.add_argument("--work-dir", default="")
    args = ap.parse_args()

    api_key = os.environ.get("STEPFUN_API_KEY", "")
    if not api_key:
        print("STEPFUN_API_KEY missing", file=sys.stderr)
        return 1

    audio = Path(args.audio).resolve()
    if not audio.exists():
        print(f"missing audio: {audio}", file=sys.stderr)
        return 1

    date_str = args.date or datetime.now().strftime("%Y-%m-%d")
    work = Path(args.work_dir or Path(__file__).resolve().parent / f"work_{args.slug}")
    chunks_dir = work / "chunks"
    progress_path = work / "progress.jsonl"
    out_dir = Path.home() / "Documents" / "transcripts" / f"{date_str}_{args.slug}"

    print(f"[1] probe {audio}", flush=True)
    duration = probe_duration(str(audio))
    print(f"  duration={duration:.1f}s", flush=True)

    print(f"[2] chunks -> {chunks_dir}", flush=True)
    wavs = ensure_chunks(str(audio), chunks_dir, args.chunks)
    print(f"  n={len(wavs)}", flush=True)

    done: dict[str, str] = {}
    if progress_path.exists():
        for line in progress_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            done[row["chunk"]] = row["text"]
        print(f"  resume {len(done)}/{len(wavs)}", flush=True)

    print("[3] ASR", flush=True)
    for i, wav in enumerate(wavs):
        name = wav.name
        if name in done:
            print(f"  skip {name} ({len(done[name])} chars)", flush=True)
            continue
        text = asr_with_retry(wav, api_key)
        done[name] = text
        with progress_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"chunk": name, "text": text}, ensure_ascii=False) + "\n")
        print(f"  {name}: {len(text)} chars  [{i+1}/{len(wavs)}]", flush=True)

    raw = "".join(done[w.name] for w in wavs)
    print(f"[4] save total={len(raw)} chars -> {out_dir}", flush=True)
    save_final(
        out_dir,
        raw,
        {
            "source": audio.name,
            "source_path": str(audio),
            "duration": duration,
            "chunk_seconds": args.chunks,
            "chunks": len(wavs),
            "speaker": "single",
            "date": date_str,
            "slug": args.slug,
        },
    )
    print("OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
