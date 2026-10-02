const { chromium } = require('playwright');
const fs = require('fs');

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
  return { status: res.status, j, text };
}

(async () => {
  const tag = 'k26u' + String(Date.now()).slice(-6);
  const U = 'ui' + tag; const P = 'pass1234';
  const r = await call('POST', '/auth/register', { username: U, password: P });
  if (r.status !== 200) throw new Error('register ' + r.status);
  const token = r.j.token;
  const cards = [
    { word: 'alpha', translation: 'альфа' },
    { word: 'beta', translation: 'бета' },
    { word: 'gamma', translation: 'гамма' },
    { word: 'delta', translation: 'дельта' },
    { word: 'epsilon', translation: 'эпсилон' },
    { word: 'zeta', translation: 'дзета' },
  ];
  const s = await call('POST', '/sets', { topic: 'K26 UI set', cards }, token);
  if (s.status !== 200) throw new Error('create set ' + s.status);
  const sid = s.j.id;
  const got = await call('GET', '/sets/' + sid);
  const cleanSet = got.j;

  const results = [];
  const ok = (n, v, extra) => { results.push([n, !!v]); console.log(((v ? '  PASS' : '  FAIL')) + ' - ' + n + (extra !== undefined ? ' :: ' + extra : '')); };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await ctx.addInitScript(([token, cleanSet, sid]) => {
    localStorage.setItem('fc_token', token);
    localStorage.setItem('fc_sets', JSON.stringify([cleanSet]));
    localStorage.setItem('fc_hide_header', '1');
  }, [token, cleanSet, sid]);

  await page.goto(V + '/set/' + sid, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="settings-toggle"]');

  // ---- A: only ONE settings panel exists (no deck-toolbar) ----
  const toolbarCount = await page.locator('.deck-toolbar').count();
  ok('A: deck-toolbar removed (count=0)', toolbarCount === 0, 'count=' + toolbarCount);
  // Every deck-toolbar item is present in the shared settings panel
  await page.click('[data-testid="settings-toggle"]');
  await page.waitForSelector('[data-testid="settings-panel"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k26_settings.png' });
  for (const tid of ['settings-priority', 'settings-starred', 'settings-play', 'settings-shuffle']) {
    await page.waitForSelector('[data-testid="' + tid + '"]');
    ok('A: settings panel has ' + tid, true);
  }
  const hasRestart = await page.locator('button:has-text("Заново")').count();
  const hasAuto = await page.locator('.settings-panel input[type=checkbox]').count();
  ok('A: settings panel has Autospeak/Label + Заново', hasAuto >= 3 && hasRestart > 0, 'checkboxes=' + hasAuto + ' restart=' + hasRestart);

  // ---- B: Cards fullscreen (unified dark stage + fs-exit-btn) ----
  await page.keyboard.press('Escape');
  await page.click('.mode-switcher button:has-text("Карточки")');
  await page.waitForTimeout(150);
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const fsActive = await page.evaluate(() => document.querySelector('.page').classList.contains('fs-active'));
  const fsExitAll = await page.locator('[data-testid="fs-exit"]').count();
  const fsOverlayLegacy = await page.locator('.fs-overlay').count();
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.page.fs-active .mode-stage')).backgroundColor);
  ok('B: F toggles fullscreen in cards', fsActive, 'bg=' + bg);
  ok('B: unified fs-exit-btn present in Cards', fsExitAll === 1, 'count=' + fsExitAll);
  ok('B: legacy .fs-overlay removed', fsOverlayLegacy === 0, 'count=' + fsOverlayLegacy);
  ok('B: fullscreen stage dark (#0f172a)', bg === 'rgb(15, 23, 42)', bg);
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k26_fullscreen_cards.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok('B: Esc exits fullscreen (cards)', !(await page.evaluate(() => document.querySelector('.page').classList.contains('fs-active'))));

  // ---- B: Learn fullscreen (unified dark stage) ----
  await page.click('.mode-switcher button:has-text("Learn")');
  await page.waitForSelector('.quiz.study .quiz-choices .quiz-choice');
  await page.waitForTimeout(150);
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const learnFs = await page.evaluate(() => document.querySelector('.page').classList.contains('fs-active'));
  const learnExit = await page.locator('[data-testid="fs-exit"]').count();
  const learnBg = await page.evaluate(() => getComputedStyle(document.querySelector('.page.fs-active .mode-stage')).backgroundColor);
  ok('B: F fullscreen in Learn', learnFs);
  ok('B: fs-exit-btn present in Learn', learnExit === 1);
  ok('B: Learn fullscreen stage dark', learnBg === 'rgb(15, 23, 42)', learnBg);
  // digit hotkey in fullscreen (Learn has digit options?) -> use Test instead below
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k26_fullscreen_learn.png' });
  await page.keyboard.press('Escape');

  // ---- B: settings hidden in fullscreen for other modes ----
  await page.waitForTimeout(150);
  await page.keyboard.press('f');
  await page.waitForTimeout(200);
  const settingsHidden = await page.evaluate(() => {
    const p = document.querySelector('.settings-panel');
    const t = document.querySelector('.settings-toggle');
    return (!p || getComputedStyle(p).display === 'none') && (!t || getComputedStyle(t).display === 'none');
  });
  ok('B: settings-panel/toggle hidden in Learn fullscreen', settingsHidden);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ---- C + D: Blast digits on all blocks + green flash auto-advance ----
  await page.click('.mode-switcher button:has-text("Blast")');
  await page.waitForSelector('.blast-intro');
  await page.click('button:has-text("Старт")');
  await page.waitForSelector('.blast-block');
  await page.waitForTimeout(120);

  // C: count digit badges == block count (all variants numbered)
  const blockCount = await page.locator('.blast-block').count();
  const digitCount = await page.locator('.blast-block .blast-digit').count();
  ok('C: digit badge on EVERY blast block', digitCount === blockCount, 'blocks=' + blockCount + ' digits=' + digitCount);

  // D: click the correct block -> green flash + auto-advance to next question.
  // Correctness is signalled by the data-correct attribute BEFORE answering.
  const correctCount = await page.locator('.blast-block[data-correct="true"]').count();
  ok('C: exactly one correct block present', correctCount === 1, 'correct=' + correctCount);

  const q1 = await page.locator('.blast-q .quiz-word').textContent();
  await page.locator('.blast-block[data-correct="true"]').click();
  await page.waitForSelector('.blast-flash-green', { timeout: 400 });
  const flashVisible = await page.locator('.blast-flash-green').count();
  ok('D: green flash overlay appears on correct', flashVisible === 1, 'count=' + flashVisible);
  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k26_blast_flash.png' });
  // auto-advance: after ~800ms a NEW question should show (feedback cleared, next block)
  await page.waitForTimeout(900);
  const stillFlash = await page.locator('.blast-flash-green').count();
  const q2 = await page.locator('.blast-q .quiz-word').textContent();
  const feedbackNow = await page.locator('.study-feedback').count();
  ok('D: green flash fades/removed after auto-advance', stillFlash === 0, 'flash=' + stillFlash);
  ok('D: auto-advanced to a new question (no manual click)', q1 !== q2 && feedbackNow === 0, 'q1=' + q1 + ' q2=' + q2);
  // digit hotkey: press the correct block's number for the current question
  const correctIdx2 = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.blast-block'));
    return els.findIndex(e => e.dataset.correct === 'true');
  });
  await page.keyboard.press(String(correctIdx2 + 1));
  await page.waitForTimeout(200);
  const flashAfterDigit = await page.locator('.blast-flash-green').count();
  ok('D: digit hotkey (correct) triggers flash', flashAfterDigit === 1, 'digit=' + (correctIdx2 + 1) + ' flash=' + flashAfterDigit);

  console.log('CONSOLE_ERRORS=' + JSON.stringify(errors));
  ok('No console/page errors', errors.length === 0, errors.join(' | '));

  console.log('\nSUMMARY: ' + results.filter(r => r[1]).length + '/' + results.length + ' passed');
  await browser.close();
  process.exit(results.every(r => r[1]) ? 0 : 1);
})().catch((e) => { console.error('SCRIPT_ERROR', e); process.exit(2); });
