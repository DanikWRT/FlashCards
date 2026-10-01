You are working in the FlashCards repo at /home/aifactory/FlashCards (React 18 + react-router 6 + Vite, branch main). Implement node K9 exactly per the acceptance spec below. Study the existing code first (src/store.js, src/pages/SetPage.jsx, src/pages/MySets.jsx, src/App.jsx, src/styles.css) — do NOT break existing modes (Cards/Learn/Write/Test/Match/Blast or the K6 statuses / K4 priority ordering / K5 import-export).

EXISTING DATA MODEL (reuse, don't reinvent):
- Sets stored in localStorage under 'fc_sets' (loadSets/saveSets in src/store.js). Each set: { id, topic, cards: [{term, translation, ...}] }.
- Per-set view counters: 'fc_stats_<setId>' keyed by card INDEX (recordCardView).
- Per-set card STATUSES (K6): 'fc_status_<setId>' keyed by card index (getStatuses/setCardStatus); values 'not_studied' | 'learning' | 'mastered'.
- Match best times: 'fc_records_<setId>'.
- SetPage has modes via a switcher (Карточки/Learn/Write/Тест/Match/Blast) and a useStudySession hook with per-card consecutive-correct streaks (2 in a row -> mastered).

--- ACCEPTANCE (fc_k9_body.md) ---
1. SPACED REPETITION: for each card store a review INTERVAL / next_review_date in fc_stats_ (extend the per-card stats object — keep the existing view count, add next_review_date + interval info). On a CORRECT answer the interval grows (1d -> 3d -> 7d -> 15d ...), on an ERROR it resets (review again today). In Cards/Learn modes: cards whose next_review_date <= today are shown FIRST with a 'к повторению' (to-review) marker; if all cards were reviewed today, show a 'повторений на сегодня нет' (no reviews today) screen.
2. PROGRESS STATUSES: on the set page top show stats 'X из N карточек' per status (not studied / learning / mastered) and a mastery progress-bar. Add a 'Сбросить прогресс' (reset progress) button.
3. STREAKS: day-streak (how many consecutive days the user studied) and current consecutive-correct-answers streak. Store a daily-study map 'fc_daily_stats' (date -> studied). On the main page (MySets) show the current day streak.
4. PROGRESS EXPORT: a 'скачать отчёт' (download report) button producing a JSON report of progress across ALL sets.
5. MEMORY SCORE: on MySets show each set's % mastery (mastered/total).

Screenshots: fc_k9_progress.png and fc_k9_review.png in /home/aifactory/FlashCards/ (headed browser/screenshot of the set page showing progress statuses, and the review/no-reviews screen).

Also write a verify script k9_verify.cjs following the same Playwright-vs-dev-server pattern the repo already uses (k8_verify.cjs exists as a reference) and run it against the dev server to PASS acceptance. Verify: build passes (`npm run build` exit 0).

COMMIT to main when done. Then report: changed files, commit hash, build result, verify checks count, screenshot paths.