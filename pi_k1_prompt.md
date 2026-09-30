You are building a new web app called "FlashCards" from scratch in the directory /home/aifactory/FlashCards (currently EMPTY - create everything).

TASK: K1 scaffold - Vite+React project with JSON-set import into localStorage and set pages.

CONCEPT: FlashCards is a Quizlet-like app for learning English via flashcards. Each JSON file is ONE SET (deck/lesson) of cards. The user imports a JSON and studies the set in different modes.

STACK (like PartsDonor): Vite + React 18 + react-router-dom 6 + @vitejs/plugin-react.

JSON SET SCHEMA (example at /home/aifactory/lesson_cards.json):
{
  "topic": "Название набора",
  "lesson_meta": { "song": "...", "grammar": [...] },
  "cards": [
    { "word": "словарное слово", "translation": "перевод",
      "examples": [ {"en":"пример EN","ru":"перевод RU"} ], "family": "родственные формы (необязательно)" }
  ]
}

K1 ACCEPTANCE (implement ALL of these):
1. Initialize a Vite+React project in /home/aifactory/FlashCards (name: flashcards, private). Start the vite dev server (default port 5173 or another free one; PartsDonor occupies 5173 - USE PORT 5174, configure server.port in vite.config).
2. Routes: "/" = My Sets page (list of imported sets from localStorage + "+ Import JSON" button), "/set/:id" = set page, "/sets/new" = import page.
3. JSON import: a form (textarea to paste text) + file input button. Parse, validate schema (cards[] with word and translation), save set to localStorage under key "fc_sets".
4. localStorage storage: fc_sets (array of sets), each set: id (uuid), topic, lesson_meta, cards[]. Load from localStorage on startup.
5. "/" page shows set-cards (topic + card count), click navigates to /set/:id.
6. Navigation: header with the name "FlashCards" and a "Мои наборы" link.
7. Demo set: place /home/aifactory/lesson_cards.json into the project as public/sample.json (for testing import).

STYLE: modern, light, clean (Quizlet-like). CSS in styles.css.

TECHNICAL NOTES:
- Use npm. npm is available (npm i works). Node v26 available.
- Use vite. The dev server MUST run on port 5174 (PartsDonor uses 5173).
- Use uuid generation (can use crypto.randomUUID(), no dep needed).
- Validation: reject JSON with no cards[] or cards lacking word/translation; show a clear error message.
- Must run the dev server and verify in a browser.

STEPS TO COMPLETE:
1. Create package.json (name flashcards, private), vite.config, index.html, and all source files.
2. Bootstrap the React app: main.jsx, App.jsx with react-router routes, a Layout with header nav, page components (MySets, SetPage, ImportPage), a store module for localStorage (fc_sets), styles.css.
3. Copy /home/aifactory/lesson_cards.json to public/sample.json.
4. npm install.
5. Start the vite dev server on port 5174 (background) and verify it responds (curl http://localhost:5174).
6. Verify in a real browser using Playwright: main page renders, import the sample JSON -> set appears, clicking opens the set page. Save a screenshot of the main page after import to /home/aifactory/FlashCards/fc_k1_main.png.
7. git init + commit all work on branch wt/k1.

Report back: the list of files created, the dev server port and status, and confirmation of each of the 7 acceptance criteria (especially the browser-verified import flow and the saved screenshot path). Do NOT report fabricated results - only what you actually verified.
