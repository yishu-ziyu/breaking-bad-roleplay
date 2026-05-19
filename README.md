# ABQ Roleplay Lab

Breaking Bad-inspired AI roleplay chat prototype for the hackathon workspace.

## What It Does

- Lets the user choose Walter, Jesse, Skyler, Saul, Mike, or Gus.
- Forces a relationship anchor such as `Walter's former student`, `Saul's client`, or `Gus's employee` before chatting.
- Supports English / Simplified Chinese switching for UI copy, relationship labels, prompt language control, and demo replies.
- Supports private pressure scenes and lightweight crew scenes.
- Uses the real MiniMax Token Plan service through the project `/api/chat` server endpoint.
- Renders GIF cards from `gif_search_query` trigger words.

## Prompt Engine

The implementation uses the same three-layer architecture in `src/App.tsx`.

1. System Prompt

   `buildSystemPrompt(character, language)` defines static role identity, personality traits, signature notes, speaking style, target reply language, immersion rules, and safety boundaries.

2. Dynamic Context Injection

   `buildContextPrompt(character, relation, mode, history, userText, language)` injects the relationship anchor, chat mode, recent history, target language, and current user message for each request.

3. Output Schema

   `responseSchema` requires the model to return:

   ```json
   {
     "reply_text": "in-character reply",
     "emotion_state": "current emotion state",
     "gif_search_query": "1-3 English keywords, or null"
   }
   ```

The UI includes an `Inspect compiled prompt` drawer for checking the actual system and context prompt text.

## Safety Boundary

Because this topic involves crime-drama characters, the system prompt explicitly blocks real-world instructions for crimes, violence, evasion, chemistry procedures, drug production, money laundering, weapons, or operational wrongdoing. The app should keep those moments as fictional dramatic tension.

## Run Locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## MiniMax Token Plan

The app calls MiniMax through a server-side proxy so the Token Plan Key is not exposed in the browser.

Local setup:

```bash
cp .env.example .env.local
# set MINIMAX_TOKEN_PLAN_KEY to your real Token Plan Key
npm run dev
```

- Browser API: `/api/chat`
- Upstream endpoint: `https://api.minimaxi.com/anthropic/v1/messages`
- Model: `MiniMax-M2.7`
- Key location: `MINIMAX_TOKEN_PLAN_KEY` in `.env.local` locally or Vercel environment variables in deployment.

## Material Library

The project-local Breaking Bad material library lives in `materials/breaking-bad/`.

- `DESIGN.md`: retrieval-library architecture and copyright-safe layering.
- `SOURCES.md`: source directory for official pages, creator interviews, podcasts, critical analysis, wiki references, and licensing routes.
- `INGESTION_SCHEMA.md`: JSONL schemas for sources, episodes, voice rules, production notes, relationship dynamics, and retrieval units.
