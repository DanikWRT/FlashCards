You are implementing FlashCards K22: add cards to an EXISTING set (not create a new one) + recompute achievements/progress.

REPO: /home/aifactory/FlashCards (React + Vite frontend in src/, python3 stdlib backend in backend/app.py). Backend serves a JSON API over SQLite (sets table stores full set JSON; personal study progress lives in the browser's localStorage, NOT on the server).

CONTEXT you must respect:
- Backend is python3 STDLIB ONLY (http.server + sqlite3). Do NOT add dependencies. MIMIC the API style of the existing endpoints in backend/app.py.
- Sets are shared server-side. Each set row stores its full JSON in the sqlite `sets.json` column; GET /api/sets/{id} returns `_clean(obj, sid)` shape {id, topic, lesson_meta, cards, author}. POST /api/sets creates; PUT /api/sets/{id} updates.
- Auth: Bearer token via _acting_user() (None if not logged in). _is_admin(username) exists (admin = user 'Danya' or role 'admin'). Existing DELETE /api/sets/{id} already gates: anon->401, admin->any set, non-admin->own author only else 403. Mirror that EXACT authorization pattern for the new endpoint.
- Frontend data layer: src/store.js. Server-backed helpers: http(url,options) attaches Bearer from localStorage 'fc_token'; apiCreateSet/apiUpdateSet/apiDeleteSet wrap REST; addSetShared/updateSetShared/deleteSetShared do server-first with localStorage fallback and update the local cache (loadSets/saveSets over 'fc_sets'). Personal progress (fc_stats_<prefix><setId> view counts, fc_status_<prefix><setId> statuses keyed by card index string) is LOCALSTORAGE ONLY and managed by getStats/getStatuses/setCardStatus (see store.js). getSet(id) reads from the local cache.
- SetPage.jsx: `const [set] = useState(() => getSet(id))` loads the set from local cache at mount. Progress overview (ProgressOverview component, data-testid k9-progress) recomputes from getStatuses(id) over set.cards.length — it's ALREADY dynamic: mastered/learning/notStudied are counted by iterating 0..n-1 reading statuses[i]||'not_studied'. So appended cards with NO stored status naturally count as 'not_studied' and recompute automatically. Memory-score / % освоения / progress bar all derive from this same count, so they recompute automatically once the set's cards array grows and any per-user stats/statuses are initialized for the new indices.

THE FEATURE (4 parts):

PART 1 — Backend endpoint (backend/app.py):
Add POST /api/sets/{id}/cards (requires a valid Bearer session):
- Body: {"cards": [ {word, translation, examples?, family?}, ... ]} — non-empty array.
- Authorization EXACTLY like DELETE: anonymous -> 401 "unauthorized"; set not found -> 404; logged-in non-author non-admin -> 403 "forbidden: only the author or admin can add cards to this set"; admin or the set's author allowed.
- Load existing set JSON, append the new cards to its `cards` array (deduplicate by lowercased `word` against existing words AND within the incoming batch — keep first occurrence, skip duplicates). Preserve the existing object's topic/lesson_meta/author exactly. Write back to the same row (UPDATE sets SET json=?). Return {"id": sid, "added": <number of cards actually added>, "cards": <new total count>, "ok": true}. Update the module docstring endpoint list.
- Validate: body must be a dict with a non-empty list `cards`; each card needs a non-empty string `word` and `translation`. Bad body -> 400.

PART 2 — store.js helpers:
Add `apiAddCards(id, cards)` -> POST to API_BASE + '/' + id + '/cards' with {cards}.
Add `addCardsShared(id, cards)` in the style of addSetShared/updateSetShared: call apiAddCards; on success fetch the updated set via apiGetSet and refresh the local cache (loadSets/saveSets map). On a real server HTTP error that is NOT a network error (status 401/403/404), RE-THROW so the caller can surface it and does NOT corrupt the local cache. Return the updated set object.

PART 3 — Recompute progress when cards are added (store.js):
Add `initNewCardProgress(setId, oldCount, addedCount)` that, for the freshly appended card indices (oldCount .. oldCount+addedCount-1), ensures each new index: has a status of 'not_studied' and an SRS entry with nextReview = today (so a brand-new card is due now). The cleanest least-invasive approach given existing code: call setCardStatus(setId, idx, 'not_studied') and applySrsAnswer(setId, idx, false) (writes interval 0 + nextReview=today) for each new index, OR write statuses/stats maps directly. Old card indices (existing statuses/stats) MUST be left untouched. Export a helper the UI can call. IMPORTANT: OPEN store.js and read the REAL exported function names (getCardSRS / applySrsAnswer / todayStr / setCardStatus / resetSetProgress) before writing — match them exactly.

PART 4 — Frontend UI (SetPage.jsx + optionally ImportPage.jsx):
On the set page (/set/:id), in the set sidebar under the share button (near line ~1943), add a "+ Добавить карточки" button (btn btn-outline, data-testid="add-cards-btn") that opens an inline collapsible import form (reuse the same JSON parse/validate spirit as ImportPage's parseAndValidate: accepts a JSON object with a `cards` array {word, translation, examples?, family?}). The form has a textarea + an "Добавить" submit button + a cancel. On submit: parse -> call addCardsShared(id, parsed.cards) -> call initNewCardProgress for the newly added count -> refresh the page so the new cards show at the end and progress recomputes. Show success "Добавлено N карточек в набор" or the error from a thrown 401/403/404 (e.g. "Войдите, чтобы добавить карточки" / "Только автор или админ может добавлять карточки").
- The SetPage currently loads set via useState(() => getSet(id)) — to refresh after add you must trigger a re-read. Add a minimal reload mechanism: e.g. a `ver` state and a refresh() that re-reads getSet(id) after addCardsShared, then resets mode to 'cards', order, pos so the new cards and recomputed progress are visible. Make whatever minimal change needed so the UI reflects the new card count + progress.
- Guests: the button may show but the add must fail with the 401 message if not logged in (let the backend 401 surface as the error message).
- ImportPage "Добавить в выбранный набор" mode is OPTIONAL — the set-page button satisfies requirement 1/4. Prefer the simplest reliable path.

VERIFY (must actually run, do not fake):
1. Backend test: start backend on a temp DB (FC_DB_PATH=/tmp/fc_k22.db python3 backend/app.py, port 5199). Register user A and admin Danya (POST /api/auth/register), create a set as A, then:
   - unauth POST /api/sets/{id}/cards -> 401
   - user B POST to A's set -> 403
   - A POST with 2 new cards -> 200, cards count grows, GET /api/sets/{id} shows them appended; dedup: adding an existing word is skipped (added counts only the new ones)
   - admin Danya POST -> 200
   Write this as a standalone python script (backend stdlib + urllib) and run it; report PASS/FAIL per case.
2. Frontend build: `npm run build` must exit 0.
3. UI check via a playwright .cjs (node) script run from the FlashCards root: start backend (FC_DB_PATH=/tmp/fc_k22_ui.db) + vite dev (BE_PORT=5199 node_modules/.bin/vite --port 5174 or similar), register a user, create a set, open /set/:id, click "+ Добавить карточки", paste JSON with 2 new cards, submit, and assert the page shows the increased card count and the progress overview counts the new ones as not_studied while an old status stays. Report PASS/FAIL + 0 console errors.
4. Screenshot fc_k22_add.png in /home/aifactory/FlashCards/.

Then COMMIT to main and PUSH to origin/main with a clear commit message ("K22: add cards to existing set + recompute achievements (...)"); list changed files in the commit body.

Constraints:
- python3 STDLIB ONLY in backend. No new npm deps.
- Match existing code style (Cyrillic UI strings, existing CSS classes btn btn-outline/btn-primary, data-testid conventions).
- Do not break K19 auth gating or K21 delete permissions.
- Keep your own chat output tiny; write the real artifact (code + test + screenshot + prompts) to disk.
- Reply with a concise final summary: changed files, each backend case PASS/FAIL, build exit code, commit hash, screenshot path. Do not paste large code blocks.
