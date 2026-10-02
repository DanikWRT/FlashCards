// ---------- K13 per-user progress binding ----------
// When a user is logged in their personal study progress is stored under a
// <username>_ prefix (e.g. fc_stats_<username>_<setId>). When logged out the
// original unprefixed keys are used, preserving current behavior.

let progressUser = null

// Set the active username for progress key binding (null = logged out).
export function setProgressUser(username) {
  progressUser = username || null
}

function userPrefix() {
  return progressUser ? progressUser + '_' : ''
}

// K19: progress writes are strictly per-user. When nobody is logged in
// (progressUser === null) a guest may only VIEW cards — they must never
// accumulate any counters/statuses/records/streaks, because those would
// belong to no one. All progress reads return neutral and all writes are
// no-ops while logged out. Once a user logs in (setProgressUser(username))
// their prefixed keys start accumulating and persist across logout/login.
function progressEnabled() {
  return !!progressUser
}

// Local storage store for FC sets (key: "fc_sets")

const STORAGE_KEY = 'fc_sets'

export function loadSets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error('Failed to load sets from localStorage', e)
    return []
  }
}

export function saveSets(sets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sets))
}

export function getSet(id) {
  return loadSets().find((s) => s.id === id) || null
}

export function addSet(set) {
  const sets = loadSets()
  sets.push(set)
  saveSets(sets)
  return set
}

export function removeSet(id) {
  const sets = loadSets().filter((s) => s.id !== id)
  saveSets(sets)
}

// ---------- PRIO: shared server-backed set storage ----------
// Sets (the cards) are now SHARED on the server. The localStorage functions
// above remain as a resilient fallback/cache. Every read/write below tries the
// REST API first and falls back to localStorage when the server is unreachable.
// Personal study progress (fc_stats_*, fc_status_*, fc_records_*, fc_blast_*,
// fc_daily_stats, streaks, stars/SRS) stays LOCALSTORAGE ONLY.

const API_BASE = '/api/sets'

// K18: optionally attach the Bearer token (read from localStorage 'fc_token')
// for authenticated calls. A token is attached whenever one is stored.
async function http(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
  const token = localStorage.getItem('fc_token')
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

// List all shared sets from the server.
export async function apiListSets() {
  const data = await http(API_BASE)
  return Array.isArray(data) ? data : []
}

// Fetch a single set by id from the server.
export async function apiGetSet(id) {
  return http(API_BASE + '/' + encodeURIComponent(id))
}

// Create a set on the server (server assigns the id). Returns { id, ok }.
export async function apiCreateSet(obj) {
  return http(API_BASE, { method: 'POST', body: JSON.stringify(obj) })
}

// Update a set on the server. Returns { id, ok }.
export async function apiUpdateSet(id, obj) {
  return http(API_BASE + '/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(obj) })
}

// Delete a set on the server. Returns { ok }.
export async function apiDeleteSet(id) {
  return http(API_BASE + '/' + encodeURIComponent(id), { method: 'DELETE' })
}

// Pull the shared set list from the server. On success the server becomes the
// source of truth: the local cache is replaced with the server's sets and true
// is returned. On failure (server unreachable) nothing changes locally and
// false is returned so callers keep using today's localStorage behavior.
export async function syncSetsFromServer() {
  try {
    const serverSets = await apiListSets()
    saveSets(serverSets)
    return true
  } catch (e) {
    console.warn('Server sets unreachable, using localStorage', e)
    return false
  }
}

// Persist a NEW set: POST to the server; on success also cache it locally (so
// it shows even before a reload). On server failure fall back to today's
// localStorage addSet. Returns the saved set (id assigned by the server).
export async function addSetShared(set) {
  try {
    const { id } = await apiCreateSet({
      topic: set.topic,
      lesson_meta: set.lesson_meta,
      cards: set.cards,
    })
    const saved = {
      id: id || set.id,
      topic: set.topic,
      lesson_meta: set.lesson_meta,
      cards: set.cards,
    }
    const sets = loadSets().filter((s) => s.id !== saved.id)
    sets.push(saved)
    saveSets(sets)
    return saved
  } catch (e) {
    console.warn('Server unreachable, saved set locally', e)
    return addSet(set)
  }
}

// Persist a set UPDATE: PUT to the server; refresh the local cache. On server
// failure fall back to updating localStorage only.
export async function updateSetShared(id, obj) {
  try {
    await apiUpdateSet(id, { topic: obj.topic, lesson_meta: obj.lesson_meta, cards: obj.cards })
  } catch (e) {
    console.warn('Server unreachable, updated set locally only', e)
  }
  const updated = { id, topic: obj.topic, lesson_meta: obj.lesson_meta, cards: obj.cards }
  saveSets(loadSets().map((s) => (s.id === id ? updated : s)))
  return updated
}

// Persist a set DELETE: DELETE to the server, then always drop it from the
// local cache so the UI reflects the removal. Falls back to localStorage-only
// removal when the server is unreachable.
export async function deleteSetShared(id) {
  try {
    await apiDeleteSet(id)
  } catch (e) {
    console.warn('Server unreachable, deleted set locally only', e)
  }
  removeSet(id)
}

// ---------- K18 my-sets (bookmark) ----------
// Authenticated calls that let a user add shared sets to their own list
// (fc_my_sets on the server). All use the Bearer token via http().

export async function apiBookmarkSet(id) {
  return http(API_BASE + '/' + encodeURIComponent(id) + '/bookmark', { method: 'POST' })
}

export async function apiUnbookmarkSet(id) {
  return http(API_BASE + '/' + encodeURIComponent(id) + '/bookmark', { method: 'DELETE' })
}

export async function apiMySets() {
  return http('/api/my/sets')
}

// Add a shared set to the current user's own list; graceful fallback.
export async function bookmarkSetShared(id) {
  try {
    return await apiBookmarkSet(id)
  } catch (e) {
    console.warn('Bookmark failed (not authenticated?)', e)
    return { ok: false }
  }
}

// Remove a shared set from the current user's own list; graceful fallback.
export async function unbookmarkSetShared(id) {
  try {
    return await apiUnbookmarkSet(id)
  } catch (e) {
    console.warn('Unbookmark failed', e)
    return { ok: false }
  }
}

// Load the ids of the sets the current user owns + bookmarked (from /api/my/sets).
export async function loadMySetIds() {
  try {
    const data = await apiMySets()
    return Array.isArray(data && data.ids) ? data.ids : []
  } catch (e) {
    console.warn('loadMySetIds failed (not authenticated?)', e)
    return []
  }
}

// Per-set view counters, stored under "fc_stats_<setId>" keyed by card index.
function statsKey(setId) {
  return 'fc_stats_' + userPrefix() + setId
}

export function getStats(setId) {
  if (!progressEnabled()) return {}
  try {
    const raw = localStorage.getItem(statsKey(setId))
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    console.error('Failed to load stats', e)
    return {}
  }
}

// Per-set card study statuses, stored under "fc_status_<setId>" keyed by card
// index (flat dict, e.g. {"0":"learning","1":"mastered"}). Kept in the same
// local-storage family as the view counters (fc_stats_*) so counters and study
// status stay together conceptually without changing counter semantics.
function statusKey(setId) {
  return 'fc_status_' + userPrefix() + setId
}

export function getStatuses(setId) {
  if (!progressEnabled()) return {}
  try {
    const raw = localStorage.getItem(statusKey(setId))
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    console.error('Failed to load statuses', e)
    return {}
  }
}

export function getStatus(setId, index) {
  return getStatuses(setId)[String(index)] || 'not_studied'
}

export function setCardStatus(setId, index, status) {
  if (!progressEnabled()) return
  const key = statusKey(setId)
  let statuses = {}
  try {
    statuses = JSON.parse(localStorage.getItem(key) || '{}')
  } catch (e) {
    statuses = {}
  }
  statuses[String(index)] = status
  try {
    localStorage.setItem(key, JSON.stringify(statuses))
  } catch (e) {
    console.error('Failed to save statuses', e)
  }
}

// Per-set best-time records for the Match mode, stored under "fc_records_<setId>".
// Value is { ms, date } where ms is the best elapsed time in milliseconds.
function recordKey(setId) {
  return 'fc_records_' + userPrefix() + setId
}

export function getRecord(setId) {
  if (!progressEnabled()) return null
  try {
    const raw = localStorage.getItem(recordKey(setId))
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    console.error('Failed to load record', e)
    return null
  }
}

// Persist `ms` only if it beats the current best. Returns true when a new best
// was written (false if the existing record is equal or faster).
export function saveRecord(setId, ms) {
  if (!progressEnabled()) return false
  const prev = getRecord(setId)
  if (prev && prev.ms <= ms) return false
  try {
    localStorage.setItem(recordKey(setId), JSON.stringify({
      ms, date: new Date().toISOString(), username: progressUser,
    }))
  } catch (e) {
    console.error('Failed to save record', e)
    return false
  }
  return true
}

// Normalize a single per-card stats entry. Older data stored a plain view-count
// number; K9 extends the entry to an object { views, srs } while keeping the
// view count intact (see getViews / getViewsMap for backward-compatible reads).
function normEntry(cur) {
  if (cur && typeof cur === 'object') {
    return {
      views: typeof cur.views === 'number' ? cur.views : 0,
      srs: cur.srs && typeof cur.srs === 'object' ? cur.srs : null,
    }
  }
  const n = Number(cur)
  return { views: Number.isFinite(n) ? n : 0, srs: null }
}

// The view-count stored for a given card index (works for old plain-number data).
export function getViews(setId, index) {
  return normEntry(getStats(setId)[String(index)]).views
}

// Record that card at `index` was displayed (increments its view count). The
// stored value stays a plain number so existing readers/tests keep working;
// K9 review-schedule data lives in the sibling "_srs" sub-map (see below).
export function recordCardView(setId, index) {
  if (!progressEnabled()) return
  const key = statsKey(setId)
  let stats = {}
  try {
    stats = JSON.parse(localStorage.getItem(key) || '{}')
  } catch (e) {
    stats = {}
  }
  const idx = String(index)
  stats[idx] = (typeof stats[idx] === 'number' ? stats[idx] : normEntry(stats[idx]).views) + 1
  try {
    localStorage.setItem(key, JSON.stringify(stats))
  } catch (e) {
    console.error('Failed to save stats', e)
  }
}

// The K9 review info is stored per card inside the fc_stats_<id> object under
// the reserved "_srs" key, e.g. {"0": 5, "_srs": {"0": {interval, nextReview}}}.
function readSrsMap(stats) {
  return stats && stats._srs && typeof stats._srs === 'object' ? stats._srs : {}
}

function readSrs(stats, index) {
  const s = readSrsMap(stats)[String(index)]
  return s && typeof s === 'object' ? s : null
}

// The spaced-repetition info for a card: { interval, nextReview } or null when
// the card has never been scheduled (treated as due now).
export function getCardSRS(setId, index) {
  const s = readSrs(getStats(setId), String(index))
  return s ? { interval: s.interval, nextReview: s.nextReview } : null
}

// True when a card is due at-or-before the given date (localhost date string).
export function isDueOn(setId, index, dateStr) {
  const s = getCardSRS(setId, index)
  if (!s) return true // never scheduled -> due now
  return !s.nextReview || s.nextReview <= dateStr
}

// Apply a correct/wrong answer to a card's review schedule. On a correct answer
// the interval grows up the ladder (1d -> 3d -> 7d -> 15d ...) and the next
// review is pushed out; on an error the interval resets so the card is reviewed
// again today. Keeps the existing view count untouched.
export function applySrsAnswer(setId, index, correct) {
  if (!progressEnabled()) return
  const key = statsKey(setId)
  let stats = {}
  try {
    stats = JSON.parse(localStorage.getItem(key) || '{}')
  } catch (e) {
    stats = {}
  }
  const srs = readSrsMap(stats)
  const cur = readSrs(stats, String(index))
  if (correct) {
    const ni = nextInterval(cur && cur.interval)
    srs[String(index)] = { interval: ni, nextReview: addDaysStr(todayStr(), ni) }
  } else {
    srs[String(index)] = { interval: 0, nextReview: todayStr() } // review again today
  }
  stats._srs = srs
  try {
    localStorage.setItem(key, JSON.stringify(stats))
  } catch (e) {
    console.error('Failed to save stats', e)
  }
}

// ---------- K10 starred cards ----------
// A card flagged as important. Stored inside the fc_stats_<id> object under the
// reserved "_stars" map (index -> true), mirroring the "_srs" reserved key so it
// survives recordCardView (which only touches the bare per-index view count).
function readStars(stats) {
  return stats && stats._stars && typeof stats._stars === 'object' ? stats._stars : {}
}

// True when the card at `index` is marked important.
export function getCardStarred(setId, index) {
  return readStars(getStats(setId))[String(index)] === true
}

// Set/unset the important flag for the card at `index`, persisted in fc_stats_.
export function setCardStarred(setId, index, starred) {
  if (!progressEnabled()) return
  const key = statsKey(setId)
  let stats = {}
  try {
    stats = JSON.parse(localStorage.getItem(key) || '{}')
  } catch (e) {
    stats = {}
  }
  const stars = readStars(stats)
  if (starred) stars[String(index)] = true
  else delete stars[String(index)]
  stats._stars = stars
  try {
    localStorage.setItem(key, JSON.stringify(stats))
  } catch (e) {
    console.error('Failed to save stars', e)
  }
}

// Flip the important flag for a card; returns the new value.
export function toggleCardStarred(setId, index) {
  const cur = getCardStarred(setId, index)
  setCardStarred(setId, index, !cur)
  return !cur
}

// ---------- K9 spaced repetition & progress ----------

function dailylKey() {
  return 'fc_daily_stats' + (userPrefix() ? '_' + progressUser : '')
}
const REVIEW_LADDER = [1, 3, 7, 15, 30, 60, 120]

// Local-calendar date as YYYY-MM-DD (the timezone the user studies in).
export function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

function nextInterval(interval) {
  if (!interval) return 1
  const i = REVIEW_LADDER.indexOf(Number(interval))
  if (i === -1) return 1
  return REVIEW_LADDER[Math.min(i + 1, REVIEW_LADDER.length - 1)]
}


// Clear all per-set progress (statuses, stats incl. reviews, best records).
export function resetSetProgress(setId) {
  if (!progressEnabled()) return
  try { localStorage.removeItem(statusKey(setId)) } catch (e) { /* ignore */ }
  try { localStorage.removeItem(statsKey(setId)) } catch (e) { /* ignore */ }
  try { localStorage.removeItem(recordKey(setId)) } catch (e) { /* ignore */ }
}

// ---------- K9 daily-study map & streaks ----------

// Record that studying happened on the current local date (idempotent).
export function recordStudyDay() {
  if (!progressEnabled()) return
  const today = todayStr()
  try {
    const map = JSON.parse(localStorage.getItem(dailylKey()) || '{}')
    map[today] = true
    localStorage.setItem(dailylKey(), JSON.stringify(map))
  } catch (e) {
    console.error('Failed to save daily stats', e)
  }
}

// Number of consecutive days (ending today) present in the daily-study map.
export function getDayStreak() {
  if (!progressEnabled()) return 0
  let map = {}
  try {
    map = JSON.parse(localStorage.getItem(dailylKey()) || '{}')
  } catch (e) {
    map = {}
  }
  let streak = 0
  const d = new Date()
  while (map[todayStr(d)]) {
    streak += 1
    d.setDate(d.getDate() - 1)
  }
  return streak
}

// ---------- K9 report export ----------

function statusSummary(statuses, total) {
  let mastered = 0
  let learning = 0
  let notStudied = 0
  for (let i = 0; i < total; i++) {
    const s = statuses[String(i)] || 'not_studied'
    if (s === 'mastered') mastered += 1
    else if (s === 'learning') learning += 1
    else notStudied += 1
  }
  return { mastered, learning, notStudied }
}

// JSON report of progress across ALL sets: per-set totals, per-card status,
// views and review schedule, plus global mastery and current day streak.
export function buildProgressReport() {
  const sets = loadSets()
  const today = todayStr()
  const report = {
    generatedAt: new Date().toISOString(),
    dayStreak: getDayStreak(),
    sets: sets.map((set) => {
      const total = set.cards.length
      const statuses = getStatuses(set.id)
      const stats = getStats(set.id)
      const summary = statusSummary(statuses, total)
      return {
        id: set.id,
        topic: set.topic || 'Без названия',
        total,
        ...summary,
        masteryPct: total ? Math.round((summary.mastered / total) * 100) : 0,
        cards: set.cards.map((card, i) => {
          const srs = readSrs(stats, String(i))
          return {
            word: card.word,
            translation: card.translation,
            status: statuses[String(i)] || 'not_studied',
            views: normEntry(stats[String(i)]).views,
            interval: srs ? srs.interval : null,
            nextReview: srs ? srs.nextReview : null,
            due: isDueOn(set.id, i, today),
          }
        }),
      }
    }),
  }
  return report
}

export function downloadProgressReport() {
  const report = buildProgressReport()
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'fc_progress_report.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ---------- K11 folders ----------
// A folder groups several sets. Stored in localStorage as [{ id, name, setIds[] }].
const FOLDER_KEY = 'fc_folders'

export function loadFolders() {
  try {
    const raw = localStorage.getItem(FOLDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error('Failed to load folders', e)
    return []
  }
}

export function saveFolders(folders) {
  localStorage.setItem(FOLDER_KEY, JSON.stringify(folders))
}

export function addFolder(name) {
  const folders = loadFolders()
  const folder = { id: crypto.randomUUID(), name: name || 'Новая папка', setIds: [] }
  folders.push(folder)
  saveFolders(folders)
  return folder
}

export function removeFolder(id) {
  saveFolders(loadFolders().filter((f) => f.id !== id))
}

export function renameFolder(id, name) {
  saveFolders(loadFolders().map((f) => (f.id === id ? { ...f, name } : f)))
}

export function folderAssignSet(folderId, setId) {
  saveFolders(loadFolders().map((f) =>
    f.id === folderId ? { ...f, setIds: f.setIds.includes(setId) ? f.setIds : [...f.setIds, setId] } : f
  ))
}

export function folderUnassignSet(folderId, setId) {
  saveFolders(loadFolders().map((f) =>
    f.id === folderId ? { ...f, setIds: f.setIds.filter((s) => s !== setId) } : f
  ))
}

// ---------- K11 classes (local) ----------
// A "Класс" is a local-only group of sets: [{ id, name, setIds[] }].
const CLASS_KEY = 'fc_classes'

export function loadClasses() {
  try {
    const raw = localStorage.getItem(CLASS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error('Failed to load classes', e)
    return []
  }
}

export function saveClasses(classes) {
  localStorage.setItem(CLASS_KEY, JSON.stringify(classes))
}

export function addClass(name) {
  const classes = loadClasses()
  const cls = { id: crypto.randomUUID(), name: name || 'Новый класс', setIds: [] }
  classes.push(cls)
  saveClasses(classes)
  return cls
}

export function removeClass(id) {
  saveClasses(loadClasses().filter((c) => c.id !== id))
}

export function renameClass(id, name) {
  saveClasses(loadClasses().map((c) => (c.id === id ? { ...c, name } : c)))
}

export function classSetMember(classId, setId) {
  saveClasses(loadClasses().map((c) =>
    c.id === classId ? { ...c, setIds: c.setIds.includes(setId) ? c.setIds : [...c.setIds, setId] } : c
  ))
}

export function classSetUnmember(classId, setId) {
  saveClasses(loadClasses().map((c) =>
    c.id === classId ? { ...c, setIds: c.setIds.filter((s) => s !== setId) } : c
  ))
}

// ---------- K11 Blast score records ----------
// Best Blast scores, stored under "fc_blast_<setId>" = { score, date }. Kept
// separate from "fc_records_<setId>" (which holds Match times) so the existing
// Match getRecord/saveRecord semantics stay untouched.
function blastKey(setId) {
  return 'fc_blast_' + userPrefix() + setId
}

export function getBlastScore(setId) {
  if (!progressEnabled()) return null
  try {
    const raw = localStorage.getItem(blastKey(setId))
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    console.error('Failed to load blast score', e)
    return null
  }
}

// Persist `score` only if it beats the current best. Returns true on new best.
export function saveBlastScore(setId, score) {
  if (!progressEnabled()) return false
  const prev = getBlastScore(setId)
  if (prev && prev.score >= score) return false
  try {
    localStorage.setItem(blastKey(setId), JSON.stringify({
      score, date: new Date().toISOString(), username: progressUser,
    }))
  } catch (e) {
    console.error('Failed to save blast score', e)
    return false
  }
  return true
}

// ---------- K11 leaderboard aggregation (LOCAL fallback only) ----------
// Combine every set's Match best-time record (fc_records_<id>) and Blast best
// score (fc_blast_<id>) into two top-5 lists. Used only as a fallback when the
// shared server leaderboard (see K20 below) is unreachable. Each entry carries
// the owning username (stored since K20; older records have none -> caller
// renders "-").
export function buildLeaderboard() {
  const sets = loadSets()
  const match = []
  const blast = []
  for (const s of sets) {
    const topic = s.topic || 'Без названия'
    const rec = getRecord(s.id)
    if (rec && rec.ms != null) match.push({ setId: s.id, topic, ms: rec.ms, date: rec.date, username: rec.username })
    const b = getBlastScore(s.id)
    if (b && b.score != null) blast.push({ setId: s.id, topic, score: b.score, date: b.date, username: b.username })
  }
  match.sort((a, b) => a.ms - b.ms)
  blast.sort((a, b) => b.score - a.score)
  return { match: match.slice(0, 5), blast: blast.slice(0, 5) }
}

// ---------- K20 shared server leaderboard (linked to nicknames) ----------
// Records live on the server (fc_leaderboard table) so results are COMMON to
// all users and carry the owner's username. GET is public (guests can read);
// POST requires a logged-in session. The http() helper attaches the Bearer
// token and throws on non-ok, so callers fall back silently.

const LB_BASE = '/api/leaderboard'

// Fetch the shared leaderboard: { match: [{username,set_id,topic,value,date}], blast: [...] }.
export async function apiGetLeaderboard() {
  return http(LB_BASE)
}

// Record/update the current user's best result for a set+mode on the server.
export async function apiSaveLeaderboard(set_id, mode, value) {
  return http(LB_BASE, { method: 'POST', body: JSON.stringify({ set_id, mode, value }) })
}

// Fire a finished best Match/Blast result to the shared leaderboard. A no-op
// and resolves false when nobody is logged in (progress disabled); resolves
// false on a network/HTTP failure so the game is never interrupted.
export async function pushLeaderboard(set_id, mode, value) {
  if (!progressEnabled()) return false
  try {
    await apiSaveLeaderboard(set_id, mode, value)
    return true
  } catch (e) {
    console.warn('Leaderboard push failed', e)
    return false
  }
}
