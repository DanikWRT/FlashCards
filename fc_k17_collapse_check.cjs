// K17 collapsed-header verification: toggle the header off via the header button,
// confirm the tagline tag disappears, sidebar pins to top:0, floating restore shows.
const { chromium } = require('playwright')
const fs = require('fs')
const BASE = 'http://127.0.0.1:5174'
const SET_ID = '94c96214d11246628d74f2d6f7820a33'

async function main(){
 const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1280,height:768}}); const p=await c.newPage()
 await p.goto(BASE+'/',{waitUntil:'domcontentloaded'})
 await p.evaluate(()=>localStorage.removeItem('fc_hide_header'))
 await p.goto(BASE+'/set/'+SET_ID,{waitUntil:'domcontentloaded'})
 await p.waitForSelector('.mode-switcher',{timeout:8000})
 await p.waitForTimeout(500)

 const out={}
 // Header visible before:
 out.headerBeforeStyle = await p.evaluate(()=>{ const el=document.querySelector('.header'); return el?getComputedStyle(el).display:'none' })
 out.headerToggleExists = await p.$('[data-testid="header-toggle"]')!==null

 // Click the header collapse toggle
 await p.click('[data-testid="header-toggle"]')
 await p.waitForTimeout(400)
 out.appClass = await p.evaluate(()=>document.querySelector('.app').className)
 out.headerDisplayAfter = await p.evaluate(()=>{ const el=document.querySelector('.header'); return el?getComputedStyle(el).display:'hidden-header' })
 out.headerShowExists = await p.$('[data-testid="header-show"]')!==null
 const sidebarTop = await p.evaluate(()=>{ const el=document.querySelector('.set-sidebar'); return el?Math.round(el.getBoundingClientRect().top):null })
 out.sidebarTopCollapsed = sidebarTop

 await p.screenshot({path:'/home/aifactory/FlashCards/fc_k17_collapsed.png'})

 // Restore via the floating button
 await p.click('[data-testid="header-show"]')
 await p.waitForTimeout(400)
 out.headerDisplayRestored = await p.evaluate(()=>{ const el=document.querySelector('.header'); return el?getComputedStyle(el).display:'none' })
 out.headerShowGoneAfterRestore = await p.$('[data-testid="header-show"]')===null
 out.lsAfter = await p.evaluate(()=>localStorage.getItem('fc_hide_header'))

 console.log(JSON.stringify(out,null,2))
 fs.writeFileSync('/home/aifactory/FlashCards/fc_k17_collapsed_geo.json', JSON.stringify(out,null,2))
 await b.close()
}
main().catch(e=>{console.error('ERR',e);process.exit(1)})
