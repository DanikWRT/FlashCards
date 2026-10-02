You are working in the FlashCards React app at /home/aifactory/FlashCards (main branch). Implement feature K27 per the Russian tech spec below. WORK IN THE REAL FILES and COMMIT to main when done. Do NOT ask clarifying questions — use your best judgment. Keep every existing mode (Cards/Learn/Write/Тест(ExtendedTest)/Spell/Match/Blast) working — do not regress K12–K26.

FILES YOU MAY EDIT: src/pages/SetPage.jsx, src/styles.css (and only these, plus anything strictly necessary in src/). Do NOT touch backend/app.py, src/pages/MySets.jsx, src/store.js (other workers may be editing those).

Primary file: src/pages/SetPage.jsx (~2558 lines) and src/styles.css.

=== CONTEXT YOU MUST READ FIRST ===
- Read src/pages/SetPage.jsx lines 640-732 (MatchingQuestion), 860-1014 (StudyDirection, Learn), 1022-1109 (Write), 1150-1253 (Spell), 2031-2129 (global keydown handler), 2349-2415 (settings panel).
- Read src/styles.css lines 1358-1434 (match-board CSS).
- The global keydown at ~2043 has an `inField` guard: if focus is INPUT/TEXTAREA/contentEditable, global keys are ignored (in-field Enter already handled locally by Write/Spell onKeyDown).

=== PROBLEM A — MOVE STUDYDIRECTION + SHUFFLE FROM LEARN FIELD INTO SETTINGS PANEL ===
Currently in Learn (line ~976-982): study-toolbar contains <StudyDirection> + "🔀 Перемешать" button. Write and Spell don't have these in their field (Write has autoFocus on input).
- Remove the study-toolbar div containing StudyDirection + Перемешать from Learn's return (lines 978-982). Keep StudyProgress and the rest of Learn's layout.
- Add a direction toggle (en-ru / ru-en) and a shuffle button into the settings-panel (inside the "settings-panel-group" div, alongside priority/starred/autospeak/play/interval/shuffle/restart items).
- Challenge: `direction` state currently lives inside `useStudySession` (which is inside Learn/Write/Spell). The settings panel is in the parent SetPage. REQUIREMENT: lift `studyDirection` state to the SetPage parent component (create `const [studyDirection, setStudyDirection] = useState('en-ru')`). Pass `studyDirection` + `setStudyDirection` into Learn and Write. Change `useStudySession(set, id)` to accept `(set, id, direction, setDirection)` and use the passed direction/setDirection instead of its own `useState('en-ru')`. This keeps a single source of truth in SetPage that the settings panel can bind to.
- The settings-panel shuffle button (`settings-shuffle`, line 2404): currently shuffles the cards pass order. When in Learn/Write/Spell modes, it should shuffle the study queue instead. Implement via a registry pattern: a module-level `studyRegistry = { shuffleNow: null }`. Each of Learn/Write/Spell registers its `s.shuffleNow` into the registry on mount via useEffect. The settings shuffle button calls `studyRegistry.shuffleNow?.()` when a study session is active; otherwise it calls the existing cards-pass shuffle. Register registry in the same useEffect as answerRegistry (so it's cleaned up on unmount).
- Write already uses StudyDirection in its toolbar? Check — Write at line 1061 has `<StudyDirection>`. Remove StudyDirection from Write's study-toolbar too (Write's toolbar is just StudyDirection + StudyProgress + quiz-card). Keep autoFocus on the input (it already has it).
- Settings-panel direction toggle: show it when mode is learn or write. Bind to `studyDirection`.

=== PROBLEM B — ENTER FOR "ДАЛЕЕ" IN ALL MODES ===
Requirement: Enter activates "Далее"/"Проверить пары"/continue when feedback is shown and no text field has focus (in-field Enter already handled locally by Write/Spell onKeyDown — do NOT override those).
- Add an `advanceRegistry = { handler: null }` module-level ref (same style as answerRegistry/matchRegistry at lines 21-22).
- Each mode that renders a "Далее"/"Проверить пары" button when feedback is shown must register its advance handler via useEffect:
  - Learn: register `next` when phase==='feedback'
  - Write: register `next` when phase==='feedback' (note: Write already has local Enter→next in feedback in onKey, but the GLOBAL Enter outside the field must also work — add registration)
  - Spell: same (register `next` when feedback)
  - Test (ExtendedTest): register `next` when feedback is shown (line 516-520 has <button quiz-next onClick={next}>)
  - Match (the matching game, not test): no next button shown (check Match component — search for next button). Only the Test's MatchingQuestion has "Проверить пары" → register that handler when pairs complete and feedback not shown? No — "Проверить пары" is the check button (line 721-723). Enter should trigger it when all pairs made and no feedback. Register `check` when !feedback && leftAllPaired.
  - Cards mode: "Далее" button at line 1686 → register its advance handler when feedback shown.
- In the global keydown handler (line 2043-2127), add: `if (e.key === 'Enter' && !inField && advanceRegistry.handler) { e.preventDefault(); advanceRegistry.handler(); return; }`. This must come AFTER the inField guard so it only fires outside text fields.
- Do NOT break: digits 1..N, A/S/P/F, arrow keys, Escape — keep their logic untouched.

=== PROBLEM C — MATCHING RENDER IN TWO COLUMNS EN|RU ===
The MatchingQuestion component (line 675) renders `q.left.map(...)` then `q.right.map(...)` as a flat sequence inside `.match-board`. CSS `.match-board` is already `display: grid; grid-template-columns: 1fr 1fr;` — so items flow L1 L2 | L3 R1 | R2 R3... (left items fill column 1 then wrap). Requirement: STRICTLY two columns — left column = ALL left items (EN terms when en-ru), right column = ALL right items (RU translations).
- Fix the JSX: wrap left items in a `<div className="match-col">` and right items in a `<div className="match-col">` inside `.match-board`. Each `.match-col` uses `display:flex; flex-direction:column; gap:10px`.
- CSS: add `.match-col { display: flex; flex-direction: column; gap: 10px; }`.
- Verify `buildQuestion` left/right semantics: for en-ru, left=word(EN), right=translation(RU) — confirmed correct. For ru-en, left=translation(RU), right=word(EN) — symmetric. No change needed to buildQuestion.

=== PROBLEM D — AUTOFOCUS INPUT ON NEW QUESTION ===
Requirement: when a new question appears, cursor goes straight into the input field. Currently autoFocus only fires on initial mount; it does NOT re-trigger when the question changes (same component instance, input value just resets).
- For TypedQuestion (Test, line 564-610): add `const inputRef = useRef(null); useEffect(() => { if (!feedback && inputRef.current) inputRef.current.focus(); }, [q.cardIndex, feedback]);` and `<input ref={inputRef} .../>`. The key is the question cardIndex — when a new question mounts/updates, focus fires.
- For Write (line 1022): the input already has autoFocus. Add the same ref+useEffect pattern keyed on `s.idx` (new question index) to re-focus after advance: `useEffect(() => { if (phase !== 'feedback' && inputRef.current) inputRef.current.focus(); }, [s.idx]);`. Actually Write advances via `next()` which resets phase to 'question' and sets input=''. The inputRef focus should fire when phase transitions to 'question'. Use `useEffect(() => { if (phase === 'question' && !feedback) inputRef.current?.focus(); }, [phase]);`.
- For Spell (line 1150): same pattern — ref + useEffect keyed on phase === 'question'.
- For Learn: Learn uses multiple-choice buttons (not typed input), so no autofocus needed (K23 digits handle it).

=== REQUIREMENT 5 — DO NOT BREAK K18–K26 ===
Run `npm run build`; it must exit 0. Verify no regressions in the other modes.

=== DELIVERABLES ===
- Implement all of A/B/C/D in src/pages/SetPage.jsx and src/styles.css.
- Run `npm run build`; it must exit 0. Report the exit code.
- Screenshots (use Playwright against the running app, or skip if browser unavailable; name exactly):
    fc_k27_learn_clean.png   (Learn mode: no StudyDirection/Перемешать in the field, only StudyProgress + question)
    fc_k27_match_columns.png  (Matching in Test: two clean columns EN|RU)
    fc_k27_focus.png          (TypedQuestion in Test: cursor in input field)
  Save in /home/aifactory/FlashCards/.
- COMMIT to main with message "K27: move direction+shuffle to settings, Enter for Далее, matching columns, autofocus"
- Write a short REPORT to /home/aifactory/FlashCards/k27_report.md summarizing what you changed per point (A/B/C/D), build result, screenshots captured, and verification done. Print the report contents at the end.

Start by reading the file sections listed above, then implement. GO.