TASK: FlashCards K12 - answer normalization variants. Implement in this Vite/React repo at /home/aifactory/FlashCards (branch main). Do NOT run the dev build; just edit source and run `npm run build` to verify compilation. Commit to main when done and verified.

PROBLEM: Cards contain terms like "Foot / Feet", "Knee / Knees" (singular/plural via /) and Russian translations with explanations in parentheses: "губы (ед. ч. lip)", "бедро (таз), хип", "палец ноги / пальцы ног". Currently in typed-answer modes (Write, Spell, Test typed input / Test-ввод) the user must type ALL variants exactly with / and parentheses, or the answer is marked wrong.

GOAL: An answer counts as CORRECT if the user typed ANY ONE of the acceptable variants of the expected answer (not the whole string).

REQUIREMENTS (applies wherever an answer is checked - Write, Spell, Test typed input, Learn):
1. Provide a shared normalization utility in a NEW file src/normalize.js that, given the EXPECTED answer string, extracts ALL alternative variants by:
   - split on "/" -> each part is a variant
   - remove parentheses "(...)" content (it's an explanation, not a variant)
   - split on "," (comma, as in "бедро (таз), хип") -> each part is a variant
   - trim whitespace, lowercase (case-insensitive), collapse extra/double spaces
2. User's answer is CORRECT if (after trim/lowercase) it equals AT LEAST ONE of the extracted variants OR the expected answer as a whole.
3. Examples that MUST pass:
   - expected "Foot / Feet" -> input "foot" or "feet" or "Foot" is CORRECT
   - expected "Kneel" -> input "kneel" is CORRECT
   - expected "губы (ед. ч. lip)" -> input "губы" is CORRECT (variant from the term; "губа" is WRONG)
   - expected "бедро (таз), хип" -> input "бедро" or "хип" or "таз" is CORRECT (all comma-listed)
   - expected "палец ноги / пальцы ног" -> input "палец ноги" or "пальцы ног" is CORRECT
4. Do NOT break normal single terms ("Body" -> "body" correct).
5. Use the utility in ALL answer-checking places - do NOT duplicate the logic via copy-paste.

WHERE TO EDIT (all in /home/aifactory/FlashCards/src/pages/SetPage.jsx):
- Create src/normalize.js exporting something like `matchAnswer(given, expected)` (returns boolean) and/or `answerVariants(expected)` (returns array of variants). Recommend importing it into SetPage.jsx.
- Write.submit (around line 961-962): currently `const answer = (given === undefined ? input : given).trim().toLowerCase(); const isCorrect = answer === correct.trim().toLowerCase()`. Replace the correctness check with the utility.
- Spell.submit (around line 1096-1097): same pattern, replace.
- TypedQuestion (around line 502-503, the ExtendedTest typed input): same pattern, replace. Line 537-538 uses the same comparison for the feedback class - use the util there too for consistency so feedback shows correct when it should.
- Learn is multiple-choice (choose by clicking, compare `val === correct` at line 881, 924, 925): the choices come from makeChoices/answerOf so clicking the exact choice already matches by string. For Learn, the user clicks a rendered option (the full variant string), so no change strictly needed - but if the correct answer displayed to the user is a combined string like "Foot / Feet", clicking it is the only option presented, so it works. Verify Learn still works; only change Learn if needed for correctness. (No typed input in Learn, so likely no change - but confirm.)

IMPORTANT parse order detail: parentheses must be removed BEFORE splitting on commas, and after removing parentheses a comma may remain (e.g. "бедро (таз), хип" -> remove (таз) -> "бедро , хип" -> split on comma -> ["бедро ", " хип"] -> trim -> ["бедро","хип"]). Handle the case where the variant list has only one non-empty entry (e.g. "Kneel" -> ["kneel"]). Also dedupe variants. Collapse multiple spaces.

ALSO: for the "Не помню"/"Don't know" button in Write (submit('') at line 1016) - empty string should remain WRONG (it's a skip), so make sure matchAnswer('') returns false when expected is non-empty.

VERIFY:
- Write a small node test file (e.g. k12_verify.cjs) in the repo that imports/requires src/normalize.js (it's ESM in a Vite project - if needed write the check standalone or use a .mjs and import it) and asserts all the example cases in requirement 3, plus that "Body"->"body" passes and empty string is wrong. Run it and confirm all PASS.
- Run `npm run build` and confirm exit 0.
- Take a screenshot demonstrating: in Write mode with expected "Foot / Feet", user types "feet" and it's counted correct. Save as fc_k12_answer.png in /home/aifactory/FlashCards/. (Use the dev server if available; if not possible headlessly, at least include the node verify output in your report. A real screenshot is preferred - a dev server may already be running on :5174 per prior work. Use a browser automation tool if available in Pi's environment, otherwise note that the screenshot couldn't be taken.)
- Commit to main with a message like "K12: answer normalization - accept any variant word" and report the commit hash.

REPORT BACK: commit hash, files changed, the test output (k12_verify.cjs PASS), npm run build result, and whether the screenshot fc_k12_answer.png was produced.
