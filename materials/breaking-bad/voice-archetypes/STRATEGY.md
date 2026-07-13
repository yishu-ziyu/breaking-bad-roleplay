# Voice Strategy — Clone Route (supersedes Voice Design)

**Locked**: 2026-07-13
**Previous**: MiniMax Voice Design archetypes (deleted after failed taste check)
**Current**: MiniMax Voice Clone from reference audio

## Product rule

- Goal: higher character resemblance via cloning, not text-only voice design.
- Public product still must not claim "official actor voice".
- Prefer authorized samples: hired VO, self-recorded, or rights-cleared material.
- Do not commit raw show rips to the public git repo.

## Pipeline

1. Collect 6 reference clips (one primary per character), 10s–5min, mp3/m4a/wav, <=20MB, single speaker, low noise.
2. Upload via MiniMax File API (`purpose=voice_clone`) on `https://api.minimaxi.com`.
3. Call Voice Clone API -> `voice_id`.
4. Within 7 days, use each `voice_id` in T2A at least once if permanence is required (per MiniMax clone docs).
5. Map `characterId -> voice_id` in private casting file; wire TTS in app.

## API (China host, working key)

- Base: `https://api.minimaxi.com`
- Auth: `Authorization: Bearer $MINIMAX_API_KEY`
- Upload: `POST /v1/files/upload`
- Clone: Voice Clone endpoint (see MiniMax speech-voice-clone docs)
- Speak: `POST /v1/t2a_v2` with `speech-2.8-hd`

## Sample layout (gitignored audio)

```
materials/breaking-bad/voice-archetypes/
  STRATEGY.md
  samples/                 # local only, gitignored
    walter/ref.wav
    jesse/ref.wav
    ...
  casting.clone.json       # voice_ids after clone (ok to commit if no secrets)
```

## Status

- [x] Voice Design batch deleted (user rejected quality)
- [ ] Receive 6 reference audio files
- [ ] Clone + preview
- [ ] Wire app TTS
