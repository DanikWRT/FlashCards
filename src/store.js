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

// Record that card at `index` was displayed. Doesn't touch ordering.
export function recordCardView(setId, index) {
  const key = statsKey(setId)
  let stats = {}
  try {
    stats = JSON.parse(localStorage.getItem(key) || '{}')
  } catch (e) {
    stats = {}
  }
  const idx = String(index)
  stats[idx] = (stats[idx] || 0) + 1
  try {
    localStorage.setItem(key, JSON.stringify(stats))
  } catch (e) {
    console.error('Failed to save stats', e)
  }
}
