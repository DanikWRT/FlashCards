FlashCards K18: split "Мои наборы" (My sets) vs "Общие наборы" (Common sets) with author tracking and bookmark/add-to-self + view buttons on the home page (MySets).

PROJECT: /home/aifactory/FlashCards. Vite + React frontend in src/, python3 STDLIB-ONLY backend in backend/app.py. Auth already exists (K13): backend tables fc_users + fc_sessions, Bearer token auth via GET /api/me, frontend auth in src/auth.jsx (AuthProvider exposes token, username, isLoggedIn via useAuth()).

REQUIREMENTS (must read the existing files first — do NOT guess their shape):

1. BACKEND (backend/app.py):
   - Add an `author` field to every set object. The sets table is `CREATE TABLE IF NOT EXISTS sets (id TEXT PRIMARY KEY, json TEXT, created TEXT)`. The authoritative set object is stored inside the `json` column — add `author` into the JSON object(s) you return, and add it to the `sets` table schema too (ALTER TABLE / add column alongside the CREATE, in a backward-compatible way — e.g. CREATE TABLE ... author TEXT, and for existing DBs handle the migration so old rows still work).
   - In POST /api/sets set author = current username (from Bearer token via the existing `_acting_user()` helper); for anonymous (no token) author = "guest". Include `author` in the GET /api/sets objects AND GET /api/sets/{id} object (use the `_clean()` shaped object with an author field). Old sets without author -> author null.
   - Add table `fc_my_sets (username TEXT, set_id TEXT, added TEXT)` — which sets a user added to themselves / created.
   - When a set is created, the author automatically also appears in his own fc_my_sets.
   - New endpoints:
     * POST   /api/sets/{id}/bookmark  (Bearer) -> add set {id} to the user's own list (fc_my_sets). Returns {ok:true}. 401 if not authenticated.
     * DELETE /api/sets/{id}/bookmark (Bearer) -> remove from user's list. Returns {ok:true}. 401 if not authenticated.
     * GET    /api/my/sets (Bearer) -> list the ids (or full objects) of sets the user owns+bookmarked (from fc_my_sets). 401 if not authenticated.
     * GET    /api/sets stays the list of ALL sets, now with author field.
   - Handle the new routes carefully relative to the existing `/api/sets/{id}` GET/PUT/DELETE matching (the `_set_id()` helper strips the `/api/sets/` prefix — route `/api/sets/{id}/bookmark` and `/api/my/sets` distinctly, in the right order, before the generic `/api/sets/` handler).
   - Keep everything STDLIB-ONLY (http.server + sqlite3). Backward compatible: old sets without author -> author null.

2. FRONTEND STORE (src/store.js):
   - The `http()` helper currently only sends Content-Type/Accept. Add helpers to send the Bearer token (read token from localStorage key 'fc_token') for authenticated calls, e.g. `apiBookmarkSet(id)`, `apiUnbookmarkSet(id)`, `apiMySets()`. Make `http()` optionally attach `Authorization: Bearer <token>` when a token is stored.
   - Add exported functions the UI can call: `bookmarkSetShared(id)`, `unbookmarkSetShared(id)`, `loadMySetIds()` (returns list of set ids the current user has), returning data from the API with graceful fallback.
   - `syncSetsFromServer()` already pulls all sets into localStorage (author will now come along as a field on each set).

3. FRONTEND UI (src/pages/MySets.jsx):
   - Use `useAuth()` to get the current username/isLoggedIn.
   - On the home page add TWO sections/tabs: "Мои наборы" and "Общие наборы". Recommend using tab state (useState, e.g. 'mine' | 'all') with two tab buttons, and the set grid below shows the appropriate sets.
     * "Мои наборы": sets whose id is in the current user's my-sets list (author === username OR bookmarked). If the user is not logged in, show a hint that they should log in to see their sets.
     * "Общие наборы": ALL sets (the full list).
   - Set card in each grid must show НАЗВАНИЕ (topic) and АВТОР ("Автор: <username>"; if null show "Автор: —" or similar).
   - On each set card:
     * If set NOT in my sets -> button "Добавить к себе" (calls bookmarkSetShared then refresh).
     * If set IS in my sets -> button "Убрать" (calls unbookmarkSetShared then refresh).
     * Always a common button "Посмотреть" (link to /set/:id).
     * The existing ✕ delete button and the set-card-main Link can stay but make sure the new author line + bookmark/view buttons render properly on the card.
   - Keep existing folders/classes/leaderboard sections and the /set/:id view WORKING (do not break them). Do not break the other modes.
   - Add minimal CSS for the tabs and the new card buttons (src/styles.css) consistent with existing .btn / .set-card styles.

4. Verify: `npm run build` exits 0.

OUTPUT: After implementing, run `npm run build` and confirm exit 0. Do NOT commit. Print a concise summary of what changed in each file (backend/app.py, src/store.js, src/pages/MySets.jsx, src/styles.css) and the build result.
