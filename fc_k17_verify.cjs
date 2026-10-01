// K17 before/after capture + geometry verification on the FlashCards set page.
// Usage: node fc_k17_verify.cjs before|after|collapsed
const { chromium } = require('playwright')
const fs = require('fs')

const BASE = 'http://127.0.0.1:5174'
const SET_ID = '94c96214d11246628d74f2d6f7820a33'
const CARDS = []
for (let i = 0; i < 8; i++) CARDS.push({ word: 'apple' + i, translation: 'яблоко ' + i })

const seedScript = `
  (() => {
    const set = { id: ${JSON.stringify(SET_ID)}, topic: 'Набор K17', cards: ${JSON.stringify(CARDS)} };
    let sets = [];
    try { sets = JSON.parse(localStorage.getItem('fc_sets') || '[]'); } catch (e) {}
    if (!sets.some(s => s.id === ${JSON.stringify(SET_ID)})) sets.push(set);
    localStorage.setItem('fc_sets', JSON.stringify(sets));
    localStorage.removeItem('fc_hide_header');
  })();
`

async function main() {
  const step = process.argv[2]
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 768 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(seedScript)
  await page.goto(BASE + '/set/' + SET_ID, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.mode-switcher', { timeout: 8000 })
  await page.waitForTimeout(600)

  // Optional: expand the legend so it's visible in the shot.
  const leg = await page.$('[data-testid="kb-toggle"]')
  if (leg) { try { await leg.click(); await page.waitForTimeout(300) } catch (e) {} }

  const shot = process.argv[3] || ('/home/aifactory/FlashCards/fc_k17_' + step + '.png')
  await page.screenshot({ path: shot, fullPage: false })

  const geo = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }
    }
    const sidebar = document.querySelector('.set-sidebar')
    const main = document.querySelector('.set-main')
    const stage = document.querySelector('.mode-stage')
    const legend = document.querySelector('.kb-legend')
    const header = document.querySelector('.header')
    // DOM order: does legend come after mode-stage inside set-main?
    let legendAfterStage = false
    if (stage && legend) {
      const body = document.body
      const pos = (el) => Array.prototype.indexOf.call(body.querySelectorAll('*'), el)
      legendAfterStage = pos(legend) > pos(stage)
    }
    return {
      sidebar: rect('.set-sidebar'),
      main: rect('.set-main'),
      stage: rect('.mode-stage'),
      legend: rect('.kb-legend'),
      header: rect('.header'),
      sidebarComputedPosition: sidebar ? getComputedStyle(sidebar).position : null,
      legendAfterStage,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docH: document.documentElement.scrollHeight,
    }
  })
  console.log(JSON.stringify({ step, geo }, null, 2))
  fs.writeFileSync('/home/aifactory/FlashCards/fc_k17_' + step + '_geo.json', JSON.stringify(geo, null, 2))
  await browser.close()
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
