# Homepage preview — 2026-09-09

Local entry: http://127.0.0.1:5176/?home=preview

## Selected direction

User selected https://www.inklestudios.com/80days/ for its art and layout.
This adaptation uses a full-width illustrated cover, condensed game title,
centered start actions, narrow introduction, wide gameplay excerpt and a cast
section. It does not copy the reference's copy, logos, awards or art.

Homepage remains query-only until visual acceptance; it is not deployed.

## Portraits

Seven user-provided original PNGs are copied into `public/avatars/illustrated/`.
Walter retains `/avatars/desert-noir/walter.jpg`. Sources in Downloads are unmodified.
The shared `characterPortrait` helper supplies the same portraits to the preview,
cast selection, chat avatars and story speaker portraits.
Hank's PNG has a bottom separator and an image fragment. Its display frame crops
that strip without altering the original image.

## Behavior and evidence

- Story entry uses the existing crisis/cast flow with newcomer context.
- All eight cast entries enter their corresponding existing direct chat.
- Jesse thought/speech excerpt comes from the actual 2026-09-09 live smoke.
  The controls switch recorded excerpts, not live model replies.
- Desktop cover and eight-character grid screenshots inspected.
- 390 x 844 mobile screenshot inspected with CDP, page scale reset to 1.
  `innerWidth = scrollWidth = 390`; character list has two columns.
- Hank chat entry verified: visible title identifies Hank, image source is the
  new PNG, and the bottom strip is hidden in the actual chat avatar.
- Frontend: 116 tests and build pass. Changed standalone modules pass lint.
  Repository lint retains 6 pre-existing errors in App/PlotGraphPanel.
- No backend changes or production deployment in this design iteration.

## Conversation refresh

The local direct/crew chat surface now uses a compact header, warm paper
background, rounded message surfaces and a persistent single-row composer.
The opener shows a larger portrait with optional starter buttons that fill the
composer; they do not auto-send. Removed the schema badge and opener emotion label.
Original user portrait assets remain in use.

Verified on the Saul conversation: starter fills input; Send produces a real
model response and GIF; phone screenshot at 390x844 shows the full Send button.
Fixed the mobile panel height to account for the 52px collapsed archive bar.
Build and 116 frontend tests pass; repository lint retains its prior 6 errors.
