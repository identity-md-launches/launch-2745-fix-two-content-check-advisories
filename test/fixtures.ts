// Real data transcribed from api.squeekchain.com on 2026-10-30 (/v1/measurement/stats?range=7d
// and /v1/settlements?range=7d). Only non-zero half-hour buckets are listed.
import type { StatsDay, StatsResponse, SettlementsResponse } from "../lib/squeek";

function day(date: string, active: Record<number, number>, distanceMm: string, opts: { missing?: number[] } = {}): StatsDay {
  const buckets = Array.from({ length: 48 }, (_, i) => {
    const m = i * 30;
    const missing = opts.missing?.includes(m);
    return {
      startMinuteUtc: m,
      coverage: (missing ? "missing" : "complete") as "missing" | "complete",
      observedRoundCount: missing ? 0 : 3,
      workUnits: missing ? null : String(active[m] ?? 0),
    };
  });
  const observed = buckets.reduce((a, b) => a + b.observedRoundCount, 0);
  const work = Object.values(active).reduce((a, b) => a + b, 0);
  return {
    date,
    coverage: { expectedRoundCount: 144, observedRoundCount: observed, coverageBps: Math.round((observed / 144) * 10000) },
    observedWorkUnits: String(work),
    distanceMm,
    buckets,
  };
}

export const stats: StatsResponse = {
  activity: { days: [
    // 26 Oct: 3 missing half-hours (12:00-13:30 UTC) + one partial, like the real API
    day("2026-10-26", { 150: 1047, 180: 541, 360: 1047, 390: 1267, 1260: 864, 1290: 1726, 1320: 1714, 1350: 1096, 1380: 707, 1410: 1173 }, "9817796", { missing: [720, 750, 780] }),
    day("2026-10-27", { 30: 1148, 60: 1723, 90: 1502, 120: 92, 150: 1274, 330: 898, 360: 608, 1260: 714, 1290: 907, 1320: 1827, 1350: 198 }, "9562298"),
    day("2026-10-28", { 0: 1332, 30: 1170, 60: 1330, 210: 390, 240: 1142, 1260: 469, 1290: 50, 1350: 1512, 1380: 1597, 1410: 1595 }, "9295386"),
    day("2026-10-29", { 0: 1596, 30: 1094, 60: 1438, 210: 1394, 240: 466, 450: 199, 1260: 155, 1290: 260, 1320: 1776, 1350: 1648, 1380: 1628, 1410: 1643 }, "11674766"),
  ] },
};

const b = (s: string, e: string, n: number) => ({ startAt: s, endAt: e, completedBlockCount: String(n) });
export const settlements: SettlementsResponse = {
  status: "available",
  buckets: [
    b("2026-10-27T12:00:00.000Z", "2026-10-27T18:00:00.000Z", 0),
    b("2026-10-27T18:00:00.000Z", "2026-10-28T00:00:00.000Z", 66),
    b("2026-10-28T00:00:00.000Z", "2026-10-28T06:00:00.000Z", 809),
    b("2026-10-28T06:00:00.000Z", "2026-10-28T12:00:00.000Z", 105),
    b("2026-10-28T12:00:00.000Z", "2026-10-28T18:00:00.000Z", 0),
    b("2026-10-28T18:00:00.000Z", "2026-10-29T00:00:00.000Z", 428),
    b("2026-10-29T00:00:00.000Z", "2026-10-29T06:00:00.000Z", 539),
    b("2026-10-29T06:00:00.000Z", "2026-10-29T12:00:00.000Z", 0),
    b("2026-10-29T12:00:00.000Z", "2026-10-29T18:00:00.000Z", 0),
    b("2026-10-29T18:00:00.000Z", "2026-10-30T00:00:00.000Z", 579),
    b("2026-10-30T00:00:00.000Z", "2026-10-30T06:00:00.000Z", 545),
    b("2026-10-30T06:00:00.000Z", "2026-10-30T12:00:00.000Z", 17),
  ],
};
