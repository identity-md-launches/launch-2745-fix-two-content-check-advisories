// Which wheel status the board may present as live. Pure, so it is tested without a browser (test/wheelStatus.test.ts).

/** A reading older than this is shown as unavailable, never as live. */
export const LIVE_MAX_AGE_MS = 90_000;

export type WheelStatus = {
  ok: boolean; spinning: boolean; freshness: string; rpm: number; kmh: number;
  blockHeight: number; blockProgress: number; observedAt?: string | null; updatedAt?: number | null;
};
/** A status and when it was true, on the browser's clock. */
export type Reading = { status: WheelStatus; at: number };

/** Squeekchain flags its own sensor feed: only "online" is live data. */
const fresh = (s: WheelStatus | null | undefined): s is WheelStatus => !!s && s.ok && s.freshness === "online";

/**
 * Picks the reading to keep after one refresh, or null when the refresh produced nothing usable
 * (the caller then keeps its previous reading, which ages out on its own).
 * - `squeek`: straight from api.squeekchain.com, observed now.
 * - `db`: the keeper's copy inside ph_state, dated by the server's `updatedAt` against the server's `now`,
 *   so a copy the keeper stopped refreshing is never treated as new.
 */
export function pickReading(
  squeek: WheelStatus | null,
  db: { now: number; status: WheelStatus | null } | null,
  clientNow: number,
): Reading | null {
  if (fresh(squeek)) return { status: squeek, at: clientNow };
  if (db && fresh(db.status) && typeof db.status.updatedAt === "number") {
    const age = Math.max(0, db.now - db.status.updatedAt);
    return { status: db.status, at: clientNow - age };
  }
  return null;
}

/** True when this reading may be shown as live at `now`. */
export const isLive = (r: Reading | null, now: number): boolean =>
  !!r && fresh(r.status) && now - r.at < LIVE_MAX_AGE_MS;

/**
 * The status the board renders. A stale or missing reading keeps its last block numbers but is marked
 * `ok: false, spinning: false`, so the board says "not live" instead of LIVE or a frozen RPM.
 */
export function displayStatus(r: Reading | null, fallback: WheelStatus | null | undefined, now: number): WheelStatus | undefined {
  if (r && isLive(r, now)) return r.status;
  const base = r ? r.status : fallback;
  return base ? { ...base, ok: false, spinning: false } : undefined;
}
