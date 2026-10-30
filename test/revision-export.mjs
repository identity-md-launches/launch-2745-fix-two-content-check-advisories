// Regression checks against dist/ at a static-hosting subpath. All external requests are intercepted.
// IMD_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs node test/revision-export.mjs
// BROWSER=webkit selects WebKit; --baseline records the same checks against the previous export.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const playwright = await import(process.env.IMD_PLAYWRIGHT);
const browserName = process.env.BROWSER || 'chromium';
const browser = await playwright[browserName].launch();
const baseline = process.argv.includes('--baseline');
const shots = `test/scratch/revision-${baseline ? 'before' : 'after'}-${browserName}`;
mkdirSync(shots, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (!path.startsWith('/sub/')) return res.writeHead(404).end();
  let file = join(process.cwd(), 'dist', decodeURIComponent(path.slice(5)));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/sub/`;
const time = Date.UTC(2026, 9, 30, 16);
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, passed: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
};
function night(offset) {
  const start = Date.UTC(2026, 9, 30 + offset, 12);
  return {
    night: new Date(start).toISOString().slice(0, 10), nightStart: start, lockAt: start + 8 * 3600000,
    markets: [{ id: `fixture-distance-${offset}`, kind: 'distance', status: 'open', lockAt: start + 8 * 3600000,
      resultIdx: null, resultValue: null, pools: Array.from({ length: 4 }, () => ({ total: 0, seeded: 0, bets: 0 })) }],
  };
}
async function fixture(width = 390, spinning = true) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, locale: 'fr-FR' });
  const ctl = { freshness: 'online', fail: false, db: null, calls: [], hold: null, releases: [], reject: false, errors: [], badAssets: [] };
  page.on('pageerror', e => ctl.errors.push(String(e)));
  page.on('response', r => { if (r.url().startsWith(url) && r.status() >= 400) ctl.badAssets.push(r.url()); });
  await page.clock.install({ time });
  await page.addInitScript(() => { localStorage.setItem('polyhamster.token', 'isolated-test-player'); });
  await page.route('**/*', async route => {
    const req = route.request();
    if (req.url().startsWith(url)) return route.continue();
    if (req.url().startsWith('https://api.squeekchain.com/')) {
      if (ctl.fail) return route.abort();
      return route.fulfill({ json: {
        measurement: { freshness: ctl.freshness, coreStatus: spinning ? 'SPINNING' : 'IDLE', rpmMilli: spinning ? 42000 : 0, speedMmPerSecond: spinning ? 500 : 0 },
        builder: { anchor: { blockHeight: '4135', blockProgress: '350000000' } },
      } });
    }
    if (!req.url().includes('/rest/v1/rpc/')) return route.abort();
    const fn = req.url().split('/rpc/')[1];
    ctl.calls.push({ fn, body: req.postDataJSON() });
    if (fn === 'ph_state') return ctl.fail
      ? route.fulfill({ status: 500, json: { message: 'isolated-test-failure' } })
      : route.fulfill({ json: { now: time, status: ctl.db, nights: [-1, 0, 1].map(night), leaderboard: [] } });
    if (fn === 'ph_me') return route.fulfill({ json: { player: { id: 'isolated-player', pseudo: 'tester', balance: 1000, last_claim: null }, entries: [] } });
    if (fn === 'ph_bet' || fn === 'ph_seed') {
      if (ctl.hold === fn) await new Promise(resolve => ctl.releases.push(resolve));
      return ctl.reject ? route.fulfill({ status: 400, json: { message: 'insufficient_balance' } }) : route.fulfill({ json: 1 });
    }
    return route.fulfill({ json: null });
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('.board-label')?.textContent.trim() === 'En direct' && document.querySelector('.player'));
  return { page, ctl };
}
async function finish(page, ctl, name) {
  check(`${name}: no script errors or missing local assets`, !ctl.errors.length && !ctl.badAssets.length, { errors: ctl.errors, badAssets: ctl.badAssets });
  for (const release of ctl.releases.splice(0)) release();
  await page.close();
}
const board = page => page.evaluate(() => ({
  label: document.querySelector('.board-label').textContent.trim(), spinning: !!document.querySelector('.board.is-spinning'),
  wheel: !!document.querySelector('.wheel.spin'), readout: document.querySelector('.board .big').getAttribute('aria-label'),
  speed: document.querySelectorAll('.stat b')[1].textContent, block: document.querySelector('.stat b').textContent,
  sub: document.querySelector('.board-sub').textContent, warning: !!document.querySelector('.warn'),
}));
try {
  for (const mode of ['failed', 'stale', 'offline']) {
    const { page, ctl } = await fixture();
    const before = await board(page);
    assert.equal(before.speed, '1.8');
    assert.equal(before.readout, '42 RPM');
    if (mode === 'failed') ctl.fail = true;
    else {
      ctl.freshness = mode;
      ctl.db = { ok: false, spinning: false, freshness: mode, rpm: 0, kmh: 0, blockHeight: 4100, blockProgress: 0.1, updatedAt: time };
    }
    const response = page.waitForResponse(r => r.url().includes('/rpc/ph_state'));
    await page.clock.runFor(21000);
    await response;
    await page.waitForTimeout(100);
    const after = await board(page);
    check(`${mode}: immediately unavailable at first poll`, after.label === 'Pas en direct' && !after.spinning && !after.wheel && after.speed === '—' && after.readout === '---' && after.sub.includes('indisponible'), after);
    check(`${mode}: last block retained`, after.block === before.block, { before: before.block, after: after.block });
    await page.screenshot({ path: `${shots}/${mode}-21s.png` });
    // A fresh reading after failure restores the live state and clears any state warning.
    ctl.fail = false; ctl.freshness = 'online'; ctl.db = null;
    const recovery = page.waitForResponse(r => r.url().includes('/rpc/ph_state'));
    await page.clock.runFor(20000); await recovery;
    await page.waitForFunction(() => document.querySelector('.board-label').textContent.trim() === 'En direct');
    const restored = await board(page);
    check(`${mode}: fresh reading restores live`, restored.spinning && restored.speed === '1.8' && !restored.warning, restored);
    await finish(page, ctl, mode);
  }
  for (const kind of ['bet', 'seed']) {
    const { page, ctl } = await fixture(390, false);
    await page.locator('.tabs button').nth(2).click();
    const market = page.locator('.market').first();
    if (kind === 'bet') await market.locator('.outcome').first().click();
    else await market.locator('footer button').click();
    const submit = market.locator('.slip .primary');
    ctl.hold = `ph_${kind}`;
    const first = page.waitForRequest(r => r.url().endsWith(`/rpc/ph_${kind}`));
    await submit.click(); await first;
    const pending = await submit.evaluate(b => ({ disabled: b.disabled, busy: b.getAttribute('aria-busy'), text: b.textContent }));
    check(`${kind}: pending button is disabled, busy and translated`, pending.disabled && pending.busy === 'true' && pending.text.includes('en cours'), pending);
    check(`${kind}: amount controls are disabled`, await market.locator('.chips').evaluate(e => [...e.querySelectorAll('button,input')].every(c => c.disabled)));
    // A second programmatic activation exercises the handler even without Playwright's disabled-button wait.
    await submit.evaluate(b => { b.click(); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(100);
    const count = ctl.calls.filter(c => c.fn === `ph_${kind}`).length;
    check(`${kind}: repeat activation sends exactly one RPC`, count === 1, { count });
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    check(`${kind}: pending EN copy`, (await submit.textContent()).includes(kind === 'bet' ? 'Placing bet…' : 'Adding liquidity…'));
    await page.screenshot({ path: `${shots}/${kind}-pending.png` });
    ctl.reject = true;
    const rejected = page.waitForResponse(r => r.url().endsWith(`/rpc/ph_${kind}`));
    for (const release of ctl.releases.splice(0)) release();
    await rejected; await page.waitForSelector('.toast.err');
    check(`${kind}: rejected request is retryable`, await submit.isEnabled() && (await submit.getAttribute('aria-busy')) !== 'true' && await market.locator('.chips input').isEnabled());
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    ctl.reject = false; ctl.hold = null;
    await submit.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('.toast.ok');
    check(`${kind}: keyboard retry succeeds and closes slip`, (await market.locator('.slip').count()) === 0 && ctl.calls.filter(c => c.fn === `ph_${kind}`).length === 2);
    await finish(page, ctl, kind);
  }
  {
    const { page, ctl } = await fixture(320, false);
    await page.locator('.tabs button').nth(2).click();
    await page.locator('.outcome').first().click();
    const input = page.locator('.chips input');
    await input.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
    for (const value of ['50', '100000']) {
      await input.fill(value); await page.locator('.slip .primary').focus();
      const metrics = await input.evaluate(e => {
        const cs = getComputedStyle(e); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); ctx.font = cs.font;
        return { value: e.value, width: e.getBoundingClientRect().width, client: e.clientWidth, scroll: e.scrollWidth,
          textWidth: ctx.measureText(e.value).width, padding: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      check(`320px: complete amount ${value} fits`, metrics.width >= 90 && metrics.client >= metrics.textWidth + metrics.padding && metrics.scroll <= metrics.client && !metrics.overflow, metrics);
      await page.screenshot({ path: `${shots}/amount-320-${value}.png` });
    }
    await finish(page, ctl, 'amount at 320');
  }
  {
    const { page, ctl } = await fixture(390, false);
    for (const lang of ['en', 'fr', 'en']) {
      await page.getByRole('button', { name: lang.toUpperCase(), exact: true }).click();
      check(`language switch ${lang}: html and visible copy agree`, (await page.locator('html').getAttribute('lang')) === lang && (await page.locator('.board-label').textContent()).trim() === (lang === 'en' ? 'Live' : 'En direct'));
    }
    await page.reload(); await page.waitForSelector('.tabs');
    check('language persists after reload', (await page.locator('html').getAttribute('lang')) === 'en');
    const primary = await page.locator('.outcome').first().boundingBox();
    check('390px: product and main action visible on first screen', primary.y >= 0 && primary.y + primary.height <= 844, primary);
    await page.screenshot({ path: `${shots}/first-screen-390.png` });
    await finish(page, ctl, 'language and first screen');
  }
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
writeFileSync(`${shots}/results.json`, JSON.stringify(results, null, 2));
const failures = results.filter(r => !r.passed);
console.log(`${results.length - failures.length}/${results.length} checks passed`);
process.exitCode = failures.length ? 1 : 0;
