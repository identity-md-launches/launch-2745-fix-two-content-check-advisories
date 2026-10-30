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
static site (Next.js export, IPFS)  ──rpc──▶  Supabase Postgres  (ph_* SECURITY DEFINER functions, RLS closed)
        │                                           ▲
        └── GET api.squeekchain.com/v1/status       │ resolve_market (service role)
                                                    │
                       pg_cron (every minute) ──▶ Edge Function `polyhamster`  ──▶ api.squeekchain.com
```

- `app/`: the UI (FR/EN, dot-matrix LED style after Squeekchain's identity).
- `supabase/migrations/`: schema, money logic (atomic SQL), public RPCs, cron.
- `supabase/functions/polyhamster/`: keeper (live status + resolution). `rules.ts` is shared with the site.
- `lib/config.ts`: public Supabase URL and publishable key (safe to ship: it can only call `ph_*` RPCs).
- Player account = name + secret key (stored hashed), copyable to switch device.

## Develop

```bash
npm install
npm test          # resolution logic on real nights (Oct 27-29) + SQL functions (PGlite)
npm run dev       # site against the live Supabase project
npm run build     # static export in ./out
```

## Built with IMD

Hosted on IPFS by the [IMD](https://imd.fun) swarm (`import-site` + `site-content-check`), for the [Squeekchain Genesis code board](https://squeekchain.com/genesis/code).
