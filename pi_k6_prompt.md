You are implementing K6 for the FlashCards app at /home/aifactory/FlashCards (React 18 + react-router 6 + Vite 5, JSX, plain CSS in src/styles.css, all data in localStorage). Work in this repo, edit src/, and commit to the current branch (main). Do NOT use any llm/pipeline tools — just do the implementation directly and verify in a real browser with Playwright.

## Existing code map (read these first)
- src/store.js: localStorage store. "fc_sets" array store. Per-set view counters in key "fc_stats_<setId>" as a FLAT dict keyed by card index -> view count, e.g. {"0":3,"1":5}. Functions: loadSets, saveSets, getSet, addSet, removeSet, getStats(setId) (returns {}), recordCardView(setId, index).
- src/pages/SetPage.jsx: the /set/:id page. Already has a mode-switcher with Card mode ("Карточки", default, K2, with priority sort K4 + view-badge reading getStats(id)[idx]) and Test mode ("Тест", K3, component <Quiz>). Direction toggle en-ru/ru-en inside Quiz. Cards are {id, word, translation, examples?, family?}.
- src/styles.css: all styling; follow existing classes (mode-switcher, mode-btn, btn, btn-primary, btn-outline, quiz-*, flashcard-*, deck-*, etc.).
- src/components/Layout.jsx: nav shell.
- Build: `npm run build`. Dev server: `npx vite` (or `node_modules/.bin/vite`) on port 5174, served on 127.0.0.1:5174. Playwright 1.63.0 is installed in node_modules with chromium cached.

## Acceptance (K6) — implement ALL
1. LEARN MODE (adaptive, "Learn"): a new mode on /set/:id. Shows cards in an adaptive order: cards with errors / fewer showings come first, difficult cards get repeated. Questions of two types: (a) show word -> choose translation from options, (b) show translation -> choose word. On a correct answer the card moves toward "mastered"; on an error it stays in "learning". Show a progress indicator. The session ends when all cards are "mastered".
2. WRITE MODE (typed input, active recall): shows a term (word or translation depending on direction), user TYPES the answer into a text field with the keyboard. Checking: match case-insensitive (trim + toLowerCase); on error highlight the correct answer. A "Не помню" (don't remember) button to skip.
3. CARD STATUSES: store a study status per card: not_studied / learning / mastered next to the view counter (in fc_stats_<setId>). In Learn and Write a correct answer 2 times in a row -> mastered; any error -> learning. 
   IMPORTANT backward-compat: keep the existing flat view-counter dict in fc_stats_<setId> working EXACTLY as today (cards mode reads getStats(id)["<idx>"] as a bare count). Store statuses in a SEPARATE localStorage key "fc_status_<setId>" as a flat dict card-index -> status string, e.g. {"0":"learning","1":"mastered"}. Add helper functions in store.js: getStatuses(setId), setCardStatus(setId, index, status), plus keep recordCardView untouched. This keeps counters and statuses together conceptually (both in the same fc_stats_ family / local storage) without breaking cards mode. If you prefer a different safe layout, explain it, but you MUST NOT change the existing counter semantics that cards mode and the view-badge rely on.
4. DIRECTION SWITCHER (en-ru / ru-en) works in BOTH Learn and Write modes (not only Test). For Learn it selects the question flavor (word->translation vs translation->word). For Write it chooses which side is the prompt (term) and which is the typed answer.
5. Mode switcher on /set/:id now shows: Карточки / Learn / Write / Тест (a common switcher). Style the two new buttons consistently with the existing mode buttons (you may reuse .mode-btn, add a small "K6" tag like the existing "K3" tag on Тест if you wish).

All data in localStorage. Statuses update live and persist across sessions. Handle empty-set gracefully (show the existing "В этом наборе нет карточек." placeholder). Keep the code clean and consistent with the existing style.

## Adaptive order for Learn
Sort the working queue so cards not yet mastered appear before mastered; among non-mastered, order by fewest view-count first (use getStats(id)[idx]) and prioritize learning-status cards (those with errors) ahead of not_studied. Keep a stable tiebreak by card index.

## Verification (MANDATORY, in a real browser with Playwright)
Write a Node .cjs script (like prior cards did) using playwright from node_modules. Steps:
1. Seed localStorage with a small set (e.g. 6 cards with word/translation) via page.addInitScript or by evaluating on the app (follow what makes localStorage persist on the origin).
2. Open http://127.0.0.1:5174/ and navigate into the set.
3. Exercise Learn mode: answer some correctly (2 in a row) and some wrong; confirm status flips to mastered/learning and the adaptive ordering + progress indicator + session-end "все освоено" state.
4. Exercise Write mode: type a correct answer (case-insensitive accepted) and a wrong one (correct highlighted), confirm "не помню" skip works, and both directions en-ru and ru-en.
5. Confirm the mode switcher shows all four modes and direction toggle works in Learn and Write.
6. Take screenshots fc_k6_learn.png and fc_k6_write.png in /home/aifactory/FlashCards/ and save them.
Run `npm run build` and confirm it passes (exit 0) BEFORE committing.

## Commit
When done and build passes and screenshots exist, `git add` and `git commit` on the current branch (main) with a clear message like "K6: learn (adaptive) and write (typed) modes + card statuses not_studied/learning/mastered". Do NOT push. Report the commit hash, the changed files, the screenshots' absolute paths, and what you verified.
