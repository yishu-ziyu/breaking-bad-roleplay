#!/bin/zsh
set -e
cd "$(dirname "$0")/.."
source ~/.zshrc 2>/dev/null
export STEPFUN_API_KEY
for i in 02 03 04 05 06; do
  echo "==== START p$i $(date) ===="
  python3 transcripts/asr_resume.py \
    "audio/p${i}.m4a" \
    --slug "murphy-bb-p${i}" \
    --chunks 180 \
    --date 2026-08-06
  mkdir -p "transcripts/p${i}"
  cp -f "$HOME/Documents/transcripts/2026-08-06_murphy-bb-p${i}/transcript_raw.md" "transcripts/p${i}/" || true
  cp -f "$HOME/Documents/transcripts/2026-08-06_murphy-bb-p${i}/transcript.md" "transcripts/p${i}/" || true
  echo "==== DONE p$i $(date) ===="
done
echo "ALL_DONE $(date)"
python3 transcripts/merge_all.py
echo "MERGE_DONE $(date)"
