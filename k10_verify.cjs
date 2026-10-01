const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:5174'
const SET_ID = 'k10-test-set'

const DATA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const CARDS = [
  { word: 'apple', translation: 'яблоко', image: DATA_PNG },
  { word: 'dog', translation: 'собака', image: 'https://invalid.example.com/nope.png' },
  { word: 'cat', translation: 'кошка' },
  { word: 'bird', translation: 'птица' },
  { word: 'fish', translation: 'рыба' },
  { word: 'tree', translation: 'дерево' },
]

let results = []
function ok(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg)
}

async function getLS(page, key) {
  return page.evaluate((k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : {} }, key)
}

const seedScript = `
  (() => {
    const set = { id: ${JSON.stringify(SET_ID)}, topic: 'Набор K10', cards: ${JSON.stringify(CARDS)} };
    let sets = [];
    try { sets = JSON.parse(localStorage.getItem('fc_sets') || '[]'); } catch (e) { }
    if (!sets.some(s => s.id === ${JSON.stringify(SET_ID)})) sets.push(set);
    localStorage.setItem('fc_sets', JSON.stringify(sets));

    try {
      const spoken = [];
      window.__spoken = spoken;
      window.SpeechSynthesisUtterance = function (text) { this.text = text; this.lang = ''; this.voice = null; };
      // Override methods on the existing SpeechSynthesis object (it cannot be
      // reassigned in Chromium), so speakEnglish() calls are observable.
      const s = window.speechSynthesis;
      s.speak = function (u) { spoken.push({ text: u && u.text, lang: u && u.lang }); };
      s.cancel = function () {};
      s.getVoices = function () { return [{ lang: 'en-US', name: 'Mock English' }]; };
    } catch (e) {}
  })();
`

async function clearKeys(page) {
  await page.evaluate((setId) => {
    localStorage.removeItem('fc_status_' + setId)
    localStorage.removeItem('fc_stats_' + setId)
    localStorage.removeItem('fc_records_' + setId)
    localStorage.removeItem('fc_daily_stats')
    localStorage.removeItem('fc_autospeak')
    localStorage.removeItem('fc_play_interval')
    localStorage.removeItem('fc_priority_mode')
  }, SET_ID)
}

async function openSet(page) {
  await page.waitForSelector('.set-card-main')
  await page.click('.set-card-main')
  await page.waitForSelector('.mode-switcher')
}

const goToCard = async (page, word) => {
  // Walk forward/back toward a specific displayed word by reading the progress
  // count and stepping (deck resets are handled by caller when order is unknown).
  for (let i = 0; i < 12; i++) {
    const w = (await page.locator('.face-word').innerText()).trim()
    if (w === word) return true
    const prog = (await page.locator('.deck-progress').innerText()).trim() // e.g. "Карточка 2 из 6"
    const cur = Number(prog.match(/Карточка (\d+)/)[1])
    const total = Number(prog.match(/из (\d+)/)[1])
    if (cur <= 1) { await page.locator('.deck-controls button', { hasText: 'Вперёд' }).click() }
    else { await page.locator('.deck-controls button', { hasText: '← Назад' }).click() }
  }
  return (await page.locator('.face-word').innerText()).trim() === word
}

const press = (page, key) => page.evaluate((k) => {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}, key)

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)

  await page.addInitScript(seedScript)
  await page.goto(BASE)
  await clearKeys(page)
  await page.reload()
  await openSet(page)

  // ---------- 1) TTS + CONTROLS ----------
  const keywords = {
    speak: await page.locator('[data-testid="speak-btn"]').count(),
    play: await page.locator('[data-testid="play-toggle"]').count(),
    interval: await page.locator('[data-testid="play-interval"]').count(),
    shuffle: await page.locator('[data-testid="shuffle-btn"]').count(),
    fullscreen: await page.locator('[data-testid="fullscreen-btn"]').count(),
    star: await page.locator('[data-testid="star-btn"]').count(),
    hints: await page.locator('[data-testid="keys-hints"]').count(),
  }
  ok(
    keywords.speak && keywords.play && keywords.interval && keywords.shuffle && keywords.fullscreen && keywords.star && keywords.hints,
    'cards view shows all K10 controls (speak/play/interval/shuffle/fullscreen/star/hints) ' + JSON.stringify(keywords)
  )

  // Speaker button speaks the English word through speechSynthesis.
  await page.locator('[data-testid="speak-btn"]').click()
  await page.waitForFunction(() => window.__spoken && window.__spoken.length > 0, null, { timeout: 4000 })
  const spoken = await page.evaluate(() => window.__spoken)
  ok(spoken.length >= 1 && spoken[0].text === 'apple', 'speaker button speaks the shown word (got "' + (spoken[0] && spoken[0].text) + '")')
  ok(spoken[0] && /^en/i.test(spoken[0].lang), 'spoken utterance uses an English voice/lang (got ' + (spoken[0] && spoken[0].lang) + ')')

  // Auto-speak toggle persists + speaks on card show.
  await page.locator('label.priority-toggle', { hasText: 'Автоозвучка' }).click()
  ok((await page.evaluate(() => localStorage.getItem('fc_autospeak'))) === '1', 'auto-speak toggle persists as fc_autospeak=1')
  await page.locator('.deck-controls button', { hasText: 'Вперёд' }).click()
  await page.waitForFunction(() => window.__spoken.some((s) => s.text === 'dog'), null, { timeout: 4000 })
  ok(true, 'auto-speak speaks the newly shown card (dog) when auto-ozvuchka is on')

  // ---------- 2) IMAGES ----------
  ok(await goToCard(page, 'apple'), 'walked back to the image card (apple)')
  const imgCount = await page.locator('.flashcard .card-image').count()
  ok(imgCount >= 1, 'a card with an image field renders an <img> (count=' + imgCount + ')')
  ok(await goToCard(page, 'dog'), 'reached the broken-image card (dog)')
  const dogWord = (await page.locator('.face-word').innerText()).trim()
  ok(dogWord === 'dog', 'broken-image card still shows its word (onError fallback keeps the deck working, got "' + dogWord + '")')

  // Screenshot: cards view with all K10 controls + an image card.
  await goToCard(page, 'apple')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k10_ux.png', fullPage: true })

  // ---------- 3) AUTOPLAY ----------
  await page.selectOption('[data-testid="play-interval"]', '3')
  ok((await page.evaluate(() => localStorage.getItem('fc_play_interval'))) === '3', 'play interval selection persists as fc_play_interval=3')
  // go to the last card first, then start autoplay to test stop-at-end.
  for (let i = 0; i < 10; i++) {
    const next = page.locator('.deck-controls button', { hasText: 'Вперёд' })
    const disabled = await next.isDisabled()
    if (disabled) break
    await next.click()
  }
  const lastProg = (await page.locator('.deck-progress').innerText()).trim()
  ok(lastProg.includes('6 из 6'), 'navigated to the last card for autoplay test (' + lastProg + ')')
  await page.locator('[data-testid="play-toggle"]').click()
  const playLabel = (await page.locator('[data-testid="play-toggle"]').innerText()).trim()
  ok(playLabel.includes('Пауза'), 'Play button toggles to pause while running (got "' + playLabel + '")')
  // At the end, autoplay stops and resets to card 1.
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="play-toggle"]')
    return el && el.textContent.includes('Play') && document.querySelector('.deck-progress').textContent.includes('1 из 6')
  }, null, { timeout: 8000 })
  ok(true, 'autoplay stops at the end and flips back to the start')
  // Autoplay advances during a run.
  await page.locator('[data-testid="play-toggle"]').click()
  await page.waitForFunction(() => document.querySelector('.deck-progress').textContent.includes('2 из 6'), null, { timeout: 5000 })
  ok(true, 'autoplay auto-advances the deck every interval')
  await page.locator('[data-testid="play-toggle"]').click() // stop

  // ---------- 4) SHORTCUTS ----------
  const hints = (await page.locator('[data-testid="keys-hints"]').innerText()).trim()
  ok(/← →/.test(hints) && /Пробел/.test(hints) && /S/.test(hints) && /P/.test(hints), 'keys hints line is shown (' + hints.replace(/\s+/g, ' ').trim() + ')')
  // ensure we are at card 1: restart deck (resets to ordered [0..5], pos 0)
  await page.locator('.deck-toolbar button', { hasText: 'Заново' }).click()
  await page.waitForFunction(() => document.querySelector('.deck-progress').textContent.includes('1 из 6'), null, { timeout: 3000 })
  await press(page, 'ArrowRight')
  await page.waitForFunction(() => document.querySelector('.deck-progress').textContent.includes('2 из 6'), null, { timeout: 3000 })
  ok(true, 'ArrowRight advances to the next card (shortcut)')
  await press(page, ' ')
  await page.waitForFunction(() => document.querySelector('.flashcard').classList.contains('flipped'), null, { timeout: 3000 })
  ok(true, 'Space flips the card (shortcut)')
  await press(page, 's')
  const shuffPos = (await page.locator('.deck-progress').innerText()).trim()
  ok(shuffPos.includes('1 из 6'), 'S shuffle resets the deck to card 1 (got "' + shuffPos + '")')
  await press(page, 'p')
  await page.waitForFunction(() => document.querySelector('[data-testid="play-toggle"]').textContent.includes('Пауза'), null, { timeout: 3000 })
  await press(page, 'p') // stop
  ok(true, 'P toggles play/pause (shortcut)')
  await page.waitForTimeout(300)

  // Shuffle actually randomizes: collect first word over several draws.
  const seen = new Set()
  for (let i = 0; i < 10; i++) {
    seen.add((await page.locator('.face-word').innerText()).trim())
    if (seen.size > 1) break
    await page.locator('[data-testid="shuffle-btn"]').click()
  }
  ok(seen.size > 1, 'shuffle randomizes the display order (distinct first cards seen: ' + seen.size + ')')

  // ---------- 5) FULLSCREEN ----------
  await page.locator('[data-testid="fullscreen-btn"]').click()
  await page.waitForSelector('[data-testid="fs-overlay"]')
  const fsCard = await page.locator('[data-testid="fs-overlay"] .flashcard').count()
  const fsExit = await page.locator('.fs-exit').count()
  ok(fsCard === 1 && fsExit === 1, 'fullscreen overlay shows one big card with an exit control')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k10_fullscreen.png', fullPage: true })
  await page.locator('.fs-exit').click()
  await page.waitForTimeout(300)
  ok((await page.locator('[data-testid="fs-overlay"]').count()) === 0, 'fullscreen exit control closes the overlay')

  // ---------- 6) STARS + starred-only filter ----------
  // Star whichever card is currently shown (robust regardless of deck order).
  const currentWord = (await page.locator('.face-word').innerText()).trim()
  const starIdx = CARDS.findIndex((c) => c.word === currentWord)
  await page.locator('[data-testid="star-btn"]').click()
  const stats = await getLS(page, 'fc_stats_' + SET_ID)
  ok(stats._stars && stats._stars[String(starIdx)] === true, 'star button persists starred=true for card ' + starIdx + ' (' + currentWord + ') in fc_stats_ (got ' + JSON.stringify(stats._stars) + ')')
  ok((await page.locator('[data-testid="star-btn"]').innerText()).trim() === '★', 'star button shows a filled star after starring')
  await page.locator('label.priority-toggle', { hasText: 'Только помеченные' }).click()
  await page.waitForFunction(() => document.querySelector('.deck-progress').textContent.includes('1 из 1'), null, { timeout: 3000 })
  ok(true, 'starred-only filter shows just the starred card (1 из 1)')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k10_starred.png', fullPage: true })
  // Unstar -> no starred cards -> empty placeholder.
  await page.locator('[data-testid="star-btn"]').click()
  await page.waitForSelector('[data-testid="no-starred"]', { timeout: 4000 })
  ok((await page.locator('[data-testid="no-starred"]').innerText()).includes('Нет помеченных'), 'starred-only with no stars shows the empty placeholder')

  // ---------- 7) SHUFFLE IN LEARN ----------
  await page.getByRole('tab', { name: /Learn/ }).click()
  await page.waitForSelector('.study-toolbar')
  await page.waitForSelector('.study-prompt')
  const learnShuffle = await page.locator('.study-toolbar button', { hasText: 'Перемешать' }).count()
  ok(learnShuffle >= 1, 'Learn mode shows a shuffle button')

  console.log('\n==== SUMMARY ====')
  const fails = results.filter((r) => !r.ok)
  console.log('Total: ' + results.length + ', Passed: ' + (results.length - fails.length) + ', Failed: ' + fails.length)
  await browser.close()
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
