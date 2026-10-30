// Squeekchain data + market rules. Pure logic, no I/O, no imports: shared by the static site
// (via lib/squeek.ts) and the Supabase Edge Function that resolves markets (Deno).
// Source of truth: https://api.squeekchain.com (public, read-only).
//
// A "Squeek night" is the API's universal day: 12:00 UTC -> 12:00 UTC next day.
// /v1/measurement/stats returns 48 half-hour buckets per night, starting at minute 720 (12:00 UTC)
// and wrapping to minute 0..690 for the next calendar morning.

export const API_BASE = "https://api.squeekchain.com";
export const HOUR = 3_600_000;
export const LOCK_HOUR_UTC = 20; // bets close at 20:00 UTC (21:00 Paris in winter)
export const RESOLVE_DELAY_MS = 30 * 60_000; // wait 30 min after the night ends for settlements

export type MarketKind = "distance" | "sleep" | "blocks" | "wake" | "owl";
export const MARKET_KINDS: MarketKind[] = ["distance", "sleep", "blocks", "wake", "owl"];

export type Outcome = { en: string; fr: string };
export type MarketDef = {
  kind: MarketKind;
  emoji: string;
  title: Outcome;
  rule: Outcome;
  outcomes: Outcome[];
};

export const MARKET_DEFS: Record<MarketKind, MarketDef> = {
  distance: {
    kind: "distance",
    emoji: "🛞",
    title: { en: "How far will Squeektoshi run tonight?", fr: "Combien de km Squeektoshi va courir cette nuit ?" },
    rule: {
      en: "Wheel distance for the night (12:00 → 12:00 UTC), from /v1/measurement/stats.",
      fr: "Distance de la roue sur la nuit (12h00 → 12h00 UTC), lue dans /v1/measurement/stats.",
    },
    outcomes: [
      { en: "< 8 km", fr: "< 8 km" },
      { en: "8 – 9.99 km", fr: "8 – 9,99 km" },
      { en: "10 – 11.99 km", fr: "10 – 11,99 km" },
      { en: "≥ 12 km (new record)", fr: "≥ 12 km (record battu)" },
    ],
  },
  sleep: {
    kind: "sleep",
    emoji: "😴",
    title: { en: "How many hours of snooze?", fr: "Combien d'heures de dodo ?" },
    rule: {
      en: "A half-hour counts as snooze when the wheel made zero turns. We measure the wheel, not real sleep: he might be eating or grooming.",
      fr: "Une demi-heure compte comme dodo si la roue n'a fait aucun tour. On mesure la roue, pas le vrai sommeil : il peut être en train de manger ou de se toiletter.",
    },
    outcomes: [
      { en: "≤ 17h30", fr: "≤ 17h30" },
      { en: "18h – 18h30", fr: "18h – 18h30" },
      { en: "19h – 19h30", fr: "19h – 19h30" },
      { en: "≥ 20h", fr: "≥ 20h" },
    ],
  },
  blocks: {
    kind: "blocks",
    emoji: "⛏️",
    title: { en: "How many blocks will he mine?", fr: "Combien de blocs va-t-il miner ?" },
    rule: {
      en: "Completed Squeek blocks settled during the night, from /v1/settlements (four 6-hour buckets).",
      fr: "Blocs Squeek complétés et réglés pendant la nuit, lus dans /v1/settlements (4 tranches de 6 h).",
    },
    outcomes: [
      { en: "< 900", fr: "< 900" },
      { en: "900 – 1,049", fr: "900 – 1 049" },
      { en: "1,050 – 1,199", fr: "1 050 – 1 199" },
      { en: "≥ 1,200", fr: "≥ 1 200" },
    ],
  },
  wake: {
    kind: "wake",
    emoji: "⏰",
    title: { en: "When does he hop on the wheel?", fr: "À quelle heure il monte dans la roue ?" },
    rule: {
      en: "Start of the first half-hour with at least one turn after 12:00 UTC.",
      fr: "Début de la première demi-heure avec au moins un tour, après 12h00 UTC.",
    },
    outcomes: [
      { en: "Before 21:00 UTC", fr: "Avant 21h00 UTC" },
      { en: "21:00 – 21:29 UTC", fr: "21h00 – 21h29 UTC" },
      { en: "21:30 – 22:59 UTC", fr: "21h30 – 22h59 UTC" },
      { en: "23:00 UTC or later", fr: "23h00 UTC ou plus tard" },
      { en: "Never (lazy night)", fr: "Jamais (nuit de flemme)" },
    ],
  },
  owl: {
    kind: "owl",
    emoji: "🦉",
    title: { en: "Night owl or early bird?", fr: "Couche-tard ou lève-tôt ?" },
    rule: {
      en: "Compares wheel turns before vs after 00:00 UTC. Exact tie or no run = market void, everyone refunded.",
      fr: "Compare les tours de roue avant et après 00h00 UTC. Égalité parfaite ou aucun tour = marché annulé, tout le monde remboursé.",
    },
    outcomes: [
      { en: "Night owl: more before midnight", fr: "Couche-tard : plus avant minuit" },
      { en: "Early bird: more after midnight", fr: "Lève-tôt : plus après minuit" },
    ],
  },
};

// ---------- time helpers ----------

/** Night key (YYYY-MM-DD) whose 12:00 UTC start is the latest one <= now. */
export function currentNight(now: number): string {
  const d = new Date(now);
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = d.getUTCHours() >= 12 ? base : base - 24 * HOUR;
  return new Date(start).toISOString().slice(0, 10);
}
export function nightStart(night: string): number {
  return Date.parse(`${night}T12:00:00.000Z`);
}
export function nextNight(night: string): string {
  return new Date(nightStart(night) + 24 * HOUR).toISOString().slice(0, 10);
}
export function lockAt(night: string): number {
  return nightStart(night) + (LOCK_HOUR_UTC - 12) * HOUR;
}
export function resolvableAt(night: string): number {
  return nightStart(night) + 24 * HOUR + RESOLVE_DELAY_MS;
}

/** Position of a bucket inside the night: 0 = 12:00 UTC, 47 = 11:30 UTC next day. */
export function nightOffset(startMinuteUtc: number): number {
  return startMinuteUtc >= 720 ? (startMinuteUtc - 720) / 30 : (startMinuteUtc + 720) / 30;
}

// ---------- API shapes (only the fields we use) ----------

export type StatsBucket = {
  startMinuteUtc: number;
  coverage: "complete" | "partial" | "missing" | "future";
  observedRoundCount: number;
  workUnits: string | null;
};
export type StatsDay = {
  date: string;
  coverage: { expectedRoundCount: number; observedRoundCount: number; coverageBps: number };
  observedWorkUnits: string;
  distanceMm: string | null;
  buckets: StatsBucket[];
};
// Real shape: the per-night data lives under `activity.days` (checked against the live API on 2026-10-30).
export type StatsResponse = { activity: { days: StatsDay[] }; records?: { maximumDailyDistanceMm?: { value: string } | null } };
export type SettlementBucket = { startAt: string; endAt: string; completedBlockCount: string };
export type SettlementsResponse = { status: string; buckets: SettlementBucket[] };
export type StatusResponse = {
  measurement: {
    freshness: string;
    observedAt: string;
    coreStatus: string; // "SPINNING" | "IDLE"
    rpmMilli: number;
    speedMmPerSecond: number;
    distanceMm: number;
    cumulativeWorkUnits: string;
  };
  builder?: { anchor?: { blockHeight: string; blockProgress: string } };
};

// ---------- metrics ----------

export type NightMetrics = {
  night: string;
  complete: boolean; // every one of the 144 rounds observed
  distanceMm: number | null;
  idleHalfHours: number;
  activeHalfHours: number;
  wakeMinuteUtc: number | null; // null = no turn at all
  workBefore: number; // 12:00 -> 00:00 UTC
  workAfter: number; // 00:00 -> 12:00 UTC
  blocks: number | null; // null = settlement data unavailable
};

export function nightMetrics(stats: StatsResponse, settlements: SettlementsResponse | null, night: string): NightMetrics | null {
  const day = stats.activity?.days?.find((d) => d.date === night);
  if (!day) return null;
  const buckets = [...day.buckets].sort((a, b) => nightOffset(a.startMinuteUtc) - nightOffset(b.startMinuteUtc));
  const complete =
    buckets.length === 48 &&
    day.coverage.expectedRoundCount === 144 &&
    day.coverage.observedRoundCount === 144 &&
    buckets.every((b) => b.coverage === "complete" && b.workUnits !== null);

  let idle = 0, active = 0, before = 0, after = 0;
  let wake: number | null = null;
  for (const b of buckets) {
    const w = b.workUnits === null ? 0 : Number(b.workUnits);
    if (w > 0) {
      active++;
      if (wake === null) wake = b.startMinuteUtc;
    } else idle++;
    if (b.startMinuteUtc >= 720) before += w;
    else after += w;
  }

  let blocks: number | null = null;
  if (settlements && settlements.status === "available") {
    const s = nightStart(night), e = s + 24 * HOUR;
    const inNight = settlements.buckets.filter((b) => Date.parse(b.startAt) >= s && Date.parse(b.endAt) <= e);
    const covered = inNight.reduce((acc, b) => acc + (Date.parse(b.endAt) - Date.parse(b.startAt)), 0);
    if (covered === 24 * HOUR) blocks = inNight.reduce((acc, b) => acc + Number(b.completedBlockCount), 0);
  }

  return {
    night,
    complete,
    distanceMm: day.distanceMm === null ? null : Number(day.distanceMm),
    idleHalfHours: idle,
    activeHalfHours: active,
    wakeMinuteUtc: wake,
    workBefore: before,
    workAfter: after,
    blocks,
  };
}

/** Winning outcome index, or null when the market must be voided (refund). */
export function winningOutcome(kind: MarketKind, m: NightMetrics): number | null {
  if (kind === "blocks") {
    if (m.blocks === null) return null;
    return m.blocks < 900 ? 0 : m.blocks < 1050 ? 1 : m.blocks < 1200 ? 2 : 3;
  }
  if (!m.complete) return null; // missing rounds => we can't be sure, refund
  switch (kind) {
    case "distance": {
      if (m.distanceMm === null) return null;
      const km = m.distanceMm / 1e6;
      return km < 8 ? 0 : km < 10 ? 1 : km < 12 ? 2 : 3;
    }
    case "sleep": {
      const h = m.idleHalfHours / 2;
      return h <= 17.5 ? 0 : h <= 18.5 ? 1 : h <= 19.5 ? 2 : 3;
    }
    case "wake": {
      if (m.wakeMinuteUtc === null) return 4;
      const off = nightOffset(m.wakeMinuteUtc); // 18 = 21:00 UTC
      return off < 18 ? 0 : off === 18 ? 1 : off <= 21 ? 2 : 3;
    }
    case "owl": {
      if (m.workBefore === m.workAfter) return null;
      return m.workBefore > m.workAfter ? 0 : 1;
    }
  }
}

/** Human-readable value shown on a resolved market. */
export function resultValue(kind: MarketKind, m: NightMetrics): string {
  switch (kind) {
    case "distance": return m.distanceMm === null ? "—" : `${(m.distanceMm / 1e6).toFixed(2)} km`;
    case "sleep": return `${m.idleHalfHours / 2} h`;
    case "blocks": return m.blocks === null ? "—" : String(m.blocks);
    case "wake": {
      if (m.wakeMinuteUtc === null) return "—";
      const h = Math.floor(m.wakeMinuteUtc / 60), mi = m.wakeMinuteUtc % 60;
      return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")} UTC`;
    }
    case "owl": return `${m.workBefore} / ${m.workAfter}`;
  }
}

/** Bets placed at/after the start of the first active half-hour are refunded (anti late-betting). */
export function lateBetCutoff(m: NightMetrics | null, night: string): number | null {
  if (!m || m.wakeMinuteUtc === null) return null;
  return nightStart(night) + nightOffset(m.wakeMinuteUtc) * 30 * 60_000;
}
