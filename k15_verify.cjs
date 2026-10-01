/* K15 verification: global keyboard shortcuts + collapsible legend. */
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = 'http://127.0.0.1:5199'
const SET_ID = 'parts-of-the-body'
const SAMPLE = JSON.parse(fs.readFileSync('public/sample.json', 'utf8'))
const SET = Object.assign({ id: SET_ID }, SAMPLE)

let results = []
function ok(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg)
}

const seedScript = `
  (() => {
    const set = ${JSON.stringify(SET)};
    let sets = [];
    try { sets = JSON.parse(localStorage.getItem('fc_sets') || '[]'); } catch(e){}
    if (!sets.some(s => s.id === ${JSON.stringify(SET_ID)})) sets.push(set);
    localStorage.setItem('fc_sets', JSON.stringify(sets));
  })();
`

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.setDefaultTimeout(10000)
  await page.addInitScript(seedScript)

  await page.goto(BASE + '/set/' + SET_ID)
  await page.waitForSelector('.flashcard')

  // ---- 1. Legend present in cards mode; '?' toggles the table ----
  ok(await page.isVisible('[data-testid="kb-toggle"]'), 'legend ? button visible in cards mode')
  ok(!(await page.isVisible('[data-testid="kb-table"]')), 'legend table hidden by default (collapsed)')
  await page.click('[data-testid="kb-toggle"]')
  await page.waitForSelector('[data-testid="kb-table"]')
  const rows = await page.$$eval('[data-testid="kb-table"] tbody tr', (trs) => trs.map((t) => t.innerText))
  ok(rows.length === 7, 'legend has 7 shortcut rows (got ' + rows.length + ')')
  const joined = rows.join('\n')
  for (const label of ['← / →', 'Пробел', 'Enter', 'S', 'P', 'F', 'Esc']) {
    ok(joined.includes(label), 'legend contains key ' + label)
  }
  for (const label of ['предыдущая', 'перевернуть', 'проверить ответ', 'перемешать', 'play / пауза', 'полный экран', 'закрыть полный экран']) {
    ok(joined.includes(label), 'legend contains russian label "' + label + '"')
  }
  // collapse again
  await page.click('[data-testid="kb-toggle"]')
  ok(!(await page.isVisible('[data-testid="kb-table"]')), 'legend collapses again')

  // ---- 2. Space flips ----
  ok(!(await page.$eval('.flashcard', (el) => el.classList.contains('flipped'))), 'card not flipped initially')
  await page.keyboard.press('Space')
  await page.waitForTimeout(700)
  ok(await page.$eval('.flashcard', (el) => el.classList.contains('flipped')), 'Space flips the card')
  await page.keyboard.press('Space')
  await page.waitForTimeout(700)
  ok(!(await page.$eval('.flashcard', (el) => el.classList.contains('flipped'))), 'Space un-flips the card')

  // ---- 3. 's' shuffles (displayed top card changes across repeats) ----
  const firstWord = await page.$eval('.flashcard .front .face-word', (el) => el.textContent.trim())
  let changed = false
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('s')
    await page.waitForTimeout(60)
    const w = await page.$eval('.flashcard .front .face-word', (el) => el.textContent.trim())
    if (w !== firstWord) { changed = true; break }
  }
  ok(changed, 's shuffles the deck (top card changed)')

  // ---- 4. 'f' toggles fullscreen; Escape closes ----
  await page.keyboard.press('f')
  await page.waitForSelector('[data-testid="fs-overlay"]')
  ok(await page.isVisible('[data-testid="fs-overlay"]'), 'f opens fullscreen overlay in cards mode')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  ok(!(await page.isVisible('[data-testid="fs-overlay"]')), 'Escape closes fullscreen')

  // ---- 5. Input-focus guard: letter 'f' must NOT fire while typing ----
  await page.focus('.priority-toggle input[type=checkbox]')
  await page.waitForTimeout(100)
  await page.keyboard.press('f')
  await page.waitForTimeout(150)
  ok(!(await page.isVisible('[data-testid="fs-overlay"]')), 'guard: f does NOT open fullscreen while an input is focused')
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await page.waitForTimeout(100)
  await page.keyboard.press('f')
  await page.waitForSelector('[data-testid="fs-overlay"]')
  ok(await page.isVisible('[data-testid="fs-overlay"]'), 'f opens fullscreen when focus is outside an input')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)

  // ---- 6. Legend reachable in a non-cards mode + write-input guard + global f ----
  await page.click('.mode-btn:has-text("Write")')
  await page.waitForSelector('.write-input')
  ok(await page.isVisible('[data-testid="kb-toggle"]'), 'legend ? button visible in Write mode')
  await page.click('[data-testid="kb-toggle"]')
  await page.waitForSelector('[data-testid="kb-table"]')
  ok(await page.isVisible('[data-testid="kb-table"]'), 'legend table opens in Write mode')
  await page.click('[data-testid="kb-toggle"]')

  // write-input is autoFocused -> typing 'f' must NOT open fullscreen
  await page.focus('.write-input')
  await page.waitForTimeout(100)
  await page.keyboard.press('f')
  await page.waitForTimeout(150)
  ok(!(await page.isVisible('[data-testid="fs-overlay"]')), 'guard: f does NOT open fullscreen while .write-input focused')
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await page.waitForTimeout(100)
  await page.keyboard.press('f')
  await page.waitForSelector('[data-testid="fs-overlay"]')
  ok(await page.isVisible('[data-testid="fs-overlay"]'), 'f opens fullscreen in Write mode when not typing')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  ok(!(await page.isVisible('[data-testid="fs-overlay"]')), 'Escape closes fullscreen in Write mode')

  // ---- Screenshot: legend OPEN on the set page ----
  await page.click('.mode-btn:has-text("Карточки")')
  await page.waitForSelector('.flashcard')
  await page.click('[data-testid="kb-toggle"]')
  await page.waitForSelector('[data-testid="kb-table"]')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k15_legend.png' })
  console.log('saved fc_k15_legend.png')

  // ---- Screenshot: fullscreen via 'f' ----
  await page.click('[data-testid="kb-toggle"]') // collapse legend
  await page.waitForTimeout(100)
  await page.evaluate(() => document.activeElement && document.activeElement.blur())
  await page.keyboard.press('f')
  await page.waitForSelector('[data-testid="fs-overlay"]')
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k15_fullscreen.png' })
  console.log('saved fc_k15_fullscreen.png')

  await browser.close()

  const fails = results.filter((r) => !r.ok).length
  console.log('')
  console.log('RESULT: ' + (results.length - fails) + ' passed, ' + fails + ' failed')
  if (fails > 0) process.exit(1)
})().catch((e) => { console.error(e); process.exit(2) })
