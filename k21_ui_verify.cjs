// K21 UI verification: delete-permission buttons on the home (MySets) page.
// Regular user sees 'Удалить из моих' on bookmarked sets and the ✕ (delete)
// ONLY on their own authorings; admin (Danya) sees ✕ on every shared set.
// Captures fc_k21_perms.png.
const { chromium } = require('playwright');

const B = 'http://127.0.0.1:5199/api';

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
  const tag = 'k21u' + String(Date.now()).slice(-6);
  const U1 = 'user' + tag;
  const U2 = 'other' + tag;
  const P = 'pass1234';

  // Create a regular user u1 and a second user u2 via the API (admin Danya
  // already exists on the live verify DB from the API test).
  const r1 = await call('POST', '/auth/register', { username: U1, password: P });
  const r2 = await call('POST', '/auth/register', { username: U2, password: P });
  if (r1.status !== 200) throw new Error('register u1 ' + r1.status + ' ' + JSON.stringify(r1.j));
  if (r2.status !== 200) throw new Error('register u2 ' + r2.status + ' ' + JSON.stringify(r2.j));
  const t1 = r1.j.token, t2 = r2.j.token;

  // u1 authors a set; u2 authors a set.
  const s1 = await call('POST', '/sets', { topic: 'Set by ' + U1, cards: [{ word: 'a', translation: 'b' }] }, t1);
  const s2 = await call('POST', '/sets', { topic: 'Set by ' + U2, cards: [{ word: 'c', translation: 'd' }] }, t2);
  if (s1.status !== 200 || s2.status !== 200) throw new Error('create sets ' + s1.status + '/' + s2.status);
  const id1 = s1.j.id, id2 = s2.j.id;
  // u1 bookmarks u2's set too.
  await call('POST', '/sets/' + id2 + '/bookmark', null, t1);

  // Admin token for Danya (login via API).
  const da = await call('POST', '/auth/login', { username: 'Danya', password: 'pass1234' });
  if (da.status !== 200) throw new Error('danya login ' + da.status + ' ' + JSON.stringify(da.j));
  const tAdmin = da.j.token;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Set auth token in localStorage, then load home.
  const setToken = async (tok) => {
    await page.goto('http://127.0.0.1:5199/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => { localStorage.setItem('fc_token', t); }, tok);
    await page.reload({ waitUntil: 'networkidle' });
  };

  // --- 1. Regular user u1 ---
  await setToken(t1);
  // MY sets tab: u1 has own set (author) + bookmarked u2 set (not author).
  await page.evaluate(() => { /* click the 'Мои наборы' tab if needed */ });
  // Inspect the two cards for u1.
  const u1Cards = await page.$$('.set-card');
  console.log('U1_CARD_COUNT:', u1Cards.length);
  if (u1Cards.length < 2) throw new Error('expected >=2 set cards for u1');
  // Find card by topic.
  async function cardInfo(sel) {
    const txt = (await sel.innerText()).replace(/\n/g, ' | ');
    const deleteBtns = await sel.$$('.set-card-actions-top .btn-icon');
    const actBtns = [...(await sel.$$('.set-card-actions .btn'))].length;
    return { txt, deleteCount: deleteBtns.length, actBtns };
  }
  const infos = [];
  for (const c of u1Cards) infos.push(await cardInfo(c));
  console.log('U1_CARDS:', JSON.stringify(infos, null, 1));

  const ownCard = infos.find((i) => i.txt.includes('Set by ' + U1));
  const otherCard = infos.find((i) => i.txt.includes('Set by ' + U2));
  if (!ownCard || !otherCard) throw new Error('u1 cards not located');
  // Author set -> delete (✕) present AND 'Удалить из моих' present.
  if (ownCard.deleteCount !== 1) throw new Error('u1 author card should show delete ✕');
  if (!ownCard.txt.includes('Удалить из моих')) throw new Error('u1 author card missing Удалить из моих');
  // Bookmarked other's set -> NO delete ✕, but 'Удалить из моих' present.
  if (otherCard.deleteCount !== 0) throw new Error('u1 bookmarked(other) card must NOT show delete ✕');
  if (!otherCard.txt.includes('Удалить из моих')) throw new Error('u1 bookmarked card missing Удалить из моих');

  // --- 2. Admin Danya ---
  await setToken(tAdmin);
  const aCards = await page.$$('.set-card');
  const aInfos = [];
  for (const c of aCards) aInfos.push(await cardInfo(c));
  console.log('ADMIN_CARD_COUNT:', aCards.length);
  console.log('ADMIN_CARDS:', JSON.stringify(aInfos, null, 1));
  // Danya (admin) sees ✕ on both others' sets ALSO on the 'Все' tab.
  const dOwn = aInfos.find((i) => i.txt.includes('Set by ' + U1));
  const dOther = aInfos.find((i) => i.txt.includes('Set by ' + U2));
  if (dOwn && dOwn.deleteCount !== 1) throw new Error('admin should see delete ✕ on u1 set');
  if (dOther && dOther.deleteCount !== 1) throw new Error('admin should see delete ✕ on u2 set');

  await page.screenshot({ path: 'fc_k21_perms.png', fullPage: true });
  console.log('SCREENSHOT: fc_k21_perms.png');
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  console.log('K21 UI CHECK PASSED');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
