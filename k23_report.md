# K23 — Fullscreen everywhere, digit hotkeys, layout-independent input, top-right settings, mobile order

Implements points 1–7 of the K23 spec in `src/pages/SetPage.jsx`, `src/normalize.js`, `src/styles.css` (only those source files changed). Verified empirically with Playwright (14/14 UI checks pass) + a `node` unit check on `normalize.js`.

## What changed per point

### 1) Fullscreen for ALL modes
- Added two CSS-class drivers: `body.fs-body` (set in `useEffect` on the `fullscreen` state) hides the global app header and locks scroll; the page root gains `fs-active`.
- `src/styles.css` `.page.fs-active …` hides all page chrome (`.set-sidebar`, `.mode-switcher`, `.set-main-head`, `.deck-toolbar`, `.deck-controls`, `.keys-hints`, `.kb-legend`, `.lesson-meta`, `.k9-progress`) and forces `.set-main` / `.mode-stage` to fill the viewport, keeping the mode component mounted so it retains its internal state. The active game/study area is centered.
- Non-cards modes get a floating `.fs-exit-btn` (✕ Выйти); Esc and the button both leave fullscreen (Esc already handled, kept).
- Cards mode keeps its dedicated dark `.fs-overlay` presentation (unchanged behavior, verified: card word renders, its exit restores the chrome).
- The existing `'F'`/`а` key toggle works in every mode.

### 2) Answer-variant digit hotkeys (1..4)
- Added a shared registry `answerRegistry = { handlers: [] }` (module-level) plus a single mode-aware digit block in the existing global keydown handler: digit `N` calls `handlers[N-1]()` then clears. It runs after the existing `INPUT`/`TEXTAREA` guard, so digits never fire while typing.
- Registered handlers + a small numeric badge (`.choice-digit`) in DOM order in:
  - ExtendedTest `ChoiceQuestion` (q.choices)
  - `Learn` choices
  - `Blast` blocks
- Verified: pressing `2` in Learn triggers the exact same action as clicking choice 2 (feedback shown).

### 3) Layout-independent input (раскладка не важна)
- Extended `src/normalize.js` with `translitNormalize(s)` (lowercases + phonetic Cyrillic→latin, ь/ъ→nothing) and a positional QWERTY↔ЙЦУКЕН layer. `matchAnswer` now compares the given and each expected variant on the raw text AND on both canonical forms (phonetic + positional), so typing works regardless of layout. Empty answer still = wrong; `/` and `(...)` variant parsing untouched.
- Verified via node (see below): «ифк» (bar on RU layout) matches `bar`; «ефиду» (table on RU layout) matches `table`; «cnjk» (стол on EN layout) matches `стол`; phonetic «privet» matches «Привет».

### 4) Match digit+letter pairing
- Added a `matchRegistry` and registered a handle while Match is in `playing`. Digits select the left (term) row, letters a.. select the right (trans) column; whichever order they come in (“2a” or “a2”) a pair is placed exactly like clicking term then translation. Buffer clears after placing; arrow keys/timer untouched.
- Added small numeric/letter labels to the Match cards. Verified: pressing digit+letter places a pair (0→1 paired).

### 5) Top-right collapsible settings menu
- Added `.set-main-head` with a `.settings-toggle` (⚙ Настройки) visible in every mode and a `.settings-panel` dropping from the top-right containing: fullscreen, priority, starred-only, autospeak, ▶ Play + interval, 🔀 Перемешать, Заново. The original inline cards `deck-toolbar` remains so existing tests/behavior are not regressed.
- When open, page root gets `settings-open`; the game/study widget compresses and shifts left (game uses the left portion). Closing restores full width. Verified: game left edge moved 481→306 when panel opened.

### 6) Mobile game-first
- In `@media (max-width:900px)` `.set-main` gets `order:0` and `.set-sidebar` `order:1`, so the study area renders before the sidebar; mobile fullscreen hides all chrome (`.fs-active` rules) leaving only the game. Settings panel becomes a static full-width block on narrow screens. Verified: mainTop 6 < sideTop 680; mobile fullscreen hides sidebar+header.

### 7) No K12–K22 regressions
- `npm run build` exits 0. Cards fullscreen overlay, deck-toolbar, and all mode entry paths verified working; 0 console errors in Playwright. Auth gates (K19), permissions (K21), add-cards (K22), leaderboard (K20) and progress (K9) are untouched UI flows confirmed rendering fine.

## Build result
```
✓ 42 modules transformed.
✓ built in 1.33s   (dist/assets/index-*.css 35.48 kB, index-*.js 248.36 kB)
```

## normalize.js unit check
```
$ node --input-type=module ...
translit(Привет) = privet
стол vs стол                                   = true
empty vs стол                                  = false
cnjk (EN layout for стол) vs стол              = true
privet vs Привет                               = true
variants бедро (таз), хип = ["таз","бедро","хип"]
ифк (RU layout bar) vs bar                     = true
ефиду (RU layout table) vs table               = true
(UI) альфа typed on EN layout (fkmaf) vs Write input  = Верно!
```
All matchAnswer results are sensible; empty stays wrong; `/` and `(...)` parsing intact.

## Verification evidence
- `fc_k23_verify.png` — desktop screenshot from the Playwright run.
- `k23_ui_verify.cjs` — 14-check UI script (fullscreen in Learn + digit + Esc + settings shift + Write translit + Match pairing + mobile order + mobile fullscreen). OVERALL: PASS.
- Additional cards-fullscreen regression check: cards fs-overlay shows the card, exit restores chrome, 0 console errors.
