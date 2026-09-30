const { chromium } = require('playwright')

const BASE = 'http://localhost:5175'
const SET_ID = 'k4-test-set-0001'
const STATS_KEY = `fc_stats_${SET_ID}`

const CARDS = [
  { word: 'word0', translation: 'пер0', examples: [{ en: 'en0', ru: 'ru0' }] },
  { word: 'word1', translation: 'пер1', examples: [{ en: 'en1', ru: 'ru1' }] },
  { word: 'word2', translation: 'пер2', examples: [{ en: 'en2', ru: 'ru2' }] },
  { word: 'word3', translation: 'пер3', examples: [{ en: 'en3', ru: 'ru3' }] },
  { word: 'word4', translation: 'пер4', examples: [{ en: 'en4', ru: 'ru4' }] },
  { word: 'word5', translation: 'пер5', examples: [{ en: 'en5', ru: 'ru5' }] },
  { word: 'word6', translation: 'пер6', examples: [{ en: 'en6', ru: 'ru6' }] },
]

// Seeded stats {0:5, 1:3, 2:1}; cards 3-6 have no counter (treated as 0).
// Clean-stable ascending sort -> count-0 cards (3,4,5,6) first in original order, then
// 2(1), 1(3), 0(5): [3,4,5,6,2,1,0]
const EXPECT_PRIORITY = [3, 4, 5, 6, 2, 1, 0]

function idxOf(word) {
  return CARDS.findIndex((c) => c.word === word)
}

async function displayedWord(page) {
  return page.locator('.face-word').innerText()
}

async function badgeText(page) {
  return page.locator('.view-badge').innerText()
}

// Walk the ENTIRE pass (each card shown exactly once -> every card gets the SAME
// increment), then read final stats. Adding the same constant to all counts does
// not change their relative order, so stableSort(final counts) equals the pass
// order regardless of StrictMode's per-view increment size.
async function walkPass(page) {
  const order = []
  for (let i = 0; i < CARDS.length; i++) {
    order.push(idxOf(await displayedWord(page)))
    if (i < CARDS.length - 1) {
      await page.getByRole('button', { name: /Вперёд/ }).click()
      await page.waitForTimeout(40)
    }
  }
  return order
}

async function walkPassAndCheck(page, label) {
  const order = await walkPass(page)
  const fin = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STATS_KEY)
  const cnt = CARDS.map((_, i) => parseInt(fin[String(i)] || 0))
  const exp = CARDS.map((_, i) => i)
    .slice()
    .sort((a, b) => cnt[a] - cnt[b])
  const okFlag = JSON.stringify(order) === JSON.stringify(exp)
  console.log(`${okFlag ? 'PASS' : 'FAIL'}: ${label} -> pass ${JSON.stringify(order)} == stableSort(final counts) ${JSON.stringify(exp)}`)
  return okFlag
}

async function statCount(page, idx) {
  return parseInt(await page.evaluate(([k, i]) => (JSON.parse(localStorage.getItem(k)) || {})[String(i)] || 0, [STATS_KEY, idx]))
}

async function badgeCount(page) {
  return parseInt((await badgeText(page)).replace(/\D/g, ''))
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  const results = []
  const ok = (cond, msg) => {
    results.push({ ok: !!cond, msg })
    console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`)
  }

  // --- Seed: set + uneven counters, no priority mode (default ON) ---
  await page.goto(BASE + '/')
  await page.evaluate((set) => localStorage.setItem('fc_sets', JSON.stringify([set])), {
    id: SET_ID,
    topic: 'K4 Test Set',
    cards: CARDS,
  })
  await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [STATS_KEY, { 0: 5, 1: 3, 2: 1 }])
  await page.evaluate(() => localStorage.removeItem('fc_priority_mode'))

  // --- 1) Open cards mode, priority default ON ---
  await page.goto(BASE + '/set/' + SET_ID)
  await page.waitForSelector('.face-word')
  ok(true, 'cards mode loads with a card')

  // --- 2) Priority ON: under-used cards first; order FIXED across the pass ---
  // First load: StrictMode double-mount inflates the first card's counter, which
  // would skew a stableSort(final) comparison, so compare against the known
  // clean-seed expected order directly.
  const firstPass = await walkPass(page)
  ok(JSON.stringify(firstPass) === JSON.stringify(EXPECT_PRIORITY), `priority ON first-load pass ${JSON.stringify(firstPass)} == expected ${JSON.stringify(EXPECT_PRIORITY)}`)

  // Navigate backward from the end: order stays fixed (last card 0 -> index 1 -> index 2)
  await page.getByRole('button', { name: /Назад/ }).click()
  await page.waitForTimeout(50)
  await page.getByRole('button', { name: /Назад/ }).click()
  await page.waitForTimeout(50)
  const idxB = idxOf(await displayedWord(page))
  // in the pass [3,4,5,6,2,1,0], two steps back from the end (index 0) lands on index 2
  ok(idxB === 2, `navigating back keeps fixed order (now card index ${idxB}, expected 2)`)

  // --- 3) Badge: shows view count of current card; updates on navigation ---
  // go to first card of the priority pass
  await page.getByRole('button', { name: 'Заново' }).click()
  await page.waitForTimeout(80)
  const w1 = await displayedWord(page)
  const b1 = await badgeCount(page)
  ok(/^Показов: \d+$/.test(await badgeText(page)), `badge shows "Показов: N" on first card (${idxOf(w1)}): "${await badgeText(page)}"`)
  // Navigate away and back to the SAME card: its view count grows, and the badge
  // (refreshed on each navigation render) must reflect the larger number.
  await page.getByRole('button', { name: /Вперёд/ }).click()
  await page.waitForTimeout(60)
  const w2 = await displayedWord(page)
  ok(idxOf(w2) !== idxOf(w1), `navigation moved to a different card (${idxOf(w2)})`)
  await page.getByRole('button', { name: /Назад/ }).click()
  await page.waitForTimeout(60)
  const bBack = await badgeCount(page)
  ok((await displayedWord(page)) === w1 && bBack > b1, `badge updates as current card count grows: ${b1} -> ${bBack}`)

  // --- 4) Toggle OFF -> natural order [0,1,2,3,4,5,6] ---
  await page.locator('.priority-toggle input').uncheck()
  await page.waitForTimeout(80)
  let w = await displayedWord(page)
  ok(idxOf(w) === 0, `priority OFF: first card is index 0 ("${w}")`)
  const naturalIdx = [idxOf(w)]
  for (let i = 1; i < CARDS.length; i++) {
    await page.getByRole('button', { name: /Вперёд/ }).click()
    await page.waitForTimeout(40)
    naturalIdx.push(idxOf(await displayedWord(page)))
  }
  ok(JSON.stringify(naturalIdx) === JSON.stringify([0, 1, 2, 3, 4, 5, 6]), `natural order after toggle OFF: ${JSON.stringify(naturalIdx)}`)

  // --- 5) Toggle ON -> priority order (fewest views first), verified robustly ---
  await page.locator('.priority-toggle input').check()
  await page.waitForTimeout(80)
  ok(await walkPassAndCheck(page, 'priority ON after toggle back'), 'priority pass verified after toggle')

  // --- 6) Persistence across reload (fc_priority_mode) ---
  const modeOn = await page.evaluate(() => localStorage.getItem('fc_priority_mode'))
  ok(modeOn === 'on', `fc_priority_mode persisted as "${modeOn}"`)
  await page.reload()
  await page.waitForSelector('.face-word')
  ok(await walkPassAndCheck(page, 'priority ON after reload'), 'priority pass verified after reload')

  // persistence of OFF
  await page.locator('.priority-toggle input').uncheck()
  await page.waitForTimeout(60)
  await page.reload()
  await page.waitForSelector('.face-word')
  ok(idxOf(await displayedWord(page)) === 0, 'after reload with fc_priority_mode=off, natural order (index 0) applied')

  // --- 7) Заново (restart) resets to start and recomputes once ---
  await page.locator('.priority-toggle input').check()
  await page.waitForTimeout(60)
  await page.getByRole('button', { name: 'Заново' }).click()
  await page.waitForTimeout(80)
  ok(await walkPassAndCheck(page, 'priority ON after Заново (restart)'), 'restart recomputes a fresh priority pass')

  // --- 8) fc_stats grows for displayed cards (keyed by ORIGINAL index) ---
  const stats = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STATS_KEY)
  ok(stats && typeof stats === 'object', 'fc_stats object present')
  // every card was shown many times across passes; each should have grown from seed
  const grown = CARDS.filter((_, i) => (parseInt(stats[String(i)] || 0)) > (i === 2 ? 1 : i === 1 ? 3 : i === 0 ? 5 : 0))
  ok(grown.length >= 5, `counters grew for ${grown.length} of 7 cards (fc_stats keyed by original index)`)

  console.log('\n=== SUMMARY ===')
  const failed = results.filter((r) => !r.ok)
  console.log(`Passed: ${results.length - failed.length}/${results.length}`)
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.msg))
    process.exitCode = 1
  }

  // --- Screenshot: badge with view count on a card ---
  await page.locator('.priority-toggle input').check()
  await page.waitForTimeout(50)
  await page.getByRole('button', { name: 'Заново' }).click()
  await page.waitForTimeout(100)
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k4_priority.png' })
  console.log('Screenshot saved to /home/aifactory/FlashCards/fc_k4_priority.png')

  await browser.close()
})()
