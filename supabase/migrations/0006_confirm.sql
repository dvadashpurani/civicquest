-- 0006_confirm.sql
-- CivicQuest core-loop RPC: confirm_class_mission.
-- Source: design.md "Security-Invoker RPC Functions", "Common preamble for all
-- five RPCs", "In-body ownership checks", and "confirm_class_mission"
-- (Requirements 20.1, 20.2, 20.6, 20.7, 20.8, 32.2, 32.4, 36.3, 36.4).
--
-- This is the first of the five security-invoker write RPCs. It follows the
-- contract documented in 0004_triggers.sql exactly:
--   * The ONLY setting it touches is the constant 'civicquest.via_rpc' set to
--     'on', transaction-local (third arg true). There is no second set_config,
--     so the task 7.4 pg_proc scan still finds set_config only in the five RPC
--     names with that one constant (contract B, design "Why the client cannot
--     set the flag itself").
--   * It is `security invoker`: it runs with the caller's privileges and RLS,
--     so the teacher's mission_completions insert/update policy, the direct-
--     write guard, and the protection trigger all apply to every row it writes
--     (design "Why security invoker here").
--   * It transitions rows into 'approved' only (insert, or reversed ->
--     approved), always with confirmed_by = auth.uid() and confirmed_at =
--     now() and server-computed points_awarded >= 0, exactly as the protection
--     trigger requires for a via_rpc transition (contract C, Requirement 32.4).
--     It NEVER moves an approved row to reversed, so it writes no reversal
--     audit entry and contract B's reversed_completion_ids rule does not apply
--     here; the re_approve entries it writes deliberately omit that key.
--   * search_path = '', fully qualified names, no dynamic SQL (Requirement
--     33.3). All actor/time fields are server-set; client-sent points_awarded,
--     status, confirmed_by, school_id, or level are never read (Requirement
--     20.2).
--
-- Points come from the mission's module level (design "confirm_class_mission"):
-- 10 for learners/helpers, 15 for leaders. This mirrors lib/domain/points.ts
-- and the `modules.level` model in 0001.
--
-- Audit entries (Requirement 36.3):
--   * one 'confirm' entry per successful call that changed at least one row,
--     target_id = mission id, details {class_id, mission_id,
--     present_student_ids, confirmed_count, reapproved_count};
--   * one 're_approve' entry per student whose row went reversed -> approved,
--     target_id = completion id, details {class_id, mission_id, student_id}.
--     These MUST NOT carry 'reversed_completion_ids' (contract B).

create or replace function public.confirm_class_mission(
  p_class_id uuid,
  p_mission_id uuid,
  p_present_student_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_school_id   uuid;
  v_level       text;
  v_points      int;
  v_student_id  uuid;
  v_completion  uuid;
  v_prev_status public.review_status;
  v_confirmed   int := 0;
  v_reapproved  int := 0;
  v_ids         uuid[];
begin
  -- 1. Make the via_rpc flag transaction-local so the direct-write guard and
  --    the protection trigger accept the approved transitions below.
  perform set_config('civicquest.via_rpc', 'on', true);

  -- 2. A signed-in user is required (Requirement 32.3).
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  -- 3a. In-body ownership check: the caller is a teacher who owns the class,
  --     read under the caller's own RLS (design "In-body ownership checks").
  if public.app_role() is distinct from 'teacher'
     or not exists (
       select 1 from public.classes c
       where c.id = p_class_id
         and c.teacher_id = v_uid
     ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- 3b. The mission must belong to the module assigned to this class, and the
  --     mission's level sets the points. Join classes -> class_modules ->
  --     modules -> missions so a mission from an unassigned module is rejected.
  select c.school_id, mo.level
    into v_school_id, v_level
    from public.classes c
    join public.class_modules cm on cm.class_id = c.id
    join public.modules mo on mo.id = cm.module_id
    join public.missions mi on mi.module_id = mo.id
   where c.id = p_class_id
     and mi.id = p_mission_id;

  if v_school_id is null or v_level is null then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Points from the mission's level (10 learners/helpers, 15 leaders).
  v_points := case when v_level = 'leaders' then 15 else 10 end;

  -- 3c. De-duplicate the present student ids to a distinct set, and require
  --     every one to be a student of this class. If the caller passes an id
  --     that is not in the class, reject with no side effects (Requirement
  --     20.7). An empty or null set is a no-op: nothing to confirm.
  select array(
           select distinct x
           from unnest(coalesce(p_present_student_ids, '{}'::uuid[])) as x
           where x is not null
         )
    into v_ids;

  if exists (
       select 1
       from unnest(v_ids) as x
       where not exists (
         select 1 from public.students s
         where s.id = x
           and s.class_id = p_class_id
       )
     ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- 4. Upsert one completion per distinct present student (design
  --    "confirm_class_mission"):
  --      no row       -> insert 'approved' with server-computed values;
  --      'reversed'   -> re-approve with FRESH server values + re_approve audit;
  --      'approved'   -> left unchanged (re-confirm never double-awards, 20.8).
  --
  --    The prior status is read before the write so each outcome is counted
  --    deterministically; the unique (mission_id, student_id) key keeps the
  --    upsert race-free. For a 'pending' row (e.g. a future photo/quiz flow)
  --    the protection trigger rejects a pending -> approved transition, so
  --    this RPC only ever acts on missing, reversed, or approved rows.
  foreach v_student_id in array v_ids loop
    select mc.status
      into v_prev_status
      from public.mission_completions mc
     where mc.mission_id = p_mission_id
       and mc.student_id = v_student_id;

    if v_prev_status is null then
      -- Missing row: insert as approved with server-set values.
      insert into public.mission_completions
        (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values
        (p_mission_id, v_student_id, p_class_id, 'approved', v_uid, now(), v_points)
      returning id into v_completion;
      v_confirmed := v_confirmed + 1;

    elsif v_prev_status = 'reversed' then
      -- Re-approve with FRESH server-computed values (allowed by the
      -- protection trigger only because via_rpc is 'on').
      update public.mission_completions mc
         set status         = 'approved',
             confirmed_by   = v_uid,
             confirmed_at   = now(),
             points_awarded = v_points
       where mc.mission_id = p_mission_id
         and mc.student_id = v_student_id
      returning mc.id into v_completion;
      v_reapproved := v_reapproved + 1;

      -- One re_approve audit entry for traceability (Requirement 36.3). It
      -- carries NO 'reversed_completion_ids' key (contract B).
      insert into public.audit_log
        (school_id, actor_id, action, target_table, target_id, details)
      values
        (v_school_id, v_uid, 're_approve', 'mission_completions', v_completion,
         jsonb_build_object(
           'class_id', p_class_id,
           'mission_id', p_mission_id,
           'student_id', v_student_id
         ));

    else
      -- Already approved: leave untouched so confirming again never
      -- double-awards points or stamps (Requirement 20.8).
      null;
    end if;
  end loop;

  -- 5. Exactly one 'confirm' audit entry when at least one row changed
  --    (Requirement 36.3). Re-confirming an already-complete mission changes
  --    nothing and writes no entry, keeping the operation idempotent.
  if v_confirmed > 0 or v_reapproved > 0 then
    insert into public.audit_log
      (school_id, actor_id, action, target_table, target_id, details)
    values
      (v_school_id, v_uid, 'confirm', 'mission_completions', p_mission_id,
       jsonb_build_object(
         'class_id', p_class_id,
         'mission_id', p_mission_id,
         'present_student_ids', to_jsonb(v_ids),
         'confirmed_count', v_confirmed,
         'reapproved_count', v_reapproved
       ));
  end if;
end;
$$;

-- Callable by signed-in users only; the in-body check restricts it to the
-- owning teacher. service_role may call it for tooling. anon is denied.
revoke all on function public.confirm_class_mission(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.confirm_class_mission(uuid, uuid, uuid[]) to authenticated, service_role;
