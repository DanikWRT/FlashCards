const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:5174'
const SET_ID = 'k7-test-set'

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

async function seed(page) {
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.goto(BASE)
  const sets = await page.evaluate(() => { const r = localStorage.getItem('fc_sets'); return r ? JSON.parse(r) : [] })
  if (!sets.some((s) => s.id === SET_ID)) {
    sets.push({ id: SET_ID, topic: 'Набор K7', cards: CARDS })
    await page.evaluate((v) => localStorage.setItem('fc_sets', JSON.stringify(v)), sets)
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), ['fc_status_' + SET_ID, {}])
  await page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), ['fc_stats_' + SET_ID, {}])
}

async function goToSet(page) {
  await page.goto(BASE + '/set/' + SET_ID)
  await page.waitForSelector('.mode-switcher')
}

async function solveMatching(page, wantWrong) {
  const lefts = page.locator('.match-item.left')
  const leftCount = await lefts.count()
  const rightCount = await page.locator('.match-item.right').count()
  ok(leftCount >= 4 && rightCount >= 4, 'matching renders >=4 left & right items (L=' + leftCount + ', R=' + rightCount + ')')
  const leftIdx = []
  for (let i = 0; i < leftCount; i++) leftIdx.push(await lefts.nth(i).getAttribute('data-cardidx'))
  const rightIdx = []
  for (let i = 0; i < rightCount; i++) rightIdx.push(await page.locator('.match-item.right').nth(i).getAttribute('data-cardidx'))
  const usedRight = new Set()
  for (let i = 0; i < leftCount; i++) {
    const li = leftIdx[i]
    let ri
    if (wantWrong && i === 0) {
      ri = rightIdx.find((x) => x !== li && !usedRight.has(x))
    } else {
      ri = rightIdx.find((x) => x === li && !usedRight.has(x)) || rightIdx.find((x) => !usedRight.has(x))
    }
    usedRight.add(ri)
    await lefts.nth(leftIdx.indexOf(li)).click()
    await page.locator('.match-item.right[data-cardidx="' + ri + '"]').first().click()
  }
  await page.getByRole('button', { name: 'Проверить пары' }).click()
  await page.waitForSelector('.matching-feedback')
}

async function solveChoice(page, wantWrong) {
  const prompt = (await page.locator('.quiz-word').innerText()).trim()
  const cidx = parseInt(prompt.replace(/\D/g, ''), 10)
  const correctVal = 'пер' + cidx
  const count = await page.locator('.quiz-choice').count()
  ok(count === 4, 'choice question renders 4 options (got ' + count + ')')
  let target
  if (wantWrong) {
    target = page.locator('.quiz-choice').filter({ hasNotText: new RegExp('^' + correctVal + '$') }).first()
  } else {
    target = page.locator('.quiz-choice').filter({ hasText: correctVal }).first()
  }
  await target.click()
  await page.waitForSelector('.quiz-next')
}

async function solveTyped(page, wantWrong) {
  const prompt = (await page.locator('.quiz-word').innerText()).trim()
  const cidx = parseInt(prompt.replace(/\D/g, ''), 10)
  await page.fill('[data-testid="typed-input"]', wantWrong ? 'zzznope' : 'пер' + cidx)
  await page.getByRole('button', { name: 'Проверить' }).click()
  await page.waitForSelector('.quiz-next')
}

async function solveTf(page, wantWrong) {
  const prompt = (await page.locator('.quiz-word').innerText()).trim()
  const cidx = parseInt(prompt.replace(/\D/g, ''), 10)
  const presented = (await page.locator('.tf-statement').innerText()).trim()
  const truthful = presented === 'пер' + cidx
  const wantYes = wantWrong ? !truthful : truthful
  await page.locator('.tf-btn').filter({ hasText: wantYes ? /Да/ : /Нет/ }).first().click()
  await page.waitForSelector('.quiz-next')
}

async function answerCurrent(page, wantWrong) {
  await page.waitForTimeout(60)
  if ((await page.locator('.match-board').count()) > 0) return solveMatching(page, wantWrong)
  if ((await page.locator('[data-testid="typed-input"]').count()) > 0) return solveTyped(page, wantWrong)
  if ((await page.locator('.tf-actions').count()) > 0) return solveTf(page, wantWrong)
  if ((await page.locator('.quiz-choices').count()) > 0) return solveChoice(page, wantWrong)
  throw new Error('Unknown question type')
}

async function runTestToEnd(page) {
  let guard = 0
  let first = true
  let seenTypes = new Set()
  while (guard < 100) {
    guard++
    if ((await page.locator('.quiz-result').count()) > 0) break
    if ((await page.locator('.match-board').count()) > 0) seenTypes.add('matching')
    else if ((await page.locator('[data-testid="typed-input"]').count()) > 0) seenTypes.add('typed')
    else if ((await page.locator('.tf-actions').count()) > 0) seenTypes.add('tf')
    else if ((await page.locator('.quiz-choices').count()) > 0) seenTypes.add('choice')
    await answerCurrent(page, first)
    first = false
    await page.locator('.quiz-next').click()
    await page.waitForTimeout(60)
  }
  ok((await page.locator('.quiz-result').count()) > 0, 'test reached result screen')
  return seenTypes
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)

  await seed(page)
  await goToSet(page)

  // MODE SWITCHER: five modes
  const modeNames = await page.locator('.mode-btn').allInnerTexts()
  const joined = modeNames.join(' | ').replace(/\n/g, ' ')
  ok(joined.includes('Карточки') && joined.includes('Learn') && joined.includes('Write') && joined.includes('Тест') && joined.includes('Spell'),
    'mode switcher shows all 5 modes: ' + joined)

  // SPELL MODE
  await page.getByRole('tab', { name: /Spell/ }).click()
  await page.waitForSelector('[data-testid="spell-input"]')
  ok((await page.locator('[data-testid="spell-repeat"]').count()) === 1, 'spell repeat-audio button renders')
  ok((await page.locator('.spell-hint').count()) === 1, 'spell shows first-letter hint')

  const answer = (await page.locator('[data-testid="spell-input"]').getAttribute('data-answer')).trim()
  ok(answer === 'word1', 'spell first adaptive card is word1 (got "' + answer + '")')

  await page.fill('[data-testid="spell-input"]', '  ' + answer.toUpperCase() + '  ')
  await page.getByRole('button', { name: 'Проверить' }).click()
  await page.waitForSelector('.study-feedback.correct')
  ok(true, 'spell correct answer (case-insensitive + trim) accepted')
  let st = (await getLS(page, 'fc_status_' + SET_ID))['1']
  ok(st === 'learning', 'spell one correct -> status learning (got ' + st + ')')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k7_spell.png' })
  await page.locator('.quiz-next').click()
  await page.waitForTimeout(150)

  await page.fill('[data-testid="spell-input"]', 'bsbogus')
  await page.getByRole('button', { name: 'Проверить' }).click()
  await page.waitForSelector('.study-feedback.wrong')
  const wrongTxt = (await page.locator('.study-feedback.wrong').innerText()).trim()
  ok(/Неверно/.test(wrongTxt), 'spell wrong answer highlights feedback (' + wrongTxt + ')')
  const wrongCardIdx = (await page.locator('[data-testid="spell-input"]').getAttribute('data-answer')).replace('word', '')
  st = (await getLS(page, 'fc_status_' + SET_ID))[wrongCardIdx]
  ok(st === 'learning', 'spell error -> status learning (got ' + st + ')')

  // EXTENDED TEST
  await page.getByRole('tab', { name: /Тест/ }).click()
  await page.waitForSelector('.test-settings')

  const typeLabels = await page.locator('.settings-check-name').allInnerTexts()
  const typesJoined = typeLabels.join(' | ')
  ok(typesJoined.includes('Выбор ответа') && typesJoined.includes('Ввод ответа') &&
    typesJoined.includes('Сопоставление') && typesJoined.includes('Правда/ложь'),
    'settings shows all 4 question-type checkboxes: ' + typesJoined)
  ok((await page.locator('.quiz-dir-btn').count()) === 2, 'settings shows direction toggle (en-ru/ru-en)')
  ok((await page.locator('input[type="radio"]').count()) === 2, 'settings shows question-count option (all / N)')
  ok((await page.getByText('Включить таймер').count()) === 1, 'settings shows timer option')
  const allChecked = await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('.settings-check:not(.inline) input[type=checkbox]'))
    return boxes.length === 4 && boxes.every((b) => b.checked)
  })
  ok(allChecked, 'all 4 question-type checkboxes checked by default')

  await page.getByRole('button', { name: 'Начать тест' }).click()
  await page.waitForSelector('.quiz')

  const seen = await runTestToEnd(page)
  ok(seen.size >= 2, 'multiple question types were exercised: ' + Array.from(seen).join(','))

  const scoreTxt = (await page.locator('.quiz-result-score').innerText()).trim()
  ok(/из 6/.test(scoreTxt), 'result shows score line (' + scoreTxt + ')')
  const errCount = await page.locator('.result-errors li').count()
  ok(errCount >= 1, 'result shows error breakdown with >=1 wrong card (got ' + errCount + ')')
  ok((await page.locator('.result-errors li').first().locator('.re-correct').count()) === 1, 'error breakdown shows correct answer')
  ok((await page.getByRole('button', { name: 'Повторить ошибочные' }).count()) === 1, 'result shows retry-on-errors button')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k7_test.png' })

  await page.getByRole('button', { name: 'Повторить ошибочные' }).click()
  await page.waitForTimeout(150)
  const meta = (await page.locator('.quiz-count').innerText()).trim()
  ok(/Вопрос 1 из \d+/.test(meta), 'retry re-ran with a reduced question set (' + meta + ')')
  await runTestToEnd(page)
  ok((await page.locator('.quiz-result').count()) > 0, 'retry pass finished with a result screen')
  ok((await getLS(page, 'fc_stats_' + SET_ID)) !== null, 'stats key intact after test')

  console.log('\n==== SUMMARY ====')
  const fails = results.filter((r) => !r.ok)
  console.log('Total: ' + results.length + ', Passed: ' + (results.length - fails.length) + ', Failed: ' + fails.length)
  await browser.close()
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
