import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(new URL("../supabase/migrations/001_init.sql", import.meta.url), "utf8");

async function setup() {
  const db = new PGlite();
  await db.exec(schema);
  const mk = async (pseudo: string) =>
    (await db.query<{ id: string }>(`insert into players(pseudo, token_hash) values ($1, $2) returning id`, [pseudo, "h" + pseudo])).rows[0].id;
  const market = (await db.query<{ id: string }>(
    `insert into markets(night, kind, outcome_count, lock_at) values ('2026-10-30','owl',2,'2026-10-30T20:00:00Z') returning id`,
  )).rows[0].id;
  const bal = async (id: string) => Number((await db.query<{ balance: string }>(`select balance from players where id=$1`, [id])).rows[0].balance);
  return { db, mk, market, bal };
}
const T0 = "2026-10-30T15:00:00Z";

test("bets debit, payouts are parimutuel, money is conserved", async () => {
  const { db, mk, market, bal } = await setup();
  const a = await mk("alice"), b = await mk("bob"), c = await mk("carol");
  await db.query(`select place_bet($1,$2,0,300,$3)`, [a, market, T0]);
  await db.query(`select place_bet($1,$2,0,100,$3)`, [b, market, T0]);
  await db.query(`select place_bet($1,$2,1,400,$3)`, [c, market, T0]);
  assert.equal(await bal(a), 700);
  await db.query(`select resolve_market($1, 0, '7110 / 6187')`, [market]);
  // pool 800, winners staked 400, no seeder => no fee. alice 300*800/400=600, bob 200
  assert.equal(await bal(a), 1300);
  assert.equal(await bal(b), 1100);
  assert.equal(await bal(c), 600);
  assert.equal((await bal(a)) + (await bal(b)) + (await bal(c)), 3000);
  // idempotent
  await db.query(`select resolve_market($1, 1, 'x')`, [market]);
  assert.equal(await bal(c), 600);
});

test("seeders split the 2% fee and play their even split", async () => {
  const { db, mk, market, bal } = await setup();
  const s = await mk("seeder"), a = await mk("alice"), b = await mk("bob");
  await db.query(`select seed_market($1,$2,201,$3)`, [s, market, T0]); // 100 per outcome, 1 point not charged
  assert.equal(await bal(s), 800);
  await db.query(`select place_bet($1,$2,0,500,$3)`, [a, market, T0]);
  await db.query(`select place_bet($1,$2,1,500,$3)`, [b, market, T0]);
  await db.query(`select resolve_market($1, 0, 'v')`, [market]);
  // T=1200, fee=2% of 1000=20, W=600 -> payout = amount*1180/600
  // alice 500*1180/600 = 983 ; seeder 100*1180/600 = 196 + fee 20 = 216
  assert.equal(await bal(a), 500 + 983);
  assert.equal(await bal(s), 800 + 216);
  assert.equal(await bal(b), 500);
  const total = (await bal(a)) + (await bal(b)) + (await bal(s));
  assert.ok(total <= 3000 && total >= 2998, `rounding dust only, got ${total}`);
});

test("guards: lock time, balance, outcome range, daily claim", async () => {
  const { db, mk, market, bal } = await setup();
  const a = await mk("alice");
  await assert.rejects(db.query(`select place_bet($1,$2,0,10,'2026-10-30T20:00:00Z')`, [a, market]), /market_locked/);
  await assert.rejects(db.query(`select place_bet($1,$2,0,5000,$3)`, [a, market, T0]), /insufficient_balance/);
  await assert.rejects(db.query(`select place_bet($1,$2,2,10,$3)`, [a, market, T0]), /bad_outcome/);
  await assert.rejects(db.query(`select seed_market($1,$2,1,$3)`, [a, market, T0]), /seed_too_small/);
  await db.query(`select claim_daily($1,'2026-10-30')`, [a]);
  assert.equal(await bal(a), 1100);
  await assert.rejects(db.query(`select claim_daily($1,'2026-10-30')`, [a]), /already_claimed/);
});

test("void refunds everyone; late bets are refunded and excluded", async () => {
  const { db, mk, market, bal } = await setup();
  const a = await mk("alice"), b = await mk("bob"), late = await mk("latecomer");
  await db.query(`select place_bet($1,$2,0,200,$3)`, [a, market, T0]);
  await db.query(`select place_bet($1,$2,1,200,$3)`, [b, market, T0]);
  await db.query(`select place_bet($1,$2,0,500,'2026-10-30T19:59:00Z')`, [late, market]);
  // hamster woke at 19:30 => latecomer's bet is refunded, not counted
  await db.query(`select resolve_market($1, 0, 'v', '2026-10-30T19:30:00Z')`, [market]);
  assert.equal(await bal(late), 1000);
  assert.equal(await bal(a), 1200);
  assert.equal(await bal(b), 800);

  const { db: db2, mk: mk2, market: m2, bal: bal2 } = await setup();
  const x = await mk2("xx");
  await db2.query(`select place_bet($1,$2,1,250,$3)`, [x, m2, T0]);
  await db2.query(`select resolve_market($1, null, 'tie')`, [m2]);
  assert.equal(await bal2(x), 1000);
  // nobody on the winner => refund
  const { db: db3, mk: mk3, market: m3, bal: bal3 } = await setup();
  const y = await mk3("yy");
  await db3.query(`select place_bet($1,$2,1,250,$3)`, [y, m3, T0]);
  await db3.query(`select resolve_market($1, 0, 'v')`, [m3]);
  assert.equal(await bal3(y), 1000);
});
