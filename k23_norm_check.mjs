import { matchAnswer, translitNormalize } from './src/normalize.js'

const R = []
const t = (label, cond) => R.push(`${cond ? 'PASS' : 'FAIL'} | ${label}`)

// translitNormalize present?
t('translitNormalize is fn', typeof translitNormalize === 'function')
console.log('translit(Привет)=', translitNormalize('Привет'))
console.log('translit(table)=', translitNormalize('table'))

// b vs и layout independence: expected has latin 'b' (e.g. word with b),
// user typed with russian layout so 'b' key produced 'и'.
// russian 'и' on QWERTY is the 'b' key. Normalizing both ways should equate.
// e.g. expected 'блин' typed as 'bkby' (russian layout on latin word)
t('ru "bkby" accepted for en-word "блин"-equiv', matchAnswer('bkby', 'блин'))
console.log('matchAnswer("bkby","блин")=', matchAnswer('bkby', 'блин'))

// latin 'stol' should match cyrillic 'стол'
t('stol == стол', matchAnswer('stol', 'стол'))
console.log('matchAnswer("stol","стол")=', matchAnswer('stol', 'стол'))

// cyrillic input on latin word: expected 'table', typed russian layout 'иfьу'? 
// Actually test reverse: typing russian letters that correspond to latin 'table'
// t = е, a = ф, b = и, l = д, e = у  -> 'ефиду'
t('russian-layout "ефиду" accepted for "table"', matchAnswer('ефиду', 'table'))
console.log('matchAnswer("ефиду","table")=', matchAnswer('ефиду', 'table'))

// empty answer stays wrong
t('empty still wrong', matchAnswer('   ', 'стол') === false)

// variants with / and () still work
t('variant / works', matchAnswer('foot', 'Foot / Feet'))
t('paren variant works', matchAnswer('таз', 'бедро (таз), хип'))

console.log('---')
const fails = R.filter((r) => r.startsWith('FAIL'))
console.log(R.join('\n'))
console.log(`\n${R.length - fails.length}/${R.length} checks passed`)
process.exit(0)
