import { test } from "node:test";
import assert from "node:assert/strict";
import { stats, settlements } from "./fixtures";
import { nightMetrics, winningOutcome, currentNight, lockAt, lateBetCutoff, resultValue } from "../lib/squeek";

test("work totals match the API's observedWorkUnits", () => {
  for (const [night, work] of [["2026-10-27", 10891], ["2026-10-28", 10587], ["2026-10-29", 13297]] as const) {
    const m = nightMetrics(stats, settlements, night)!;
    assert.equal(m.workBefore + m.workAfter, work);
  }
});

test("night of 29 Oct: real values", () => {
  const m = nightMetrics(stats, settlements, "2026-10-29")!;
  assert.equal(m.complete, true);
  assert.equal(m.blocks, 1141); // site says "In the last day it dug up 1,141 blocks"
  assert.equal(m.idleHalfHours / 2, 18);
  assert.equal(m.wakeMinuteUtc, 1260);
  assert.equal(winningOutcome("distance", m), 2); // 11.67 km
  assert.equal(winningOutcome("sleep", m), 1); // 18h
  assert.equal(winningOutcome("blocks", m), 2); // 1141
  assert.equal(winningOutcome("wake", m), 1); // 21:00 UTC
  assert.equal(winningOutcome("owl", m), 0); // 7110 before vs 6187 after
  assert.equal(resultValue("distance", m), "11.67 km");
});

test("nights 27 and 28", () => {
  const a = nightMetrics(stats, settlements, "2026-10-27")!;
  assert.equal(a.idleHalfHours / 2, 18.5);
  assert.equal(a.blocks, 980);
  assert.equal(winningOutcome("owl", a), 1); // 3646 vs 7245
  assert.equal(winningOutcome("distance", a), 1);
  const b = nightMetrics(stats, settlements, "2026-10-28")!;
  assert.equal(b.idleHalfHours / 2, 19);
  assert.equal(winningOutcome("sleep", b), 2);
  assert.equal(b.workBefore, 5223);
  assert.equal(b.workAfter, 5364);
});

test("incomplete night voids stats markets", () => {
  const m = nightMetrics(stats, settlements, "2026-10-26")!;
  assert.equal(m.complete, false);
  assert.equal(winningOutcome("distance", m), null);
  assert.equal(winningOutcome("blocks", m), null); // no settlement buckets for that night in fixture
});

test("unknown night returns null", () => {
  assert.equal(nightMetrics(stats, settlements, "2026-11-30"), null);
});

test("time helpers", () => {
  assert.equal(currentNight(Date.parse("2026-10-30T17:40:00Z")), "2026-10-30");
  assert.equal(currentNight(Date.parse("2026-10-31T03:00:00Z")), "2026-10-30");
  assert.equal(new Date(lockAt("2026-10-30")).toISOString(), "2026-10-30T20:00:00.000Z");
  const m = nightMetrics(stats, settlements, "2026-10-29")!;
  assert.equal(new Date(lateBetCutoff(m, "2026-10-29")!).toISOString(), "2026-10-29T21:00:00.000Z");
});
