// K12 answer normalization.
//
// Given the EXPECTED answer string (which may bundle several variants, e.g.
// "Foot / Feet", "губы (ед. ч. lip)", "бедро (таз), хип") this extracts all
// acceptable variant words so that a typed answer matching ANY ONE of them is
// treated as correct (instead of forcing the user to retype the whole string).
//
// Variants are produced by:
//   1. splitting on "/"        ("Foot / Feet"          -> Foot, Feet)
//   2. removing "(...)" pieces ("губы (ед. ч. lip)"    -> губы)
//   3. splitting on ","        ("бедро (таз), хип"     -> бедро, хип)
// Parenthetical content is ALSO kept as its own candidate variant so an
// alternate word in parens (e.g. "таз" in "бедро (таз), хип") still counts,
// while pure explanations ("(ед. ч. lip)") merely add a usually non-matching
// entry and do no harm.
//
// Everything is trimmed, lowercased, whitespace-collapsed and de-duplicated.

function clean(raw) {
  return String(raw).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Return the full list of acceptable variants for an expected answer string.
 * e.g. answerVariants("Foot / Feet") -> ["foot", "feet"]
 *      answerVariants("бедро (таз), хип") -> ["таз", "бедро", "хип"]
 */
export function answerVariants(expected) {
  if (typeof expected !== 'string') return []
  const out = []

  // Parenthetical content is also a candidate variant.
  const parens = expected.toLowerCase().match(/\(([^)]*)\)/g) || []
  for (const p of parens) {
    const inner = p.slice(1, -1)
    for (const bit of inner.split('/')) {
      for (const sub of bit.split(',')) {
        const c = clean(sub)
        if (c) out.push(c)
      }
    }
  }

  // Main string with parentheses removed, then split on "/" and ",".
  const stripped = expected.replace(/\([^)]*\)/g, ' ')
  for (const bit of stripped.split('/')) {
    for (const sub of bit.split(',')) {
      const c = clean(sub)
      if (c) out.push(c)
    }
  }

  return [...new Set(out)]
}

/**
 * A user answer is CORRECT if (after trim + lowercase + whitespace collapse)
 * it equals AT LEAST ONE acceptable variant, or the expected answer as a whole.
 * An empty / whitespace-only answer is always WRONG (it's a "skip").
 */
export function matchAnswer(given, expected) {
  if (typeof given !== 'string') return false
  const g = clean(given)
  if (g === '') return false

  // The whole expected string (post-cleanup) still counts.
  if (g === clean(expected)) return true

  return answerVariants(expected).includes(g)
}
