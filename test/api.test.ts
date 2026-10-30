import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const sql = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

async function setup() {
  const db = new PGlite();
  await db.exec(sql("001_init.sql"));
  await db.exec(sql("002_public_api.sql"));
  const one = async <T>(q: string, p: unknown[] = []) => (await db.query<Record<string, T>>(q, p)).rows[0];
  return { db, one };
}

test("public API: state, create player, bet, seed, claim, me", async () => {
  const { db, one } = await setup();
  const state = (await one<any>(`select ph_state() as s`)).s;
  assert.equal(state.nights.length, 3);
  assert.equal(state.nights[1].markets.length, 5);
  assert.deepEqual(state.nights[1].markets.map((m: any) => m.kind), ["distance", "sleep", "blocks", "wake", "owl"]);
  assert.equal(state.nights[1].markets[3].pools.length, 5);
  assert.equal(state.nights[0].markets.length, 0);
  // idempotent market creation
  await one(`select ph_state()`);
  assert.equal(Number((await one<any>(`select count(*) c from markets`)).c), 10);

  const { token } = (await one<any>(`select ph_create_player('matteo') as r`)).r;
  assert.equal(token.length, 64);
  await assert.rejects(db.query(`select ph_create_player('MATTEO')`), /pseudo_taken/);
  await assert.rejects(db.query(`select ph_create_player('a')`), /bad_pseudo/);

  const cur = state.nights[1];
  const open = new Date().getTime() < cur.lockAt;
  const sleep = cur.markets[1].id, owl = cur.markets[4].id;
  const tomorrowOwl = state.nights[2].markets[4].id;
  // tonight may already be locked depending on when the test runs; tomorrow is always open
  const target = open ? sleep : state.nights[2].markets[1].id;
  assert.equal(Number((await one<any>(`select ph_bet($1,$2,1,150) as b`, [token, target])).b), 850);
  assert.equal(Number((await one<any>(`select ph_seed($1,$2,201) as b`, [token, tomorrowOwl])).b), 650);
  assert.equal(Number((await one<any>(`select ph_claim($1) as b`, [token])).b), 750);
  await assert.rejects(db.query(`select ph_claim($1)`, [token]), /already_claimed/);
  await assert.rejects(db.query(`select ph_bet('nope',$1,1,10)`, [target]), /unknown_player/);

  const me = (await one<any>(`select ph_me($1) as m`, [token])).m;
  assert.equal(me.player.pseudo, "matteo");
  assert.equal(me.entries.length, 2); // the seed's 2 rows are merged into one line
  const seed = me.entries.find((e: any) => e.kind === "seed");
  assert.equal(Number(seed.amount), 200);

  const s2 = (await one<any>(`select ph_state() as s`)).s;
  const pools = s2.nights[2].markets[4].pools;
  assert.deepEqual(pools.map((p: any) => Number(p.seeded)), [100, 100]);
  assert.equal(s2.leaderboard[0].pseudo, "matteo");
  void owl;
});

test("bets are refused while the wheel spins during the night", async () => {
  const { db, one } = await setup();
  const state = (await one<any>(`select ph_state() as s`)).s;
  const { token } = (await one<any>(`select ph_create_player('runner') as r`)).r;
  await db.query(`update live_status set spinning = true, updated_at = now() where id = 1`);
  // current night has started (it starts at 12:00 UTC, always <= now) => refused, either locked or spinning
  await assert.rejects(db.query(`select ph_bet($1,$2,0,10)`, [token, state.nights[1].markets[0].id]), /wheel_spinning|market_locked/);
  // next night has not started => allowed
  await one(`select ph_bet($1,$2,0,10)`, [token, state.nights[2].markets[0].id]);
  // stale status (> 3 min) is ignored
  await db.query(`update live_status set updated_at = now() - interval '10 minutes' where id = 1`);
  const open = Date.now() < state.nights[1].lockAt;
  if (open) await one(`select ph_bet($1,$2,0,10)`, [token, state.nights[1].markets[0].id]);
});
