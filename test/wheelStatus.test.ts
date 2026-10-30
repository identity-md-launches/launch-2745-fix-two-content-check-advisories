import { test } from "node:test";
import assert from "node:assert/strict";
import { displayStatus, isLive, LIVE_MAX_AGE_MS, pickReading, WheelStatus } from "../app/components/wheelStatus";

const base: WheelStatus = { ok: true, spinning: true, freshness: "online", rpm: 42, kmh: 1.5, blockHeight: 4135, blockProgress: 0.3 };
const T = 1_800_000_000_000;

test("Squeekchain status is live when fresh and online", () => {
  const r = pickReading(base, null, T);
  assert.deepEqual(r, { status: base, at: T });
  assert.equal(isLive(r, T + LIVE_MAX_AGE_MS - 1), true);
  assert.equal(displayStatus(r, null, T)?.spinning, true);
});

test("a reading older than 90 s is never live", () => {
  const r = pickReading(base, null, T);
  assert.equal(isLive(r, T + LIVE_MAX_AGE_MS), false);
  const shown = displayStatus(r, null, T + 5 * 60_000)!;
  assert.equal(shown.ok, false);
  assert.equal(shown.spinning, false);
  assert.equal(shown.blockHeight, 4135); // last known block kept
});

test("a source that flags its sensor as stale is not live", () => {
  assert.equal(pickReading({ ...base, freshness: "stale" }, null, T), null);
  assert.equal(pickReading({ ...base, ok: false }, null, T), null);
});

test("the keeper copy is dated by its updatedAt, so a stalled keeper is not live", () => {
  const fresh = pickReading(null, { now: T, status: { ...base, updatedAt: T - 30_000 } }, T + 7)!;
  assert.equal(fresh.at, T + 7 - 30_000);
  assert.equal(isLive(fresh, T + 7), true);
  const old = pickReading(null, { now: T, status: { ...base, updatedAt: T - 4 * 60_000 } }, T)!;
  assert.equal(isLive(old, T), false);
  assert.equal(displayStatus(old, null, T)!.ok, false);
  assert.equal(pickReading(null, { now: T, status: { ...base, updatedAt: null } }, T), null);
});

test("failed refresh: no reading, the board falls back to a not-live status", () => {
  assert.equal(pickReading(null, null, T), null);
  assert.equal(displayStatus(null, null, T), undefined);
  const shown = displayStatus(null, base, T)!;
  assert.equal(shown.ok, false);
  assert.equal(shown.spinning, false);
});
