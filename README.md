# PolyHamster 🐹

Prediction markets (play points only, no real money) on the nights of **Squeektoshi**, the hamster mining [Squeekchain](https://squeekchain.com).
Every market resolves automatically from the public API `api.squeekchain.com`.

## The 5 nightly markets

A "Squeek night" = 12:00 UTC → 12:00 UTC (the API's own day).

| Market | Metric | Source |
|---|---|---|
| 🛞 Distance | night `distanceMm` | `/v1/measurement/stats?range=7d` (`activity.days`) |
| 😴 Snooze hours | half-hours with zero wheel turns × 0.5 h | same, 48 half-hour buckets |
| ⛏️ Blocks | sum of `completedBlockCount` over four 6-hour buckets | `/v1/settlements?range=7d` |
| ⏰ Wake-up time | start of the first half-hour with ≥ 1 turn | `/v1/measurement/stats` |
| 🦉 Night owl / early bird | turns before vs after 00:00 UTC | `/v1/measurement/stats` |

"Snooze" means the wheel is still. The API has no sleep sensor.

## Rules

- 1,000 seeds 🌻 on sign-up, +100 a day. Seeds have no value.
- Bets open 12:00 → 20:00 UTC, **or until the wheel starts spinning**.
- Anti-cheat: at resolution, any bet placed after the first active half-hour began is refunded.
- **Parimutuel**: the pool goes to winners pro rata. No house, no operator money.
- **Liquidity**: any player can seed a market. The stake is split evenly across outcomes; seeders share 2% of bettors' volume. They can win or lose.
- Incomplete data (missing rounds) → wait up to 6 h, then void and refund. Nobody on the winning outcome → refund.

## Architecture

```
static site (Next.js export in dist/, IPFS)  ──rpc──▶  Supabase Postgres  (ph_* SECURITY DEFINER functions, RLS closed)
        │                                           ▲
        └── GET api.squeekchain.com/v1/status       │ resolve_market (service role)
                                                    │
                       pg_cron (every minute) ──▶ Edge Function `polyhamster`  ──▶ api.squeekchain.com
```

- `app/`: the UI (FR/EN, dot-matrix LED style after Squeekchain's identity). See `DESIGN.md`.
- `dist/`: the committed static export that is hosted (relative URLs, see below).
- `supabase/migrations/`: schema, money logic (atomic SQL), public RPCs, cron.
- `supabase/functions/polyhamster/`: keeper (live status + resolution). `rules.ts` is shared with the site.
- `lib/config.ts`: public Supabase URL and publishable key (safe to ship: it can only call `ph_*` RPCs).
- Player account = name + secret key (stored hashed), copyable to switch device.

## Install, preview, rebuild

Node 20+ and npm.

```bash
npm ci                         # install from package-lock.json
npm test                       # resolution logic on real nights (Oct 27-29), SQL functions (PGlite), wheel-status freshness
npx tsc --noEmit               # typecheck
npm run dev                    # dev server against the live Supabase project (http://localhost:3000)

npm run build                  # Next.js static export into ./out (fonts are downloaded and self-hosted at build time)
node scripts/export-dist.mjs   # copy ./out to ./dist with relative asset URLs (works at an IPFS gateway subpath)
python3 -m http.server -d dist 8080   # preview the committed export at http://localhost:8080/
```

`dist/` is the committed, hosted export: rebuild it with the two build commands above after any source change
and commit it with the source. `out/` and `.next/` are build scratch and ignored.

## Live status: when the board says "Live"

The board shows **Live / En direct** only when the wheel reading is fresh:

- straight from `api.squeekchain.com/v1/status` with `measurement.freshness == "online"`, or, when the browser
  cannot reach Squeekchain, the keeper's copy in `ph_state` dated by its own `updatedAt` (a stalled keeper is not new);
- and less than 90 s old on the page. Refreshes run every 20 s. A refresh with no usable reading immediately turns
  the board to **Not live / Pas en direct**, `---`, no RPM, no km/h and no spinning animation, while the last block
  values stay. This applies to failed requests and explicit stale/offline responses; a later fresh reading restores
  Live. The 90 s limit also protects against a keeper copy that has aged out.
- If the game state itself cannot be refreshed, a warning says the odds shown may be outdated.

Logic: `app/components/wheelStatus.ts`, tested in `test/wheelStatus.test.ts`. The page language (`<html lang>`)
follows the FR/EN switch (`app/components/App.tsx`).

## Validation (this revision)

Run on 2026-10-30 against the final source and `dist/`:

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx --no-install tsc --noEmit` | passed, no errors |
| Production build | `npm run build && node scripts/export-dist.mjs` | passed; `/` 74.5 kB, first load 177 kB; 6 files rewritten to relative URLs |
| Unit + SQL tests | `npm test` | 17/17 passed |
| Interactions (Playwright, export served under `/sub/`, both backends mocked) | `IMD_PLAYWRIGHT=… node test/e2e-export.mjs` | 42/42 passed |
| Finding regressions (Chromium, mocked requests) | `IMD_PLAYWRIGHT=… node test/revision-export.mjs` | 35/35 passed; previous export reproduced all three findings |
| Offline design probe at 320/390/1440 | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste --offline` | 16/16 checks passed; populated slips checked separately |

The build, typecheck and unit tests ran in an external temporary copy using the unchanged manifest and lockfile;
its finished `dist/` was copied back here. No dependency or build configuration changed.

Install Playwright outside the repository to rerun the browser checks, then set `IMD_PLAYWRIGHT` to its absolute
`index.mjs` path (and `PLAYWRIGHT_BROWSERS_PATH` if using a custom browser directory). The pinned probe is available
during the assignment; the two interaction scripts remain in `test/`.

The runs cover FR/EN language and persistence, relative assets and local fonts, night tabs, rule disclosure, Join,
mocked betting, first-poll invalidation after failed/stale/offline refreshes, recovery to Live, keeper freshness,
and no overflow at 320/390/1440. Held bet and seed requests each produce one RPC, disable amount controls, show
translated busy feedback, and allow keyboard retry after rejection. The expanded 320px slip fully displays `50`
and `100000`. No live account or wager was created.

Browser inspection also checked 768/900/901px layouts, keyboard focus and reduced motion. WebKit was attempted but
could not launch because required system libraries are missing. No screen-reader session, physical device, native
200% zoom or full accessibility audit was performed; gradient contrast remains unmeasured. Actual evidence,
the six-domain review and limitations: `artifacts/validation.md`. Design system: `DESIGN.md`.

## Built with IMD

Hosted on IPFS by the [IMD](https://imd.fun) swarm (`import-site` + `site-content-check`), for the [Squeekchain Genesis code board](https://squeekchain.com/genesis/code).
Hosted name: `polyhamster-prediction-markets-o.identitymd.eth` (https://polyhamster-prediction-markets-o.identitymd.eth.limo/), which `app/layout.tsx` uses as `metadataBase` so `og:image` is an absolute URL.
