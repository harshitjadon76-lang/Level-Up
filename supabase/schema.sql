-- Level Up: run once in Supabase > SQL Editor.
-- Safe to run again. Old tables from the first prototype are left untouched.

create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Revision-based optimistic concurrency prevents one device from silently overwriting another.
alter table public.user_state add column if not exists revision bigint not null default 1;

-- Save only when the client's revision is current. A stale client receives the latest
-- row and can merge independent changes before retrying.
create or replace function public.save_user_state(p_state jsonb, p_expected_revision bigint)
returns table(saved boolean, revision bigint, state jsonb, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.user_state%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_state is null then
    raise exception 'State cannot be null';
  end if;

  if coalesce(p_expected_revision, 0) <= 0 then
    insert into public.user_state(user_id, state, revision, updated_at)
    values (v_user_id, p_state, 1, clock_timestamp())
    on conflict (user_id) do nothing;
    if found then
      select * into v_row from public.user_state where user_id = v_user_id;
      return query select true, v_row.revision, v_row.state, v_row.updated_at;
      return;
    end if;
  else
    update public.user_state as us
       set state = p_state,
           revision = us.revision + 1,
           updated_at = clock_timestamp()
     where us.user_id = v_user_id
       and us.revision = p_expected_revision
    returning us.* into v_row;
    if found then
      return query select true, v_row.revision, v_row.state, v_row.updated_at;
      return;
    end if;
  end if;

  select * into v_row from public.user_state where user_id = v_user_id;
  if found then
    return query select false, v_row.revision, v_row.state, v_row.updated_at;
  end if;
end;
$$;

revoke all on function public.save_user_state(jsonb, bigint) from public;
grant execute on function public.save_user_state(jsonb, bigint) to authenticated;

-- Enable realtime notifications when the project's Supabase publication is available.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public' and tablename = 'user_state'
     ) then
    alter publication supabase_realtime add table public.user_state;
  end if;
exception when insufficient_privilege or undefined_object then
  null;
end $$;

create table if not exists public.scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Player',
  points int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.google_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;
alter table public.scores enable row level security;
alter table public.google_tokens enable row level security;

drop policy if exists "own state" on public.user_state;
create policy "own state" on public.user_state for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- everyone signed in can read the leaderboard, but only write their own row
drop policy if exists "read scores" on public.scores;
create policy "read scores" on public.scores for select to authenticated using (true);
drop policy if exists "write own score" on public.scores;
create policy "write own score" on public.scores for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "update own score" on public.scores;
create policy "update own score" on public.scores for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "delete own score" on public.scores;
create policy "delete own score" on public.scores for delete to authenticated
  using (user_id = (select auth.uid()));

-- Google OAuth tokens must never be readable/writable directly from the browser.
-- Server routes use the server-only service-role key after validating the user's JWT.
drop policy if exists "own tokens" on public.google_tokens;
revoke all on public.google_tokens from anon, authenticated;

-- Push subscription endpoints and delivery de-duplication are server-only data.
-- The browser can manage its own subscriptions only through authenticated API routes.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

drop policy if exists "own push subscriptions" on public.push_subscriptions;

create table if not exists public.push_delivery_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);
alter table public.push_delivery_log enable row level security;
revoke all on public.push_delivery_log from anon, authenticated;
drop policy if exists "own push delivery log" on public.push_delivery_log;

-- Secure XP & leaderboard: the browser can no longer write authoritative scores.
-- Existing scores and skill XP are imported once as a starting balance.
create table if not exists public.xp_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Player',
  points integer not null default 0 check (points >= 0 and points <= 10000000),
  season_month text,
  skill_xp jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.xp_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  points_delta integer not null default 0,
  skill text,
  skill_delta integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, event_key)
);

alter table public.xp_profiles add column if not exists season_month text;
alter table public.xp_profiles alter column points set default 0;

alter table public.xp_profiles enable row level security;
alter table public.xp_events enable row level security;
revoke all on public.xp_profiles from public, anon, authenticated;
revoke all on public.xp_events from public, anon, authenticated;
grant all on public.xp_profiles to service_role;
grant all on public.xp_events to service_role;

-- Import current profiles without overwriting a profile on subsequent migrations.
insert into public.xp_profiles (user_id, name, points, skill_xp)
select
  us.user_id,
  left(coalesce(nullif(btrim(us.state #>> '{S,name}'), ''), 'Player'), 80),
  case
    when length(coalesce(us.state #>> '{S,points}', '')) <= 12
      and coalesce(us.state #>> '{S,points}', '') ~ '^-?\d+$'
    then least(10000000::numeric, greatest(0::numeric, (us.state #>> '{S,points}')::numeric))::integer
    else 0
  end,
  case
    when jsonb_typeof(us.state #> '{S,xp}') = 'object' then us.state #> '{S,xp}'
    else '{}'::jsonb
  end
from public.user_state us
on conflict (user_id) do nothing;

insert into public.xp_profiles (user_id, name, points)
select s.user_id, left(coalesce(nullif(btrim(s.name), ''), 'Player'), 80), least(10000000, greatest(0, s.points))
from public.scores s
on conflict (user_id) do nothing;

-- Mark activity that existed before this migration as already accounted for.
-- That preserves imported balances instead of paying historical activity twice.
insert into public.xp_events (user_id, event_key, event_type, points_delta, skill, skill_delta)
select us.user_id, 'task:' || (t.value ->> 'id'), 'legacy_task', 0, null, 0
from public.user_state us
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(us.state #> '{S,tasks}') = 'array' then us.state #> '{S,tasks}' else '[]'::jsonb end
) as t(value)
where t.value ->> 'done' = 'true'
  and coalesce(t.value ->> 'id', '') <> ''
on conflict (user_id, event_key) do nothing;

insert into public.xp_events (user_id, event_key, event_type, points_delta, skill, skill_delta)
select
  us.user_id,
  'habit:' || coalesce(nullif(us.state #>> '{S,mk}', ''), to_char(now(), 'YYYY-MM')) || ':' || left(lower(btrim(h.value ->> 'n')), 100) || ':' || d.day_no::text,
  'legacy_habit', 0, null, 0
from public.user_state us
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(us.state #> '{S,hab}') = 'array' then us.state #> '{S,hab}' else '[]'::jsonb end
) as h(value)
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(h.value -> 'd') = 'array' then h.value -> 'd' else '[]'::jsonb end
) with ordinality as d(value, day_no)
where d.value = '1'::jsonb
  and coalesce(btrim(h.value ->> 'n'), '') <> ''
on conflict (user_id, event_key) do nothing;

-- A single server-only batch operation applies each event at most once.
create or replace function public.award_xp_events(
  p_user_id uuid,
  p_events jsonb
)
returns table (applied_count integer, points integer, skill_xp jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
  v_key text;
  v_type text;
  v_points integer;
  v_skill text;
  v_skill_delta integer;
  v_rows integer;
  v_count integer := 0;
  v_skill_name text;
begin
  if p_user_id is null or p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Invalid XP event batch';
  end if;
  if jsonb_array_length(p_events) > 5000 then
    raise exception 'XP event batch is too large';
  end if;

  insert into public.xp_profiles (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception 'Invalid XP event';
    end if;
    v_key := v_event ->> 'key';
    v_type := v_event ->> 'type';
    v_points := (v_event ->> 'points')::integer;
    v_skill := nullif(btrim(v_event ->> 'skill'), '');
    v_skill_delta := (v_event ->> 'skillDelta')::integer;

    if v_key is null or length(v_key) < 1 or length(v_key) > 200
       or v_type is null or length(v_type) > 50
       or v_points is null or v_points < -100000 or v_points > 100000
       or v_skill_delta is null or v_skill_delta < 0 or v_skill_delta > 1000 then
      raise exception 'Invalid XP event';
    end if;

    insert into public.xp_events (user_id, event_key, event_type, points_delta, skill, skill_delta)
    values (p_user_id, v_key, v_type, v_points, v_skill, v_skill_delta)
    on conflict (user_id, event_key) do nothing;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
      continue;
    end if;

    v_skill_name := left(coalesce(v_skill, ''), 60);
    update public.xp_profiles p
    set points = greatest(0, least(10000000, p.points + v_points)),
        skill_xp = case
          when v_skill_name = '' or v_skill_delta = 0 then coalesce(p.skill_xp, '{}'::jsonb)
          else jsonb_set(
            coalesce(p.skill_xp, '{}'::jsonb),
            array[v_skill_name],
            to_jsonb(least(10000000::numeric, greatest(0::numeric,
              (case
                when length(coalesce(p.skill_xp ->> v_skill_name, '')) <= 12
                  and coalesce(p.skill_xp ->> v_skill_name, '') ~ '^-?\d+$'
                then (p.skill_xp ->> v_skill_name)::numeric
                else 0
              end) + v_skill_delta
            ))),
            true
          )
        end,
        updated_at = now()
    where p.user_id = p_user_id;
    v_count := v_count + 1;
  end loop;

  return query select v_count, p.points, p.skill_xp
    from public.xp_profiles p where p.user_id = p_user_id;
end;
$$;

revoke all on function public.award_xp_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.award_xp_events(uuid, jsonb) to service_role;

-- Retire direct browser score writes. All future leaderboard reads/writes go through server APIs.
drop policy if exists "read scores" on public.scores;
drop policy if exists "write own score" on public.scores;
drop policy if exists "update own score" on public.scores;
drop policy if exists "delete own score" on public.scores;
revoke all on public.scores from public, anon, authenticated;
grant all on public.scores to service_role;
