-- 0009_leaderboard_checkins.sql
-- CivicQuest: the school leaderboard, the two Leader-hours RPCs
-- (approve_checkin, leader_scan), and demo fixes for the partner flow.
-- Source: design.md "approve_checkin", "leader_scan", "Leaderboard"
-- (Requirements 23, 25.4, 26.1–26.7, 27.1–27.4, 32.6, 35.1, 35.2, 36.4).
--
-- Both RPCs follow the 0004 contract: security invoker, search_path = '',
-- the constant via_rpc flag set transaction-locally, an in-body role and
-- ownership check, server-computed values only, and an audit entry in the same
-- transaction. Unlike the core-loop RPCs they RETURN a rejection
-- ({ ok: false, message }) instead of raising, so the Leader and partner
-- screens can show a friendly message. A rejection writes nothing except the
-- rate-limit counter, which must persist for the limit to work.

-- ---------------------------------------------------------------------------
-- 1. School leaderboard (Requirement 23). Class totals only, never students.
-- security definer so every class in the caller's school is ranked, including
-- classes the caller does not own; it returns totals and nothing else, and is
-- scoped to public.app_school_id() (partners get null and so zero rows).
-- ---------------------------------------------------------------------------

create or replace function public.school_leaderboard()
returns table (
  class_id uuid,
  name text,
  grade int,
  student_count int,
  approved_points int,
  points_per_student numeric,
  rank int
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select public.app_school_id() as school_id
  ),
  totals as (
    select c.id,
           c.name,
           c.grade,
           (select count(*)::int from public.students s where s.class_id = c.id) as student_count,
           coalesce((
             select sum(mc.points_awarded)::int
               from public.mission_completions mc
              where mc.class_id = c.id
                and mc.status = 'approved'
           ), 0) as approved_points
      from public.classes c
      join caller on caller.school_id = c.school_id
  ),
  scored as (
    select t.*,
           case when t.student_count > 0
                then t.approved_points::numeric / t.student_count
                else 0 end as raw_score
      from totals t
  )
  select s.id,
         s.name,
         s.grade,
         s.student_count,
         s.approved_points,
         round(s.raw_score, 1),
         (rank() over (order by s.raw_score desc))::int
    from scored s
   order by s.raw_score desc, s.name;
$$;

revoke all on function public.school_leaderboard() from public, anon;
grant execute on function public.school_leaderboard() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Private helper: the school of a check-in's student, for the partner's
-- audit entry. Partners cannot read students (Requirement 3.7), so this
-- definer helper returns one uuid, and only for a check-in at the caller's own
-- partner org's opportunity. Not exposed through PostgREST.
-- ---------------------------------------------------------------------------

create or replace function private.checkin_school_id(p_checkin_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.school_id
    from public.checkins c
    join public.opportunities o on o.id = c.opportunity_id
    join public.students s on s.id = c.student_id
   where c.id = p_checkin_id
     and o.partner_org_id = public.app_partner_org_id();
$$;

revoke all on function private.checkin_school_id(uuid) from public, anon;
grant execute on function private.checkin_school_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. approve_checkin (Requirements 27.1–27.4, 32.6)
-- ---------------------------------------------------------------------------

create or replace function public.approve_checkin(p_checkin_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_student_id uuid;
  v_status     public.review_status;
  v_out        timestamptz;
  v_hours      numeric;
  v_school_id  uuid;
begin
  perform set_config('civicquest.via_rpc', 'on', true);

  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to approve hours.');
  end if;

  if public.app_role() is distinct from 'partner' or public.app_partner_org_id() is null then
    return jsonb_build_object('ok', false, 'message', 'Only a partner supervisor can approve hours.');
  end if;

  -- Own org only. Read under the partner's RLS and re-checked explicitly.
  select c.student_id, c.status, c.check_out_at, c.hours
    into v_student_id, v_status, v_out, v_hours
    from public.checkins c
    join public.opportunities o on o.id = c.opportunity_id
   where c.id = p_checkin_id
     and o.partner_org_id = public.app_partner_org_id();

  if v_student_id is null then
    return jsonb_build_object('ok', false, 'message', 'That check-in is not one of yours.');
  end if;

  -- Nobody approves their own work (Requirement 27.3, 32.6).
  if v_student_id is not distinct from public.app_student_id() then
    return jsonb_build_object('ok', false, 'message', 'You can''t approve your own hours.');
  end if;

  if v_status is distinct from 'pending' then
    return jsonb_build_object('ok', false, 'message', 'These hours are already reviewed.');
  end if;

  if v_out is null then
    return jsonb_build_object('ok', false, 'message', 'This student hasn''t checked out yet.');
  end if;

  v_school_id := private.checkin_school_id(p_checkin_id);

  insert into public.audit_log
    (school_id, actor_id, action, target_table, target_id, details)
  values
    (v_school_id, v_uid, 'approve', 'checkins', p_checkin_id,
     jsonb_build_object('hours', v_hours));

  update public.checkins c
     set status      = 'approved',
         approved_by = v_uid,
         approved_at = now()
   where c.id = p_checkin_id
     and c.status = 'pending';

  return jsonb_build_object('ok', true, 'hours', v_hours);
end;
$$;

revoke all on function public.approve_checkin(uuid) from public, anon;
grant execute on function public.approve_checkin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. leader_scan (Requirements 25.4, 26.1–26.7, 35.1, 35.2)
-- The only input is the token. Student, timestamps, hours, and status are all
-- server-set. The token itself stays hidden: it is matched only through
-- private.opportunity_id_for_token and never returned.
-- ---------------------------------------------------------------------------

create or replace function public.leader_scan(p_token text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_student_id uuid;
  v_school_id  uuid;
  v_grade      int;
  v_level      text;
  v_opp_id     uuid;
  v_title      text;
  v_org_id     uuid;
  v_starts     timestamptz;
  v_ends       timestamptz;
  v_min_grade  int;
  v_capacity   int;
  v_checkin_id uuid;
  v_in         timestamptz;
  v_out        timestamptz;
  v_hours      numeric;
begin
  perform set_config('civicquest.via_rpc', 'on', true);

  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', 'Sign in to check in.');
  end if;

  v_student_id := public.app_student_id();
  if public.app_role() is distinct from 'student' or v_student_id is null then
    return jsonb_build_object('ok', false, 'message', 'Only student Leaders can check in.');
  end if;

  select s.school_id, s.grade, s.level
    into v_school_id, v_grade, v_level
    from public.students s
   where s.id = v_student_id;

  if v_level is distinct from 'leaders' then
    return jsonb_build_object('ok', false, 'message', 'Check-ins are for grades 9 to 12.');
  end if;

  -- 10 scans per minute per Leader, enforced here so direct .rpc() calls are
  -- limited too.
  if not private.consume_rate_limit('leader_scan', 10, interval '1 minute') then
    return jsonb_build_object('ok', false, 'message', 'Too many scans. Wait a minute and try again.');
  end if;

  if p_token is null or char_length(p_token) not between 1 and 256 then
    return jsonb_build_object('ok', false, 'message', 'This code isn''t valid. Ask the partner for the current code.');
  end if;

  v_opp_id := private.opportunity_id_for_token(p_token);
  if v_opp_id is null then
    return jsonb_build_object('ok', false, 'message', 'This code isn''t valid. Ask the partner for the current code.');
  end if;

  -- Non-secret columns only, under the Leader's RLS (school-linked partners).
  select o.title, o.partner_org_id, o.starts_at, o.ends_at, o.min_grade, o.capacity
    into v_title, v_org_id, v_starts, v_ends, v_min_grade, v_capacity
    from public.opportunities o
   where o.id = v_opp_id;

  if v_title is null
     or not exists (
       select 1 from public.school_partners sp
        where sp.school_id = v_school_id
          and sp.partner_org_id = v_org_id
     ) then
    return jsonb_build_object('ok', false, 'message', 'This event isn''t open to your school.');
  end if;

  select c.id, c.check_in_at, c.check_out_at
    into v_checkin_id, v_in, v_out
    from public.checkins c
   where c.opportunity_id = v_opp_id
     and c.student_id = v_student_id;

  -- Second scan: check out. Hours = elapsed rounded down to 0.25, capped at 8,
  -- mirroring computeHours in lib/domain/hours.ts. Still pending approval.
  if v_checkin_id is not null then
    if v_out is not null then
      return jsonb_build_object('ok', false, 'message', 'You''ve already checked out of this event.');
    end if;

    v_hours := least(8, greatest(0, floor(extract(epoch from (now() - v_in)) / 900) * 0.25));

    insert into public.audit_log
      (school_id, actor_id, action, target_table, target_id, details)
    values
      (v_school_id, v_uid, 'check_out', 'checkins', v_checkin_id,
       jsonb_build_object('opportunity_id', v_opp_id, 'hours', v_hours));

    update public.checkins c
       set check_out_at = now(),
           hours = v_hours
     where c.id = v_checkin_id
       and c.check_out_at is null;

    return jsonb_build_object('ok', true, 'action', 'checked_out',
                              'opportunity_title', v_title, 'hours', v_hours);
  end if;

  -- First scan: check in, after the eligibility checks.
  if v_grade < v_min_grade then
    return jsonb_build_object('ok', false, 'message', 'This event is for older grades.');
  end if;

  if v_capacity is not null and private.opportunity_checkin_count(v_opp_id) >= v_capacity then
    return jsonb_build_object('ok', false, 'message', 'This event is full.');
  end if;

  if now() < v_starts - interval '30 minutes' then
    return jsonb_build_object('ok', false, 'message', 'Check-in opens 30 minutes before the event starts.');
  end if;

  if now() > v_ends then
    return jsonb_build_object('ok', false, 'message', 'This event has ended.');
  end if;

  insert into public.checkins (opportunity_id, student_id, check_in_at, status)
  values (v_opp_id, v_student_id, now(), 'pending')
  on conflict (opportunity_id, student_id) do nothing
  returning id into v_checkin_id;

  if v_checkin_id is null then
    return jsonb_build_object('ok', false, 'message', 'You''re already checked in.');
  end if;

  insert into public.audit_log
    (school_id, actor_id, action, target_table, target_id, details)
  values
    (v_school_id, v_uid, 'check_in', 'checkins', v_checkin_id,
     jsonb_build_object('opportunity_id', v_opp_id));

  return jsonb_build_object('ok', true, 'action', 'checked_in',
                            'opportunity_title', v_title, 'hours', null);
end;
$$;

revoke all on function public.leader_scan(text) from public, anon;
grant execute on function public.leader_scan(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Demo fixes (data only, idempotent)
-- ---------------------------------------------------------------------------

-- 5a. Link the demo partner login to Greater Community Food Bank.
update public.profiles p
   set partner_org_id = (
         select po.id from public.partner_orgs po
          where po.name = 'Greater Community Food Bank'
          order by po.created_at
          limit 1)
 where p.role = 'partner'
   and p.partner_org_id is null
   and p.id in (select u.id from auth.users u where u.email = 'partner@demo.civicquest.app');

-- 5b. Make sure one Food Bank opportunity is open right now, so the scan demo
-- works today: started within the last hour, ends later tonight.
update public.opportunities o
   set starts_at = now() - interval '30 minutes',
       ends_at   = now() + interval '5 hours'
 where o.id = (
         select o2.id
           from public.opportunities o2
           join public.partner_orgs po on po.id = o2.partner_org_id
          where po.name = 'Greater Community Food Bank'
          order by o2.starts_at
          limit 1)
   and not exists (
         select 1
           from public.opportunities o3
           join public.partner_orgs po on po.id = o3.partner_org_id
          where po.name = 'Greater Community Food Bank'
            and now() between o3.starts_at - interval '30 minutes' and o3.ends_at);

-- 5c. Demo history: one past, approved 3-hour shift for Jordan M., so verified
-- hours, the proof timeline, and the certificate have real data. Written once,
-- the same way the seed writes history; it sets the via_rpc flag for this one
-- block only, transaction-local. Skipped if it already exists.
do $$
declare
  v_org     uuid;
  v_student uuid;
  v_school  uuid;
  v_partner uuid;
  v_opp     uuid;
  v_checkin uuid;
  v_start   timestamptz := date_trunc('day', now()) - interval '6 days' + interval '14 hours';
begin
  select po.id into v_org from public.partner_orgs po
   where po.name = 'Greater Community Food Bank' order by po.created_at limit 1;
  select s.id, s.school_id into v_student, v_school from public.students s
   where s.auth_user_id = (select u.id from auth.users u where u.email = 'leader@demo.civicquest.app');
  select u.id into v_partner from auth.users u where u.email = 'partner@demo.civicquest.app';

  if v_org is null or v_student is null or v_partner is null then
    return;
  end if;

  select o.id into v_opp from public.opportunities o
   where o.partner_org_id = v_org and o.title = 'Fall coat drive';

  if v_opp is null then
    insert into public.opportunities
      (partner_org_id, title, description, location_name, starts_at, ends_at, min_grade, capacity)
    values
      (v_org, 'Fall coat drive', 'Sort donated coats by size and hang them for families to choose from.',
       'Greater Community Food Bank warehouse', v_start, v_start + interval '3 hours', 9, 12)
    returning id into v_opp;
  end if;

  if exists (select 1 from public.checkins c where c.opportunity_id = v_opp and c.student_id = v_student) then
    return;
  end if;

  perform set_config('civicquest.via_rpc', 'on', true);

  insert into public.checkins
    (opportunity_id, student_id, check_in_at, check_out_at, hours, status, approved_by, approved_at)
  values
    (v_opp, v_student, v_start + interval '2 minutes', v_start + interval '3 hours 4 minutes',
     3.00, 'approved', v_partner, v_start + interval '3 hours 20 minutes')
  returning id into v_checkin;

  insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details, created_at)
  values
    (v_school, (select p.id from public.profiles p where p.id = (select u.id from auth.users u where u.email = 'leader@demo.civicquest.app')),
     'check_in', 'checkins', v_checkin, jsonb_build_object('opportunity_id', v_opp), v_start + interval '2 minutes'),
    (v_school, (select p.id from public.profiles p where p.id = (select u.id from auth.users u where u.email = 'leader@demo.civicquest.app')),
     'check_out', 'checkins', v_checkin, jsonb_build_object('opportunity_id', v_opp, 'hours', 3.00), v_start + interval '3 hours 4 minutes'),
    (v_school, v_partner, 'approve', 'checkins', v_checkin, jsonb_build_object('hours', 3.00), v_start + interval '3 hours 20 minutes');
end;
$$;
