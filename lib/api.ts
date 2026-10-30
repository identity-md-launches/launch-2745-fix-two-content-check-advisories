// Browser-side data layer. The site is static (IPFS): it only talks to Supabase RPCs and the public Squeekchain API.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SQUEEK_API } from "./config";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const KNOWN = [
  "market_not_found", "market_locked", "bad_outcome", "bad_amount", "insufficient_balance", "seed_too_small",
  "already_claimed", "unknown_player", "pseudo_taken", "bad_pseudo", "wheel_spinning",
];

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(KNOWN.find((k) => error.message.includes(k)) ?? "server_error");
  return data as T;
}

export const api = {
  state: <T>() => rpc<T>("ph_state"),
  me: <T>(token: string) => rpc<T>("ph_me", { p_token: token }),
  createPlayer: (pseudo: string) => rpc<{ token: string }>("ph_create_player", { p_pseudo: pseudo }),
  bet: (token: string, marketId: string, outcome: number, amount: number) =>
    rpc<number>("ph_bet", { p_token: token, p_market: marketId, p_outcome: outcome, p_amount: amount }),
  seed: (token: string, marketId: string, amount: number) =>
    rpc<number>("ph_seed", { p_token: token, p_market: marketId, p_amount: amount }),
  claim: (token: string) => rpc<number>("ph_claim", { p_token: token }),
};

export type LiveStatus = {
  ok: boolean; spinning: boolean; freshness: string; rpm: number; kmh: number; blockHeight: number; blockProgress: number;
};

/** Live wheel status straight from Squeekchain (real time). Returns null if the browser can't reach it. */
export async function liveFromSqueek(): Promise<LiveStatus | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${SQUEEK_API}/v1/status`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return null;
    const s = await res.json();
    const m = s.measurement;
    return {
      ok: true,
      spinning: m.coreStatus === "SPINNING",
      freshness: m.freshness,
      rpm: Math.round(m.rpmMilli / 1000),
      kmh: Math.round(m.speedMmPerSecond * 3.6 / 100) / 10,
      blockHeight: Number(s.builder?.anchor?.blockHeight ?? 0),
      blockProgress: Number(s.builder?.anchor?.blockProgress ?? 0) / 1e9,
    };
  } catch {
    return null;
  }
}
