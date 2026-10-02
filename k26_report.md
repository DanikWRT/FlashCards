# K26 Report — Unified fullscreen, dedup settings, Blast digits + green flash

## Summary
Implemented Problems A/B/C/D from `fc_k26_body.md` in `src/pages/SetPage.jsx` and
`src/styles.css`. `npm run build` exits **0** (see below). All K12–K25 modes and
behaviours verified working via a Playwright UI script (22/22 checks passed).

---

## A — Duplicate settings in Cards mode (removed)
- Deleted the legacy in-deck `.deck-toolbar` JSX block (the ⚙ collapsible row with
  Приоритет/Только помеченные/Автоозвучка/Play/интервал/Перемешать/Заново).
- Removed the now-unused `toolbarOpen` / `setToolbarOpen` state and the
  `deck-toolbar-toggle` / toolbar markup. No dangling handlers or CSS selectors remain
  (grep confirmed zero references).
- The shared top-right `.settings-panel` remains the single settings surface and already
  exposed every previously-toolbar item (verified via `data-testid` in A checks).
- The per-card `🔊/★/⛶` card-actions buttons were **not** touched.

## B — Unified fullscreen for all modes (Cards-style dark presentation)
- Removed the Cards-only `.fs-overlay` fullscreen JSX block (and its dead CSS + the
  `.page.fs-active:has(> .fs-overlay) .fs-exit-btn` hide rule).
- The floating `✕ Выйти` (`.fs-exit-btn`) now renders in **every** mode when `fullscreen`
  is on (condition changed from `fullscreen && mode !== 'cards'` to just `fullscreen`).
- Removed the `mode === 'cards'` fullscreen special-casing so all modes share one path.
- Dark presentation: `.page.fs-active` now overrides the CSS variable palette
  (`--bg/#0f172a`, `--surface/#1e293b`, `--border/#334155`, `--text/#e2e8f0`,
  `--muted/#94a3b8`) so every game surface/text recolours automatically; `.mode-stage`
  gets `background:#0f172a`; `.quiz-card`, `.flashcard`, `.test-placeholder` become slate;
  headings/words white, labels muted. Matches the old Cards overlay look.
- Esc and 'F' handling kept intact; digit answer hotkeys (answerRegistry) still work;
  settings-panel/settings-toggle hidden in fullscreen for all modes.

## C — Blast: digits on ALL variant buttons
- Changed `{i < 4 && <span…>}` to an unconditional `<span className="choice-digit blast-digit">{i + 1}</span>`
  so every block (i=0..N-1) shows its number.
- Extended the digit hotkey regex in the global keydown from `/^[1-4]$/` to `/^[1-9]$/`
  (handler array index still bounds it), so Blast blocks beyond the 4th are keyboard-reachable.

## D — Blast: green flash + auto-advance on correct
- `answer()` now, on a **correct** answer: keeps all scoring/lives/level/win/gameover
  logic firing exactly once, shows a full-screen `.blast-flash-green` overlay, and
  schedules a single 600 ms timer that calls the new `advance()` step.
- `advance()` (extracted from `next()`) reads live state via a `blastState` ref (avoids
  stale-closure level issues) and is guarded to only run while `phase === 'playing'`,
  so the win/gameover transition never double-advances (phase is already `done` by then).
- **Wrong** answers keep the manual `Далее` button (deferred correctly); correct answers
  auto-advance with **no** button.
- Pending timer cleared on wrong/advance/unmount/reset to avoid duplicates.
- Added `.blast-flash-green` CSS (fixed full-viewport, `rgba(34,197,94,0.35)`,
  `pointer-events:none`) with a `blastFlashFade` keyframe to fade out over 0.6 s.

## Build
`npm run build` → **exit 0** (Vite production build succeeded).

## Screenshots (Playwright, captured — 4/4)
- `fc_k26_fullscreen_cards.png`
- `fc_k26_fullscreen_learn.png`
- `fc_k26_settings.png`
- `fc_k26_blast_flash.png`
Backend `FC_DB_PATH=/tmp/fc_k26.db python3 backend/app.py` on :5199, frontend `npm run dev`
on :5174, set seeded via `POST /api/sets`.

## Verification
Playwright script `k26_ui_verify.cjs` — **22/22 checks passed**, 0 console/page errors:
deck-toolbar gone; single settings panel intact; Cards + Learn fullscreen dark
(`rgb(15,23,42)`), unified exit button, Esc/F work, legacy overlay gone, settings hidden
in fullscreen; every Blast block numbered; single correct block; green flash appears on
correct then auto-advances to the next question with no manual click; digit hotkey still
triggers the flash.
