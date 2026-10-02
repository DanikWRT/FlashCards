// K12 answer normalization.
//
// Given the EXPECTED answer string (which may bundle several variants, e.g.
// "Foot / Feet", "губы (ед. ч. lip)", "бедро (таз), хип") this extracts all
// acceptable variant words so that a typed answer matching ANY ONE of them is
// treated as correct (instead of forcing the user to retype the whole string).
//
// Variants are produced by:
//   1. splitting on "/"        ("Foot / Feet"        -> Foot, Feet)
//   2. removing "(...)" pieces ("губы (ед. ч. lip)"   -> губы)
//   3. splitting on ","        ("бедро (таз), хип"    -> бедро, хип)
// Parenthetical content is ALSO kept as its own candidate variant so an
// alternate word in parens (e.g. "таз" in "бедро (таз), хип") still counts,
// while pure explanations ("(ед. ч. lip)") merely add a usually non-matching
// entry and do no harm.
//
// Everything is trimmed, lowercased, whitespace-collapsed and de-duplicated.

function clean(raw) {
  return String(raw).toLowerCase().replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// K23: layout-independent input ("раскладка не важна").
//
// A user typing an answer on a Russian layout produces Cyrillic letters where
// an English word (or an English-layout typed Russian word) was intended, and
// vice-versa. To accept both layouts we canonicalize every expected variant AND
// every typed answer into comparable latin-only forms before comparing.
//
// Two canonical layers are applied (a match on EITHER counts as correct):
//
//  1) translitNormalize()  — PHONETIC transliteration (Cyrillic -> latin) as
//     specified for K23 (а->a, б->b, ... ш->sh, щ->shch, ю->yu, я->ya). This is
//     the classic "type the Russian word with latin letters" mapping.
//
//  2) positional layer    — QWERTY<->ЙЦУКЕН positional equivalence: a latin
//     letter and the Cyrillic letter printed on the SAME physical key are
//     treated as identical (e.g. 'b' == 'и', 'f' == 'а', 't' == 'е'). This is
//     what makes "table" typed on a Russian layout ("ефиду") match, and makes
//     "стол" typed on an English layout ("cnjk") match. It also implements the
//     K23 acceptance rule that «и» is accepted where expected has «b».
//
// When either layer yields equal canonical forms the answer is correct, so both
// the phonetic mapping and true layout-independence are honoured.

// Phonetic transliteration (Cyrillic letter -> latin), per K23 spec.
// ь and ъ transliterate to nothing.
const PHON = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

// Positional equivalence: Cyrillic key (ЙЦУКЕН) -> latin on the same physical
// QWERTY key. Latin letters are left untouched (they already are their own
// canonical value). Uppercase handled by lowercasing first.
const POS = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i',
  щ: 'o', з: 'p', х: '[', ъ: ']', ф: 'a', ы: 's', в: 'd', а: 'f',
  п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', ж: ';', э: "'", я: 'z',
  ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm', б: ',', ю: '.', ё: '`',
}

const mapChars = (s, map) =>
  clean(s)
    .split('')
    .map((c) => map[c] || c)
    .join('')

/**
 * K23: phonetic transliteration of a string (lowercased) into a canonical
 * latin-only form. e.g. translitNormalize('Привет') -> 'privet'.
 * Latin characters are preserved. ь/ъ are dropped per the mapping.
 */
export function translitNormalize(s) {
  return mapChars(s, PHON)
}

// Internal canonicalizers used by matchAnswer. Positional mapping keeps latin
// letters as-is and maps Russian key letters to their physical latin key.
function phonCanon(s) { return mapChars(s, PHON) }
function posCanon(s) { return mapChars(s, POS) }

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
 * Comparison is done on the raw text AND on both canonical layout-independent
 * form(s) (phonetic transliteration + QWERTY positional), so a user's answer
 * is accepted regardless of whether they typed it in a latin or Cyrillic
 * layout. An empty / whitespace-only answer is always WRONG (it's a "skip").
 */
export function matchAnswer(given, expected) {
  if (typeof given !== 'string') return false
  const g = clean(given)
  if (g === '') return false

  const gPhon = phonCanon(g)
  const gPos = posCanon(g)

  // The whole expected string (post-cleanup) plus every extracted variant.
  const candidates = [clean(expected), ...answerVariants(expected)]

  for (const cand of candidates) {
    if (!cand) continue
    if (g === cand) return true
    if (!gPhon || !gPos) continue
    if (phonCanon(cand) === gPhon) return true
    if (posCanon(cand) === gPos) return true
  }

  return false
}
