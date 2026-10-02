const { chromium } = require('playwright');

const B = 'http://127.0.0.1:5199/api';
const V = 'http://127.0.0.1:5174';

async function call(method, path, body, token) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: res.status, j };
}

(async () => {
  const tag = 'k23u' + String(Date.now()).slice(-6);
  const U = 'ui' + tag; const P = 'pass1234';
  const r = await call('POST', '/auth/register', { username: U, password: P });
  if (r.status !== 200) throw new Error('register ' + r.status);
  const token = r.j.token;
  const s = await call('POST', '/sets', { topic: 'K23 UI set', cards: [
    { word: 'alpha', translation: 'альфа' },
    { word: 'beta', translation: 'бета' },
    { word: 'gamma', translation: 'гамма' },
    { word: 'delta', translation: 'дельта' },
  ] }, token);
  if (s.status !== 200) throw new Error('create set ' + s.status);
  const sid = s.j.id;
  const got = await call('GET', '/sets/' + sid);
  const cleanSet = got.j;

  const results = [];
  const ok = (n, v, extra) => { results.push([n, !!v]); console.log((v ? '  PASS' : '  FAIL') + ' - ' + n + (extra !== undefined ? ' :: ' + extra : '')); };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await ctx.addInitScript(([token, U, cleanSet, sid]) => {
    localStorage.setItem('fc_token', token);
    localStorage.setItem('fc_sets', JSON.stringify([cleanSet]));
    localStorage.setItem('fc_hide_header', '1');
  }, [token, U, cleanSet, sid]);

  await page.goto(V + '/set/' + sid, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="settings-toggle"]');

  // ---- 1 & 2: fullscreen in Learn + digit hotkey + exit ----
  await page.click('button:has-text("Learn")');
  await page.waitForSelector('.quiz.study .quiz-choices .quiz-choice');
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const fsSidebarHidden = await page.evaluate(() => {
    const el = document.querySelector('.page');
    const active = el && el.classList.contains('fs-active');
    const sidebar = getComputedStyle(document.querySelector('.set-sidebar')).display;
    const headHidden = getComputedStyle(document.querySelector('.set-main-head')).display;
    const fsExitPresent = !!document.querySelector('.fs-exit-btn');
    const fsExit = fsExitPresent ? getComputedStyle(document.querySelector('.fs-exit-btn')).display : 'none';
    return { active, sidebar, headHidden, fsExitPresent, fsExit };
  });
  await page.keyboard.press('2');
  await page.waitForTimeout(200);
  const feedbackAfter = await page.locator('.study-feedback').textContent().catch(() => null);

  ok('fs-active class applied in Learn', fsSidebarHidden.active);
  ok('sidebar hidden in fullscreen', fsSidebarHidden.sidebar === 'none');
  ok('set-main-head (mode tabs) hidden in fullscreen', fsSidebarHidden.headHidden === 'none');
  ok('non-cards fs-exit button visible', fsSidebarHidden.fsExitPresent && fsSidebarHidden.fsExit !== 'none');
  ok('digit 2 triggered an answer (feedback shown)', !!feedbackAfter, feedbackAfter);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const afterEsc = await page.evaluate(() => ({
    fsExit: !!document.querySelector('.fs-exit-btn'),
    sidebar: getComputedStyle(document.querySelector('.set-sidebar')).display,
  }));
  ok('Esc exits fullscreen, chrome restored', !afterEsc.fsExit && afterEsc.sidebar !== 'none', JSON.stringify(afterEsc));

  // ---- 5: settings panel shifts game left ----
  const beforeW = await page.evaluate(() => Math.round(document.querySelector('.mode-stage > .quiz').getBoundingClientRect().left));
  await page.click('[data-testid="settings-toggle"]');
  await page.waitForSelector('[data-testid="settings-panel"]');
  const panelVisible = await page.locator('[data-testid="settings-panel"]').isVisible();
  const afterLeft = await page.evaluate(() => Math.round(document.querySelector('.mode-stage > .quiz').getBoundingClientRect().left));
  const settingsOpenClass = await page.evaluate(() => document.querySelector('.page').classList.contains('settings-open'));
  ok('settings panel opens', panelVisible);
  ok('settings-open class applied', settingsOpenClass);
  ok('game shifts left when panel open', afterLeft < beforeW, beforeW + ' -> ' + afterLeft);
  await page.click('[data-testid="settings-toggle"]');

  // ---- 3: Write input accepts a translit-equivalent typed answer ----
  await page.click('button:has-text("Write")');
  await page.waitForSelector('.write-input');
  const ans = await page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('fc_sets'))[0].cards;
    const t = document.querySelector('.quiz-word.study-prompt').textContent.trim();
    const se = cards.find(c => c.word === t || c.translation === t) || cards[0];
    const answer = t === se.word ? se.translation : se.word;
    // Positional layout: if answer is latin (en), encode it as typed on a RU
    // keyboard; if answer is cyrillic, encode as typed on an EN keyboard.
    const enToRu = { q:'й', w:'ц', e:'у', r:'к', t:'е', y:'н', u:'г', i:'ш', o:'щ', p:'з', a:'ф', s:'ы', d:'в', f:'а', g:'п', h:'р', j:'о', k:'л', l:'д', z:'я', x:'ч', c:'с', v:'м', b:'и', n:'т', m:'ь' };
    const ruToEn = { й:'q', ц:'w', у:'e', к:'r', е:'t', н:'y', г:'u', ш:'i', щ:'o', з:'p', ф:'a', ы:'s', в:'d', а:'f', п:'g', р:'h', о:'j', л:'k', д:'l', я:'z', ч:'x', с:'c', м:'v', и:'b', т:'n', ь:'m' };
    const latin = /^[a-z ]+$/.test(answer.toLowerCase());
    const typed = latin
      ? answer.toLowerCase().split('').map(c => enToRu[c] || c).join('')
      : answer.toLowerCase().split('').map(c => ruToEn[c] || c).join('');
    return { answer, typed, latin };
  });
  await page.fill('.write-input', ans.typed);
  await page.click('.write-actions button:has-text("Проверить")');
  await page.waitForTimeout(200);
  const writeFeedback = await page.locator('.study-feedback').textContent().catch(() => null);
  ok('layout-independent answer accepted in Write', !!writeFeedback && writeFeedback.includes('Верно'),
    'answer=' + ans.answer + ' typedAs=' + ans.typed + ' fb=' + writeFeedback);

  // ---- 4: Match digit+letter pairing ----
  await page.click('button:has-text("Match")');
  await page.waitForSelector('button:has-text("Начать")');
  await page.click('button:has-text("Начать")');
  await page.waitForSelector('.match-grid .match-card.term');
  const pair = await page.evaluate(() => {
    const terms = [...document.querySelectorAll('.match-card.term')].map(b => Number(b.getAttribute('data-cardidx')));
    const trans = [...document.querySelectorAll('.match-card.trans')].map(b => Number(b.getAttribute('data-cardidx')));
    const r = terms.findIndex(x => trans.includes(x));
    const c = trans.indexOf(terms[r]);
    return { r, c };
  });
  const before = await page.locator('.match-card.term.paired').count().catch(() => 0);
  await page.keyboard.press(String(pair.r + 1));
  await page.keyboard.press(String.fromCharCode(97 + pair.c));
  await page.waitForTimeout(250);
  const after = await page.locator('.match-card.term.paired').count().catch(() => 0);
  ok('Match digit+letter places a pair', after > before, JSON.stringify({ before, after, r: pair.r, c: pair.c }));

  ok('no console errors (desktop)', errors.length === 0);
  if (errors.length) console.log('desktop console errors:', JSON.stringify(errors, null, 2));
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k23_verify.png' });

  // ---- 6: mobile: game first + fullscreen game-only ----
  const mobileSet = await browser.newContext({ viewport: { width: 420, height: 800 } });
  const mp = await mobileSet.newPage();
  await mobileSet.addInitScript(([token, U, cleanSet, sid]) => {
    localStorage.setItem('fc_token', token);
    localStorage.setItem('fc_sets', JSON.stringify([cleanSet]));
    localStorage.setItem('fc_hide_header', '1');
  }, [token, U, cleanSet, sid]);
  await mp.goto(V + '/set/' + sid, { waitUntil: 'networkidle' });
  await mp.waitForSelector('[data-testid="settings-toggle"]');
  const order = await mp.evaluate(() => ({
    mainTop: Math.round(document.querySelector('.set-main').getBoundingClientRect().top),
    sideTop: Math.round(document.querySelector('.set-sidebar').getBoundingClientRect().top),
  }));
  ok('mobile: game area before sidebar', order.mainTop < order.sideTop, JSON.stringify(order));
  await mp.keyboard.press('f');
  await mp.waitForTimeout(200);
  const mfs = await mp.evaluate(() => ({
    ds: getComputedStyle(document.querySelector('.set-sidebar')).display,
    head: getComputedStyle(document.querySelector('.set-main-head')).display,
  }));
  ok('mobile fullscreen hides sidebar+header', mfs.ds === 'none' && mfs.head === 'none', JSON.stringify(mfs));
  await mobileSet.close();
  await browser.close();

  const all = results.every(([, v]) => v);
  console.log('\n=== K23 UI SUMMARY ===');
  for (const [n, v] of results) console.log((v ? 'PASS' : 'FAIL') + ' - ' + n);
  console.log('OVERALL:', all ? 'PASS' : 'FAIL');
  process.exit(all ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
