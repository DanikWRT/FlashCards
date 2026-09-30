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
