You are working in the FlashCards React app at /home/aifactory/FlashCards (Vite + React, UI COPY MUST STAY RUSSIAN, do NOT change existing Russian UI text unnecessarily). Task K17: layout polish for the desktop/browser version of the set page (/set/:id) and the global header. Make the left info panel sticky, center the tasks, add a compact collapsible header, and move the keyboard legend below the tasks. Do the work, run `npm run build` (must exit 0), and COMMIT to main. Note: this VM's default FC_DB_PATH /home/dpogodin is not writable — use FC_DB_PATH=/tmp/fc.db if you start the backend for verification.

## Files you will edit
- src/pages/SetPage.jsx
- src/components/Layout.jsx
- src/styles.css

## Current architecture (read these before editing)
- src/components/Layout.jsx renders `<header className="header">` (brand link "FlashCards", nav "Мои наборы"/"Импорт JSON", auth area) then `<main className="main"><Outlet/></main>`. CSS: `.header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:14px 28px;...}`. `.main{max-width:980px;margin:0 auto;padding:32px 24px 64px}` (styles.css lines ~34-80).
- src/pages/SetPage.jsx: default export `SetPage`. It returns (line ~1902): `<div className="page set-layout set-page"><aside className="set-sidebar">...</aside><div className="set-main">` containing first `<div className="mode-switcher">` (7 mode tabs), then `<KeyboardLegend />` (line ~2012), then `<div className="mode-stage">` which renders the active mode (deck / test / learn / write / spell / match / blast / NoReviews / placeholders). Inside a `.deck` the cards-mode shows `.deck-toolbar`, `.card-actions`, `.flashcard-wrap`, `.deck-controls`, and `.keys-hints` (line ~2149). `<KeyboardLegend />` is a self-contained collapsible component (defined at ~line 1546) that renders `.kb-legend` with a `.kb-toggle` button ("Управление клавиатурой" + ? icon + chevron) and, when open, `.kb-table`.
- CSS layout-machinery (styles.css):
  - `.set-layout{display:flex;gap:28px;align-items:flex-start}` (~1892)
  - `.set-sidebar{width:250px;flex:0 0 250px;position:sticky;top:84px;display:flex;flex-direction:column;gap:14px;min-height:0}` (~1899) — this IS currently sticky, but its `top:84px` assumes a ~58px header; that must be reconciled.
  - `.set-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:16px;align-items:stretch}` (~1969)
  - `.mode-stage{flex:1;min-height:560px;display:flex;flex-direction:column;align-items:center;justify-content:center}` (~1994)
  - `.mode-stage > .deck, .quiz, .test-placeholder{width:100%;margin:0}` (~2004)
  - `.main:has(.set-page){max-width:1240px;margin-left:max(16px,calc((100vw - 1240px)/2));margin-right:16px}` (~2017, K16)
  - Responsive `@media (max-width:900px)` (~2024) stacks `.set-layout` to column, makes `.set-sidebar` static full width, `.mode-stage{min-height:420px}`.
  - `.kb-legend{align-self:flex-start;width:100%;max-width:420px;...}` (~2103). `.mode-switcher{margin:24px 0 0;...}` (~435) is overridden in `.set-main .mode-switcher{margin:0;align-self:flex-start;...}` (~1979). `.keys-hints{font-size:13px;color:var(--muted);text-align:center;...}` (~1601).

## Requirements (translate the user's Russian ТЗ into concrete layout changes)
1. LEFT PANEL sticky for desktop: ensure `.set-sidebar` stays pinned on the left during vertical scroll (it already uses position:sticky; keep it sticky, fix its `top` so it tracks a compact header — see requirement 4). Tasks/cards must be CENTERED in the remaining main area (both vertically and horizontally).
2. Move the LEGEND below the tasks: relocate `<KeyboardLegend />` to render AFTER (below) `.mode-stage` inside `.set-main` (i.e. as the last element of .set-main), instead of above the stage (line ~2012). Remove any excess top/bottom margin so it hugs the stage. It must stay reachable in all modes.
3. Cut vertical paddings/gaps so the tasks/quiz fit on one screen (1080p and 768p) without scrolling where feasible: tighten `.main` top/bottom padding, `.set-layout` gap, `.set-main` gap, and reduce `.mode-stage` min-height so the card + toolbar + legend fit comfortably on a 768px-tall viewport. Keep it reasonable — do not clip content; page should still scroll if truly overflowing.
4. HEADER (шапка):
   a. Make it compact: reduce `.header` height/padding to a single short line (e.g. padding ~8px 16-24px, brand font ~18px, smaller nav-link padding). Keep it sticky at top.
   b. Allow the user to COLLAPSE/HIDE the header entirely: add a small control (a button in the header, and/or a keyboard shortcut — e.g. 'H' — matching the existing global-hotkey pattern) that toggles the header hidden. When hidden, the whole page centers on the full viewport (no header row consuming vertical space). Persist the preference in localStorage (key like 'fc_hide_header'); default = shown. When the header is hidden, the left sidebar should stick to top:0 (no header offset).
   c. When scrolling, the (compact) header stays sticky at top and content begins immediately beneath it with NO big empty gap — ensure `.main` top padding around the set page is small so the mode switcher/tasks sit right under the header.
   Implementation note for (4b): the header lives in Layout.jsx; the set-page centering/sidebar top-offset lives in SetPage/styles. A clean approach: put header-hidden state in Layout (useState + localStorage), add a header element class like `header-hidden` on the Layout root or body, and toggle a class on the app wrapper (e.g. `app.header-collapsed`) so SetPage CSS can react via `.main:has(.set-page)` combinators or by setting `--header-h` custom property. Concretely: define a CSS custom property `--header-h` on `:root` (default 0px or measured) and toggle the header's contribution by collapsing its element (display:none or max-height:0) while keeping the toggle button somewhere (e.g. a slim floating button at the very top-right, outside the hidden header) so the user can bring it back. Make sure the toggle is ALWAYS reachable (when collapsed, show a tiny floating '▼ / показать' button pinned top-right).
5. Keep the K14 mobile responsiveness intact: on `@media (max-width:900px)` the sidebar still collapses to a full-width section (do not break that), and the compact-header behavior should feel reasonable on small widths (the collapse button should not overlap the auth area — wrap/stack sensibly).
6. The existing `.keys-hints` line inside the cards `.deck` may be kept as-is (it is the inline cards-mode hint) — do NOT confuse it with the collapsible legend; the legend is the one to relocate below the stage.

## Recommended approach summary
- Layout.jsx: add compact header + collapse toggle button + persisted state + a class on the root wrapper when collapsed. Ensure the floating "show header" button appears when collapsed so it is never unreachable.
- SetPage.jsx: move `<KeyboardLegend />` to just after `</div>{/* /mode-stage */}` and before `</div>{/* /set-main */}`. Keep all logic untouched.
- styles.css: compact `.header`; tighten `.main` padding; adjust `.set-sidebar` top to respect a compact/collapsible header via a custom property (e.g. `top: var(--header-h, 46px)`); tighten `.set-layout`/`.set-main` gaps and `.mode-stage` min-height; style `.kb-legend` under-the-stage (smaller/compact, margin-top small, full width of main or max-width ~420px); style the header collapse + floating-show buttons; keep `:has(.set-page)` rules.
- Choose consistent values that make the whole set page fit ~768px-high viewport in cards mode. Document choices in comments.

## ADDENDUM (operator update, IN ADDITION to everything above — same single pass)
The user further clarified the desired final layout. Treat these as authoritative refinements of the requirements above (they supersede any conflicting detail):

A1. LEGEND: place "Управление клавиатурой" at the VERY BOTTOM of the main area — BELOW the tasks/test (matches req 2). Top stays minimal: only modes/navigation. Keep it reachable in all modes; it should hug the stage (small top margin), compact.
A2. TASKS UP HIGH: the working block (card/question) must be pushed as high as possible in the main area — NOT spread out around vertical center with big empty gaps. Tasks sit toward the top of the main column; mode switcher + a small gap, then the task block, then the legend pinned to the bottom. Reduce any `justify-content:center` push-down in `.mode-stage` so content starts near the top (keep a modest gap below the mode switcher). The page should fit a 768p viewport without scrolling where feasible.
A3. SHIFT LEFT ~1-2cm: shift the whole working area further left by ~10-20px (tighten left padding/margins, make the left part more compact) so the tasks sit a bit more left/comfortable, while STAYING reasonably centered for a typical PC. Do not break the K16 left-pin (widen + left-align is fine, just trim ~10-20px more from the left side).
A4. CARDS-MODE CONTROL PANEL (.deck-toolbar with Приоритет повторения / Только помеченные / Автоозвучка / ▶ Play / interval select / 🔀 Перемешать / Заново): this row must NOT obstruct card viewing. Choose ONE: (a) move it to the RIGHT side — into the unused horizontal zone beside the card — as a compact stacked column with a collapse/expand control (gear ⚙ or similar) that expands/shrinks it; OR (b) keep it as a single COMPACT row placed immediately ABOVE the card area (one tight line, smaller controls/gaps). Pick whichever keeps the card unobstructed on 1280px; make controls smaller and gaps tighter than today. It can be collapsible.
A5. CARD-LAYER ACTION BUTTONS (currently the `.card-actions` row of 🔊/★/⛶ above the card): place them ON the card, CENTERED, in ONE horizontal row BETWEEN the "к повторению" marker (left) and the "Показов: N" badge (right) — i.e. a single centered strip on the card between these two labels. The `.flashcard-wrap` currently shows `<span class="view-badge">Показов…</span>` and a conditional `<span class="review-badge">к повторению</span>` above the card; put the round 🔊/★/⛶ buttons into a centered row between those two labels (left = review marker, center = buttons, right = views badge). They must not overlap the red strip (K16 fix) nor the badges.

Implementation notes:
- The cards `.deck` renders (in order) `.deck-toolbar`, `.card-actions`, `.flashcard-wrap` (with view-badge + review-badge + `.flashcard-scene`), `.deck-controls`, `.keys-hints`. For A5 restructure the `.flashcard-wrap` top row so the action buttons sit centered between the review marker and the views badge. For A4 the `.deck-toolbar` should be re-positioned/collapsible per the chosen option.
- Preserve all logic; this is purely JSX structure + CSS. Keep Russian labels.
- The KeyboardLegend must remain AVAILABLE in all modes (still rendered for the whole set page), just positioned at the bottom of `.set-main`.

## Verification (required — actually run these)
1. `npm run build` must pass (exit 0). Report output.
2. Live check with headless chromium (playwright is in node_modules) against the vite dev server or a built+served app, and take screenshots into /home/aifactory/FlashCards/:
   - fc_k17_before.png — capture the CURRENT layout before your changes for comparison (do this FIRST, before editing, if feasible; if you already edited, kind the 'before' from git stash/old build).
   - fc_k17_after.png — the set page after changes on a ~1280x768 viewport: left sidebar visible at left edge, task/card centered in main area, legend visible BELOW the tasks, header compact. Also a second fc_k17_collapsed.png with the header hidden showing the page centered full-screen and the floating show-header button present.
   - Verify programmatically where practical: sidebar is sticky (position computed sticky), legend element is BELOW the mode-stage in DOM order, header is short (measured height smaller than before), toggling the header hides it and shows the restore control, tasks vertically centered.
3. Commit to main. Include the before/after screenshots (fc_k17_before.png, fc_k17_after.png, fc_k17_collapsed.png) as untracked image files in the repo root.

## Report back (final message)
- Summary of every layout change: header compaction + collapse toggle (where the state lives, the reconcile/restore button, localStorage key), sidebar sticky offset, legend relocation, spacing reductions (list the specific CSS property changes and new values), responsive handling.
- npm run build exit result.
- Changed files + commit hash.
- Absolute paths to fc_k17_before.png / fc_k17_after.png / fc_k17_collapsed.png.
- Verification results (sidebar sticky, legend below stage, centered tasks, header heights before/after, collapse+restore works).
- Any caveats.