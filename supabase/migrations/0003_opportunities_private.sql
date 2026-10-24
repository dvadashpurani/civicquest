-- 0003_opportunities_private.sql
-- CivicQuest: QR token secrecy, partner token functions, the partner
-- check-in student surface, and the private helper schema.
-- Source: design.md "Partner student-detail view/function" and "QR token
-- secrecy: column privileges on opportunities" (Requirements 3.7, 25.2, 25.3,
-- 25.4, 26.4, 35.1, 36.3).
--
-- Deliberate differences from design.md (also noted in the build log):
--   1. The location column is `location_name` (as created in 0001), not
--      `location`.
--   2. `delete` on opportunities is also revoked from anon/authenticated.
--      0002 has no delete policy, so this changes no behavior; it removes the
--      privilege entirely (defense in depth: deleting would cascade away
--      check-ins and Leaders' verified hours).
--   3. `partner_checkin_students` is a `security definer` function, not a
--      view or `security invoker` function. Partners have no privileges and no
--      RLS policy on `students` (Requirement 3.7), so an invoker surface would
--      return nothing; granting partners `students` access would expose full
--      rows. The definer function filters to the caller's own partner org in
--      its body and returns only `first_name`, `last_initial`, `grade`, plus
--      `checkin_id` so the partner UI can match a name to the check-in row it
--      already reads under RLS. `checkin_id` is a check-in key, not a student
--      field; no student id or other student column is returned.

-- ---------------------------------------------------------------------------
-- opportunities: column-level privileges (Requirements 25.2, 25.4, 26.4)
-- A table-level grant would override a column revoke, so table-level
-- privileges are revoked first (which also drops any column grants), and only
-- column lists without qr_token are granted back. RLS (0002) still decides
-- which rows each role sees and writes.
-- ---------------------------------------------------------------------------

revoke select, insert, update, delete on public.opportunities from anon, authenticated;

grant select (id, partner_org_id, title, description, location_name, starts_at, ends_at,
              min_grade, capacity, created_at)
  on public.opportunities to authenticated;

-- Partners insert under the opportunities_insert policy (own org only). id,
-- created_at, and qr_token always come from database defaults.
grant insert (partner_org_id, title, description, location_name, starts_at, ends_at,
              min_grade, capacity)
  on public.opportunities to authenticated;

-- partner_org_id is not updatable: an opportunity never moves between orgs.
grant update (title, description, location_name, starts_at, ends_at, min_grade, capacity)
  on public.opportunities to authenticated;

-- Crypto-random token (Requirement 25.2): 24 bytes from pgcrypto, hex encoded.
alter table public.opportunities
  alter column qr_token set default encode(extensions.gen_random_bytes(24), 'hex');

-- Rotate any token created with the old 16-byte default (idempotent).
update public.opportunities
  set qr_token = encode(extensions.gen_random_bytes(24), 'hex')
  where char_length(qr_token) < 48;

-- ---------------------------------------------------------------------------
-- Partner token functions (public, called via .rpc() from the partner page)
-- security definer: authenticated has no privilege on qr_token. Each checks
-- partner ownership in its body and returns a single scalar or nothing.
-- ---------------------------------------------------------------------------

-- Current token for the caller's own org's opportunity; null otherwise.
create or replace function public.partner_opportunity_token(p_opportunity_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.qr_token
  from public.opportunities o
  where o.id = p_opportunity_id
    and (select public.app_role()) = 'partner'
    and o.partner_org_id = (select public.app_partner_org_id());
$$;

-- Issue a new token; the previous token stops matching immediately
-- (Requirements 25.3, 25.4). Writes one audit_log entry without the token
-- value (Requirement 36.2, 36.3).
create or replace function public.regenerate_opportunity_token(p_opportunity_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null
     or public.app_role() is distinct from 'partner'
     or public.app_partner_org_id() is null then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.opportunities o
    set qr_token = encode(extensions.gen_random_bytes(24), 'hex')
    where o.id = p_opportunity_id
      and o.partner_org_id = public.app_partner_org_id()
    returning o.partner_org_id into v_org;

  if not found then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details)
  values (null, v_uid, 'regenerate_token', 'opportunities', p_opportunity_id,
          jsonb_build_object('partner_org_id', v_org));
end;
$$;

revoke all on function public.partner_opportunity_token(uuid)    from public, anon;
revoke all on function public.regenerate_opportunity_token(uuid) from public, anon;
grant execute on function public.partner_opportunity_token(uuid)    to authenticated, service_role;
grant execute on function public.regenerate_opportunity_token(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Partner check-in student surface (Requirement 3.7)
-- Returns exactly first_name, last_initial, grade for students who checked in
-- to the given opportunity, only when it belongs to the caller's own partner
-- org; zero rows otherwise (Requirements 3.10, 25.5).
-- ---------------------------------------------------------------------------

create or replace function public.partner_checkin_students(p_opportunity_id uuid)
returns table (checkin_id uuid, first_name text, last_initial text, grade int)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, s.first_name, s.last_initial, s.grade
  from public.checkins c
  join public.opportunities o on o.id = c.opportunity_id
  join public.students s on s.id = c.student_id
  where c.opportunity_id = p_opportunity_id
    and (select public.app_role()) = 'partner'
    and o.partner_org_id = (select public.app_partner_org_id())
  order by c.check_in_at, c.id;
$$;

revoke all on function public.partner_checkin_students(uuid) from public, anon;
grant execute on function public.partner_checkin_students(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- private schema: not in PostgREST's exposed schemas (public, graphql_public),
-- so nothing here is reachable via .rpc(). authenticated gets usage and
-- execute only so the security invoker RPCs (leader_scan) can call these.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Opportunity whose CURRENT token equals p_token, or null (Requirement 25.4).
create or replace function private.opportunity_id_for_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.opportunities o
  where p_token is not null
    and char_length(p_token) between 1 and 256
    and o.qr_token = p_token;
$$;

-- Number of check-ins for an opportunity (capacity), nothing else.
create or replace function private.opportunity_checkin_count(p_opportunity_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.checkins c
  where c.opportunity_id = p_opportunity_id;
$$;

-- Fixed-window counter keyed on the caller (Requirement 35.1). The key is
-- built from auth.uid() inside the function, so a caller cannot spend or
-- inspect another user's budget. Returns true while within p_limit calls in
-- the current window. Raises when there is no signed-in user.
-- Note: the increment is part of the caller's transaction; if the calling RPC
-- raises afterwards, the increment rolls back with it.
create or replace function private.consume_rate_limit(p_bucket text, p_limit int, p_window interval)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_key   text;
  v_start timestamptz;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if p_bucket is null or char_length(p_bucket) not between 1 and 64
     or p_limit is null or p_limit < 1
     or p_window is null or p_window <= interval '0'
     or extract(month from p_window) <> 0 or extract(year from p_window) <> 0 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  v_key   := p_bucket || ':' || v_uid::text;
  v_start := date_bin(p_window, now(), timestamptz '2000-01-01 00:00:00+00');

  insert into public.rate_limits as r (key, window_start, count)
  values (v_key, v_start, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  -- Keep the table small: drop this key's expired windows.
  delete from public.rate_limits r
  where r.key = v_key
    and r.window_start < v_start;

  return v_count <= p_limit;
end;
$$;

revoke all on function private.opportunity_id_for_token(text)                from public, anon;
revoke all on function private.opportunity_checkin_count(uuid)               from public, anon;
revoke all on function private.consume_rate_limit(text, int, interval)       from public, anon;
grant execute on function private.opportunity_id_for_token(text)          to authenticated;
grant execute on function private.opportunity_checkin_count(uuid)         to authenticated;
grant execute on function private.consume_rate_limit(text, int, interval) to authenticated;
