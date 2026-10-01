You are implementing K7 for the FlashCards app at /home/aifactory/FlashCards (React 18 + react-router 6 + Vite 5, JSX, plain CSS in src/styles.css, all data in localStorage). Work in this repo, edit src/, and commit to the current branch (main). Do NOT use any llm/pipeline tools — just do the implementation directly and verify in a real browser with Playwright.

## Existing code map (read these first)
- src/store.js: localStorage store. "fc_sets" array store. Per-set view counters in key "fc_stats_<setId>" as a FLAT dict keyed by card index -> view count. Card statuses live in a SEPARATE key "fc_status_<setId>" (added in K6) as a FLAT dict card-index -> status string ("not_studied"/"learning"/"mastered"), with helpers getStatuses(setId), setCardStatus(setId, index, status). getStats(setId), recordCardView(setId, index) are for the view counters. Cards are {id, word, translation, examples?, family?}.
- src/pages/SetPage.jsx: the /set/:id page. Has a common mode-switcher (role=tablist) with four modes, state `mode` in ['cards','learn','write','test']:
  - Карточки (mode='cards', label K4 optional)
  - Learn (mode='learn', label "K6" via <span className="mode-k6">)
  - Write (mode='write', label "K6")
  - Тест (mode='test', existing K3 basic <Quiz> component, label "K3" via <span className="mode-k3">)
  The switcher renders buttons ~lines 645-686; then `mode === 'test' ? <Quiz .../> : mode === 'learn' ? <LearnMode .../> : mode === 'write' ? <WriteMode .../> : <cards deck>`. There is a direction toggle en-ru/ru-en inside Quiz; K6 added direction toggles to Learn and Write too.
- src/styles.css: all styling; follow existing classes (mode-switcher, mode-btn, btn, btn-primary, btn-outline, quiz-*, flashcard-*, deck-*, learn-*, write-* etc.). You may add new classes but keep them consistent with existing style.
- src/components/Layout.jsx: nav shell.
- Build: `npm run build`. Dev server: `node_modules/.bin/vite` on port 5174 served on 127.0.0.1:5174. Playwright 1.63.0 is installed in node_modules with chromium cached.

## Acceptance (K7) — implement ALL
1. SPELL MODE ("Spell"): a new mode on /set/:id. It speaks the word aloud via the Web Speech API (speechSynthesis.speak with the English voice auto-selected), the user types what they hear letter-by-letter into a text input. Spelling check = case-insensitive match (trim + toLowerCase like Write). Provide a "повторить озвучку" (repeat audio) button that calls speak again. Auto-pick an en voice from speechSynthesis.getVoices() (prefer a voice whose lang starts with 'en'; fall back to default). Handle the case where speechSynthesis is unavailable (e.g. headless Chromium) gracefully so the UI still works and users can type (e.g. wrap speak in try/catch; still show the word's first letter as a gentle hint optionally, but the core requirement is type-to-spell + verify + repeat-audio button).
   Add "Spell" as a FIFTH mode button in the switcher (label with a "K7" tag, style consistent with existing mode buttons). Route it in the same ternary in SetPage.
2. EXTENDED TEST: extend the existing Тест mode so the user configures question types with checkboxes at the START of the test. Question types:
   - Выбор ответа (multiple choice) — like the current K3 quiz: question + 4 options.
   - Ввод ответа (typed input, active recall) — print with keyboard, case-insensitive match.
   - Сопоставление (matching): 4-6 terms on the left, their translations on the right (shuffled); click to pair/connect them (click left item then right item, or click-to-toggle; finalize and check pairs).
   - Правда/ложь (true/false): show a word + translation and ask whether they correctly correspond (yes/no).
   The test should weight/integrate the selected types across the cards.
3. TEST SETTINGS at start of the test: choose which question types (checkboxes, allow multiple; default: all selected), direction (en-ru / ru-en), number of questions (all or N, default all), max time (optional countdown timer — show remaining time; when it reaches zero, auto-finish). Provide a "Начать тест" button that starts; settings shown before start.
4. RESULT SCREEN at end of the test: score (e.g. "N из N верно" + percent), breakdown of errors (list which cards/answers were wrong with correct answer), and a "повторить ошибочные" button that re-runs a test with only the incorrectly-answered cards.
5. PROGRESS/STATUSES: as answers happen in Spell and extended Test, update card statuses (fc_status_<setId>) consistently with K6 semantics (correct 2 in a row -> mastered, any error -> learning; you may simplify sensibly for these modes but must persist statuses). Keep the existing fc_stats_ view-counter semantics untouched.

Backward-compat: do NOT change how cards mode reads getStats(id)["<idx>"] as a bare count. Keep all data in localStorage. Handle empty-set gracefully (existing "В этом наборе нет карточек." placeholder). Keep code clean and consistent with existing style. Keep the current build passing.

## Verification (MANDATORY, in a real browser with Playwright)
Write a Node .cjs script (like prior cards did, e.g. k6_verify.cjs) using playwright from node_modules. It must:
1. Seed localStorage with a small set (e.g. 6 cards with word/translation) via page.addInitScript so it persists on the origin.
2. Open http://127.0.0.1:5174/ and navigate into the set.
3. Spell mode: confirm the mode button exists and route works, confirm the input + "повторить озвучку" button render, type a correctly-spelled answer (case-insensitive accepted) and a wrong one (wrong highlighted / correct shown), confirm letter-by-letter typing and final spelling check. (speechSynthesis may be a stub in headless — that is fine; verify the UI around it.)
4. Extended Test: confirm the settings screen shows the type checkboxes, direction, question count, and timer options; select types and start; exercise multiple-choice, typed-input, matching, and true/false question rendering; finish and confirm the result screen shows score + error breakdown + "повторить ошибочные" button; confirm retry-on-errors re-runs with only wrong cards.
5. Confirm mode switcher shows all five modes (Карточки/Learn/Write/Тест/Spell) and the settings->start->result->retry flow works.
6. Take screenshots fc_k7_spell.png and fc_k7_test.png in /home/aifactory/FlashCards/ and save them.
Run `npm run build` and confirm it passes (exit 0) BEFORE committing.

## Commit
When done and build passes and screenshots exist, `git add` and `git commit` on the current branch (main) with a clear message like "K7: spell (audio + typed spelling) mode + extended Test (question types, settings, retry errors)". Do NOT push. Report the commit hash, the changed files, the screenshots' absolute paths, and what you verified.
