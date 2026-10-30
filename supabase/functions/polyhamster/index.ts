// PolyHamster keeper. Public, idempotent, no secrets in the request: anyone may trigger it.
//   ?action=tick    (pg_cron, every minute): refresh live_status from /v1/status, then resolve due markets
//   ?action=status  : same refresh, returns the status (fallback for browsers that can't reach the API)
//   ?action=resolve : resolve due markets only
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  MARKET_DEFS, MarketKind, nightMetrics, winningOutcome, resultValue, lateBetCutoff, resolvableAt, HOUR,
  type StatusResponse, type StatsResponse, type SettlementsResponse,
} from "./rules.ts";

const API = "https://api.squeekchain.com";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Squeekchain ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

let statusCache: { at: number; row: Record<string, unknown> } | null = null;
async function refreshStatus() {
  if (statusCache && Date.now() - statusCache.at < 15_000) return statusCache.row;
  const s = await getJson<StatusResponse>("/v1/status");
  const m = s.measurement;
  const row = {
    spinning: m.coreStatus === "SPINNING",
    freshness: m.freshness,
    rpm_milli: Math.round(m.rpmMilli),
    speed_mm_s: Math.round(m.speedMmPerSecond),
    block_height: Number(s.builder?.anchor?.blockHeight ?? 0),
    block_progress: Number(s.builder?.anchor?.blockProgress ?? 0),
    observed_at: m.observedAt,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("live_status").update(row).eq("id", 1);
  if (error) throw error;
  statusCache = { at: Date.now(), row };
  return row;
}

async function resolveDue() {
  const now = Date.now();
  const { data: open, error } = await db
    .from("markets").select("id, night, kind").eq("status", "open").lt("lock_at", new Date(now).toISOString());
  if (error) throw error;
  const due = (open ?? []).filter((m) => resolvableAt(m.night) <= now);
  if (due.length === 0) return [];

  const [stats, settlements] = await Promise.all([
    getJson<StatsResponse>("/v1/measurement/stats?range=7d"),
    getJson<SettlementsResponse>("/v1/settlements?range=7d").catch(() => null),
  ]);
  const done: string[] = [];
  for (const m of due) {
    const kind = m.kind as MarketKind;
    if (!MARKET_DEFS[kind]) continue;
    const metrics = nightMetrics(stats, settlements, m.night);
    const graceOver = now > resolvableAt(m.night) + 6 * HOUR; // late data: wait up to 6 h, then void
    const result = metrics ? winningOutcome(kind, metrics) : null;
    const value = metrics ? resultValue(kind, metrics) : "no data";
    const tieIsFinal = kind === "owl" && metrics?.complete === true;
    if (result === null && !graceOver && !tieIsFinal) continue;
    const cutoff = lateBetCutoff(metrics, m.night);
    const { error: e } = await db.rpc("resolve_market", {
      p_market: m.id, p_result: result, p_value: value, p_cutoff: cutoff === null ? null : new Date(cutoff).toISOString(),
    });
    if (e) throw e;
    done.push(`${m.night}/${kind}:${result ?? "void"}`);
  }
  return done;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const action = new URL(req.url).searchParams.get("action") ?? "tick";
  try {
    if (action === "status") return json(await refreshStatus());
    if (action === "resolve") return json({ ok: true, resolved: await resolveDue() });
    if (action === "tick") {
      const status = await refreshStatus().catch((e) => ({ error: String(e) }));
      return json({ ok: true, status, resolved: await resolveDue() });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
