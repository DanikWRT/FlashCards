const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:5174'
const LEARN_ID = 'k6-learn-set-0001'
const WRITE_ID = 'k6-write-set-0001'

function makeCards(n) {
  const arr = []
  for (let i = 0; i < n; i++) {
    arr.push({ word: 'word' + i, translation: 'пер' + i })
  }
  return arr
}

const LEARN_CARDS = makeCards(6)
const WRITE_CARDS = makeCards(6)

let results = []
function ok(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg)
}

async function getLS(page, key) {
  return page.evaluate((k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : {} }, key)
}

function idxByWord(cards, w) { return cards.findIndex((c) => c.word === w) }

async function seed(page, setId, cards, statuses) {
  const sets = await page.evaluate(() => { const r = localStorage.getItem('fc_sets'); return r ? JSON.parse(r) : [] })
  if (!sets.some((s) => s.id === setId)) {
    sets.push({ id: setId, topic: 'Набор ' + setId, cards })
    await page.evaluate((v) => localStorage.setItem('fc_sets', JSON.stringify(v)), sets)
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), ['fc_status_' + setId, statuses || {}])
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), ['fc_stats_' + setId, {}])
}

async function readPrompt(page) {
  for (let i = 0; i < 40; i++) {
    const t = ((await page.locator('.study-prompt').innerText().catch(() => '')) || '').trim()
    if (t) return t
    await page.waitForTimeout(50)
  }
  return ((await page.locator('.study-prompt').innerText().catch(() => '')) || '').trim()
}

async function goToSet(page, setId) {
  await page.goto(BASE + '/set/' + setId)
  await page.waitForSelector('.mode-switcher')
}

function learnCorrectFor(cards, prompt) {
  // en-ru: prompt is a word, answer is its translation; ru-en the inverse.
  if (prompt.startsWith('word')) {
    const i = cards.findIndex((c) => c.word === prompt)
    return { idx: i, answer: cards[i].translation, isWordSide: true }
  }
  const i = cards.findIndex((c) => c.translation === prompt)
  return { idx: i, answer: cards[i].word, isWordSide: false }
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  // ==== LEARN MODE ====
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE)
  await seed(page, LEARN_ID, LEARN_CARDS, { '3': 'learning', '5': 'mastered' })
  await goToSet(page, LEARN_ID)

  const modeNames = await page.locator('.mode-btn').allInnerTexts()
  const joined = modeNames.join(' | ')
  ok(joined.includes('Карточки') && joined.includes('Learn') && joined.includes('Write') && joined.includes('Тест'),
    'mode switcher shows all 4 modes: ' + joined.replace(/\n/g, ' '))

  // Enter Learn. Default cards-mode mount records a view for card0, but the seeded
  // learning-status card 3 must still come first (rank beats view count).
  await page.getByRole('tab', { name: /Learn/ }).click()
  await page.waitForSelector('.study-prompt')
  let prompt = await readPrompt(page)
  ok(prompt === 'word3', 'learn adaptive order shows learning card first (got "' + prompt + '", want "word3")')

  // Direction toggle works in Learn.
  await page.getByRole('tab', { name: 'ru-en' }).click()
  await page.waitForTimeout(60)
  prompt = await readPrompt(page)
  ok(prompt === 'пер3', 'learn direction toggle ru-en shows translation (got "' + prompt + '")')
  await page.getByRole('tab', { name: 'en-ru' }).click()
  await page.waitForTimeout(60)
  prompt = await readPrompt(page)
  ok(prompt === 'word3', 'learn direction toggle back en-ru shows word (got "' + prompt + '")')

  // Wrong answer -> learning + correct highlighted.
  const choiceTexts = await page.locator('.quiz-choice').allInnerTexts()
  const wrongVal = choiceTexts.find((t) => t.trim() !== 'пер3')
  await page.locator('.quiz-choice:has-text("' + wrongVal.trim() + '")').first().click()
  await page.waitForSelector('.study-feedback.wrong')
  const wrongTxt = (await page.locator('.study-feedback.wrong').innerText()).trim()
  ok(wrongTxt.includes('пер3'), 'learn wrong answer highlights correct (' + wrongTxt + ')')
  ok((await page.locator('.quiz-choice.correct').count()) >= 1, 'learn wrong answer marks the correct choice green')
  const st3 = (await getLS(page, 'fc_status_' + LEARN_ID))['3']
  ok(st3 === 'learning', 'learn error -> status learning (got ' + st3 + ')')
  await page.locator('.quiz-next').click()
  await page.waitForTimeout(80)

  // One correct answer -> status learning (dynamic card).
  prompt = await readPrompt(page)
  const cur = learnCorrectFor(LEARN_CARDS, prompt)
  await page.locator('.quiz-choice:has-text("' + cur.answer + '")').first().click()
  await page.waitForSelector('.study-feedback.correct')
  const stX = (await getLS(page, 'fc_status_' + LEARN_ID))[String(cur.idx)]
  ok(stX === 'learning', 'learn one correct -> status learning for card ' + cur.idx + ' (got ' + stX + ')')
  await page.locator('.quiz-next').click()

  // Drive until all mastered.
  let guard = 0
  let maxProgressSeen = ''
  while (guard < 200) {
    guard++
    const doneCount = await page.locator('.study-feedback').count()
    if ((await page.locator('.quiz-result').count()) > 0) break
    prompt = await readPrompt(page)
    const info = learnCorrectFor(LEARN_CARDS, prompt)
    if (doneCount === 0) {
      await page.locator('.quiz-choice:has-text("' + info.answer + '")').first().click()
      await page.waitForTimeout(60)
      maxProgressSeen = (await page.locator('.study-progress-label').innerText()).trim()
      if (guard === 1) {
        await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k6_learn.png' })
      }
    } else {
      await page.locator('.quiz-next').click()
    }
    await page.waitForTimeout(30)
  }

  ok((await page.locator('.quiz-result').count()) > 0, 'learn session ends in "все освоено" state')
  ok(/6 из 6/.test(maxProgressSeen), 'learn progress reached full mastery (' + maxProgressSeen + ')')
  const endSt = await getLS(page, 'fc_status_' + LEARN_ID)
  const allMastered = Object.keys(endSt).length === 6 && Object.values(endSt).every((s) => s === 'mastered')
  ok(allMastered, 'learn final statuses all mastered: ' + JSON.stringify(endSt))

  // ===== WRITE MODE =====
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE)
  await seed(page, WRITE_ID, WRITE_CARDS, {})
  await goToSet(page, WRITE_ID)
  await page.getByRole('tab', { name: /Write/ }).click()
  await page.waitForSelector('.write-input')

  // First card: card0 was viewed by the default cards-mode mount, so the adaptive
  // order should present a zero-view not_studied card first (word1).
  prompt = await readPrompt(page)
  ok(prompt === 'word1', 'write adaptive order shows zero-view card first (got "' + prompt + '")')

  // Case-insensitive + trimmed correct answer accepted (dynamic).
  let info = learnCorrectFor(WRITE_CARDS, prompt)
  await page.locator('.write-input').fill('  ' + info.answer.toUpperCase() + '  ')
  await page.locator('button', { hasText: 'Проверить' }).click()
  await page.waitForSelector('.study-feedback.correct')
  ok(true, 'write correct answer (case-insensitive + trim) accepted')
  await page.locator('.quiz-next').click()

  // Wrong answer -> correct highlighted + status learning.
  prompt = await readPrompt(page)
  info = learnCorrectFor(WRITE_CARDS, prompt)
  await page.locator('.write-input').fill('zzznope')
  await page.locator('button', { hasText: 'Проверить' }).click()
  await page.waitForSelector('.study-feedback.wrong')
  const wTxt = (await page.locator('.study-feedback.wrong').innerText()).trim()
  ok(wTxt.includes(info.answer), 'write wrong answer highlights correct (' + wTxt + ')')
  const wst = (await getLS(page, 'fc_status_' + WRITE_ID))[String(info.idx)]
  ok(wst === 'learning', 'write error -> status learning (got ' + wst + ')')
  await page.locator('.quiz-next').click()

  // "Не помню" skip -> wrong + shows correct.
  prompt = await readPrompt(page)
  info = learnCorrectFor(WRITE_CARDS, prompt)
  await page.locator('button', { hasText: 'Не помню' }).click()
  await page.waitForSelector('.study-feedback.wrong')
  const w2txt = (await page.locator('.study-feedback.wrong').innerText()).trim()
  ok(w2txt.includes(info.answer), 'write Не помню skip marks as wrong & shows correct')
  const wst2 = (await getLS(page, 'fc_status_' + WRITE_ID))[String(info.idx)]
  ok(wst2 === 'learning', 'write Не помню -> status learning')
  await page.locator('.quiz-next').click()

  // Direction toggle works in Write (ru-en): prompt = translation, typed answer = word.
  await page.getByRole('tab', { name: 'ru-en' }).click()
  await page.waitForTimeout(60)
  prompt = await readPrompt(page)
  info = learnCorrectFor(WRITE_CARDS, prompt) // returns word as answer when prompt is translation
  ok(!info.isWordSide, 'write direction toggle ru-en shows translation side (' + prompt + ')')
  await page.locator('.write-input').fill(info.answer)
  await page.locator('button', { hasText: 'Проверить' }).click()
  await page.waitForSelector('.study-feedback.correct')
  ok(true, 'write ru-en direction: typed word accepted as correct')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k6_write.png' })

  console.log('\n==== SUMMARY ====')
  const fails = results.filter((r) => !r.ok)
  console.log('Total: ' + results.length + ', Passed: ' + (results.length - fails.length) + ', Failed: ' + fails.length)
  await browser.close()
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
