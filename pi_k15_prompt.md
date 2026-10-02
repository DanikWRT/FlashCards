You are working in the FlashCards React app at /home/aifactory/FlashCards (Vite + React, UI is Russian). Add consistent keyboard controls across ALL study modes on the set page (/set/:id) plus a visible, collapsible KEYBOARD LEGEND, as described below. UI COPY MUST STAY RUSSIAN. Do the work, build, and commit to main.

## Files you will edit
- src/pages/SetPage.jsx
- src/styles.css

## Current state (important context)
The set page is src/pages/SetPage.jsx. There is ALREADY a cards-mode-only hotkey handler: a useEffect with window keydown that (only when mode === 'cards') handles ArrowRight/ArrowLeft = prev/next, Space = flip, 's'/'S' = shuffle, 'p'/'P' = play/pause, and it skips events whose target is an INPUT/TEXTAREA. There is ALREADY a static ".keys-hints" line inside the cards deck (shows "← → листать · Пробел: переворот · S: перемешать · P: play/pause"). There is a fullscreen overlay ('.fs-overlay', toggled by setFullscreen) shown when fullscreen===true, and a '⛶' button in .card-actions that sets fullscreen true. Modes are switched by setMode: 'cards' | 'learn' | 'write' | 'test' | 'spell' | 'match' | 'blast'. Mode components (ExtendedTest, Learn, Write, Spell, Match, Blast) are rendered inside .mode-stage. The Write/TypedQuestion/Spell inputs already have local onKeyDown Enter submit.

## Requirements
1. GLOBAL shortcuts that work on /set/:id in ALL modes (cards/learn/write/test/spell/match/blast), consistent with (and in addition to) what the fullscreen already offers:
   - ArrowLeft / ArrowRight = previous / next card (cards mode)
   - Space = flip card (cards mode)
   - Enter = confirm / check answer (in Write/Test typed inputs)
   - 's' = shuffle
   - 'p' = play/pause autoscroll (cards mode)
   - 'f' = toggle fullscreen (currently NO 'f' handler exists — add it)
   - Also carry over Escape to close fullscreen (nice to have).
2. Do NOT conflict with text input: letter keys (s, p, f) and Enter must NOT fire when focus is in an input/textarea (check document.activeElement — if input/textarea, ignore everything except Escape). Arrows/Space for cards may stay global ONLY when NOT in an input/textarea.
3. LEGEND: a compact, collapsible "Управление клавиатурой" panel. A small icon/button (a '?' button is suggested) toggles a table that lists each shortcut key -> action. Should be visible on the set page, not just in cards mode. Keep it small and collapsible (chevron/'?' toggle).
4. INFRASTRUCTURE: centralize the hotkey handling in SetPage (a single useEffect with a keydown listener + a per-mode dispatch), NOT scattered per-component. Keep the existing per-input Enter handling in Write/Spell/TypedQuestion working (they already submit on Enter) but make sure the global listener does not double-trigger/conflict. Prefer refs (useRef) for handlers so the useEffect can depend on minimal deps and always call the latest handler.
5. Keep all existing functionality. Do NOT rip out handlers/states/logic. Structure the key handling so it works for the current mode.

## Recommended approach
- Add a ref-based handler map or a single global keydown effect. Keep a useRef to the latest mode/flip/pos/playing state so the listener never goes stale and can be registered once with a stable callback.
- Add the 'f' handler to toggle fullscreen (setFullscreen((v) => !v)) and 'Escape' to close fullscreen.
- Guard: const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) { if (e.key !== 'Escape') return; }
- Build a legend component (e.g. KeyboardLegend) with a '?' toggle button that opens a small table of shortcuts. Render it in SetPage (e.g. near the top of .set-main or inside .mode-stage) so it's reachable in all modes (not only cards). Make it collapsible and persistent per the toggle state.
- If the old static '.keys-hints' inside the cards deck duplicates the legend, you may keep it or replace it — but the main legend panel must exist and be reachable in all modes. Prefer one source of truth for shortcut text.
- Enter: for cards mode, Enter may also flip (like Space) — optional. For write/test typed, the existing input-level onKeyDown already handles Enter; ensure the global listener ignores Enter while an input is focused so there is no double action.

## Shortcut table to present in the legend (Russian labels)
- ← / → — предыдущая / следующая карточка (Карточки)
- Пробел — перевернуть карточку (Карточки)
- Enter — проверить ответ (Write / Тест)
- S — перемешать
- P — play / пауза (Карточки)
- F — полный экран
- Esc — закрыть полный экран
(These labels are the source of truth — keep the Russian text consistent between the legend and any inline hints.)

## Verification (required)
1. npm run build must pass (exit 0).
2. Serve the app: backend python3 server on :5199 serves both dist/ static + SPA (backend/app.py; set FC_DB_PATH to a writable file, e.g. /tmp/fc.db, and ensure a set 'Parts of the body' exists — POST via /api/sets if needed, or use an existing one). Rebuild before serving so dist reflects your changes.
3. Use a headless chromium (playwright is available in node_modules) to verify and take screenshots in /home/aifactory/FlashCards/:
   - fc_k15_legend.png — the set page with the LEGEND panel OPEN (click the '?' button) showing the key->action table.
   - (optional) fc_k15_fullscreen.png — fullscreen toggled via the 'f' key to prove the shortcut works.
   - Verify programmatically where possible: the '?' toggle exists, the table rows are present, pressing 'f' toggles fullscreen, pressing 's' shuffles, Space flips (assert class/flipped state), and that typing 's'/'f' inside a text input does NOT trigger the global action (no shuffle / no fullscreen while a .write-input is focused).
4. Commit to main.

## Report back (in your final message)
- Summary: where the hotkey infra lives, how 'f' + Escape were added, how the input-focus guard works, how the legend is structured and where it renders.
- npm run build output (exit status).
- List of changed files, commit hash.
- Absolute paths to fc_k15_legend.png (and fc_k15_fullscreen.png if taken).
- The results of the key verification checks (f toggles fullscreen, s shuffles, Space flips, input-focus guard works).
- Any caveats (e.g. browser automation limits).
