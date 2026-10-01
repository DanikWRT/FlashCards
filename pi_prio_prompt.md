# FlashCards PRIORITY : shared server-side set storage (backend python + SQLite, frontend off localStorage)

Project: /home/aifactory/FlashCards (React + Vite SPA, UI is RUSSIAN — keep Russian copy; do NOT change existing UI text unnecessarily).
Branch main is at commit 8d5d9c5 (K11). Use the working tree directly; build with `npm run build`; commit to main when done.

GOAL (user, PRIORITY demo to colleagues): today sets live in the browser localStorage key "fc_sets" (src/store.js) — only the browser that imported JSON sees them. Make sets SHARED on the server so EVERY visitor of the resource sees the same sets. Add a python3 stdlib-only backend serving BOTH static dist/ AND a REST API backed by SQLite. Then rewire the frontend to read/write sets via the API with a localStorage fallback/cache when the server is unreachable.

## 1. Backend — /home/aifactory/FlashCards/backend/app.py (python3 STDLIB ONLY, http.server + sqlite3)
- NO external dependencies whatsoever. One process serves BOTH static dist/ AND the REST API. Port 5199, host 0.0.0.0. Must be runnable the same way as the old serve.py: `python3 backend/app.py` (binary-compatible for prod on Astra; stdlib-only so no pip).
- API endpoints:
  - GET  /api/sets        -> JSON array of ALL sets: [{id, topic, lesson_meta, cards}, ...] (strip created from the payload; keep the shape the frontend already uses: id, topic, lesson_meta, cards)
  - GET  /api/sets/{id}   -> single set object
  - POST /api/sets        -> create; body is JSON object {topic, lesson_meta, cards}; returns {id, ok:true}; server assigns the id (use uuid.uuid4().hex or str(uuid4()))
  - PUT  /api/sets/{id}   -> update; body is JSON object {topic, lesson_meta, cards}; returns {id, ok:true}
  - DELETE /api/sets/{id} -> delete; returns {ok:true}
  - ANY other path        -> static file from dist/ (serve the file verbatim with correct Content-Type by extension), else index.html (SPA fallback). Also handle "/" -> index.html.
- SQLite storage: table `sets (id TEXT PRIMARY KEY, json TEXT, created TEXT)`. CREATE TABLE IF NOT EXISTS at startup. One row per set: id, the whole set object as JSON text (including id/topic/lesson_meta/cards), created timestamp. On GET parse the JSON back and return the object.
  - DB file path: use `DB_PATH = os.environ.get("FC_DB_PATH") or "/home/dpogodin/flashcards/fc.db"`. Create the parent directory with os.makedirs(..., exist_ok=True) at startup if missing. (NOTE: on this dev VM /home/dpogodin does not exist and is not writable by the aifactory user — that is WHY the default stays in code for prod compatibility but verification must run with FC_DB_PATH pointed at a writable temp path, e.g. /tmp/fc.db. Keep this default override mechanism in the shipped code.)
- Handle JSON request bodies for POST/PUT (Content-Length + json.loads). Return proper JSON Content-Type. Return 404 for unknown /api/sets/{id}. Return 405/400 for malformed as appropriate. Keep it simple but correct.
- Ensure the connection is per-request (open sqlite3.connect inside each handler) so it's thread-safe under http.server's ThreadingHTTPServer.

## 2. Frontend — src/store.js + screens: read/write sets VIA the API, localStorage fallback
- Add API helpers using fetch to the SAME base URL as the page (relative "/api/sets..."); the dev proxy + prod static same-origin both work:
  - apiListSets(), apiGetSet(id), apiCreateSet(obj), apiUpdateSet(id, obj), apiDeleteSet(id)
- Keep the existing localStorage behavior as a resilient fallback/cache and to avoid breaking K1-K11:
  - On app start (and on MySets load), fetch GET /api/sets. On SUCCESS: replace the in-memory/localStorage set list with the server's sets (server becomes source of truth). On FAILURE (server unreachable): fall back to localStorage "fc_sets" exactly as today, so dev-without-backend still works.
  - Creating a set -> POST to server; on success also cache it locally (so it shows even before a reload); on server failure fall back to today's localStorage addSet.
  - Updating a set -> PUT to server (fallback to localStorage).
  - Deleting a set -> DELETE to server (fallback to localStorage removeSet).
  - Keep the set object shape identical ({id, topic, lesson_meta, cards}) so MySets/ImportPage/SetPage/leaderboards/status/stats all work unchanged.
- IMPORTANT NOT TO BREAK: MySets / ImportPage / SetPage and ALL existing study modes. Personal study progress (fc_stats_*, fc_status_*, fc_records_*, fc_blast_*, fc_daily_stats, streaks, star/SRS maps) stays LOCALSTORAGE ONLY — shared changes apply ONLY to the SETS (the cards). Do not move progress to the server.

## 3. Dev proxy — vite.config.js
- The K11 express AI proxy listens on :5198 and handles POST /api/ai. The new python backend listens on :5199. Do NOT break /api/ai.
- Configure the vite server proxy so the frontend on :5174 sees BOTH without CORS:
  - "/api/sets" -> "http://localhost:5199"  (the new python storage backend)
  - "/api/ai"   -> "http://localhost:5198"  (keep K11 AI proxy working)
  - Keep port 5174, strictPort true.

## 4. Do NOT move personal progress to server
- Only SETS (cards) become shared. Everything under fc_* per-user progress stays in localStorage. Re-read src/store.js to confirm which are sets vs progress.

## Verification (run these against /home/aifactory/FlashCards, backend started with FC_DB_PATH=/tmp/fc.db so it runs on this VM):
1. `python3 -c "import ast;ast.parse(open('backend/app.py').read())"` — syntax OK (write it as a probe, don't run inline if flagged).
2. Start backend in background: `FC_DB_PATH=/tmp/fc.db python3 backend/app.py` (port 5199). Health: GET http://localhost:5199/ -> index or ok payload; GET an api route.
3. POST /api/sets with a small JSON set {topic:"Демо", lesson_meta:{}, cards:[{word:"apple",translation:"яблоко"},{word:"cat",translation:"кот"}]} -> returns {id, ok:true}.
4. GET /api/sets -> list contains that set's id and topic; GET /api/sets/{id} returns the full object.
5. PUT /api/sets/{id} with changed topic -> GET reflects it. DELETE /api/sets/{id} -> GET /api/sets no longer contains it; GET /api/sets/{id} -> 404.
6. Static: with dist/ built (run `npm run build` first), GET http://localhost:5199/ serves index.html; a non-API path returns SPA fallback.
7. Frontend via dev: start vite dev (port 5174), proxy "/api/sets" -> backend so GET /api/sets on 5174 returns the server list (no CORS error). Add a set through ImportPage flow if practical; confirm it appears in MySets.
8. `npm run build` exits 0.
9. Test the LOCALSTORAGE FALLBACK: with the backend STOPPED, the frontend still loads and shows the localStorage cached sets (no crash). Restart backend afterwards.
10. Screenshots: fc_prio_api.png (MySets showing a server-backed set, or the API response) and fc_prio_storage.png — save into /home/aifactory/FlashCards/.
11. Write a small verify script /home/aifactory/FlashCards/prio_verify.cjs (node) OR prio_verify.sh that exercises the API CRUD end-to-end against the running backend and prints PASS/FAIL per check, exiting 0 only when all pass. Re-run it to confirm green.
12. COMMIT to main: `git add -A && git commit`. Commit message like "PRIO: shared server storage for sets (python3 backend + SQLite, frontend via /api/sets with localStorage fallback)". Push only if asked; leave committed on main.

Report final output: list changed/new files, the backend+verify results, the screenshot paths, and the commit hash.
