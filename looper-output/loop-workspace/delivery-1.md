# Delivery 1 — Build Fixed

## What changed

### `src/lib/sseClient.ts`
- Added `status`, `outline`, `complete` to `SseEventType` union (lines 10-12).
  These are event types the backend emits but were missing from the frontend type.
- Hoisted `currentEvent` and `currentData` declarations from inside the `for`
  loop to the `readStream` method scope (line 138-139). Block-scoped `let`
  was not visible at the flush block after the `while` loop.

### `src/components/StoryEvent.tsx`
- Deleted unused `StatusData` interface (was line 134).
- Deleted unused `OutlineData` interface (was line 150).
- `noUnusedLocals: true` in tsconfig.app.json caused these to fail build.
- Kept `StatusBody` and `OutlineBody` renderers — they are not dead code.
  Backend emits `status` and `outline` events.

## Verification

- `npm run build`: exit 0, 0 errors, 122ms
- `cd backend && uv run pytest`: 15 passed, 0 failed, 0.25s

## Notes

- Frontend and backend SSE schema now aligned.
- `complete` event type added to union for forward compatibility (backend emits it).
- No runtime behavior changed — only type-level fixes unblocking the build.
