-- 0007_edit.sql
-- CivicQuest core-loop RPC: edit_mission_participants.
-- Source: design.md "Security-Invoker RPC Functions", "Common preamble for all
-- five RPCs", "In-body ownership checks", "edit_mission_participants", and
-- "Recently confirmed (< 24h)" / class_recent_confirmation
-- (Requirements 21.2, 21.3, 21.4, 21.5, 36.4).
--
-- This is the second of the five security-invoker write RPCs. It follows the
-- contract documented in 0004_triggers.sql exactly and mirrors 0006_confirm.sql:
--   * The ONLY setting it touches is the constant 'civicquest.via_rpc' set to
--     'on', transaction-local (third arg true). There is no second set_config,
--     so the task 7.4 pg_proc scan still finds set_config only in the five RPC
--     names with that one constant (contract B / design "Why the client cannot
--     set the flag itself").
--   * It is `security invoker`: it runs with the caller's privileges and RLS,
--     so the teacher's policies, the direct-write guard, and the protection
--     trigger all apply to every row it writes (design "Why security invoker").
--   * search_path = '', fully qualified names, no dynamic SQL (Requirement
--     33.3). All actor/time fields are server-set; the client supplies only the
--     class id, mission id, and the new roster set B.
--
-- Difference from confirm_class_mission: edit_mission_participants reconciles
-- the confirmed roster to a new set B. For students in B it applies the SAME
-- upsert as confirm (missing -> approved; reversed -> re_approve with fresh
-- server values + a re_approve audit entry; approved -> untouched). For
-- students currently APPROVED but NOT in B it reverses the row
-- (approved -> reversed) with reason 'removed by edit'. Editing from any prior
-- set A to B yields exactly the totals of confirming B directly (Requirement
-- 21.3, 21.4; design "edit_mission_participants", Requirement 15.3).
--
-- ADDITIONAL guard vs confirm: the mission's confirmation must be < 24 hours
-- old. The mission confirmation time is min(confirmed_at) over the mission's
-- currently approved completions for the class (design "Recently confirmed
-- (< 24h)" / class_recent_confirmation). If there is no approved completion, or
-- the oldest approved completion is >= 24h old, the edit window has passed and
-- the call is rejected with no side effects (Requirement 21.2).
--
-- Reversal contract (0004_triggers.sql contract B, Requirements 4.7, 4.8): the
-- protection trigger requires, per reversed row, exactly one audit_log entry by
-- this actor in this transaction whose details carry a valid 'reason' (1-500
-- chars) and a 'reversed_completion_ids' JSON array containing that row's id.
-- This RPC therefore writes ONE 'edit_remove' entry PER removed student BEFORE
-- updating that row to reversed, each with reason 'removed by edit' and
-- reversed_completion_ids = [that one completion id]. Re-added students get
-- their own 're_approve' entries, which MUST NOT carry
-- 'reversed_completion_ids' (contract B).
--
-- Audit entries (Requirement 36.4 — data change + audit in one transaction):
--   * one 'edit' summary entry per successful call that changed at least one
--     row, target_id = mission id, details {class_id, mission_id,
--     present_student_ids, confirmed_count, reapproved_count, removed_count};
--   * one 're_approve' entry per student whose row went reversed -> approved,
--     target_id = completion id, details {class_id, mission_id, student_id}
--     (no 'reversed_completion_ids');
--   * one 'edit_remove' entry per student whose row went approved -> reversed,
--     target_id = completion id, details {class_id, mission_id, student_id,
--     reason: 'removed by edit', reversed_completion_ids: [that id]}.
-- Everything runs in the function's single implicit transaction, so the data
-- changes and the audit entries commit together or roll back together.

create or replace function public.edit_mission_participants(
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
  v_first_conf  timestamptz;
  v_student_id  uuid;
  v_completion  uuid;
  v_prev_status public.review_status;
  v_confirmed   int := 0;
  v_reapproved  int := 0;
  v_removed     int := 0;
  v_ids         uuid[];
begin
  -- 1. Make the via_rpc flag transaction-local so the direct-write guard and
  --    the protection trigger accept the approved/reversed transitions below.
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

  -- 3c. ADDITIONAL guard: the mission's confirmation must be < 24h old. The
  --     confirmation time is min(confirmed_at) over the mission's currently
  --     approved completions for this class (design class_recent_confirmation).
  --     No approved completion, or an oldest approval >= 24h ago, means the
  --     edit window has passed; reject with no side effects (Requirement 21.2).
  select min(mc.confirmed_at)
    into v_first_conf
    from public.mission_completions mc
   where mc.mission_id = p_mission_id
     and mc.class_id = p_class_id
     and mc.status = 'approved';

  if v_first_conf is null or now() - v_first_conf >= interval '24 hours' then
    raise exception 'the 24-hour edit window for this mission has passed'
      using errcode = '42501';
  end if;

  -- 3d. De-duplicate the new roster set B to a distinct set, and require every
  --     one to be a student of this class. If the caller passes an id that is
  --     not in the class, reject with no side effects (Requirement 21.2). A
  --     null set is treated as the empty set (remove everyone).
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

  -- 4. Upsert the students in B (same upsert as confirm_class_mission):
  --      no row       -> insert 'approved' with server-computed values;
  --      'reversed'   -> re-approve with FRESH server values + re_approve audit;
  --      'approved'   -> left unchanged (re-editing never double-awards).
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

      -- One re_approve audit entry for traceability (Requirement 21.4). It
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
      -- Already approved and still in B: leave untouched so editing never
      -- double-awards points or stamps.
      null;
    end if;
  end loop;

  -- 5. Reverse every student currently APPROVED for this mission/class who is
  --    NOT in the new set B, with reason 'removed by edit' (Requirement 21.3).
  --    Per contract B the 'edit_remove' audit entry MUST be inserted BEFORE the
  --    update to reversed, because the protection trigger checks, per reversed
  --    row, that exactly one entry in this transaction lists that row's id in
  --    'reversed_completion_ids' with a valid reason. One entry per removed
  --    student; each entry lists only that student's completion id, so no id
  --    appears in more than one entry (contract B).
  for v_completion, v_student_id in
    select mc.id, mc.student_id
      from public.mission_completions mc
     where mc.mission_id = p_mission_id
       and mc.class_id = p_class_id
       and mc.status = 'approved'
       and not (mc.student_id = any (v_ids))
  loop
    insert into public.audit_log
      (school_id, actor_id, action, target_table, target_id, details)
    values
      (v_school_id, v_uid, 'edit_remove', 'mission_completions', v_completion,
       jsonb_build_object(
         'class_id', p_class_id,
         'mission_id', p_mission_id,
         'student_id', v_student_id,
         'reason', 'removed by edit',
         'reversed_completion_ids', jsonb_build_array(v_completion::text)
       ));

    -- Reverse the row; only status changes, so the original proof of who
    -- confirmed what stays intact (0004 contract B, Requirement 4.4-4.8).
    update public.mission_completions mc
       set status = 'reversed'
     where mc.id = v_completion;

    v_removed := v_removed + 1;
  end loop;

  -- 6. Exactly one 'edit' summary audit entry when at least one row changed
  --    (Requirement 36.4). Saving an edit that changes nothing writes no entry,
  --    keeping the operation idempotent.
  if v_confirmed > 0 or v_reapproved > 0 or v_removed > 0 then
    insert into public.audit_log
      (school_id, actor_id, action, target_table, target_id, details)
    values
      (v_school_id, v_uid, 'edit', 'mission_completions', p_mission_id,
       jsonb_build_object(
         'class_id', p_class_id,
         'mission_id', p_mission_id,
         'present_student_ids', to_jsonb(v_ids),
         'confirmed_count', v_confirmed,
         'reapproved_count', v_reapproved,
         'removed_count', v_removed
       ));
  end if;
end;
$$;

-- Callable by signed-in users only; the in-body check restricts it to the
-- owning teacher. service_role may call it for tooling. anon is denied.
revoke all on function public.edit_mission_participants(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.edit_mission_participants(uuid, uuid, uuid[]) to authenticated, service_role;
