You are working in the FlashCards repo at /home/aifactory/FlashCards (React 18 + react-router 6 + Vite, branch main). Implement node K10 exactly per the acceptance spec below. Study the existing code first (src/store.js, src/pages/SetPage.jsx, src/pages/MySets.jsx, src/App.jsx, src/styles.css) — do NOT break existing modes (Cards/Learn/Write/Test/Match/Blast/Spell, the K6 statuses, K4 priority ordering, K9 SRS/progress/streaks).

EXISTING DATA MODEL AND FEATURES (reuse, don't reinvent):
- Sets in localStorage 'fc_sets' (loadSets/saveSets in src/store.js). Each set: { id, topic, cards: [{term, translation, ...}] } — a card MAY optionally have an 'image' field (URL string).
- Per-set stats 'fc_stats_<setId>' keyed by card index — object per index already holds view count and (K9) SRS data. Extend this object with a 'starred' boolean for K10 (getters/setters already exist for related fields; add a setCardStarred/toggle-star helper).
- An English TTS helper already exists in SetPage.jsx: `speakEnglish(text)` uses window.speechSynthesis with an English voice (used by Spell mode). Reuse it for the K10 speaker button.
- SetPage has modes via a switcher (Карточки/Learn/Write/Тест/Match/Blast/Spell) in src/pages/SetPage.jsx. The Карточки (cards) mode keeps a display `order` array (indices) with K9 due-first + K4 priority sorting, a `flipped` state, `goPrev/goNext`, and a window keydown handler.

--- ACCEPTANCE (fc_k10_body.md) ---
1. TTS ОЗВУЧКА: on flashcards show a speaker button (🔊) that speaks the word/translation via speechSynthesis (English voice). Add a settings toggle "озвучивать автоматически при показе карточки" (auto-speak on card show) — respect it in cards mode (speak the shown side when a card is shown, using speakEnglish). Toggle should be persisted (localStorage).
2. АВТОПРОКРУТКА (Play): in cards mode add a "Play" button that auto-advances the deck every N seconds (configurable 3/5/10 sec, small UI control); the same button/state toggles stop. Auto-advance should wrap or stop at the end (choose sensible — stop at end and flip back to start on restart; do not break manual nav).
3. SHUFFLE: a shuffle button in Cards and Learn modes that randomizes the display order for the current pass.
4. ШОРТКАТЫ: keyboard shortcuts —
   - ArrowLeft/ArrowRight = prev/next card (cards mode),
   - Space = flip (cards mode),
   - Enter = confirm/next answer (Write and Test),
   - 's' = shuffle,
   - 'p' = play/pause.
   Show a short on-screen keys hints line (e.g. "← →: листать · Пробел: переворот · S: перемешать · P: play/pause"). Don't fire these when typing in an input/textarea.
5. ПОЛНОЭКРАННЫЙ РЕЖИМ: a fullscreen button on the card viewer that toggles a fullscreen presentation mode (big card, minimal UI); should feel like a dedicated mode with an exit control. (Implement as a CSS class that overlays the single big card — a proper in-app fullscreen from the regular cards view is fine; use the DOM Fullscreen API optionally but an in-app modal overlay is acceptable and more robust for a screenshot.)
6. ЗВЁЗДОЧКИ: a star button on each card to mark it as important (persist 'starred' in fc_stats_). Add a "только помеченные" (starred-only) filter in cards mode.
7. КАРТИНКИ: if a card has an 'image' URL field, show the image on the card (optional field, not required on every card). Render <img> with the URL (onError fallback so a broken URL doesn't break the deck).

Also write a verify script k10_verify.cjs following the Playwright-vs-dev-server pattern already used (k9_verify.cjs is the reference; dev server is running at http://127.0.0.1:5174) and run it to PASS acceptance. Verify `npm run build` exits 0. Take screenshots of the new UI (e.g. fc_k10_ux.png as required by the body, showing the cards view with the new TTS/Play/shuffle/fullscreen/star controls and an image card if you seed one).

COMMIT to main when done. Then report: changed files, commit hash, build result, verify checks count + pass/fail, screenshot paths.

Constraints: keep existing UI language Russian (the app UI is Russian). Do not rename/break existing exports used elsewhere. Keep changes focused on K10.
