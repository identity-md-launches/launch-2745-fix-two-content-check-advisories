"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DotText } from "./DotText";
import { Lang, t, errText } from "./i18n";
import { MARKET_DEFS, MarketKind } from "@/lib/squeek";
import { api, liveFromSqueek } from "@/lib/api";

type Pool = { total: number; seeded: number; bets: number };
type Market = { id: string; kind: MarketKind; status: string; lockAt: number; resultIdx: number | null; resultValue: string | null; pools: Pool[] };
type Night = { night: string; nightStart: number; lockAt: number; markets: Market[] };
type Status = { ok: boolean; spinning: boolean; freshness: string; rpm: number; kmh: number; blockHeight: number; blockProgress: number; observedAt?: string | null };
type State = { now: number; status: Status; nights: Night[]; leaderboard: { pseudo: string; balance: number }[] };
type Player = { id: string; pseudo: string; balance: number; last_claim: string | null };
type Entry = { marketId: string; kind: "bet" | "seed"; outcome: number; amount: number; payout: number | null; refunded: boolean; night: string; marketKind: MarketKind; status: string };

const fmt = (n: number, lang: Lang) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
const TOKEN_KEY = "polyhamster.token";
const LANG_KEY = "polyhamster.lang";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

export default function App() {
  const [lang, setLang] = useState<Lang>("fr");
  const [state, setState] = useState<State | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<{ player: Player; entries: Entry[] } | null>(null);
  const [tab, setTab] = useState(1);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  useEffect(() => {
    const l = store.get(LANG_KEY);
    setLang(l === "en" || l === "fr" ? l : navigator.language.startsWith("fr") ? "fr" : "en");
    setToken(store.get(TOKEN_KEY));
  }, []);

  const loadState = useCallback(async () => {
    try {
      const [s, live] = await Promise.all([api.state<State>(), liveFromSqueek()]);
      if (live) s.status = live; // real time when the browser can reach Squeekchain, else the 1-min copy in the DB
      setState(s);
    } catch { /* keep last state */ }
  }, []);
  const loadMe = useCallback(() => {
    if (!token) return setMe(null);
    api.me<{ player: Player; entries: Entry[] }>(token)
      .then(setMe)
      .catch((e) => { if (e.message === "unknown_player") { store.set(TOKEN_KEY, null); setToken(null); } });
  }, [token]);

  useEffect(() => { loadState(); const i = setInterval(loadState, 20_000); return () => clearInterval(i); }, [loadState]);
  useEffect(() => { loadMe(); const i = setInterval(loadMe, 30_000); return () => clearInterval(i); }, [loadMe]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { if (!toast) return; const i = setTimeout(() => setToast(null), 3500); return () => clearTimeout(i); }, [toast]);

  const say = (text: string, kind: "ok" | "err" = "ok") => setToast({ text, kind });
  const switchLang = (l: Lang) => { setLang(l); store.set(LANG_KEY, l); };

  const act = async (run: (token: string) => Promise<unknown>, okText: string) => {
    if (!token) { document.getElementById("join")?.scrollIntoView({ behavior: "smooth" }); return false; }
    try {
      await run(token);
      say(okText);
      loadState(); loadMe();
      return true;
    } catch (e) { say(errText(lang, (e as Error).message), "err"); return false; }
  };

  const status = state?.status;
  const tonight = state?.nights[1];

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <Wheel spinning={!!status?.spinning} />
          <DotText text="POLYHAMSTER" size={5} className="logo" />
        </div>
        <div className="lang">
          <button className={lang === "fr" ? "on" : ""} onClick={() => switchLang("fr")}>FR</button>
          <button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")}>EN</button>
        </div>
      </header>
      <p className="tagline">{t(lang, "tagline")} <span className="muted">{t(lang, "points")}</span></p>

      <section className={`board ${status?.spinning ? "is-spinning" : "is-idle"}`}>
        <div className="board-main">
          <div className="board-label"><span className={`led ${status?.ok ? (status.spinning ? "led-on" : "led-idle") : "led-off"}`} />{t(lang, "live")}</div>
          {status?.spinning
            ? <DotText text={`${status.rpm} RPM`} size={9} color="var(--gold)" className="big" />
            : <DotText text={status ? t(lang, "sleeping") : "..."} size={9} color="var(--blue)" className="big" />}
          <p className="board-sub">{!status ? "…" : !status.ok ? t(lang, "offline") : status.spinning ? t(lang, "spinningTxt") : t(lang, "sleepingTxt")}</p>
        </div>
        <div className="board-stats">
          <Stat label={`${t(lang, "block")} · ${Math.round((status?.blockProgress ?? 0) * 100)}%`} value={status ? `#${fmt(status.blockHeight + 1, lang)}` : "—"}>
            <div className="progress"><i style={{ width: `${Math.round((status?.blockProgress ?? 0) * 100)}%` }} /></div>
          </Stat>
          <Stat label="km/h" value={status ? status.kmh.toFixed(1) : "—"} />
          {tonight && (
            <Stat
              label={now < tonight.lockAt && !status?.spinning ? t(lang, "closesIn") : t(lang, "tonight")}
              value={now < tonight.lockAt && !status?.spinning ? countdown(tonight.lockAt - now) : "🔒"}
              accent
            />
          )}
        </div>
      </section>

      <div className="layout">
        <main>
          <nav className="tabs">
            {state?.nights.map((n, i) => (
              <button key={n.night} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>
                {[t(lang, "lastNight"), t(lang, "tonight"), t(lang, "tomorrow")][i]}
                <small>{nightLabel(n.night, lang)}</small>
              </button>
            ))}
          </nav>
          {state && state.nights[tab] && (
            <NightView
              night={state.nights[tab]}
              lang={lang}
              now={now}
              spinning={!!status?.spinning && tab === 1}
              onBet={(m, outcome, amount) => act((tk) => api.bet(tk, m.id, outcome, amount), `✓ ${fmt(amount, lang)} 🌻 ${t(lang, "on")} « ${MARKET_DEFS[m.kind].outcomes[outcome][lang]} »`)}
              onSeed={(m, amount) => act((tk) => api.seed(tk, m.id, amount), `✓ ${t(lang, "liquidity")} +${fmt(amount, lang)} 🌻`)}
              myEntries={me?.entries ?? []}
            />
          )}
          {!state && <p className="muted">…</p>}
        </main>

        <aside>
          {me ? (
            <PlayerCard me={me} lang={lang} token={token!} onClaim={() => act((tk) => api.claim(tk), t(lang, "claimed"))}
              onLogout={() => { store.set(TOKEN_KEY, null); setToken(null); setMe(null); }} say={say} />
          ) : (
            <JoinCard lang={lang} onJoined={(tok) => { store.set(TOKEN_KEY, tok); setToken(tok); }} say={say} />
          )}
          <section className="card">
            <h3>{t(lang, "leaderboard")}</h3>
            <ol className="lb">
              {state?.leaderboard.map((p, i) => (
                <li key={p.pseudo} className={me?.player.pseudo === p.pseudo ? "me" : ""}>
                  <span className="rank">{i + 1}</span><span className="who">{p.pseudo}</span><span className="amt">{fmt(p.balance, lang)} 🌻</span>
                </li>
              ))}
              {state && state.leaderboard.length === 0 && <li className="muted">—</li>}
            </ol>
          </section>
          <section className="card how">
            <h3>{t(lang, "how")}</h3>
            <ol>
              <li>{t(lang, "how1")}</li><li>{t(lang, "how2")}</li><li>{t(lang, "how3")}</li><li>{t(lang, "how4")}</li>
            </ol>
            <p className="muted small">Data: <a href="https://sepolia.squeekchain.com/" target="_blank" rel="noreferrer">sepolia.squeekchain.com</a> · api.squeekchain.com</p>
          </section>
        </aside>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- night + markets

function NightView({ night, lang, now, spinning, onBet, onSeed, myEntries }: {
  night: Night; lang: Lang; now: number; spinning: boolean;
  onBet: (m: Market, outcome: number, amount: number) => Promise<boolean>;
  onSeed: (m: Market, amount: number) => Promise<boolean>;
  myEntries: Entry[];
}) {
  const open = now < night.lockAt && !spinning;
  const isPast = night.nightStart + 24 * 3_600_000 <= now;
  return (
    <div>
      <p className="night-info">
        {open
          ? <>{t(lang, "closesIn")} <b>{countdown(night.lockAt - now)}</b> · 20:00 UTC = {localTime(night.lockAt, lang)} {t(lang, "yourTime")}</>
          : isPast ? null : <>{t(lang, "closed")} · {t(lang, "resolvesAt")} {localTime(night.nightStart + 24.75 * 3_600_000, lang)}</>}
      </p>
      <div className="markets">
        {night.markets.map((m) => (
          <MarketCard key={m.id} m={m} lang={lang} open={open && m.status === "open"} night={night} onBet={onBet} onSeed={onSeed}
            mine={myEntries.filter((e) => e.marketId === m.id)} />
        ))}
      </div>
    </div>
  );
}

function MarketCard({ m, lang, open, night, onBet, onSeed, mine }: {
  m: Market; lang: Lang; open: boolean; night: Night; mine: Entry[];
  onBet: (m: Market, outcome: number, amount: number) => Promise<boolean>;
  onSeed: (m: Market, amount: number) => Promise<boolean>;
}) {
  const def = MARKET_DEFS[m.kind];
  const [pick, setPick] = useState<number | null>(null);
  const [amount, setAmount] = useState(50);
  const [seeding, setSeeding] = useState(false);
  const [showRule, setShowRule] = useState(false);
  const total = m.pools.reduce((a, p) => a + p.total, 0);
  const seeded = m.pools.reduce((a, p) => a + p.seeded, 0);
  const betVol = total - seeded;
  const fee = (extra: number) => (seeded > 0 ? Math.floor(((betVol + extra) * 2) / 100) : 0);
  const mult = (i: number) => (m.pools[i].total > 0 ? (total - fee(0)) / m.pools[i].total : null);
  const potential = pick === null ? 0 : Math.floor((amount * (total + amount - fee(amount))) / (m.pools[pick].total + amount));
  const myStake = (i: number) => mine.filter((e) => e.kind === "bet" && e.outcome === i).reduce((a, e) => a + e.amount, 0);
  const resolved = m.status === "resolved";

  return (
    <article className={`market ${m.status}`}>
      <header>
        <span className="emoji">{def.emoji}</span>
        <h4>{def.title[lang]}</h4>
        <button className="link" onClick={() => setShowRule((s) => !s)}>{t(lang, "rule")}</button>
      </header>
      {showRule && <p className="rule">{def.rule[lang]}{m.kind === "wake" && <> · 21:00 UTC = {localTime(night.nightStart + 9 * 3_600_000, lang)} {t(lang, "yourTime")}</>}</p>}
      {m.status !== "open" && (
        <p className={`verdict ${m.status}`}>
          {m.status === "resolved" ? `✓ ${t(lang, "resolved")} : ${m.resultValue}` : `${t(lang, "void")}${m.resultValue ? ` (${m.resultValue})` : ""}`}
        </p>
      )}
      <ul className="outcomes">
        {def.outcomes.map((o, i) => {
          const share = total > 0 ? m.pools[i].total / total : 0;
          const x = mult(i);
          const win = resolved && m.resultIdx === i;
          const stake = myStake(i);
          return (
            <li key={i}>
              <button
                className={`outcome ${pick === i ? "picked" : ""} ${win ? "win" : ""} ${resolved && !win ? "lose" : ""}`}
                disabled={!open}
                onClick={() => { setPick(pick === i ? null : i); setSeeding(false); }}
              >
                <i className="bar" style={{ width: `${Math.round(share * 100)}%` }} />
                <span className="label">{win && "✓ "}{o[lang]}{stake > 0 && <em className="mine"> · {stake} 🌻</em>}</span>
                <span className="pct">{Math.round(share * 100)}%</span>
                <span className={`mult ${x === null ? "first" : ""}`}>{x === null ? (open ? t(lang, "firstIn") : "—") : `×${x.toFixed(2)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {open && pick !== null && (
        <div className="slip">
          <div className="chips">
            {[10, 50, 100, 250].map((v) => <button key={v} className={amount === v ? "on" : ""} onClick={() => setAmount(v)}>{v}</button>)}
            <input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </div>
          <button className="primary" onClick={async () => { if (await onBet(m, pick, amount)) setPick(null); }}>
            {t(lang, "bet")} {amount} 🌻 → {t(lang, "pays")} ~{potential} 🌻
          </button>
        </div>
      )}
      {open && seeding && (
        <div className="slip seedslip">
          <b>{t(lang, "liquidityTitle")}</b>
          <p className="small">{t(lang, "liquidityHelp")}</p>
          <div className="chips">
            {[100, 250, 500].map((v) => <button key={v} className={amount === v ? "on" : ""} onClick={() => setAmount(v)}>{v}</button>)}
            <input type="number" min={def.outcomes.length} value={amount} onChange={(e) => setAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          </div>
          <div className="row">
            <button className="primary blue" onClick={async () => { if (await onSeed(m, amount)) setSeeding(false); }}>{t(lang, "seed")} {amount} 🌻</button>
            <button className="ghost" onClick={() => setSeeding(false)}>{t(lang, "cancel")}</button>
          </div>
        </div>
      )}
      <footer>
        <span>{t(lang, "pool")} <b>{fmt(total, lang)} 🌻</b>{seeded > 0 && <> · {t(lang, "liquidity")} {fmt(seeded, lang)}</>}</span>
        {open && !seeding && <button className="link" onClick={() => { setSeeding(true); setPick(null); setAmount(100); }}>{t(lang, "addLiquidity")}</button>}
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------- player

function JoinCard({ lang, onJoined, say }: { lang: Lang; onJoined: (token: string) => void; say: (s: string, k?: "ok" | "err") => void }) {
  const [pseudo, setPseudo] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [key, setKey] = useState("");
  return (
    <section className="card join" id="join">
      <h3>{t(lang, "join")}</h3>
      <p className="small">{t(lang, "joinHelp")}</p>
      {!restoring ? (
        <form onSubmit={async (e) => {
          e.preventDefault();
          try { const r = await api.createPlayer(pseudo); onJoined(r.token); }
          catch (err) { say(errText(lang, (err as Error).message), "err"); }
        }}>
          <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder={t(lang, "pseudo")} maxLength={20} />
          <button className="primary" type="submit">{t(lang, "go")}</button>
        </form>
      ) : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          try { await api.me(key.trim()); onJoined(key.trim()); }
          catch (err) { say(errText(lang, (err as Error).message), "err"); }
        }}>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t(lang, "restorePh")} />
          <button className="primary" type="submit">OK</button>
        </form>
      )}
      <button className="link" onClick={() => setRestoring((r) => !r)}>{restoring ? t(lang, "join") : t(lang, "restore")}</button>
    </section>
  );
}

function PlayerCard({ me, lang, token, onClaim, onLogout, say }: {
  me: { player: Player; entries: Entry[] }; lang: Lang; token: string;
  onClaim: () => void; onLogout: () => void; say: (s: string, k?: "ok" | "err") => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const canClaim = me.player.last_claim !== today;
  return (
    <section className="card player">
      <div className="who-row">
        <h3>{me.player.pseudo}</h3>
        <button className="link" onClick={onLogout}>{t(lang, "logout")}</button>
      </div>
      <div className="balance"><DotText text={String(me.player.balance)} size={6} color="var(--gold)" /> <span>🌻 {t(lang, "seeds")}</span></div>
      <div className="row">
        <button className="primary" disabled={!canClaim} onClick={onClaim}>{canClaim ? t(lang, "claim") : t(lang, "claimed")}</button>
        <button className="ghost" onClick={async () => {
          try { await navigator.clipboard.writeText(token); say(t(lang, "keyCopied")); } catch { say(token); }
        }}>{t(lang, "copyKey")}</button>
      </div>
      <h4>{t(lang, "myBets")}</h4>
      <ul className="mybets">
        {me.entries.length === 0 && <li className="muted">{t(lang, "noBets")}</li>}
        {me.entries.slice(0, 12).map((e, i) => {
          const def = MARKET_DEFS[e.marketKind];
          const state = e.payout === null ? t(lang, "open") : e.refunded ? t(lang, "refunded") : e.payout > 0 ? `${t(lang, "won")} ${e.payout}` : t(lang, "lost");
          const cls = e.payout === null ? "" : e.refunded ? "" : e.payout > 0 ? "pos" : "neg";
          return (
            <li key={i}>
              <span>{def.emoji} {e.kind === "seed" ? t(lang, "liquidity") : def.outcomes[e.outcome][lang]}</span>
              <span className="muted small">{nightLabel(e.night, lang)} · {e.amount} 🌻</span>
              <span className={`state ${cls}`}>{state}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- bits

function Stat({ label, value, accent, children }: { label: string; value: string; accent?: boolean; children?: React.ReactNode }) {
  return <div className={`stat ${accent ? "accent" : ""}`}><span>{label}</span><b>{value}</b>{children}</div>;
}

function Wheel({ spinning }: { spinning: boolean }) {
  const dots = useMemo(() => Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return { x: 20 + Math.cos(a) * 16, y: 20 + Math.sin(a) * 16 };
  }), []);
  return (
    <svg className={`wheel ${spinning ? "spin" : ""}`} viewBox="0 0 40 40" width="40" height="40" aria-hidden>
      {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={1.9} fill={i % 4 === 0 ? "var(--gold)" : "var(--blue)"} />)}
      <circle cx="20" cy="20" r="3" fill="var(--gold)" />
    </svg>
  );
}

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}h${String(m).padStart(2, "0")}m${String(sec).padStart(2, "0")}s`;
}
function localTime(ts: number, lang: Lang) {
  return new Date(ts).toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" });
}
function nightLabel(night: string, lang: Lang) {
  return new Date(`${night}T12:00:00Z`).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
