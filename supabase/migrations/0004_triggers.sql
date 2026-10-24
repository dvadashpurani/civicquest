-- 0004_triggers.sql
-- CivicQuest protection triggers: audit_log immutability, the via_rpc
-- direct-write guard, mission_completions protection, and no-delete.
-- Source: design.md "Triggers", "Service-role exemption", "Security-Invoker
-- RPC Functions" (Requirements 4.1–4.9, 32.2, 32.4, 32.5, 36.4).
--
-- ===========================================================================
-- CONTRACT FOR THE RPCs (tasks 7.1–7.3, 11.1, 11.2 MUST follow this)
-- ===========================================================================
--
-- A. Direct-write guard. Every insert/update on mission_completions, checkins,
--    and audit_log raises "writes to this table must go through CivicQuest
--    actions" unless current_setting('civicquest.via_rpc', true) = 'on'
--    (set only by the five RPCs' preamble) or current_user = 'service_role'
--    (seed, demo reset, admin invites). audit_log additionally accepts
--    current_user = 'postgres', i.e. our security definer functions such as
--    regenerate_opportunity_token, which run as their owner. Consequence:
--    server actions never insert audit_log rows through the user client; they
--    go through an RPC, a definer function, or the admin (service role) client.
--
-- B. Reversal reason and "exactly one audit_log entry" (Requirements 4.7,
--    4.8). The reason lives in audit_log, not in a column or a second setting.
--    There is NO second set_config: the only setting any function sets is the
--    constant 'civicquest.via_rpc', so the task 7.4 pg_proc scan is unchanged.
--    Before an RPC moves a completion approved -> reversed it MUST insert, in
--    the same transaction, exactly one audit_log row that covers it:
--      actor_id     = auth.uid()              (the audit_log_insert policy
--                                              already requires this)
--      created_at   = default now()           (do not pass created_at)
--      target_table = 'mission_completions'
--      details      = jsonb with
--                       'reason'                  text, 1–500 characters,
--                                                 not only whitespace
--                       'reversed_completion_ids' jsonb array of completion
--                                                 id strings being reversed
--    The protection trigger then checks, per reversed row, that exactly one
--    entry by this actor in this transaction (created_at = now()) lists the
--    row's id in reversed_completion_ids, with a valid reason. Zero entries or
--    a bad reason -> "a valid reversal reason (1-500 characters) is required";
--    two or more -> rejected. The trigger itself writes NO audit rows, so there
--    are never duplicate entries.
--      * undo_mission (7.3): select the approved completion ids for the
--        mission and class, insert ONE entry (action 'undo', target_id =
--        mission id, details {reason, mission_id, class_id,
--        reversed_completion_ids: [all of them]}), then update them all.
--      * edit_mission_participants (7.2): ONE entry PER removed student
--        (action 'edit_remove', target_id = completion id, details {reason:
--        'removed by edit', reversed_completion_ids: [that id], ...}), then
--        update. Re-added students get their own 're_approve' entries, which
--        must NOT contain 'reversed_completion_ids'.
--      * Do not mention a completion id in reversed_completion_ids of more
--        than one entry in the same transaction.
--
-- C. Transitions into 'approved' (insert, or reversed -> approved on upsert)
--    require via_rpc = 'on', the caller to be the class's teacher or a school
--    admin, confirmed_by = auth.uid(), and confirmed_at = now(). The RPCs
--    always set exactly these server values (Requirement 32.4).
--
-- D. Only service_role is exempt from the guard and the protection trigger.
--    No role is exempt from audit_log immutability or the no-delete rule on
--    mission_completions. Seed and demo reset must therefore restore state by
--    insert/update (e.g. re-approve or reverse rows as service_role), never by
--    deleting completions or audit rows. Because FK actions run as the table
--    owner (postgres, not service_role), deleting an auth user/profile that
--    authored audit entries (actor_id set null) or confirmed completions
--    (confirmed_by set null) is rejected, as is deleting a student, class,
--    mission, or school that has completions or audit rows. Proof is kept.
--
-- Other enforced rules:
--   * mission_completions identity fields (id, mission_id, student_id,
--     class_id, created_at) never change after insert, so a completion cannot
--     be moved to another student or class.
--   * Approved -> reversed changes only status; points_awarded, confirmed_by,
--     and confirmed_at keep the original proof of who confirmed what.
--   * Allowed transitions: approved -> reversed, reversed -> approved, and
--     inserts as 'pending' (default protected values) or 'approved'. Every
--     other transition (including pending -> approved/rejected for future
--     photo/quiz review flows) is rejected until a later migration extends
--     this trigger.
--   * delete is revoked from anon/authenticated on mission_completions, so a
--     client delete raises a permission error; the trigger covers every
--     privileged role. Same pattern as audit_log update/delete (revoked in
--     0002, trigger here).
--
-- All trigger functions live in the private schema (not exposed via
-- PostgREST), are security invoker (so current_user, auth.uid(), and RLS are
-- the caller's), use search_path = '' with fully qualified names, and have
-- execute revoked from every client role. Postgres checks EXECUTE on a trigger
-- function only when the trigger is created, not when it fires.

create schema if not exists private;

-- Supports the reversal-entry lookup below and per-actor proof log reads.
create index if not exists audit_log_actor_created_at_idx
  on public.audit_log (actor_id, created_at);

-- ---------------------------------------------------------------------------
-- 1. audit_log immutability (Requirements 4.1, 4.2). No role is exempt.
-- ---------------------------------------------------------------------------

create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log rows are immutable' using errcode = '42501';
end;
$$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- ---------------------------------------------------------------------------
-- 2. audit_log insert guard (contract A). Closes the gap where a signed-in
--    user could insert arbitrary audit rows with the REST API.
-- ---------------------------------------------------------------------------

-- Statement-level, so it raises even when the statement matches zero rows.
create or replace function private.audit_log_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres')
     or coalesce(current_setting('civicquest.via_rpc', true), '') = 'on' then
    return null;
  end if;
  raise exception 'writes to this table must go through CivicQuest actions'
    using errcode = '42501';
end;
$$;

create trigger audit_log_10_insert_guard
  before insert on public.audit_log
  for each statement execute function private.audit_log_insert_guard();

-- ---------------------------------------------------------------------------
-- 3. Direct-write guard on mission_completions and checkins (Requirements
--    32.2, 32.4, 32.5, 36.4). Only the RPCs (via_rpc flag) and service_role
--    may write. Not exempt: anon, authenticated, postgres.
--    Statement-level: it fires once per insert/update statement before any
--    row is touched, even when RLS hides every row (e.g. a teacher's direct
--    update on checkins), so every direct write raises rather than silently
--    matching zero rows. Statement-level BEFORE triggers also always fire
--    before the row-level protection trigger below. An
--    insert ... on conflict do update fires both the insert and the update
--    statement triggers.
-- ---------------------------------------------------------------------------

create or replace function private.guard_direct_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role'
     or coalesce(current_setting('civicquest.via_rpc', true), '') = 'on' then
    return null;
  end if;
  raise exception 'writes to this table must go through CivicQuest actions'
    using errcode = '42501';
end;
$$;

create trigger mission_completions_10_via_rpc_guard
  before insert or update on public.mission_completions
  for each statement execute function private.guard_direct_write();

create trigger checkins_10_via_rpc_guard
  before insert or update on public.checkins
  for each statement execute function private.guard_direct_write();

-- ---------------------------------------------------------------------------
-- 4. mission_completions protection (Requirements 4.3–4.8). service_role is
--    exempt (seed and demo reset write approved history directly).
-- ---------------------------------------------------------------------------

create or replace function private.protect_mission_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid        uuid    := auth.uid();
  v_via_rpc    boolean := coalesce(current_setting('civicquest.via_rpc', true), '') = 'on';
  v_is_admin   boolean := false;
  v_is_teacher boolean := false;
  v_entries    integer;
  v_reason_ok  boolean;
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Identity never changes: a completion cannot move to another student,
    -- mission, or class.
    if (new.id, new.mission_id, new.student_id, new.class_id, new.created_at)
       is distinct from
       (old.id, old.mission_id, old.student_id, old.class_id, old.created_at) then
      raise exception 'completion identity fields cannot be changed'
        using errcode = '42501';
    end if;

    -- No protected column changes: nothing to check here (RLS still applies).
    if (new.status, new.points_awarded, new.confirmed_by, new.confirmed_at)
       is not distinct from
       (old.status, old.points_awarded, old.confirmed_by, old.confirmed_at) then
      return new;
    end if;
  else
    -- INSERT with default protected values (status pending, no points, not
    -- confirmed) needs no extra authority (Requirement 32.5).
    if new.status = 'pending'
       and new.points_awarded = 0
       and new.confirmed_by is null
       and new.confirmed_at is null then
      return new;
    end if;
  end if;

  -- Protected columns are changing: caller must be the class's teacher or an
  -- admin of the class's school (Requirement 4.3). Read under the caller's RLS.
  if v_uid is not null then
    select coalesce(public.app_role() = 'admin' and c.school_id = public.app_school_id(), false),
           coalesce(public.app_role() = 'teacher' and c.teacher_id = v_uid, false)
      into v_is_admin, v_is_teacher
      from public.classes c
     where c.id = new.class_id;
  end if;

  if not (coalesce(v_is_admin, false) or coalesce(v_is_teacher, false)) then
    raise exception 'not authorized to change protected completion fields'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- Insert as approved: only inside an RPC, with server-set actor and time.
    if new.status = 'approved'
       and v_via_rpc
       and new.confirmed_by = v_uid
       and new.confirmed_at = now()
       and new.points_awarded >= 0 then
      return new;
    end if;
    raise exception 'completion status change not permitted'
      using errcode = '42501';
  end if;

  -- approved -> reversed (Requirements 4.4–4.8)
  if old.status = 'approved' and new.status = 'reversed' then
    -- Only status changes; the original proof stays intact.
    if (new.points_awarded, new.confirmed_by, new.confirmed_at)
       is distinct from
       (old.points_awarded, old.confirmed_by, old.confirmed_at) then
      raise exception 'completion status change not permitted'
        using errcode = '42501',
              detail = 'A reversal may change only status.';
    end if;

    -- Teacher: within 24 hours of confirmed_at. Admin: no time limit.
    if not v_is_admin
       and (old.confirmed_at is null or now() - old.confirmed_at >= interval '24 hours') then
      raise exception 'completion status change not permitted'
        using errcode = '42501',
              detail = 'The 24-hour window for the teacher has passed.';
    end if;

    -- Exactly one audit_log entry in this transaction covers this row and
    -- carries a 1–500 character reason (contract B).
    select count(*)::integer,
           coalesce(bool_and(
             a.details->>'reason' is not null
             and char_length(a.details->>'reason') between 1 and 500
             and btrim(a.details->>'reason') <> ''
           ), false)
      into v_entries, v_reason_ok
      from public.audit_log a
     where a.actor_id = v_uid
       and a.created_at = now()
       and a.target_table = 'mission_completions'
       and jsonb_typeof(a.details->'reversed_completion_ids') = 'array'
       and a.details->'reversed_completion_ids' @> jsonb_build_array(new.id::text);

    if v_entries > 1 then
      raise exception 'completion status change not permitted'
        using errcode = '42501',
              detail = 'Exactly one audit_log entry must record each reversal.';
    end if;

    if v_entries = 0 or not v_reason_ok then
      raise exception 'a valid reversal reason (1-500 characters) is required'
        using errcode = '22023';
    end if;

    return new;
  end if;

  -- reversed -> approved: only inside confirm/edit RPCs, with fresh server
  -- values (design "Triggers").
  if old.status = 'reversed' and new.status = 'approved' then
    if v_via_rpc
       and new.confirmed_by = v_uid
       and new.confirmed_at = now()
       and new.points_awarded >= 0 then
      return new;
    end if;
    raise exception 'completion status change not permitted'
      using errcode = '42501';
  end if;

  -- Every other transition, and protected-column edits without a status
  -- change, are rejected (Requirement 4.6).
  raise exception 'completion status change not permitted'
    using errcode = '42501';
end;
$$;

create trigger mission_completions_20_protect
  before insert or update on public.mission_completions
  for each row execute function private.protect_mission_completion();

-- ---------------------------------------------------------------------------
-- 5. mission_completions are never deleted (Requirement 4.9). No role exempt.
-- ---------------------------------------------------------------------------

create or replace function private.mission_completions_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'mission completions cannot be deleted' using errcode = '42501';
end;
$$;

create trigger mission_completions_30_no_delete
  before delete on public.mission_completions
  for each row execute function private.mission_completions_no_delete();

create trigger mission_completions_no_truncate
  before truncate on public.mission_completions
  for each statement execute function private.mission_completions_no_delete();

-- Clients have no delete policy (0002); removing the privilege makes a client
-- delete raise instead of silently matching zero rows.
revoke delete on public.mission_completions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger functions are not callable by any client role.
-- ---------------------------------------------------------------------------

revoke all on function private.audit_log_immutable()            from public, anon, authenticated;
revoke all on function private.audit_log_insert_guard()         from public, anon, authenticated;
revoke all on function private.guard_direct_write()             from public, anon, authenticated;
revoke all on function private.protect_mission_completion()     from public, anon, authenticated;
revoke all on function private.mission_completions_no_delete()  from public, anon, authenticated;
