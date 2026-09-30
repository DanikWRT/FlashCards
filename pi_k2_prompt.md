FlashCards repo lives at /home/aifactory/FlashCards (branch wt/k2, already checked out). It is an existing Vite+React18+react-router-dom6 app from K1. Do NOT scaffold anything new — MODIFY the existing code in place. You are the coding agent building K2.

## Existing K1 codebase (already present, read these files first)
- src/App.jsx — routes: '/' = MySets, '/set/:id' = SetPage, '/sets/new' = ImportPage
- src/store.js — localStorage store key 'fc_sets': loadSets(), saveSets(), getSet(id), addSet(set), removeSet(id). Set shape: { id, topic, lesson_meta, cards: [ { word, translation, examples:[{en,ru}], family? } ] }
- src/pages/SetPage.jsx — currently lists ALL cards in a vertical list. K2 REPLACES this page's body with a flashcard deck mode + a mode toggle (Карточки default / Тест stub link).
- src/pages/MySets.jsx, src/pages/ImportPage.jsx, src/components/Layout.jsx — leave as-is
- src/styles.css — all styles, light theme CSS variables already defined (--bg, --surface, --border, --text, --muted, --primary, --primary-dark, --radius, --shadow, --shadow-lg). Reuse these. ADD new flashcard-deck styles at the end of styles.css.
- vite.config.js — dev server strict port 5174.

## K2 REQUIREMENTS (implement all)
1. On /set/:id show a MODE SWITCHER between 'Карточки' (flashcard deck, default active) and 'Тест' (a stub — a disabled/stub link or button that says K3 will implement it; do not build the test).
2. Deck mode shows ONE card at a time. FACE = word (English). BACK = translation + examples[0] (en+ru) + family (if present), nicely laid out.
3. FLIP ANIMATION: click the card toggles a smooth 3D flip (rotateY around vertical axis, perspective + backface-visibility:hidden, transition ~0.6s ease). Second click flips back. NO instant shows — only smooth animation. Implement via a .flipped class toggling transform: rotateY(180deg) on an inner flip container with two absolutely-positioned faces (.flashcard-face.front / .back, backface-visibility:hidden, back face prefipped rotateY(180deg)).
4. Control panel under the card: Назад / Вперёд buttons (prev/next card), and a progress label 'Карточка X из N' (1-based).
5. VIEW COUNTER: every time a card is DISPLAYED (when it becomes the current card), increment that card's counter. Persist in localStorage under per-set key: fc_stats_<setId> = { "<cardIndex>": count, ... } (cardIndex = index in the cards array, as string keys). Increment when the card mounts/becomes current (use an effect keyed on the current index that increments on each change). Counter does NOT affect ordering — order stays natural array order.
6. HOTKEYS: ArrowLeft/ArrowRight = prev/next card, Space = flip. Attach a keydown listener (window), preventDefault on Space so the page doesn't scroll. Ignore when focus is in an input/textarea.
7. Beautiful light styling consistent with the app: card centered, large typography (word big, translation medium, examples/family smaller), nice shadow/corners matching existing theme.

## VERIFICATION (do all, report results)
- cd /home/aifactory/FlashCards
- npm run build must pass (the app currently builds — do not break it).
- A Vite dev server is expected on http://localhost:5174. If none is running, start it with: node_modules/.bin/vite --port 5174 (background). Confirm curl returns 200.
- Use Playwright (a node .cjs script you write — node v26 available; @playwright/test may not be installed — if not, install or use playwright-core) OR use a browser to verify manually. Write a node .cjs script that: opens http://localhost:5174/, seeds localStorage 'fc_sets' with the sample from public/sample.json via page.evaluate, navigates to the first set's /set/:id, verifies: (a) mode switcher shows 'Карточки'+'Тест'; (b) one card shown with the word; (c) clicking the card adds .flipped and shows translation; (d) clicking Вперёд moves to card 2 and 'Карточка 2 из 40'; (e) after paging through, localStorage 'fc_stats_<id>' grew for visited indices. Save screenshots /home/aifactory/FlashCards/fc_k2_card.png (face) and fc_k2_card_back.png (flipped back).
- If Playwright is genuinely unavailable, at minimum run the build and dev server, check the page renders via curl, and clearly state the browser-verification limitation in your final report.

## STEPS
1. Read the existing files.
2. Modify src/pages/SetPage.jsx: add mode switcher + deck mode (keep not-found branch). Keep scoped, in-file is fine.
3. Add flashcard CSS to src/styles.css.
4. Implement fc_stats_<id> counter logic.
5. Run verification.
6. Save screenshots fc_k2_card.png and fc_k2_card_back.png.
7. Report: files changed, flip/counter summary, build result, dev-server URL+status, browser verification (confirm fc_stats_<id> grew), screenshot paths.

Do NOT commit — I (orchestrator) handle git. Leave edited files in the working tree on branch wt/k2. Do NOT touch App.jsx routes, MySets, ImportPage, Layout except SetPage.jsx and styles.css (optionally store.js if you add the counter helper there). Keep changes scoped to K2.