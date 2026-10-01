// K17 mobile responsive check (<=900px): sidebar stacks full-width above main,
// no horizontal overflow, compact header does not overlap auth area.
const { chromium } = require('playwright')
const BASE = 'http://127.0.0.1:5174'
const SET_ID = '94c96214d11246628d74f2d6f7820a33'
async function main(){
 const b=await chromium.launch(); const c=await b.newContext({viewport:{width:390,height:844}}); const p=await c.newPage()
 await p.goto(BASE+'/',{waitUntil:'domcontentloaded'})
 await p.evaluate(()=>localStorage.removeItem('fc_hide_header'))
 await p.goto(BASE+'/set/'+SET_ID,{waitUntil:'domcontentloaded'})
 await p.waitForSelector('.mode-switcher',{timeout:8000})
 await p.waitForTimeout(500)
 const out={}
 out.docScrollW = await p.evaluate(()=>document.documentElement.scrollWidth)
 out.viewportW = await p.evaluate(()=>window.innerWidth)
 out.sidebarLayout = await p.evaluate(()=>{ const el=document.querySelector('.set-layout'); return el?getComputedStyle(el).flexDirection:null })
 out.sidebarPos = await p.evaluate(()=>{ const el=document.querySelector('.set-sidebar'); return el?getComputedStyle(el).position:null })
 out.horizontalOverflow = await p.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth+1)
 await p.screenshot({path:'/home/aifactory/FlashCards/fc_k17_mobile.png'})
 console.log(JSON.stringify(out,null,2))
 await b.close()
}
main().catch(e=>{console.error('ERR',e);process.exit(1)})
