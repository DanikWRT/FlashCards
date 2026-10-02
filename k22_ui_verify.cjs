// K22 UI verification: "+ Добавить карточки" on the set page.
// Registers a user + creates a set via the API, seeds the browser's local
// cache + an existing 'mastered' status for card 0, opens /set/:id, adds 2 new
// cards through the inline form, and asserts the card count grows, the new
// cards count as 'not_studied' in the progress overview while the old status
// stays 'mastered', and there are 0 console errors.
const { chromium } = require('playwright');

const B = 'http://127.0.0.1:5199/api';
const V = 'http://127.0.0.1:5174';

async function call(method, path, body, token) {
  const res = await fetch(B + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: res.status, j };
}

(async () => {
  const tag = 'k22u' + String(Date.now()).slice(-6);
  const U = 'ui' + tag;
  const P = 'pass1234';

  const r = await call('POST', '/auth/register', { username: U, password: P });
  if (r.status !== 200) throw new Error('register ' + r.status + ' ' + JSON.stringify(r.j));
  const token = r.j.token;

  const s = await call('POST', '/sets', {
    topic: 'K22 UI set',
    cards: [
      { word: 'alpha', translation: 'альфа' },
      { word: 'beta', translation: 'бета' },
    ],
  }, token);
  if (s.status !== 200) throw new Error('create set ' + s.status + ' ' + JSON.stringify(s.j));
  const sid = s.j.id;

  // Fetch the server's clean set to seed localStorage.
  const got = await call('GET', '/sets/' + sid);
  const cleanSet = got.j; // {id, topic, lesson_meta, cards, author}

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // Seed local storage BEFORE the app loads: token (auto-login) + the set cache
  // + an existing 'mastered' status for card 0 of this user's set.
  await ctx.addInitScript(([token, U, cleanSet, sid]) => {
    localStorage.setItem('fc_token', token);
    localStorage.setItem('fc_sets', JSON.stringify([cleanSet]));
    localStorage.setItem('fc_status_' + U + '_' + sid, JSON.stringify({ '0': 'mastered', '1': 'mastered' }));
  }, [token, U, cleanSet, sid]);

  await page.goto(V + '/set/' + sid, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="add-cards-btn"]', { timeout: 10000 });

  const count1 = await page.locator('.set-count').first().textContent();
  const prog1 = await page.locator('[data-testid="k9-progress"]').textContent();
  console.log('initial count text:', JSON.stringify(count1));
  console.log('initial progress:', JSON.stringify(prog1));

  // Open the inline add form and paste JSON for 2 new cards.
  await page.click('[data-testid="add-cards-btn"]');
  await page.waitForSelector('[data-testid="add-cards-text"]');
  await page.fill('[data-testid="add-cards-text"]', JSON.stringify({
    cards: [
      { word: 'gamma', translation: 'гамма' },
      { word: 'delta', translation: 'дельта' },
    ],
  }));
  await page.click('[data-testid="add-cards-submit"]');

  // Wait for the local cache to hold 4 cards.
  await page.waitForFunction((id) => {
    const sets = JSON.parse(localStorage.getItem('fc_sets') || '[]');
    const st = sets.find((x) => x.id === id);
    return st && st.cards.length === 4;
  }, sid, { timeout: 10000 });

  const count2 = await page.locator('.set-count').first().textContent();
  const prog2 = await page.locator('[data-testid="k9-progress"]').textContent();
  const msg = await page.locator('[data-testid="add-cards-msg"]').textContent().catch(() => null);
  console.log('after count text:', JSON.stringify(count2));
  console.log('after progress:', JSON.stringify(prog2));
  console.log('success msg:', JSON.stringify(msg));

  const results = [];
  const ok = (n, v) => { results.push([n, !!v]); console.log((v ? '  PASS' : '  FAIL') + ' ' + n); };

  ok('page shows 4 карточек', count2.includes('4'));
  ok('progress counts new as not_studied (Не изучено 2 из 4)', prog2.includes('Не изучено: 2 из 4'));
  ok('old statuses stay mastered (Освоено: 2 из 4)', prog2.includes('Освоено: 2 из 4'));
  ok('success message shown', !!msg && msg.includes('2'));
  ok('no console errors', errors.length === 0);

  if (errors.length) console.log('console errors:', JSON.stringify(errors, null, 2));

  await page.screenshot({ path: '/home/aifactory/FlashCards/fc_k22_add.png', fullPage: false });
  await browser.close();

  const all = results.every(([, v]) => v);
  console.log('\n=== K22 UI SUMMARY ===');
  for (const [n, v] of results) console.log((v ? 'PASS' : 'FAIL') + ' - ' + n);
  console.log('OVERALL:', all ? 'PASS' : 'FAIL');
  process.exit(all ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
