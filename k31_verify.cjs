// K31 verification (browser-side). Args: <token> <repeatId> <freshId>
// Checks:
//  1) fully-mastered set starts a repeat pass in Learn/Write/Spell (not StudyDone/NoReviews)
//  2) answering + advancing continues the pass
//  3) progress NOT reset: statuses stay mastered, view counters do not drop
//  4) a set with nothing due today (all SRS future, nothing mastered) still shows NoReviews
const { chromium } = require('playwright');
const [TOKEN, SET_ID, FRESH_ID] = process.argv.slice(2);
const BASE = 'http://127.0.0.1:5174';
const count = (stats) => Object.entries(stats).filter(([k]) => !k.startsWith('_')).reduce((a, [, v]) => a + v, 0);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.goto(BASE + '/');
  await page.waitForTimeout(600);
  await page.evaluate(([token, setId]) => {
    localStorage.setItem('fc_token', token);
    localStorage.setItem('fc_status_k31verify_' + setId, JSON.stringify({ "0":'mastered',"1":'mastered',"2":'mastered',"3":'mastered',"4":'mastered' }));
    localStorage.setItem('fc_stats_k31verify_' + setId, JSON.stringify({ "0":9,"1":12,"2":7,"3":5,"4":3 }));
  }, [TOKEN, SET_ID]);

  async function switchMode(page, name) {
    const tabs = await page.$$('[role=tab]');
    for (const t of tabs) { const txt = await t.innerText(); if (new RegExp(name, 'i').test(txt)) { await t.click(); break; } }
    await page.waitForTimeout(700);
  }
  const state = (page) => page.evaluate(() => ({
    quiz: !!document.querySelector('.quiz'),
    prompt: !!document.querySelector('.study-prompt'),
    spell: !!document.querySelector('.spell-speaker'),
    noRev: !!document.querySelector('.no-reviews'),
    studyDone: !!document.querySelector('.quiz-result h2') && !document.querySelector('.no-reviews'),
  }));
  const line = (name, ok, extra) => console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
  const repeatOk = (s) => s.quiz && !s.noRev && !s.studyDone;

  console.log('== #1 repeat starts in each mastery mode ==');
  await page.goto(BASE + '/set/' + SET_ID); await page.waitForTimeout(800);
  for (const [mode, det] of [['Learn', null], ['Write', null], ['Spell', 'speaker']]) {
    await switchMode(page, mode);
    const s = await state(page);
    const ok = det === 'speaker' ? (s.quiz && s.spell && !s.noRev && !s.studyDone) : repeatOk(s);
    line(mode + ': mastered set starts repeat', ok ? true : false, JSON.stringify(s));
  }

  console.log('== #2 advance continues + #3 no reset ==');
  await switchMode(page, 'Learn');
  const s0 = await state(page);
  const stBefore = await page.evaluate((id) => JSON.stringify(localStorage.getItem('fc_status_k31verify_' + id)), SET_ID);
  const viewsBefore = await page.evaluate((id) => JSON.stringify(localStorage.getItem('fc_stats_k31verify_' + id)), SET_ID);
  const vSumBefore = await page.evaluate((id) => { const s = JSON.parse(localStorage.getItem('fc_stats_k31verify_' + id) || '{}'); return Object.entries(s).filter(([k]) => !k.startsWith('_')).reduce((a, [, v]) => a + (typeof v === 'number' ? v : (v?.views ?? 0)), 0); }, SET_ID);
  const c1 = await page.$('.quiz-choice'); if (c1) await c1.click(); await page.waitForTimeout(250);
  const n1 = await page.$('.quiz-next'); if (n1) await n1.click(); await page.waitForTimeout(350);
  const s1 = await state(page);
  line('learn advance keeps pass running', repeatOk(s1));
  const stAfter = await page.evaluate((id) => JSON.stringify(localStorage.getItem('fc_status_k31verify_' + id)), SET_ID);
  const vSumAfter = await page.evaluate((id) => { const s = JSON.parse(localStorage.getItem('fc_stats_k31verify_' + id) || '{}'); return Object.entries(s).filter(([k]) => !k.startsWith('_')).reduce((a, [, v]) => a + (typeof v === 'number' ? v : (v?.views ?? 0)), 0); }, SET_ID);
  line('statuses stay mastered after repeat interaction', stBefore === stAfter && stAfter.includes('mastered'));
  line('view counter sum does not DROP (no reset): ' + vSumBefore + ' -> ' + vSumAfter, vSumAfter >= vSumBefore);

  console.log('== #4 nothing-due set shows NoReviews ==');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => errors.push('PAGE2: ' + e.message));
  await page2.goto(BASE + '/'); await page2.waitForTimeout(500);
  await page2.evaluate(([t, fid]) => {
    localStorage.setItem('fc_token', t);
    // all cards 'learning', all SRS pushed out 1 full year -> dueCount == 0, nothing mastered
    localStorage.setItem('fc_status_k31verify_' + fid, JSON.stringify({ '0':'learning','1':'learning' }));
    localStorage.setItem('fc_stats_k31verify_' + fid, JSON.stringify({ '0':4,'1':4,
      '_srs': { '0': { interval: 14, nextReview: '2099-01-01' }, '1': { interval: 14, nextReview: '2099-01-01' } } }));
  }, [TOKEN, FRESH_ID]);
  await page2.goto(BASE + '/set/' + FRESH_ID); await page2.waitForTimeout(800);
  await switchMode(page2, 'Learn');
  const s2 = await state(page2);
  line('nothing-due non-fresh set still shows NoReviews', s2.noRev, JSON.stringify(s2));

  console.log(errors.length ? 'PAGE ERRORS: ' + JSON.stringify(errors) : 'NO page errors');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
