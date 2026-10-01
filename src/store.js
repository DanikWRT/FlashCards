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

// Per-set view counters, stored under "fc_stats_<setId>" keyed by card index.
const STATS_PREFIX = 'fc_stats_'

function statsKey(setId) {
  return STATS_PREFIX + setId
}

export function getStats(setId) {
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
const STATUS_PREFIX = 'fc_status_'

function statusKey(setId) {
  return STATUS_PREFIX + setId
}

export function getStatuses(setId) {
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
const RECORD_PREFIX = 'fc_records_'

function recordKey(setId) {
  return RECORD_PREFIX + setId
}

export function getRecord(setId) {
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
  const prev = getRecord(setId)
  if (prev && prev.ms <= ms) return false
  try {
    localStorage.setItem(recordKey(setId), JSON.stringify({ ms, date: new Date().toISOString() }))
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

const DAILY_KEY = 'fc_daily_stats'
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
  try { localStorage.removeItem(statusKey(setId)) } catch (e) { /* ignore */ }
  try { localStorage.removeItem(statsKey(setId)) } catch (e) { /* ignore */ }
  try { localStorage.removeItem(recordKey(setId)) } catch (e) { /* ignore */ }
}

// ---------- K9 daily-study map & streaks ----------

// Record that studying happened on the current local date (idempotent).
export function recordStudyDay() {
  const today = todayStr()
  try {
    const map = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}')
    map[today] = true
    localStorage.setItem(DAILY_KEY, JSON.stringify(map))
  } catch (e) {
    console.error('Failed to save daily stats', e)
  }
}

// Number of consecutive days (ending today) present in the daily-study map.
export function getDayStreak() {
  let map = {}
  try {
    map = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}')
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
