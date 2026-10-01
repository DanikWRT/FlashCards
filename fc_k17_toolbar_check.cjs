// K17 toolbar collapse toggle check (A4): click the gear toggle, verify the
// toolbar controls hide/show.
const { chromium } = require('playwright')
const BASE = 'http://127.0.0.1:5174'
const SET_ID = '94c96214d11246628d74f2d6f7820a33'
async function main(){
 const b=await chromium.launch(); const c=await b.newContext({viewport:{width:1280,height:768}}); const p=await c.newPage()
 await p.goto(BASE+'/',{waitUntil:'domcontentloaded'})
 await p.evaluate(()=>localStorage.removeItem('fc_hide_header'))
 await p.goto(BASE+'/set/'+SET_ID,{waitUntil:'domcontentloaded'})
 await p.waitForSelector('.mode-switcher',{timeout:8000})
 await p.waitForTimeout(400)
 const out={}
 out.toggleExists = await p.$('[data-testid="toolbar-toggle"]')!==null
 out.priorityVisibleBefore = await p.$('.deck-toolbar .priority-toggle')!==null
 await p.click('[data-testid="toolbar-toggle"]')
 await p.waitForTimeout(300)
 out.priorityVisibleAfterCollapse = await p.$('.deck-toolbar .priority-toggle')!==null
 out.ariaExpanded = await p.getAttribute('[data-testid="toolbar-toggle"]','aria-expanded')
 await p.click('[data-testid="toolbar-toggle"]')
 await p.waitForTimeout(300)
 out.priorityVisibleAfterExpand = await p.$('.deck-toolbar .priority-toggle')!==null
 console.log(JSON.stringify(out,null,2))
 await b.close()
}
main().catch(e=>{console.error('ERR',e);process.exit(1)})
