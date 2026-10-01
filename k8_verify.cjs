const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:5174'
const SET_ID = 'k8-test-set'

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

// Seed via addInitScript so the set persists on the origin before any page load.
const seedScript = `
  (() => {
    const set = { id: ${JSON.stringify(SET_ID)}, topic: 'Набор K8', cards: ${JSON.stringify(CARDS)} };
    let sets = [];
    try { sets = JSON.parse(localStorage.getItem('fc_sets') || '[]'); } catch (e) { }
    if (!sets.some(s => s.id === ${JSON.stringify(SET_ID)})) sets.push(set);
    localStorage.setItem('fc_sets', JSON.stringify(sets));
  })();
`

async function goToSet(page) {
  await page.goto(BASE)
  await page.click('.set-card-main')
  await page.waitForSelector('.mode-switcher')
}

// Solve the Match board fully (all 6 pairs correctly), optionally delaying first.
async function solveMatch(page, delayMs) {
  if (delayMs) await page.waitForTimeout(delayMs)
  for (let i = 0; i < 6; i++) {
    await page.locator('.match-card.term[data-cardidx="' + i + '"]').click()
    await page.locator('.match-card.trans[data-cardidx="' + i + '"]').click()
  }
  await page.waitForSelector('.match-result')
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)

  // Seed localStorage via init script, then clear transient keys.
  await page.addInitScript(seedScript)
  await page.addInitScript(([k1, k2, k3]) => {
    localStorage.removeItem(k1) // fc_status
    localStorage.removeItem(k2) // fc_stats
    localStorage.removeItem(k3) // fc_records
  }, ['fc_status_' + SET_ID, 'fc_stats_' + SET_ID, 'fc_records_' + SET_ID])

  await page.goto(BASE)
  await goToSet(page)

  // 1) MODE SWITCHER: six modes + K8 tags
  const modeNames = await page.locator('.mode-btn').allInnerTexts()
  const joined = modeNames.join(' | ').replace(/\n/g, ' ')
  ok(
    joined.includes('Карточки') && joined.includes('Learn') && joined.includes('Write') &&
      joined.includes('Тест') && joined.includes('Match') && joined.includes('Blast'),
    'mode switcher shows all six modes: ' + joined
  )
  const k8tags = await page.locator('.mode-btn .mode-k8').allInnerTexts()
  ok(k8tags.length === 2 && k8tags.every((t) => t.includes('K8')), 'Match and Blast carry the K8 tag (got ' + k8tags.join(',') + ')')

  // 2) MATCH MODE
  await page.getByRole('tab', { name: /Match/ }).click()
  await page.waitForSelector('.match-intro')
  const startText = (await page.locator('.match-intro').innerText()).replace(/\s+/g, ' ').trim()
  ok(/6 пар/.test(startText), 'match start screen explains the 6-pair goal')

  // Clear stats right before the run so ONLY match view-counts are observed
  // (cards-mode already counted a view for the mounted card on load).
  await page.evaluate((k) => localStorage.setItem(k, '{}'), 'fc_stats_' + SET_ID)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.waitForSelector('.match-grid')
  const termCount = await page.locator('.match-card.term').count()
  const transCount = await page.locator('.match-card.trans').count()
  ok(termCount === 6 && transCount === 6, 'match renders 6 terms and 6 shuffled translations (T=' + termCount + ', R=' + transCount + ')')

  const t1 = (await page.locator('.match-timer').innerText()).trim()
  await page.waitForTimeout(300)
  const t2 = (await page.locator('.match-timer').innerText()).trim()
  ok(t2 !== t1, 'match timer runs while playing ("' + t1 + '" -> "' + t2 + '")')

  // First (prime) run: deliberately slower so a later fast run can beat it.
  await solveMatch(page, 500)
  const rec1 = await getLS(page, 'fc_records_' + SET_ID)
  ok(rec1 && rec1.ms > 0, 'best record persisted under fc_records_<id> (' + JSON.stringify(rec1) + ')')
  const resText = (await page.locator('.match-result').innerText()).replace(/\s+/g, ' ').trim()
  ok(/Лучший результат/.test(resText), 'match result screen shows "лучший результат" (' + resText + ')')
  ok(/Готово/.test(resText), 'match result screen says done and shows elapsed time')

  // Correct matches updated statuses + view counters.
  const statuses = await getLS(page, 'fc_status_' + SET_ID)
  const allL = Object.keys(statuses).every((k) => statuses[k] === 'learning')
  ok(allL && Object.keys(statuses).length === 6, 'all 6 matched cards -> learning after one correct turn (statuses=' + JSON.stringify(statuses) + ')')
  const stats = await getLS(page, 'fc_stats_' + SET_ID)
  const statsOk = ['0', '1', '2', '3', '4', '5'].every((k) => stats[k] === 1)
  ok(statsOk, 'all 6 correct matches recorded a view count of 1 (stats=' + JSON.stringify(stats) + ')')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k8_match.png' })

  // Slower re-run must NOT overwrite the record.
  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await page.waitForSelector('.match-grid')
  await solveMatch(page, 1200)
  const rec2 = await getLS(page, 'fc_records_' + SET_ID)
  ok(rec2.ms === rec1.ms, 'slower re-run did not overwrite the best record (' + rec1.ms + 'ms stays)')

  // Faster re-run MUST overwrite.
  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await page.waitForSelector('.match-grid')
  await solveMatch(page, 0)
  const rec3 = await getLS(page, 'fc_records_' + SET_ID)
  ok(rec3.ms < rec1.ms, 'faster re-run overwrote the record (' + rec1.ms + 'ms -> ' + rec3.ms + 'ms)')

  // 3) BLAST MODE
  // Fresh statuses/stats so we can observe Blast-progress updates.
  await page.evaluate(([a, b, c]) => {
    localStorage.setItem(a, '{}')
    localStorage.setItem(b, '{}')
    localStorage.setItem(c, '{}')
  }, ['fc_status_' + SET_ID, 'fc_stats_' + SET_ID, 'fc_records_' + SET_ID])

  await page.getByRole('tab', { name: /Blast/ }).click()
  await page.waitForSelector('.blast-intro')
  await page.getByRole('button', { name: 'Старт' }).click()
  await page.waitForSelector('.blast-board')

  const blockCount = await page.locator('.blast-block').count()
  ok(blockCount === 4, 'blast level 1 shows 4 floating translation blocks (got ' + blockCount + ')')
  const qWord = (await page.locator('.blast-q .quiz-word').innerText()).trim()
  ok(/^word\d/.test(qWord), 'blast center shows a term (' + qWord + ')')

  // Click the correct block -> score increases + status learning.
  const firstQIdx = parseInt(qWord.replace('word', ''), 10)
  await page.locator('.blast-block[data-correct="true"]').click({ force: true })
  await page.waitForSelector('.study-feedback.correct')
  const scoreAfterCorrect = (await page.locator('.blast-score').innerText()).trim()
  ok(/Очки: 1/.test(scoreAfterCorrect), 'correct click increased score to 1 (' + scoreAfterCorrect + ')')
  let st = (await getLS(page, 'fc_status_' + SET_ID))[String(firstQIdx)]
  ok(st === 'learning', 'blast correct answer -> status learning for card ' + firstQIdx + ' (got ' + st + ')')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k8_blast.png' })

  // Click a wrong block -> penalty (score decreases, a life is lost).
  await page.getByRole('button', { name: 'Далее' }).click()
  await page.waitForSelector('.blast-board')
  const livesBefore = (await page.locator('.blast-lives').innerText()).split('❤️').length - 1
  await page.locator('.blast-block[data-correct="false"]').first().click({ force: true })
  await page.waitForSelector('.study-feedback.wrong')
  const scoreAfterWrong = (await page.locator('.blast-score').innerText()).trim()
  ok(/Очки: 0/.test(scoreAfterWrong), 'wrong click penalty reduced score back to 0 (' + scoreAfterWrong + ')')
  const livesAfter = (await page.locator('.blast-lives').innerText()).split('❤️').length - 1
  ok(livesAfter === livesBefore - 1, 'wrong click cost one life (' + livesBefore + ' -> ' + livesAfter + ' hearts)')

  // Run out of hearts -> game-over end screen with the score counter.
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Далее' }).click()
    await page.waitForSelector('.blast-board')
    await page.locator('.blast-block[data-correct="false"]').first().click({ force: true })
    // The final wrong click ends the game immediately (done screen, no feedback).
    await page.waitForSelector('.blast-result, .study-feedback.wrong')
  }
  await page.waitForSelector('.blast-result')
  const endText = (await page.locator('.blast-result').innerText()).replace(/\s+/g, ' ').trim()
  ok(/Игра окончена/.test(endText), 'blast end screen shows game over')
  ok(/Очки: \d+/.test(endText), 'blast end screen shows the score counter (' + endText + ')')

  console.log('\n==== SUMMARY ====')
  const fails = results.filter((r) => !r.ok)
  console.log('Total: ' + results.length + ', Passed: ' + (results.length - fails.length) + ', Failed: ' + fails.length)
  await browser.close()
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
