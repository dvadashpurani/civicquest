-- 0008_undo.sql
-- CivicQuest core-loop RPC: undo_mission.
-- Source: design.md "Security-Invoker RPC Functions", "Common preamble for all
-- five RPCs", "In-body ownership checks", and "undo_mission"
-- (Requirements 4.5, 4.7, 4.8, 21.6, 21.7, 21.8, 21.9, 36.4).
--
-- This is the third of the five security-invoker write RPCs. It follows the
-- contract documented in 0004_triggers.sql exactly and mirrors the shape of
-- 0006_confirm.sql / 0007_edit.sql:
--   * The ONLY setting it touches is the constant 'civicquest.via_rpc' set to
--     'on', transaction-local (third arg true). There is no second set_config,
--     so the task 7.4 pg_proc scan still finds set_config only in the five RPC
--     names with that one constant (contract B / design "Why the client cannot
--     set the flag itself").
--   * It is `security invoker`: it runs with the caller's privileges and RLS,
--     so the teacher's / admin's policies, the direct-write guard, and the
--     protection trigger all apply to every row it writes (design "Why security
--     invoker here").
--   * search_path = '', fully qualified names, no dynamic SQL (Requirement
--     33.3). All actor/time fields are server-set; the client supplies only the
--     class id, mission id, and a reason string.
--
-- What undo_mission does (design "undo_mission"): it reverses ALL of the
-- mission's currently APPROVED completions for the class in one transaction.
-- The class_town / student_stamps / class_points views then naturally drop the
-- building, stamps, and points, and the next-not-yet-confirmed lookup selects
-- the mission again, returning it to "not done" (Requirement 21.8). A later
-- confirm_class_mission call restores the exact prior state (Requirement 15.2).
--
-- Caller rules (design "In-body ownership checks", Requirements 4.5, 21.7,
-- 21.9):
--   * TEACHER who owns the class: allowed only while the mission's confirmation
--     is < 24h old, and p_reason must be EXACTLY one of the three permitted
--     reasons. The confirmation time is min(confirmed_at) over the mission's
--     currently approved completions for the class (design
--     class_recent_confirmation), the same window computation used by
--     edit_mission_participants in 0007.
--   * ADMIN of the class's school: may undo at ANY age (no time limit), with a
--     free-text p_reason of 1-500 characters.
--   * Any other caller (non-owning teacher, admin of another school, wrong
--     role) is rejected with no side effects.
--
-- Reversal contract (0004_triggers.sql contract B, Requirements 4.7, 4.8): the
-- protection trigger requires, per reversed row, exactly one audit_log entry by
-- this actor in this transaction whose details carry a valid 'reason' (1-500
-- chars, not only whitespace) and a 'reversed_completion_ids' JSON array
-- containing that row's id. Because a single undo reverses MANY rows, this RPC
-- writes ONE 'undo' audit entry whose 'reversed_completion_ids' lists ALL of
-- the reversed completion ids, and that entry MUST be inserted BEFORE the rows
-- are updated to reversed. No completion id appears in more than one entry
-- (there is only one entry). This is exactly the undo_mission shape documented
-- in contract B: "insert ONE entry (action 'undo', target_id = mission id,
-- details {reason, mission_id, class_id, reversed_completion_ids: [all of
-- them]}), then update them all."
--
-- Audit entry (Requirement 36.4 — data change + audit in one transaction):
--   * one 'undo' entry per successful call, target_id = mission id, details
--     {class_id, mission_id, reason, reversed_completion_ids: [all reversed ids],
--      reversed_count}.
-- Everything runs in the function's single implicit transaction, so the data
-- changes and the audit entry commit together or roll back together. If there
-- is no approved completion to reverse, the call is a validated no-op: it
-- writes no audit entry and changes nothing.

create or replace function public.undo_mission(
  p_class_id uuid,
  p_mission_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_school_id   uuid;
  v_is_admin    boolean := false;
  v_is_teacher  boolean := false;
  v_first_conf  timestamptz;
  v_ids         uuid[];
  v_id_strings  jsonb;
  v_reason      text;
begin
  -- 1. Make the via_rpc flag transaction-local so the direct-write guard and
  --    the protection trigger accept the approved -> reversed transitions below.
  perform set_config('civicquest.via_rpc', 'on', true);

  -- 2. A signed-in user is required (Requirement 32.3).
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  -- 3a. In-body role/ownership check. The caller is EITHER the class's teacher
  --     OR an admin of the class's school. Read under the caller's own RLS
  --     (design "In-body ownership checks"). v_school_id is the class's school.
  select c.school_id,
         coalesce(public.app_role() = 'admin'
                  and c.school_id = public.app_school_id(), false),
         coalesce(public.app_role() = 'teacher'
                  and c.teacher_id = v_uid, false)
    into v_school_id, v_is_admin, v_is_teacher
    from public.classes c
   where c.id = p_class_id;

  if v_school_id is null or not (v_is_admin or v_is_teacher) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- 3b. The mission must belong to the module assigned to this class, so an
  --     unrelated mission id cannot be undone against this class.
  if not exists (
       select 1
         from public.class_modules cm
         join public.modules mo on mo.id = cm.module_id
         join public.missions mi on mi.module_id = mo.id
        where cm.class_id = p_class_id
          and mi.id = p_mission_id
     ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- 3c. Reason validation (Requirements 21.7, 4.7, 4.8).
  --     * TEACHER: p_reason must be EXACTLY one of the three permitted reasons.
  --     * ADMIN:   p_reason must be a 1-500 character non-whitespace string.
  v_reason := p_reason;
  if v_is_teacher and not v_is_admin then
    if v_reason is distinct from 'pressed by mistake'
       and v_reason is distinct from 'the activity didn''t happen'
       and v_reason is distinct from 'wrong class' then
      raise exception 'an undo reason must be one of the three permitted reasons'
        using errcode = '22023';
    end if;
  else
    -- Admin (or admin who is also owning teacher): free text, 1-500 chars,
    -- not only whitespace. This mirrors the protection trigger's reason rule.
    if v_reason is null
       or char_length(v_reason) < 1
       or char_length(v_reason) > 500
       or btrim(v_reason) = '' then
      raise exception 'an undo reason of 1-500 characters is required'
        using errcode = '22023';
    end if;
  end if;

  -- 3d. 24-hour window for TEACHER callers (Requirements 21.9, 4.5). The
  --     confirmation time is min(confirmed_at) over the mission's currently
  --     approved completions for this class (design class_recent_confirmation),
  --     the same window computation as edit_mission_participants in 0007. An
  --     admin has no time limit, so this guard is skipped for admins.
  if v_is_teacher and not v_is_admin then
    select min(mc.confirmed_at)
      into v_first_conf
      from public.mission_completions mc
     where mc.mission_id = p_mission_id
       and mc.class_id = p_class_id
       and mc.status = 'approved';

    if v_first_conf is null or now() - v_first_conf >= interval '24 hours' then
      raise exception 'the 24-hour undo window for this mission has passed'
        using errcode = '42501';
    end if;
  end if;

  -- 4. Collect ALL currently approved completion ids for this mission and
  --    class. These are the rows to reverse. If there are none, the undo is a
  --    validated no-op (nothing to reverse, no audit entry).
  select array(
           select mc.id
             from public.mission_completions mc
            where mc.mission_id = p_mission_id
              and mc.class_id = p_class_id
              and mc.status = 'approved'
            order by mc.id
         )
    into v_ids;

  if v_ids is null or array_length(v_ids, 1) is null then
    return;
  end if;

  -- 5. Build the reversed_completion_ids array (strings) for the ONE audit
  --    entry (contract B). Because one undo reverses many rows, this single
  --    entry must list EVERY reversed completion id.
  select jsonb_agg(id::text order by id)
    into v_id_strings
    from unnest(v_ids) as id;

  -- 6. Insert the ONE 'undo' audit entry BEFORE updating the rows, so the
  --    protection trigger finds exactly one entry by this actor in this
  --    transaction that lists each reversed row's id with a valid reason
  --    (contract B, Requirements 4.7, 4.8, 36.4).
  insert into public.audit_log
    (school_id, actor_id, action, target_table, target_id, details)
  values
    (v_school_id, v_uid, 'undo', 'mission_completions', p_mission_id,
     jsonb_build_object(
       'class_id', p_class_id,
       'mission_id', p_mission_id,
       'reason', v_reason,
       'reversed_completion_ids', v_id_strings,
       'reversed_count', array_length(v_ids, 1)
     ));

  -- 7. Reverse ALL of the approved completions. Only status changes, so the
  --    original proof of who confirmed what stays intact (0004 contract B,
  --    Requirements 4.4-4.8, 21.8). The protection trigger allows each
  --    approved -> reversed because via_rpc is 'on', the caller is the class's
  --    teacher or school admin, and the single audit entry above covers every
  --    row with a valid reason.
  update public.mission_completions mc
     set status = 'reversed'
   where mc.id = any (v_ids);
end;
$$;

-- Callable by signed-in users only; the in-body check restricts it to the
-- owning teacher or the class's school admin. service_role may call it for
-- tooling. anon is denied.
revoke all on function public.undo_mission(uuid, uuid, text) from public, anon;
grant execute on function public.undo_mission(uuid, uuid, text) to authenticated, service_role;
