const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:5174'
const SET_ID = 'k9-test-set'

const CARDS = []
for (let i = 0; i < 6; i++) {
  CARDS.push({ word: 'word' + i, translation: 'пер' + i })
}

let results = []
function ok(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg)
}

async function getLS(page, key) {
  return page.evaluate((k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : {} }, key)
}
async function setLS(page, key, val) {
  return page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [key, val])
}

// Seed the set only (idempotent, runs on every navigation). Clearing of transient
// keys is done explicitly via page.evaluate AFTER the first load so reloads don't wipe it.
const seedScript = `
  (() => {
    const set = { id: ${JSON.stringify(SET_ID)}, topic: 'Набор K9', cards: ${JSON.stringify(CARDS)} };
    let sets = [];
    try { sets = JSON.parse(localStorage.getItem('fc_sets') || '[]'); } catch (e) { }
    if (!sets.some(s => s.id === ${JSON.stringify(SET_ID)})) sets.push(set);
    localStorage.setItem('fc_sets', JSON.stringify(sets));
  })();
`

async function clearKeys(page) {
  await page.evaluate(([a, b, c]) => {
    localStorage.removeItem(a)
    localStorage.removeItem(b)
    localStorage.removeItem(c)
    localStorage.removeItem('fc_daily_stats')
  }, ['fc_status_' + SET_ID, 'fc_stats_' + SET_ID, 'fc_records_' + SET_ID])
}

async function openSet(page) {
  await page.waitForSelector('.set-card-main')
  await page.click('.set-card-main')
  await page.waitForSelector('.mode-switcher')
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)

  await page.addInitScript(seedScript)

  await page.goto(BASE)
  await clearKeys(page)
  await page.reload()
  await openSet(page)

  // ---------- 1) PROGRESS OVERVIEW on a fresh set ----------
  const prog = await page.locator('[data-testid="k9-progress"]').innerText()
  ok(
    /Не изучено: 6 из 6/.test(prog) && /Освоено: 0 из 6/.test(prog),
    'set page shows progress overview "X из N" per status on a fresh set (' + prog.replace(/\s+/g, ' ').trim() + ')'
  )
  const barWidth = await page.locator('.k9-mastery-fill').evaluate((el) => el.style.width)
  ok(barWidth === '0%', 'mastery bar is 0% on a fresh set (got ' + barWidth + ')')

  // ---------- 2) SPACED REPETITION: cards 0-4 not due (future), card 5 due today ----------
  await setLS(page, 'fc_status_' + SET_ID, { '0': 'mastered', '1': 'mastered', '2': 'mastered' })
  const yest = await page.evaluate(() => { const d = new Date(Date.now() - 86400000); return d.toISOString().slice(0, 10) })
  const tomD = await page.evaluate(() => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 10) })
  // cards 3,4 are NOT due (future nextReview); card 5 IS due today. 0,1,2 mastered & ignored in queue.
  const srsMap = {
    '3': { interval: 7, nextReview: tomD },
    '4': { interval: 7, nextReview: tomD },
    '5': { interval: 1, nextReview: yest },
  }
  await setLS(page, 'fc_stats_' + SET_ID, { _srs: srsMap })
  await page.reload()
  await page.waitForSelector('.mode-switcher')

  const prog2 = await page.locator('[data-testid="k9-progress"]').innerText()
  ok(/Освоено: 3 из 6/.test(prog2), 'progress overview updates to 3/6 mastered after statuses set')
  const bar2 = await page.locator('.k9-mastery-fill').evaluate((el) => el.style.width)
  ok(bar2 === '50%', 'mastery bar shows 50% (got ' + bar2 + ')')

  // ---------- 3) LEARN mode: the single due card (5) comes first; srs advances ----------
  await page.getByRole('tab', { name: /Learn/ }).click()
  await page.waitForSelector('.study-prompt')
  const firstDue = (await page.locator('.study-prompt').innerText()).trim()
  ok(firstDue === 'word5', 'Learn shows the due card first (got "' + firstDue + '")')
  // The due card carries the "к повторению" marker.
  ok((await page.locator('.review-badge.inline').count()) === 1, 'due card carries the "к повторению" marker in Learn')

  // Correctly answer the due card (word5 -> пер5): interval 1d -> 3d, next_review tomorrow.
  await page.locator('.quiz-choice').filter({ hasText: 'пер5' }).click()
  await page.waitForSelector('.study-feedback.correct')
  let stats = await getLS(page, 'fc_stats_' + SET_ID)
  const srsAfter = stats._srs['5']
  ok(srsAfter && srsAfter.interval === 3, 'correct answer advanced interval 1d -> 3d (got ' + JSON.stringify(srsAfter) + ')')
  const expNext = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0'); return d.getFullYear() + '-' + m + '-' + dd })
  ok(srsAfter.nextReview === expNext, 'correct answer scheduled next_review using the grown interval (got ' + srsAfter.nextReview + ', expected ' + expNext + ')')

  // Wrongly answer the next card (3, not-due) -> interval resets to 0 / "review today".
  await page.getByRole('button', { name: 'Далее' }).click()
  await page.waitForSelector('.study-prompt')
  const secondPrompt = (await page.locator('.study-prompt').innerText()).trim()
  const correctForSecond = secondPrompt === 'word3' ? 'пер3' : 'пер4'
  const choices = await page.locator('.quiz-choice').allInnerTexts()
  const wrongChoice = choices.find((t) => t.trim() !== correctForSecond) || choices[0]
  await page.locator('.quiz-choice').filter({ hasText: wrongChoice.trim() }).click()
  await page.waitForSelector('.study-feedback.wrong')
  const secondIdx = secondPrompt === 'word3' ? '3' : '4'
  stats = await getLS(page, 'fc_stats_' + SET_ID)
  const srsWrong = stats._srs[secondIdx]
  ok(srsWrong && srsWrong.interval === 0, 'wrong answer reset the interval (got ' + JSON.stringify(srsWrong) + ')')
  const today = await page.evaluate(() => { const d = new Date(); return d.toISOString().slice(0, 10) })
  ok(srsWrong.nextReview === today, 'wrong answer set next_review to today (got ' + srsWrong.nextReview + ')')

  // ---------- 4) STREAK: daily-study map records today ----------
  const daily = await getLS(page, 'fc_daily_stats')
  const today2 = await page.evaluate(() => { const d = new Date(); return d.toISOString().slice(0, 10) })
  ok(daily[today2] === true, 'daily-study map records today after a study session')

  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k9_progress.png' })

  // ---------- 5) NO-REVIEWS screen when no cards are due today ----------
  const tom2 = await page.evaluate(() => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 10) })
  const allFuture = {}
  for (let i = 0; i < 6; i++) allFuture[i] = { interval: 7, nextReview: tom2 }
  await setLS(page, 'fc_stats_' + SET_ID, { _srs: allFuture })
  await setLS(page, 'fc_status_' + SET_ID, {})
  await page.reload()
  await page.waitForSelector('.mode-switcher')
  await page.waitForSelector('[data-testid="no-reviews"]', { timeout: 8000 })
  const noRev = await page.locator('[data-testid="no-reviews"]').innerText()
  ok(/Повторений на сегодня нет/.test(noRev), 'cards mode shows no-reviews screen when nothing is due (' + noRev.replace(/\s+/g, ' ').trim() + ')')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k9_review.png' })

  await page.getByRole('tab', { name: /Learn/ }).click()
  await page.waitForSelector('[data-testid="no-reviews"]', { timeout: 8000 })
  ok(true, 'Learn also shows the no-reviews screen when nothing is due')

  // ---------- 6) REPORT DOWNLOAD ----------
  let dled = null
  page.on('download', (d) => { dled = d })
  await page.getByRole('button', { name: 'Скачать отчёт' }).first().click()
  ok(!!dled, 'report download triggered a file (' + (dled ? dled.suggestedFilename() : 'none') + ')')
  if (dled) {
    const fs = require('fs')
    const json = JSON.parse(fs.readFileSync(await dled.path(), 'utf8'))
    ok(json.sets.length >= 1, 'report JSON covers at least one set (got ' + json.sets.length + ')')
    ok(typeof json.dayStreak === 'number', 'report includes day streak field')
    ok(json.sets[0].masteryPct >= 0, 'report computes masteryPct (got ' + json.sets[0].masteryPct + ')')
  }

  // ---------- 7) MySets: streak badge + memory % ----------
  await page.goto(BASE)
  await clearKeys(page)
  await setLS(page, 'fc_daily_stats', { [today2]: true })
  await page.reload()
  await page.waitForSelector('.page-head')
  const streakEl = await page.locator('.k9-streak')
  const sCount = await streakEl.count()
  ok(sCount >= 1, 'MySets shows the daily streak badge when studied today (count=' + sCount + ')')
  const mem = await page.locator('.set-memory').first().innerText()
  ok(/Память: \d+%/.test(mem), 'MySets shows memory score per set (' + mem + ')')

  // ---------- 8) RESET PROGRESS clears per-set statuses/stats/reviews ----------
  await page.locator('.set-card-main').first().click()
  await page.waitForSelector('.mode-switcher')
  await setLS(page, 'fc_status_' + SET_ID, { '0': 'mastered', '1': 'learning' })
  await setLS(page, 'fc_stats_' + SET_ID, { '0': 9, _srs: { '0': { interval: 15, nextReview: '2026-09-01' } } })
  await page.reload()
  await page.waitForSelector('.mode-switcher')
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click()
  await page.reload()
  await page.waitForSelector('.mode-switcher')
  const st = await getLS(page, 'fc_status_' + SET_ID)
  const sta = await getLS(page, 'fc_stats_' + SET_ID)
  ok(Object.keys(st).length === 0, 'reset progress cleared all statuses (got ' + JSON.stringify(st) + ')')
  ok(!('_srs' in sta), 'reset progress cleared the review schedule (_srs gone: ' + JSON.stringify(sta) + ')')

  console.log('\n==== SUMMARY ====')
  const fails = results.filter((r) => !r.ok)
  console.log('Total: ' + results.length + ', Passed: ' + (results.length - fails.length) + ', Failed: ' + fails.length)
  await browser.close()
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
