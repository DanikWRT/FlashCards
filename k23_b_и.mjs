import { matchAnswer } from './src/normalize.js'

const R = []
const t = (label, cond) => R.push(`${cond ? 'PASS' : 'FAIL'} | ${label}`)

// THE core K23 #3 requirement verbatim: letter 'b' and 'и' are the same KEY.
// On QWERTY: EN key 'b' == RU key 'и'. So a word spelled in latin with a 'b'
// must match the same word typed on the RU layout where that key produced 'и'.
// Example: expected latin word "bar" (b-a-r). RU-layout typing: b-key->ж? No:
// key 'b' in RU layout emits 'и'. key 'a' emits 'ф'. key 'r' emits 'к'.
// So typing the latin word graphically "bar" while on RU layout yields "ифк".
t('ru "ифк" == en "bar" (b/и same key)', matchAnswer('ифк', 'bar'))
console.log('matchAnswer("ифк","bar")=', matchAnswer('ифк', 'bar'))

// And the OTHER direction: user on EN layout, expected a ru word.
// expected 'вики'; keys v=м, i=ш? i key ru = ш, k=л, i=ш -> "мшлш"
// Simpler: expected 'игра' typed as 'b...'? 'и' key = b, 'г'=п, 'р'=к, 'а'=ф -> 'bпкф'
t('en "bпкф" == ru "игра" (b key = и)', matchAnswer('bпкф', 'игра'))
console.log('matchAnswer("bпкф","игра")=', matchAnswer('bпкф', 'игра'))

console.log('---')
console.log(R.join('\n'))
process.exit(0)
