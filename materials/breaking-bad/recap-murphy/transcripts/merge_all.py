#!/usr/bin/env python3
"""Merge all part transcripts into one pure-text file once ASR is done."""
from pathlib import Path
import re, shutil

ROOT = Path(__file__).resolve().parents[1]
DOCS = Path.home() / "Documents/transcripts"
parts = [
    ("p01", "第一季", DOCS / "2026-08-06_murphy-bb-p01-s1"),
    ("p02", "第二季", DOCS / "2026-08-06_murphy-bb-p02"),
    ("p03", "第三季", DOCS / "2026-08-06_murphy-bb-p03"),
    ("p04", "第四季", DOCS / "2026-08-06_murphy-bb-p04"),
    ("p05", "第五季", DOCS / "2026-08-06_murphy-bb-p05"),
    ("p06", "续命之徒 El Camino", DOCS / "2026-08-06_murphy-bb-p06"),
]
repls = [
    ("scarlett", "Skyler"), ("Scarlett", "Skyler"),
    ("门瑞", "Marie"), ("欢子", "汉克"), ("连金", "连襟"),
    ("土口", "Tuco"), ("秃口", "Tuco"), ("不瞌睡", "No-Doze"),
    ("文斯吉里根", "文斯·吉里根"), ("亚伦保尔", "Aaron Paul"),
    ("最纯的病毒", "最纯的冰毒"), ("高纯度的病毒", "高纯度的冰毒"),
]

def clean(body: str) -> str:
    for a,b in repls:
        body = body.replace(a,b)
    body = re.sub(r"([。！？])", r"\1\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()

chunks = []
missing = []
for key, title, d in parts:
    raw = d / "transcript_raw.md"
    if not raw.exists():
        missing.append(key)
        continue
    text = raw.read_text(encoding="utf-8")
    body = text.split("---", 2)[2].strip() if text.startswith("---") else text.strip()
    body = clean(body)
    outp = ROOT / "transcripts" / key
    outp.mkdir(parents=True, exist_ok=True)
    shutil.copy2(raw, outp / "transcript_raw.md")
    header = f"# 墨菲 绝命毒师一口气解说 · {key} {title}\n\n来源 BV1QN4y1B7Xu\n\n---\n\n"
    (outp / "transcript_pure.txt").write_text(header + body + "\n", encoding="utf-8")
    chunks.append(f"\n\n{'='*60}\n# {key} · {title}\n{'='*60}\n\n" + body)
    print("OK", key, "chars", len(body))

if missing:
    print("MISSING", missing)
    raise SystemExit(1)

full_header = """# 墨菲《一口气24小时看完绝命毒师+续命之徒》全文纯文本

- 来源：https://www.bilibili.com/video/BV1QN4y1B7Xu
- 结构：P01–P05 季解说 + P06 El Camino
- ASR：Stepfun stepaudio-2.5-asr；轻清洗断句与明显人名纠错

"""
out = ROOT / "transcripts" / "FULL_transcript_pure.txt"
out.write_text(full_header + "".join(chunks) + "\n", encoding="utf-8")
print("WROTE", out, "total_chars", out.stat().st_size)
