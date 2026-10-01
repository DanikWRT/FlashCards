// Find which elements overflow horizontally on a 390px viewport.
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
 const offenders = await p.evaluate(()=>{
   const vw = window.innerWidth
   const bad = []
   document.querySelectorAll('body *').forEach(el=>{
     const r = el.getBoundingClientRect()
     if (r.right > vw + 1 || r.left < -1){
       const cs = getComputedStyle(el)
       if (cs.position==='absolute' || cs.position==='fixed' || el.closest('.fs-overlay')) return // skip intentional overlays
       if (r.width===0) return
       bad.push({tag:el.tagName, cls:el.className, left:Math.round(r.left), right:Math.round(r.right), w:Math.round(r.width)})
     }
   })
   return bad.slice(0,25)
 })
 console.log('overflow offenders:', JSON.stringify(offenders,null,2))
 await b.close()
}
main().catch(e=>{console.error('ERR',e);process.exit(1)})
