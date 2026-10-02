You are working in the FlashCards React app at /home/aifactory/FlashCards (Vite + React, UI is Russian). Rework the set page (/set/:id) layout as described below. UI COPY MUST STAY RUSSIAN. Do the work, build, and commit to main.

## Files you will edit
- src/pages/SetPage.jsx
- src/styles.css

## Problem (current /set/:id, in src/pages/SetPage.jsx)
1. Set/card info at top (.set-head, .lesson-meta, ProgressOverview) takes the whole width at top.
2. Main content (cards) jumps left-right / up-down when switching mode or answering.
3. The mode switcher (.mode-switcher) works but sits low — needs to move to the TOP.

## Required new layout (2-panel flex)
1. Two-panel flex page:
   - LEFT SIDEBAR (fixed width ~240-260px on desktop): set info — title/name, lesson/meta, progress, description, buttons. Short and laconic. On mobile it collapses to a full-width compact header on top.
   - RIGHT/MAIN area: MODE SWITCHER AT TOP of this area + mode content (cards) CENTERED.
2. Cards centered on screen: main content flex-centered both vertically and horizontally in the work area, stable.
3. NO JUMPING: reserve space (padding/min-height or a fixed central stage) so switching modes, changing cards, or showing hints does NOT shift the layout. Reserve space for content, min-height, careful appearance animations, no shifts.
4. Mode menu (Карточки / Learn / Write / Тест / Spell / Match / Blast) at the START (top) of the main area, compact tabs/buttons.
5. Preserve readability + current styles overall; make it responsive for mobile.

Reference: src/pages/SetPage.jsx, src/styles.css (card/mode classes). The set info block includes: .set-head (back-link, h1 title, set-count.big card count, k11-share button + share msg), .lesson-meta (song + grammar), ProgressOverview (k9-progress). The mode switcher is .mode-switcher with .mode-btn tabs. Mode content renders: ExtendedTest, Spell, Match, Blast, Learn, Write, or the cards .deck (deck-toolbar, flashcard-wrap, deck-controls, keys-hints).

## Structural approach (recommended)
- Wrap the whole set page in a new flex container (e.g. .set-layout) with two children: a .set-sidebar (the info panel) and a .set-main.
- Move the existing set info JSX (.set-head, .lesson-meta, ProgressOverview) into the sidebar (keep them readable but more compact in the 240-260px column).
- In the main area: place .mode-switcher at the top, then a stable centered content stage (add a wrapper with flex centering + a min-height/reserved stage so switching modes doesn't jump).
- Use CSS media query so on narrow screens the sidebar becomes a full-width compact header above the main area.
- Keep all existing class names and functionality — do NOT rip out any handlers, states, or logic. Only restructure JSX nesting + add new wrapper CSS classes. The fullscreen overlay and all mode components must keep working.
- CRITICAL: ensure switching between modes and answering does not shift layout (reserve a stable central stage: min-height and centered flex).

## Verification (required)
1. npm run build must pass (exit 0).
2. Serve the app (backend python3 server on :5199 serves both dist/ static + SPA — check backend/app.py; you may need to npm run build then re-serve, or use vite dev). When you re-serve, make sure you can reach the app. There is one set 'Parts of the body' to compare.
3. Take screenshots BEFORE (fc_k14_before.png) and AFTER (fc_k14_after.png) of the set page 'Parts of the body' in /home/aifactory/FlashCards/ (use a headless chromium/playwright if available, else a suitable method). Verify visually: info on the side, cards centered, mode menu on top.
   - If you cannot drive a browser, still take whatever screenshot you can and note it in the result.
4. Commit to main.

## Report back (in your final message)
- Summary of the restructuring (what moved where, new CSS class names).
- npm run build output (exit status).
- List of changed files, commit hash.
- Absolute paths to fc_k14_before.png and fc_k14_after.png.
- Any caveats (e.g. browser automation limits).