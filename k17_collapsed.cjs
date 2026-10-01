// K17 collapsed-header + interaction verification.
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = 'http://127.0.0.1:5174'
const SET_ID = '94c96214d11246628d74f2d6f7820a33'
const CARDS = []
for (let i = 0; i < 8; i++) CARDS.push({ word: 'apple' + i, translation: 'яблоко ' + i })
const seed = `(()=>{const set={id:${JSON.stringify(SET_ID)},topic:'Набор K17',cards:${JSON.stringify(CARDS)}};let s=[];try{s=JSON.parse(localStorage.getItem('fc_sets')||'[]')}catch(e){}if(!s.some(x=>x.id===${JSON.stringify(SET_ID)}))s.push(set);localStorage.setItem('fc_sets',JSON.stringify(s));localStorage.removeItem('fc_hide_header');localStorage.removeItem('fc_token')})();`

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 768 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(seed)
  await page.goto(BASE + '/set/' + SET_ID, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.mode-switcher', { timeout: 8000 })
  await page.waitForTimeout(500)

  const out = {}
  // 1) collapse via the header toggle button
  await page.click('[data-testid="header-toggle"]')
  await page.waitForTimeout(300)
  out.headerHidden = (await page.$('.header')) === null
  out.showBtnVisible = (await page.$('[data-testid="header-show"]')) !== null
  out.sidebarTopCollapsed = await page.evaluate(() => Math.round(document.querySelector('.set-sidebar').getBoundingClientRect().top))
  out.persisted = await page.evaluate(() => localStorage.getItem('fc_hide_header'))
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k17_collapsed.png' })

  // 2) restore via floating button
  await page.click('[data-testid="header-show"]')
  await page.waitForTimeout(300)
  out.restoredHeader = (await page.$('.header')) !== null
  out.headerHiddenAfterRestore = (await page.$('[data-testid="header-show"]')) === null
  out.persistedAfter = await page.evaluate(() => localStorage.getItem('fc_hide_header'))

  // 3) H key toggles header too
  await page.keyboard.press('h')
  await page.waitForTimeout(200)
  out.hKeyHidden = (await page.$('.header')) === null
  await page.keyboard.press('h')
  await page.waitForTimeout(200)
  out.hKeyRestored = (await page.$('.header')) !== null

  // 4) toolbar collapse
  await page.click('[data-testid="toolbar-toggle"]')
  await page.waitForTimeout(200)
  out.toolbarCollapsible = (await page.$$('.deck-toolbar .priority-toggle')).length === 0
  await page.click('[data-testid="toolbar-toggle"]')
  await page.waitForTimeout(200)
  out.toolbarRestored = (await page.$$('.deck-toolbar .priority-toggle')).length > 0

  console.log(JSON.stringify(out, null, 2))
  fs.writeFileSync('/home/aifactory/FlashCards/fc_k17_collapsed_check.json', JSON.stringify(out, null, 2))
  await browser.close()
}
main().catch((e) => { console.error('ERR', e); process.exit(1) })
