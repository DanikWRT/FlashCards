const { chromium } = require('playwright')

const BASE = 'http://127.0.0.1:5174'

// Three seeded sets spread across folders/classes/leaderboard.
const SETS = [
  {
    id: 'k11-set-1', topic: 'Фрукты',
    cards: [
      { word: 'apple', translation: 'яблоко' },
      { word: 'pear', translation: 'груша' },
    ],
  },
  {
    id: 'k11-set-2', topic: 'Животные',
    cards: [
      { word: 'dog', translation: 'собака' },
      { word: 'cat', translation: 'кошка' },
    ],
  },
  {
    id: 'k11-set-3', topic: 'Цвета',
    cards: [
      { word: 'red', translation: 'красный' },
      { word: 'blue', translation: 'синий' },
      { word: 'green', translation: 'зелёный' },
    ],
  },
]

const MATCH_RECORDS = { // ms ascending: set-2 (9s) best, then set-1, then set-3
  'k11-set-2': 9000,
  'k11-set-1': 12000,
  'k11-set-3': 15000,
}
const BLAST_SCORES = { // descending: set-2 (12) best, then set-1, then set-3
  'k11-set-2': 12,
  'k11-set-1': 8,
  'k11-set-3': 5,
}

const seedScript = `
  (() => {
    const sets = ${JSON.stringify(SETS)};
    localStorage.setItem('fc_sets', JSON.stringify(sets));
    const mr = ${JSON.stringify(MATCH_RECORDS)};
    for (const k in mr) localStorage.setItem('fc_records_' + k, JSON.stringify({ ms: mr[k], date: '2024-01-01T00:00:00Z' }));
    const bs = ${JSON.stringify(BLAST_SCORES)};
    for (const k in bs) localStorage.setItem('fc_blast_' + k, JSON.stringify({ score: bs[k], date: '2024-01-01T00:00:00Z' }));
    // Capture clipboard writes for the share test.
    window.__clipboard = [];
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__clipboard.push(String(t)); return Promise.resolve(); } },
      });
    } catch (e) {}
  })();
`

let results = []
function ok(cond, msg) {
  results.push({ ok: !!cond, msg })
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg)
}

async function getLS(page, key) {
  return page.evaluate((k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null }, key)
}

const clearLocalStorage = (page) => page.evaluate(() => localStorage.clear())

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(seedScript)

  // ---------- 1) Leaderboards ----------
  await page.goto(BASE) // establish an origin first
  await clearLocalStorage(page)
  await page.reload()
  await page.waitForSelector('[data-testid="k11-leaderboard"]')
  ok(true, 'MySets renders the leaderboard panel')

  const lbMatchRows = await page.locator('[data-testid="k11-leaderboard"] .k11-lb').first().locator('tbody tr').count()
  const lbBlastRows = await page.locator('[data-testid="k11-leaderboard"] .k11-lb').nth(1).locator('tbody tr').count()
  ok(lbMatchRows === 3 && lbBlastRows === 3, 'leaderboard aggregates records from all sets (match=' + lbMatchRows + ', blast=' + lbBlastRows + ')')

  const bestMatch = (await page.locator('[data-testid="k11-leaderboard"] .k11-lb').first().locator('tbody tr').first().innerText()).trim()
  ok(bestMatch.includes('Животные') && bestMatch.includes('9.0'), 'Match leaderboard sorted top-5 ascending, best set first (got "' + bestMatch.replace(/\s+/g, ' ') + '")')
  const bestBlast = (await page.locator('[data-testid="k11-leaderboard"] .k11-lb').nth(1).locator('tbody tr').first().innerText()).trim()
  ok(bestBlast.includes('Животные') && bestBlast.includes('12'), 'Blast leaderboard sorted top-5 descending, best set first (got "' + bestBlast.replace(/\s+/g, ' ') + '")')

  // ---------- 2) Folders ----------
  await page.locator('[data-testid="folder-name-input"]').fill('Словарь A')
  await page.locator('[data-testid="folder-create"]').click()
  await page.waitForSelector('[data-testid="folder-item"]')
  const foldersRaw = await getLS(page, 'fc_folders')
  ok(Array.isArray(foldersRaw) && foldersRaw.length === 1 && foldersRaw[0].name === 'Словарь A', 'folder is persisted in fc_folders')
  const folderId = foldersRaw[0].id

  // Assign 'Фрукты' (k11-set-1) to the folder.
  await page.locator('[data-testid="folder-assign-open"]').click()
  await page.waitForSelector('[data-testid="folder-assign-select"]')
  await page.selectOption('[data-testid="folder-assign-select"]', 'k11-set-1')
  await page.waitForTimeout(300)
  const folders2 = await getLS(page, 'fc_folders')
  ok(folders2[0].setIds.includes('k11-set-1'), 'assigning a set to a folder persists its setIds')
  ok((await page.locator('[data-testid="folder-item"] .k11-chip').count()) >= 1, 'folder shows the assigned set as a chip')

  // Filter by folder -> only the assigned set is shown in the grid.
  await page.selectOption('[data-testid="folder-filter"]', folderId)
  await page.waitForTimeout(300)
  const gridCount = await page.locator('[data-testid="set-grid"] .set-card').count()
  ok(gridCount === 1, 'folder filter shows only the folder' + String.fromCharCode(39) + 's set (count=' + gridCount + ')')
  await page.selectOption('[data-testid="folder-filter"]', 'all')
  await page.waitForTimeout(300)

  // Rename folder.
  await page.locator('[data-testid="folder-item"] .btn-icon', { hasText: '✎' }).first().click()
  await page.locator('[data-testid="folder-rename-input"]').fill('Словарь B')
  await page.locator('[data-testid="folder-item"] button', { hasText: 'Сохранить' }).first().click()
  await page.waitForTimeout(300)
  const folders3 = await getLS(page, 'fc_folders')
  ok(folders3[0].name === 'Словарь B', 'folder rename is persisted (name="' + folders3[0].name + '")')

  // ---------- 3) Classes ----------
  await page.locator('[data-testid="class-name-input"]').fill('Группа 1')
  await page.locator('[data-testid="class-create"]').click()
  await page.waitForSelector('[data-testid="class-item"]')
  const classesRaw = await getLS(page, 'fc_classes')
  ok(Array.isArray(classesRaw) && classesRaw.length === 1 && classesRaw[0].name === 'Группа 1', 'class is persisted in fc_classes')

  // Add set 'k11-set-2' to the class via the checkbox.
  const classCheck = page.locator('[data-testid="class-item"] .k11-class-check', { hasText: 'Животные' }).locator('input')
  await classCheck.check()
  await page.waitForTimeout(300)
  const classes2 = await getLS(page, 'fc_classes')
  ok(classes2[0].setIds.includes('k11-set-2'), 'adding a set to a class persists its setIds')
  // Remove it again.
  await classCheck.uncheck()
  await page.waitForTimeout(300)
  const classes3 = await getLS(page, 'fc_classes')
  ok(!classes3[0].setIds.includes('k11-set-2'), 'removing a set from a class persists (setIds emptied)')

  // Screenshot the new K11 UI (folders / classes / leaderboard).
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k11_folders.png', fullPage: true })

  // ---------- 4) Frontend AI: generate cards from notes (mocked backend) ----------
  await page.goto(BASE + '/sets/new')
  await page.waitForSelector('[data-testid="k11-ai"]')
  await page.locator('[data-testid="import-text"]').fill('hello\nworld')

  await page.route('**/api/ai', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, content: '{"topic":"AI Набор","cards":[{"word":"hello","translation":"привет"},{"word":"world","translation":"мир"}]}' }),
    })
  )
  await page.locator('[data-testid="ai-gen-cards"]').click()
  // Success navigates home; verify the new set exists in fc_sets.
  await page.waitForSelector('.set-grid')
  const allSets = await getLS(page, 'fc_sets')
  const aiSet = allSets.find((s) => s.topic === 'AI Набор')
  ok(!!aiSet && aiSet.cards.length === 2, 'frontend AI generation creates a set from the backend reply (topic=' + (aiSet && aiSet.topic) + ', cards=' + (aiSet && aiSet.cards.length) + ')')
  await page.unroute('**/api/ai')

  // ---------- 5) Frontend AI stub when backend is unreachable ----------
  await page.goto(BASE + '/sets/new')
  await page.waitForSelector('[data-testid="k11-ai"]')
  await page.locator('[data-testid="import-text"]').fill('one\ntwo')
  await page.route('**/api/ai', (route) => route.abort())
  await page.locator('[data-testid="ai-gen-trans"]').click()
  await page.waitForTimeout(600)
  const stubMsg = (await page.locator('[data-testid="ai-msg"]').innerText()).trim()
  ok(/заглушк|недоступен|ошибк|Бэкенд/i.test(stubMsg), 'frontend shows a stub message when the AI backend is unreachable (got "' + stubMsg + '")')
  await page.unroute('**/api/ai')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k11_ai.png', fullPage: true })

  // ---------- 6) Share button ----------
  // Navigate to a seeded set and copy link + JSON to the clipboard.
  await page.goto(BASE + '/set/k11-set-1')
  await page.waitForSelector('[data-testid="share-btn"]')
  await page.locator('[data-testid="share-btn"]').click()
  await page.waitForTimeout(400)
  const clip = await page.evaluate(() => (window.__clipboard && window.__clipboard[0]) || '')
  ok(clip.includes('/#/set/k11-set-1'), 'share button copies the https://host/#/set/<id> link (' + clip.split('\n')[0] + ')')
  ok(clip.includes('"topic":"Фрукты"') && clip.includes('"word":"apple"'), 'share button copies the set JSON to the clipboard')
  ok((await page.locator('[data-testid="share-msg"]').count()) >= 1, 'share success message is shown')
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k11_share.png', fullPage: true })

  // ---------- 7) Backend endpoint through the dev-server proxy ----------
  const proxyResp = await page.request.post('http://127.0.0.1:5174/api/ai', {
    data: { prompt: 'Ответь одним словом: тест', max_tokens: 10 },
  })
  const proxyJson = await proxyResp.json()
  ok(proxyResp.ok && proxyJson && typeof proxyJson.content === 'string', 'backend /api/ai responds through the Vite dev proxy (status=' + proxyResp.status() + ')')

  console.log('\n==== SUMMARY ====')
  const fails = results.filter((r) => !r.ok)
  console.log('Total: ' + results.length + ', Passed: ' + (results.length - fails.length) + ', Failed: ' + fails.length)
  await browser.close()
  process.exit(fails.length ? 1 : 0)
})().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
