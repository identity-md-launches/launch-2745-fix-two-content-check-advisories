// Interaction checks on the committed export (dist/) served under a subpath, with Squeekchain and Supabase mocked.
// Needs Playwright outside the repo: IMD_PLAYWRIGHT=/path/to/playwright/index.mjs node test/e2e-export.mjs (from the repo root).
// Screenshots go to test/scratch/.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
const { chromium } = await import(process.env.IMD_PLAYWRIGHT);

const DIST = join(process.cwd(), "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".txt": "text/plain" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!p.startsWith("/sub/")) { res.writeHead(404).end(); return; }
  p = join(DIST, p.slice(5));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URLBASE = `http://127.0.0.1:${server.address().port}/sub/`;

const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " :: " + extra : ""}`); };

const night = (d, start) => ({
  night: d, nightStart: start, lockAt: start + 8 * 3600e3,
  markets: ["distance", "sleep", "blocks", "wake", "owl"].map((kind, i) => ({
    id: `${d}-${kind}`, kind, status: "open", lockAt: start + 8 * 3600e3, resultIdx: null, resultValue: null,
    pools: Array.from({ length: kind === "wake" ? 5 : kind === "owl" ? 2 : 4 }, () => ({ total: 0, seeded: 0, bets: 0 })),
  })),
});

async function scenario(name, { squeek, dbAge = 30_000, dbOk = true, stateFails = false, width = 390 }, body) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 844 }, locale: "fr-FR" });
  const errors = []; const bad = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.url().startsWith(URLBASE) && r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  const ctl = { squeek, stateFails, dbAge, dbOk, calls: [] };
  await page.route("https://api.squeekchain.com/**", (route) => {
    if (ctl.squeek === "fail") return route.abort();
    route.fulfill({ json: {
      measurement: { freshness: ctl.squeek, coreStatus: "IDLE", rpmMilli: 0, speedMmPerSecond: 0 },
      builder: { anchor: { blockHeight: "4135", blockProgress: "350000000" } },
    } });
  });
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1];
    ctl.calls.push(fn);
    const now = Date.now();
    if (fn === "ph_state") {
      if (ctl.stateFails) return route.fulfill({ status: 500, json: { message: "boom" } });
      const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 12) - (new Date(now).getUTCHours() < 12 ? 864e5 : 0);
      const ds = (t) => new Date(t).toISOString().slice(0, 10);
      return route.fulfill({ json: {
        now,
        status: { ok: ctl.dbOk, spinning: false, freshness: "online", rpm: 0, kmh: 0, blockHeight: 4100, blockProgress: 0.1, observedAt: new Date(now - ctl.dbAge).toISOString(), updatedAt: now - ctl.dbAge },
        nights: [night(ds(start - 864e5), start - 864e5), night(ds(start), start), night(ds(start + 864e5), start + 864e5)],
        leaderboard: [{ pseudo: "nibbles", balance: 1200 }],
      } });
    }
    if (fn === "ph_create_player") return route.fulfill({ json: { token: "a".repeat(64) } });
    if (fn === "ph_me") return route.fulfill({ json: { player: { id: "1", pseudo: "tester", balance: 1000, last_claim: null }, entries: [] } });
    if (fn === "ph_bet") return route.fulfill({ json: 1 });
    return route.fulfill({ json: null });
  });
  await page.goto(URLBASE);
  await page.waitForSelector(".board-label");
  await page.waitForFunction(() => !document.querySelector(".board-label").textContent.includes("…"), null, { timeout: 15000 }).catch(() => {});
  try { await body(page, ctl); } catch (e) { check(`${name}: threw`, false, String(e).slice(0, 300)); }
  check(`${name}: no page errors`, errors.length === 0, errors.join(" | "));
  check(`${name}: no failed local asset`, bad.length === 0, bad.join(" | "));
  await browser.close();
}
const label = async (p) => { const t = await p.locator(".board-label").textContent(); console.log("   label:", t); return t; };

await scenario("squeek online", { squeek: "online" }, async (page) => {
  // Language follows the switch.
  await page.getByRole("button", { name: "EN", exact: true }).click();
  check("lang EN sets <html lang=en>", (await page.evaluate(() => document.documentElement.lang)) === "en");
  check("EN board label is Live", (await label(page)).trim() === "Live");
  await page.getByRole("button", { name: "FR", exact: true }).click();
  check("lang FR sets <html lang=fr>", (await page.evaluate(() => document.documentElement.lang)) === "fr");
  check("FR board label is En direct", (await label(page)).trim() === "En direct");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.reload(); await page.waitForTimeout(800);
  check("lang persists across reload", (await page.evaluate(() => document.documentElement.lang)) === "en");
  // fonts from the export, not from Google
  const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "IBM Plex Mono"') || [...document.fonts].some((f) => f.status === "loaded"); });
  check("self-hosted fonts load at subpath", fontsOk);
  // Tabs
  await page.locator(".tabs button").nth(2).click();
  check("tab switch marks aria-pressed", (await page.locator(".tabs button").nth(2).getAttribute("aria-pressed")) === "true");
  await page.locator(".tabs button").nth(1).click();
  // Rule disclosure
  const rule = page.locator(".market").first().getByRole("button", { name: "Rule" });
  await rule.click();
  check("rule toggle expands", (await rule.getAttribute("aria-expanded")) === "true" && (await page.locator(".market .rule").count()) === 1);
  // Pick an outcome: slip appears; betting without an account goes to Join
  await page.locator(".market").first().locator(".outcome").first().click();
  check("picking an outcome opens the bet slip", (await page.locator(".slip").count()) === 1);
  await page.locator(".slip .primary").click();
  await page.waitForTimeout(800);
  const joinTop = await page.locator("#join").evaluate((e) => e.getBoundingClientRect().top);
  check("bet without account scrolls to Join", joinTop < 844 && joinTop > -50, `top=${joinTop}`);
  // Join (mocked) then bet
  await page.getByRole("textbox", { name: "Your name" }).fill("tester");
  await page.getByRole("button", { name: "Start playing" }).click();
  await page.waitForSelector(".player", { timeout: 5000 });
  check("join shows the player card", true);
  if (!(await page.locator(".slip").count())) await page.locator(".market").first().locator(".outcome").first().click();
  await page.locator(".slip .primary").click();
  await page.waitForSelector(".toast.ok", { timeout: 5000 });
  check("bet confirms in a status toast", (await page.locator('[role="status"] .toast.ok').count()) === 1);
});

await scenario("squeek down, keeper copy fresh", { squeek: "fail", dbAge: 30_000 }, async (page) => {
  check("fresh keeper copy shows En direct", (await label(page)).trim() === "En direct");
});

await scenario("squeek down, keeper copy 4 min old", { squeek: "fail", dbAge: 240_000 }, async (page) => {
  check("stale keeper copy is not live", (await label(page)).trim() === "Pas en direct");
  check("stale: km/h shows a dash", (await page.locator(".stat").nth(1).locator("b").textContent()) === "—");
  check("stale: unavailable text", (await page.locator(".board-sub").textContent()).includes("indisponible"));
  check("stale: LED off", (await page.locator(".led").getAttribute("class")).includes("led-off"));
});

await scenario("squeek sensor offline", { squeek: "offline", dbOk: false }, async (page) => {
  check("source freshness offline is not live", (await label(page)).trim() === "Pas en direct");
});

await scenario("state refresh fails", { squeek: "fail", stateFails: true }, async (page) => {
  check("failed refresh shows warning", (await page.locator(".warn").count()) === 1);
  check("failed refresh is not live", (await label(page)).trim() === "Pas en direct");
});

// A live reading ages out after 90 s when every later refresh fails.
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "fr-FR" });
  let fail = false;
  await page.clock.install();
  await page.route("https://api.squeekchain.com/**", (r) => fail ? r.abort() : r.fulfill({ json: { measurement: { freshness: "online", coreStatus: "SPINNING", rpmMilli: 42000, speedMmPerSecond: 500 }, builder: { anchor: { blockHeight: "1", blockProgress: "0" } } } }));
  await page.route("**/rest/v1/rpc/**", (r) => fail ? r.fulfill({ status: 500, json: {} }) : r.fulfill({ json: { now: Date.now(), status: null, nights: [], leaderboard: [] } }));
  await page.goto(URLBASE);
  await page.waitForFunction(() => document.querySelector(".board-label")?.textContent.includes("En direct"), null, { timeout: 10000 }).catch(() => {});
  check("aging: starts live and spinning", (await label(page)).includes("En direct") && (await page.locator(".board.is-spinning").count()) === 1);
  fail = true;
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(500);
  check("aging: still live at 60 s", (await label(page)).includes("En direct"));
  await page.clock.fastForward(40_000);
  await page.waitForTimeout(500);
  check("aging: not live after 100 s of failed refreshes", (await label(page)).includes("Pas en direct") && (await page.locator(".board.is-spinning").count()) === 0);
  await browser.close();
}

for (const w of [320, 390, 1440]) {
  await scenario(`width ${w}`, { squeek: "online", width: w }, async (page) => {
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check(`no horizontal scroll at ${w}`, sw <= w, `scrollWidth=${sw}`);
    mkdirSync("test/scratch", { recursive: true }); await page.screenshot({ path: `test/scratch/e2e-${w}.png` });
  });
}

server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
