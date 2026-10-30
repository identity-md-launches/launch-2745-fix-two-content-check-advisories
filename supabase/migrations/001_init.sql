-- PolyHamster: parimutuel prediction markets on Squeektoshi's wheel.
-- All writes go through SECURITY DEFINER functions called by the Next.js server (service role).
-- RLS is on with no policies: the browser never talks to the database directly.

create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  pseudo      text not null unique check (pseudo ~ '^[A-Za-z0-9_\-]{2,20}$'),
  token_hash  text not null unique,
  balance     bigint not null default 1000 check (balance >= 0),
  last_claim  date,
  created_at  timestamptz not null default now()
);

create table if not exists markets (
  id             uuid primary key default gen_random_uuid(),
  night          date not null,
  kind           text not null,
  outcome_count  int  not null check (outcome_count between 2 and 8),
  lock_at        timestamptz not null,
  status         text not null default 'open' check (status in ('open', 'resolved', 'void')),
  result_idx     int,
  result_value   text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (night, kind)
);

create table if not exists entries (
  id          bigserial primary key,
  market_id   uuid not null references markets(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  kind        text not null check (kind in ('bet', 'seed')),
  outcome     int  not null check (outcome >= 0),
  amount      bigint not null check (amount > 0),
  created_at  timestamptz not null default now(),
  payout      bigint,
  refunded    boolean not null default false
);
create index if not exists entries_market_idx on entries(market_id);
create index if not exists entries_player_idx on entries(player_id);

create or replace view market_pools as
  select market_id, outcome,
         sum(amount)::bigint as total,
         sum(amount) filter (where kind = 'seed')::bigint as seeded,
         count(*) filter (where kind = 'bet')::int as bets
  from entries
  where not refunded
  group by market_id, outcome;

alter table players enable row level security;
alter table markets enable row level security;
alter table entries enable row level security;

-- ---------------------------------------------------------------- bet
create or replace function place_bet(p_player uuid, p_market uuid, p_outcome int, p_amount bigint, p_now timestamptz default now())
returns bigint language plpgsql security definer set search_path = public as $$
declare m markets; nb bigint;
begin
  select * into m from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;
  if m.status <> 'open' or p_now >= m.lock_at then raise exception 'market_locked'; end if;
  if p_outcome < 0 or p_outcome >= m.outcome_count then raise exception 'bad_outcome'; end if;
  if p_amount < 1 or p_amount > 100000 then raise exception 'bad_amount'; end if;
  update players set balance = balance - p_amount where id = p_player and balance >= p_amount returning balance into nb;
  if not found then raise exception 'insufficient_balance'; end if;
  insert into entries(market_id, player_id, kind, outcome, amount, created_at) values (p_market, p_player, 'bet', p_outcome, p_amount, p_now);
  return nb;
end $$;

-- ---------------------------------------------------------------- seed (liquidity)
-- The amount is split evenly across every outcome. Seeders share a 2% fee on bettors' volume.
create or replace function seed_market(p_player uuid, p_market uuid, p_amount bigint, p_now timestamptz default now())
returns bigint language plpgsql security definer set search_path = public as $$
declare m markets; per bigint; nb bigint;
begin
  select * into m from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;
  if m.status <> 'open' or p_now >= m.lock_at then raise exception 'market_locked'; end if;
  if p_amount > 100000 then raise exception 'bad_amount'; end if;
  per := p_amount / m.outcome_count;
  if per < 1 then raise exception 'seed_too_small'; end if;
  update players set balance = balance - per * m.outcome_count where id = p_player and balance >= per * m.outcome_count returning balance into nb;
  if not found then raise exception 'insufficient_balance'; end if;
  insert into entries(market_id, player_id, kind, outcome, amount, created_at)
    select p_market, p_player, 'seed', g, per, p_now from generate_series(0, m.outcome_count - 1) g;
  return nb;
end $$;

-- ---------------------------------------------------------------- resolve
-- p_result null => void, everyone refunded. p_cutoff: entries created at/after it are refunded (late bets).
create or replace function resolve_market(p_market uuid, p_result int, p_value text, p_cutoff timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare m markets; t bigint; w bigint; bet_vol bigint; seed_tot bigint; fee bigint;
begin
  select * into m from markets where id = p_market for update;
  if not found then raise exception 'market_not_found'; end if;
  if m.status <> 'open' then return m.status; end if; -- idempotent

  if p_cutoff is not null then
    update entries set refunded = true, payout = amount where market_id = p_market and created_at >= p_cutoff;
  end if;

  if p_result is null then
    update entries set refunded = true, payout = amount where market_id = p_market and not refunded;
    update markets set status = 'void', result_value = p_value, resolved_at = now() where id = p_market;
  else
    select coalesce(sum(amount), 0),
           coalesce(sum(amount) filter (where outcome = p_result), 0),
           coalesce(sum(amount) filter (where kind = 'bet'), 0),
           coalesce(sum(amount) filter (where kind = 'seed'), 0)
      into t, w, bet_vol, seed_tot
      from entries where market_id = p_market and not refunded;

    if w = 0 then
      -- nobody backed the winner: refund everyone
      update entries set refunded = true, payout = amount where market_id = p_market and not refunded;
    else
      fee := case when seed_tot > 0 then bet_vol * 2 / 100 else 0 end;
      update entries set payout = case when outcome = p_result then amount * (t - fee) / w else 0 end
        where market_id = p_market and not refunded;
      if fee > 0 then
        with shares as (
          select player_id, sum(amount) s from entries
          where market_id = p_market and not refunded and kind = 'seed' group by player_id
        ), target as (
          select distinct on (player_id) id, player_id from entries
          where market_id = p_market and not refunded and kind = 'seed' and outcome = p_result
          order by player_id, id
        )
        update entries e set payout = e.payout + fee * shares.s / seed_tot
          from target join shares using (player_id) where e.id = target.id;
      end if;
    end if;
    update markets set status = 'resolved', result_idx = p_result, result_value = p_value, resolved_at = now() where id = p_market;
  end if;

  update players p set balance = p.balance + x.total
    from (select player_id, sum(payout) total from entries where market_id = p_market group by player_id) x
    where p.id = x.player_id and x.total > 0;
  return (select status from markets where id = p_market);
end $$;

-- ---------------------------------------------------------------- daily seeds
create or replace function claim_daily(p_player uuid, p_today date)
returns bigint language plpgsql security definer set search_path = public as $$
declare nb bigint;
begin
  update players set balance = balance + 100, last_claim = p_today
    where id = p_player and (last_claim is null or last_claim < p_today) returning balance into nb;
  if not found then raise exception 'already_claimed'; end if;
  return nb;
end $$;

-- Lock functions down to the service role (Supabase roles only exist on Supabase).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function place_bet, seed_market, resolve_market, claim_daily from public, anon, authenticated;
    revoke all on market_pools from anon, authenticated;
  end if;
end $$;
