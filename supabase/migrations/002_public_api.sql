-- Public API for the static site (IPFS). The browser calls these RPCs with the anon key.
-- Every write goes through a SECURITY DEFINER function; tables stay closed (RLS on, no policies).

-- Live wheel status, refreshed every minute by the `polyhamster` Edge Function (pg_cron).
create table if not exists live_status (
  id              int primary key default 1 check (id = 1),
  spinning        boolean not null default false,
  freshness       text not null default 'unknown',
  rpm_milli       int not null default 0,
  speed_mm_s      int not null default 0,
  block_height    bigint not null default 0,
  block_progress  bigint not null default 0,
  observed_at     timestamptz,
  updated_at      timestamptz not null default now()
);
alter table live_status enable row level security;
insert into live_status(id) values (1) on conflict do nothing;

create or replace function ph_epoch_ms(t timestamptz) returns bigint language sql immutable as $$
  select (extract(epoch from t) * 1000)::bigint
$$;
create or replace function ph_night_at(n date, h int) returns timestamptz language sql immutable as $$
  select (n + make_time(h, 0, 0)) at time zone 'utc'
$$;
create or replace function ph_current_night() returns date language sql stable as $$
  select ((now() at time zone 'utc') - interval '12 hours')::date
$$;

create or replace function ph_player_id(p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare pid uuid;
begin
  if p_token is null or length(p_token) > 100 then raise exception 'unknown_player'; end if;
  select id into pid from players where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if pid is null then raise exception 'unknown_player'; end if;
  return pid;
end $$;

create or replace function ph_ensure_markets(n date) returns void
language sql security definer set search_path = public as $$
  insert into markets(night, kind, outcome_count, lock_at)
  select n, k.kind, k.cnt, ph_night_at(n, 20)
  from (values ('distance', 4), ('sleep', 4), ('blocks', 4), ('wake', 5), ('owl', 2)) as k(kind, cnt)
  on conflict (night, kind) do nothing
$$;

-- ---------------------------------------------------------------- read

create or replace function ph_state() returns json
language plpgsql security definer set search_path = public as $$
declare cur date := ph_current_night();
begin
  perform ph_ensure_markets(cur);
  perform ph_ensure_markets(cur + 1);
  return json_build_object(
    'now', ph_epoch_ms(now()),
    'status', (
      select json_build_object(
        'spinning', spinning, 'freshness', freshness, 'rpm', round(rpm_milli / 1000.0),
        'kmh', round(speed_mm_s * 3.6 / 100.0) / 10.0, 'blockHeight', block_height,
        'blockProgress', block_progress / 1e9, 'observedAt', observed_at, 'updatedAt', ph_epoch_ms(updated_at),
        'ok', observed_at is not null and updated_at > now() - interval '5 minutes')
      from live_status where id = 1),
    'nights', (
      select json_agg(json_build_object(
        'night', n, 'nightStart', ph_epoch_ms(ph_night_at(n, 12)), 'lockAt', ph_epoch_ms(ph_night_at(n, 20)),
        'markets', coalesce((
          select json_agg(json_build_object(
            'id', m.id, 'kind', m.kind, 'status', m.status, 'lockAt', ph_epoch_ms(m.lock_at),
            'resultIdx', m.result_idx, 'resultValue', m.result_value,
            'pools', (
              select json_agg(json_build_object('total', coalesce(p.total, 0), 'seeded', coalesce(p.seeded, 0), 'bets', coalesce(p.bets, 0)) order by g)
              from generate_series(0, m.outcome_count - 1) g
              left join market_pools p on p.market_id = m.id and p.outcome = g))
            order by array_position(array['distance', 'sleep', 'blocks', 'wake', 'owl'], m.kind))
          from markets m where m.night = n), '[]'::json))
        order by n)
      from unnest(array[cur - 1, cur, cur + 1]) as n),
    'leaderboard', coalesce((
      select json_agg(x) from (select pseudo, balance from players order by balance desc, created_at asc limit 15) x), '[]'::json)
  );
end $$;

create or replace function ph_me(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare pid uuid := ph_player_id(p_token);
begin
  return json_build_object(
    'player', (select json_build_object('id', id, 'pseudo', pseudo, 'balance', balance, 'last_claim', last_claim) from players where id = pid),
    'entries', coalesce((
      select json_agg(x order by x."createdAt" desc) from (
        select e.market_id as "marketId", e.kind, min(e.outcome) as outcome, sum(e.amount) as amount,
               case when bool_or(e.payout is null) then null else sum(e.payout) end as payout,
               bool_and(e.refunded) as refunded, e.created_at as "createdAt",
               m.night, m.kind as "marketKind", m.status
        from entries e join markets m on m.id = e.market_id
        where e.player_id = pid
        group by e.market_id, e.kind, case when e.kind = 'seed' then 0 else e.id end, e.created_at, m.night, m.kind, m.status
        order by e.created_at desc limit 40) x), '[]'::json));
end $$;

-- ---------------------------------------------------------------- write

create or replace function ph_create_player(p_pseudo text) returns json
language plpgsql security definer set search_path = public as $$
declare tok text; pid uuid;
begin
  if p_pseudo is null or p_pseudo !~ '^[A-Za-z0-9_\-]{2,20}$' then raise exception 'bad_pseudo'; end if;
  if exists (select 1 from players where lower(pseudo) = lower(p_pseudo)) then raise exception 'pseudo_taken'; end if;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into players(pseudo, token_hash) values (p_pseudo, encode(sha256(convert_to(tok, 'UTF8')), 'hex')) returning id into pid;
  return json_build_object('token', tok);
exception when unique_violation then
  raise exception 'pseudo_taken';
end $$;

create or replace function ph_assert_wheel_quiet(p_market uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare spin boolean; n date;
begin
  select night into n from markets where id = p_market;
  if n is null then raise exception 'market_not_found'; end if;
  select spinning and updated_at > now() - interval '3 minutes' into spin from live_status where id = 1;
  if coalesce(spin, false) and now() >= ph_night_at(n, 12) then raise exception 'wheel_spinning'; end if;
end $$;

create or replace function ph_bet(p_token text, p_market uuid, p_outcome int, p_amount bigint) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform ph_assert_wheel_quiet(p_market);
  return place_bet(ph_player_id(p_token), p_market, p_outcome, p_amount, now());
end $$;

create or replace function ph_seed(p_token text, p_market uuid, p_amount bigint) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  perform ph_assert_wheel_quiet(p_market);
  return seed_market(ph_player_id(p_token), p_market, p_amount, now());
end $$;

create or replace function ph_claim(p_token text) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  return claim_daily(ph_player_id(p_token), (now() at time zone 'utc')::date);
end $$;

-- ---------------------------------------------------------------- privileges (Supabase roles only)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on players, markets, entries, live_status, market_pools from anon, authenticated;
    revoke execute on function ph_player_id, ph_ensure_markets, ph_assert_wheel_quiet,
      place_bet, seed_market, resolve_market, claim_daily from public, anon, authenticated;
    grant execute on function ph_state, ph_me, ph_create_player, ph_bet, ph_seed, ph_claim to anon, authenticated;
    grant execute on function resolve_market to service_role;
  end if;
end $$;
