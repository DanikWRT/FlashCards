# FlashCards K3 — Quiz/test mode (en-ru and ru-en) with hint

Repo: /home/aifactory/FlashCards (Vite + React 18 + react-router-dom 6, plain CSS in src/styles.css).
You are on branch wt/k3 (already checked out, based on wt/k2 which has the card deck mode + fc_stats counter).

## Current code (do NOT break this)
- src/store.js: localStorage store. `getSet(id)`, `getStats(setId)`, `recordCardView(setId, index)` — increments per-card view counter under key `fc_stats_<setId>` keyed by String(index). Set shape: `{ id, topic, lesson_meta, cards: [{ word, translation, examples:[{en,ru}], family? }] }`.
- src/pages/SetPage.jsx: /set/:id page with mode switcher (Карточки / Тест). Test tab currently shows a placeholder `<div className="test-placeholder">🧪 Режим теста будет реализован в K3.</div>` and the Test button has `title="Режим теста появится в K3"` and a `<span className="mode-k3">K3</span>` badge inside it. Cards mode is a deck with rotateY flip etc. — leave cards mode and the mode-switcher logic intact.

## K3 task: build the Тест (Test) mode into SetPage.jsx

When mode === 'test', render a full quiz instead of the placeholder. Requirements (all must hold):

1. Direction switcher at top of the test area: en-ru (show English word, choices are Russian translations) and ru-en (show Russian translation, choices are English words). Default en-ru. Switching direction re-inits the test for that direction.

2. Each question shows one card as the prompt, plus FOUR choice buttons: 1 correct + 3 random incorrect choices drawn from other cards in the SAME set (distinct, correct answer choices must not repeat — if a set has fewer than 4 distinct possible answers, pad/reduce gracefully to the distinct choices available). Correct answer is determined by direction (en-ru → the card's translation; ru-en → the card's word). Randomize the order of the 4 choices every question.

3. On answering: highlight correct (green) and, if the user picked wrong, also highlight their wrong pick (red), and SHOW the hint text below (content from the same card): examples[0].en and examples[0].ru and family if present, so the user understands the meaning. If examples is empty/missing, hint falls back to just the translation/family text. Show a "Далее" (Next) button to go to the next question.

4. Scoring: a correct/total counter, a progress bar showing position through the run, and at the end a results screen: "X из N правильных" plus percentage.

5. Shuffle the order of question cards at the START of each full test run. Each card shown exactly once per pass. After the last card show the results screen.

6. Increment fc_stats_<setId> for the card whenever its question is displayed in test mode (call recordCardView(id, cardIndex) — note you need the ORIGINAL card index, not the shuffled position, because the stats keys are original card indices).

7. A way to restart the test (start over) from the results screen, and to switch back to Cards mode via the existing switcher.

## UX / styling
- Match existing light styling in src/styles.css (see .deck, .flashcard*, .btn, .btn-outline, .btn-primary, .mode-switcher classes already present). Add the needed new CSS classes to styles.css in the same style (e.g. .quiz, .quiz-direction, .quiz-choice, .quiz-choice.correct, .quiz-choice.wrong, .quiz-hint, .quiz-progress, .quiz-result).
- Keep button labels in Russian (Далее, Начать заново, and the direction labels en-ru / ru-en).
- The hint must only appear AFTER a wrong answer, not before answering.

## Verify (do it yourself with a real browser/runner)
1. Seed a test set into localStorage with at least 6 cards that have word/translation/examples (and at least one card with empty examples to exercise fallback hint).
2. Start dev server (vite; K2 used port 5174).
3. Open /set/:id, switch to Тест. Run through in en-ru: confirm 4 choices, correct green highlight, wrong red + hint shown with examples/family, Далее advances.
4. Do the same in ru-en.
5. Finish a run and confirm the results screen counts X of N correctly (pick one wrong deliberately).
6. Confirm fc_stats_<setId> increments for every card shown via test.

Keep a short proof file (e.g. k3_verify.txt or in your output) listing what you confirmed.

## Deliverables
- Implemented test mode in src/pages/SetPage.jsx (edit the placeholder branch), CSS additions in src/styles.css.
- `npm run build` must pass clean.
- Save screenshots: fc_k3_question.png (a question with 4 choices) and fc_k3_hint.png (hint visible after a wrong answer) in /home/aifactory/FlashCards/.
- Git commit on branch wt/k3 with a clear message.
- Report final output: what you built, files changed, build result, verification results, screenshot paths, and the commit hash. Keep the final report concise.
