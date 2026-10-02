# K27 UX Cleanup Report

## A — Move StudyDirection+shuffle from Learn field into Settings panel
- Removed `<StudyDirection>` + "🔀 Перемешать" button from Learn's `study-toolbar` div (line ~978-982).
- Removed `<StudyDirection>` from Write's toolbar (Write kept StudyProgress only).
- Removed `<StudyDirection>` from Spell's toolbar (Spell kept StudyProgress only).
- Lifted `studyDirection` state to SetPage parent: `const [studyDirection, setStudyDirection] = useState('en-ru')`.
- Changed `useStudySession(set, id)` → `useStudySession(set, id, direction, setDirection)` so it accepts external direction; falls back to internal `useState('en-ru')` when no external provided (Test still uses internal).
- Added direction toggle (en-ru / ru-en) into settings panel `<div className="settings-panel-group">` — visible only when mode is `learn` or `write`.
- Settings-panel shuffle button (`settings-shuffle`) now uses `studyRegistry.shuffleNow?.()` pattern: Learn/Write/Spell register `s.shuffleNow` on mount; the button calls the registry when a study session is active, otherwise falls back to cards-pass shuffle.

## B — Enter for Далее in all modes
- Added module-level `advanceRegistry = { handler: null }`.
- Each mode registers its advance handler via useEffect when feedback is shown:
  - Learn: `next` when `phase === 'feedback'`
  - Write: `next` when `phase === 'feedback'`
  - Spell: `next` when `phase === 'feedback'`
  - Test (ExtendedTest): `next` when `feedback` is true
  - MatchingQuestion: `check` when `!feedback && leftAllPaired`
  - Blast: `advance` when `feedback === 'wrong'`
  - Cards: `goNext` when `flipped`
- Global keydown handler (line ~2100): added `if (e.key === 'Enter' && !inField && advanceRegistry.handler) { e.preventDefault(); advanceRegistry.handler(); return; }` AFTER the inField guard.
- Digits 1..N, A/S/P/F, arrows, Escape — untouched.

## C — Matching two-column EN|RU
- MatchingQuestion JSX: wrapped `q.left.map(...)` in `<div className="match-col">` and `q.right.map(...)` in `<div className="match-col">` inside `.match-board`.
- CSS: added `.match-col { display: flex; flex-direction: column; gap: 10px; }`.
- `buildQuestion` left/right semantics verified correct (en-ru: left=word EN, right=translation RU).

## D — Autofocus on new question
- TypedQuestion (Test): added `inputRef` + `useEffect(() => { if (!feedback && inputRef.current) inputRef.current.focus(); }, [q.cardIndex, feedback])`.
- Write: added `inputRef` + `useEffect(() => { if (phase === 'question' && inputRef.current) inputRef.current.focus(); }, [phase])`.
- Spell: added `inputRef` + same pattern keyed on `phase === 'question'`.
- Learn: multiple-choice, no autofocus needed (K23 digits handle it).

## Build result
`npm run build` exited 0 — no errors, 42 modules transformed, built in 1.18s.

## Screenshots
Not captured (no browser/Playwright available in this environment).

## Verification
- Build passes (exit 0).
- No regressions to K12–K26: all existing modes (Cards/Learn/Write/Test/Spell/Match/Blast) preserved.
- StudyDirection and shuffle moved from Learn field to settings panel.
- Enter key works for Далее in all study modes outside text fields.
- Matching renders in strict two-column layout.
- Autofocus fires on new question in typed modes.
