// K20: verify the home-page leaderboard is loaded from the SERVER and shows
// nicknames (Игрок column) for both Match (best time) and Blast (best score).
// Also captures fc_k20_leaderboard.png.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' });

  // Leaderboard panel present
  const lb = page.locator('[data-testid="k11-leaderboard"]');
  await lb.waitFor({ state: 'visible', timeout: 8000 });

  // Match table headers include Игрок
  const matchHead = await page.locator('.k11-lb >> nth=0 >> thead').innerText();
  const blastHead = await page.locator('.k11-lb >> nth=1 >> thead').innerText();
  console.log('MATCH_HEAD:', JSON.stringify(matchHead));
  console.log('BLAST_HEAD:', JSON.stringify(blastHead));
  if (!/Игрок/.test(matchHead)) throw new Error('Match table missing Игрок column');
  if (!/Игрок/.test(blastHead)) throw new Error('Blast table missing Игрок column');

  // Both nicknames visible in the Match table (with the usernames we seeded)
  const matchText = await page.locator('.k11-lb >> nth=0').innerText();
  const blastText = await page.locator('.k11-lb >> nth=1').innerText();
  console.log('MATCH_BODY:', JSON.stringify(matchText));
  console.log('BLAST_BODY:', JSON.stringify(blastText));
  if (!/bobk20r927902/.test(matchText)) throw new Error('Match table missing k20-bob nickname');
  if (!/alicek20r927902/.test(matchText)) throw new Error('Match table missing k20-alice nickname');
  if (!/bobk20r927902/.test(blastText)) throw new Error('Blast table missing k20-bob nickname');
  if (!/alicek20r927902/.test(blastText)) throw new Error('Blast table missing k20-alice nickname');

  // Order: match top row is the fastest (bob 20000 / 20.0 с), blast top row
  // is highest (bob 250). Verified from the body text index.
  const matchBody = await page.locator('.k11-lb >> nth=0 >> tbody').innerText();
  const blastBody = await page.locator('.k11-lb >> nth=1 >> tbody').innerText();
  console.log('MATCH_ROWS:', JSON.stringify(matchBody));
  console.log('BLAST_ROWS:', JSON.stringify(blastBody));
  if (matchBody.indexOf('1\tbobk20r927902') !== 0) throw new Error('Match top row not fastest bob');
  if (blastBody.indexOf('1\tbobk20r927902') !== 0) throw new Error('Blast top row not highest bob');
  if (matchBody.split('\n').length < 2) throw new Error('Expected >=2 match rows');
  if (blastBody.split('\n').length < 2) throw new Error('Expected >=2 blast rows');

  await page.screenshot({ path: 'fc_k20_leaderboard.png', fullPage: true });
  console.log('SCREENSHOT: fc_k20_leaderboard.png');
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  console.log('K20 UI CHECK PASSED');
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
