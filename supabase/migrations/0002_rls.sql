-- 0002_rls.sql
-- CivicQuest Row Level Security: helper functions and per-role policies.
-- Source: docs/build-prompt.md section 3 "Row Level Security"; design.md
-- "RLS helper functions" (Requirements 3.1–3.6, 3.8–3.10, 4.1).
--
-- Scope: helpers + RLS policies + privilege hardening only.
--   * qr_token column privileges, token functions, partner_checkin_students,
--     and the private schema are added in 0003 (task 1.6).
--   * audit_log immutability, completion protection, and the via_rpc
--     direct-write guard triggers are added in 0004 (task 1.7).
--
-- Conventions:
--   * Every policy targets `authenticated` only. `anon` matches no policy, so
--     every table is deny-all for anonymous callers.
--   * Helper calls are wrapped as `(select public.app_role())` so Postgres
--     evaluates them once per statement (initPlan), not once per row.
--   * One policy per table per command; role branches are OR-ed inside it.
--   * Partners get NO policy on `students` (Requirement 3.7 is served only by
--     the column-limited surface in 0003).
--   * Cross-school rows never match any branch, so they return zero rows
--     (Requirement 3.10).

-- ---------------------------------------------------------------------------
-- Helper functions (Requirement 3.2)
-- security definer: they read profiles/students for auth.uid() without the
-- caller needing read access to those rows; each returns one scalar only.
-- They run as the table owner (postgres), which bypasses RLS, so policies on
-- profiles/students that call them cannot recurse.
-- ---------------------------------------------------------------------------

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- School of the caller. Partners never get a school (returns null), so a
-- misconfigured partner profile cannot gain school-scoped access. For a Leader
-- (role student) the linked students row is the source of truth.
create or replace function public.app_school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p.role = 'partner' then null
           when p.role = 'student' then (
             select s.school_id
             from public.students s
             where s.auth_user_id = p.id
           )
           else p.school_id
         end
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Partner organization of the caller; null for every non-partner role.
create or replace function public.app_partner_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.partner_org_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.role = 'partner';
$$;

-- Student row linked to the caller; null unless the caller's role is student.
create or replace function public.app_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.students s
  join public.profiles p on p.id = s.auth_user_id
  where s.auth_user_id = (select auth.uid())
    and p.role = 'student';
$$;

revoke all on function public.app_role()           from public, anon;
revoke all on function public.app_school_id()      from public, anon;
revoke all on function public.app_partner_org_id() from public, anon;
revoke all on function public.app_student_id()     from public, anon;
grant execute on function public.app_role()           to authenticated, service_role;
grant execute on function public.app_school_id()      to authenticated, service_role;
grant execute on function public.app_partner_org_id() to authenticated, service_role;
grant execute on function public.app_student_id()     to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table (Requirement 3.1). Already enabled in 0001;
-- repeated here so this file alone guarantees it.
-- ---------------------------------------------------------------------------

alter table public.schools             enable row level security;
alter table public.partner_orgs        enable row level security;
alter table public.school_partners     enable row level security;
alter table public.profiles            enable row level security;
alter table public.classes             enable row level security;
alter table public.class_rewards       enable row level security;
alter table public.students            enable row level security;
alter table public.modules             enable row level security;
alter table public.missions            enable row level security;
alter table public.class_modules       enable row level security;
alter table public.mission_completions enable row level security;
alter table public.opportunities       enable row level security;
alter table public.checkins            enable row level security;
alter table public.badges              enable row level security;
alter table public.student_badges      enable row level security;
alter table public.audit_log           enable row level security;
alter table public.rate_limits         enable row level security;

-- ---------------------------------------------------------------------------
-- Privilege hardening
-- ---------------------------------------------------------------------------

-- TRUNCATE bypasses RLS and row triggers; clients never need it.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- rate_limits is managed only by a security definer helper (0003). No client
-- privileges and no policies.
revoke all on public.rate_limits from anon, authenticated;

-- audit_log is append-only for clients (Requirement 4.1). Row-level enforcement
-- of immutability (all roles) is the 0004 trigger.
revoke update, delete on public.audit_log from anon, authenticated;

-- students: clients may never set auth_user_id (Leader logins are linked only
-- by the server with the service role), id, or school_id on update. Table-level
-- insert/update are revoked so the column lists below are the only grants.
revoke insert, update on public.students from anon, authenticated;
grant insert (school_id, class_id, first_name, last_initial, grade, login_code, avatar, kid_theme)
  on public.students to authenticated;
grant update (class_id, first_name, last_initial, grade, avatar, kid_theme)
  on public.students to authenticated;

-- ---------------------------------------------------------------------------
-- schools
-- ---------------------------------------------------------------------------

create policy schools_select on public.schools
  for select to authenticated
  using (id = (select public.app_school_id()));

-- ---------------------------------------------------------------------------
-- partner_orgs: own org (partner) or orgs linked to the caller's school.
-- ---------------------------------------------------------------------------

create policy partner_orgs_select on public.partner_orgs
  for select to authenticated
  using (
    id = (select public.app_partner_org_id())
    or exists (
      select 1 from public.school_partners sp
      where sp.partner_org_id = partner_orgs.id
        and sp.school_id = (select public.app_school_id())
    )
  );

-- ---------------------------------------------------------------------------
-- school_partners
-- ---------------------------------------------------------------------------

create policy school_partners_select on public.school_partners
  for select to authenticated
  using (
    school_id = (select public.app_school_id())
    or partner_org_id = (select public.app_partner_org_id())
  );

-- ---------------------------------------------------------------------------
-- profiles
-- Everyone reads their own row; admin/counselor read their school's profiles.
-- Admin inserts/updates profiles in their own school only. Admins can never
-- create or edit partner profiles (no partner_org_id, role <> partner), so an
-- admin cannot grant anyone access to a partner org's data. No delete policy:
-- profiles are removed only by deleting the auth user (server side).
-- ---------------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (
      (select public.app_role()) in ('admin', 'counselor')
      and school_id = (select public.app_school_id())
    )
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    (select public.app_role()) = 'admin'
    and school_id = (select public.app_school_id())
    and partner_org_id is null
    and role <> 'partner'
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    (select public.app_role()) = 'admin'
    and school_id = (select public.app_school_id())
  )
  with check (
    (select public.app_role()) = 'admin'
    and school_id = (select public.app_school_id())
    and partner_org_id is null
    and role <> 'partner'
  );

-- ---------------------------------------------------------------------------
-- classes
-- Admin/counselor read own school; teacher reads own classes. Admin writes own
-- school's classes, assigning only teachers from the same school. Teacher may
-- create/update a class only as its own teacher in its own school.
-- ---------------------------------------------------------------------------

create policy classes_select on public.classes
  for select to authenticated
  using (
    school_id = (select public.app_school_id())
    and (
      (select public.app_role()) in ('admin', 'counselor')
      or ((select public.app_role()) = 'teacher' and teacher_id = (select auth.uid()))
    )
  );

create policy classes_insert on public.classes
  for insert to authenticated
  with check (
    school_id = (select public.app_school_id())
    and (
      (
        (select public.app_role()) = 'admin'
        and (
          classes.teacher_id is null
          or exists (
            select 1 from public.profiles p
            where p.id = classes.teacher_id
              and p.role = 'teacher'
              and p.school_id = (select public.app_school_id())
          )
        )
      )
      or ((select public.app_role()) = 'teacher' and teacher_id = (select auth.uid()))
    )
  );

create policy classes_update on public.classes
  for update to authenticated
  using (
    school_id = (select public.app_school_id())
    and (
      (select public.app_role()) = 'admin'
      or ((select public.app_role()) = 'teacher' and teacher_id = (select auth.uid()))
    )
  )
  with check (
    school_id = (select public.app_school_id())
    and (
      (
        (select public.app_role()) = 'admin'
        and (
          classes.teacher_id is null
          or exists (
            select 1 from public.profiles p
            where p.id = classes.teacher_id
              and p.role = 'teacher'
              and p.school_id = (select public.app_school_id())
          )
        )
      )
      or ((select public.app_role()) = 'teacher' and teacher_id = (select auth.uid()))
    )
  );

create policy classes_delete on public.classes
  for delete to authenticated
  using (
    (select public.app_role()) = 'admin'
    and school_id = (select public.app_school_id())
  );

-- ---------------------------------------------------------------------------
-- class_rewards
-- ---------------------------------------------------------------------------

create policy class_rewards_select on public.class_rewards
  for select to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_rewards.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) in ('admin', 'counselor')
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

create policy class_rewards_insert on public.class_rewards
  for insert to authenticated
  with check (
    exists (
      select 1 from public.classes c
      where c.id = class_rewards.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

create policy class_rewards_update on public.class_rewards
  for update to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_rewards.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from public.classes c
      where c.id = class_rewards.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

create policy class_rewards_delete on public.class_rewards
  for delete to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_rewards.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- students (no partner access of any kind)
-- Admin/counselor read own school; teacher reads students in owned classes;
-- Leader reads only their own row. Admin writes own school; teacher inserts/
-- updates only students in classes they own. Delete is admin-only.
-- ---------------------------------------------------------------------------

create policy students_select on public.students
  for select to authenticated
  using (
    (
      (select public.app_role()) in ('admin', 'counselor')
      and school_id = (select public.app_school_id())
    )
    or (
      (select public.app_role()) = 'teacher'
      and school_id = (select public.app_school_id())
      and exists (
        select 1 from public.classes c
        where c.id = students.class_id
          and c.teacher_id = (select auth.uid())
      )
    )
    or (
      (select public.app_role()) = 'student'
      and id = (select public.app_student_id())
    )
  );

create policy students_insert on public.students
  for insert to authenticated
  with check (
    school_id = (select public.app_school_id())
    and (
      (
        (select public.app_role()) = 'admin'
        and (
          students.class_id is null
          or exists (
            select 1 from public.classes c
            where c.id = students.class_id
              and c.school_id = (select public.app_school_id())
          )
        )
      )
      or (
        (select public.app_role()) = 'teacher'
        and exists (
          select 1 from public.classes c
          where c.id = students.class_id
            and c.school_id = (select public.app_school_id())
            and c.teacher_id = (select auth.uid())
        )
      )
    )
  );

create policy students_update on public.students
  for update to authenticated
  using (
    school_id = (select public.app_school_id())
    and (
      (select public.app_role()) = 'admin'
      or (
        (select public.app_role()) = 'teacher'
        and exists (
          select 1 from public.classes c
          where c.id = students.class_id
            and c.teacher_id = (select auth.uid())
        )
      )
    )
  )
  with check (
    school_id = (select public.app_school_id())
    and (
      (
        (select public.app_role()) = 'admin'
        and (
          students.class_id is null
          or exists (
            select 1 from public.classes c
            where c.id = students.class_id
              and c.school_id = (select public.app_school_id())
          )
        )
      )
      or (
        (select public.app_role()) = 'teacher'
        and exists (
          select 1 from public.classes c
          where c.id = students.class_id
            and c.school_id = (select public.app_school_id())
            and c.teacher_id = (select auth.uid())
        )
      )
    )
  );

create policy students_delete on public.students
  for delete to authenticated
  using (
    (select public.app_role()) = 'admin'
    and school_id = (select public.app_school_id())
  );

-- ---------------------------------------------------------------------------
-- modules and missions: shared content (school_id is null) is readable by any
-- signed-in user (Requirement 3.9); school-specific content only by that
-- school. No client writes.
-- ---------------------------------------------------------------------------

create policy modules_select on public.modules
  for select to authenticated
  using (
    school_id is null
    or school_id = (select public.app_school_id())
  );

create policy missions_select on public.missions
  for select to authenticated
  using (
    exists (
      select 1 from public.modules m
      where m.id = missions.module_id
        and (m.school_id is null or m.school_id = (select public.app_school_id()))
    )
  );

-- ---------------------------------------------------------------------------
-- class_modules
-- ---------------------------------------------------------------------------

create policy class_modules_select on public.class_modules
  for select to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_modules.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) in ('admin', 'counselor')
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

create policy class_modules_insert on public.class_modules
  for insert to authenticated
  with check (
    exists (
      select 1 from public.classes c
      where c.id = class_modules.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
    and exists (
      select 1 from public.modules m
      where m.id = class_modules.module_id
        and (m.school_id is null or m.school_id = (select public.app_school_id()))
    )
  );

create policy class_modules_update on public.class_modules
  for update to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_modules.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from public.classes c
      where c.id = class_modules.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
    and exists (
      select 1 from public.modules m
      where m.id = class_modules.module_id
        and (m.school_id is null or m.school_id = (select public.app_school_id()))
    )
  );

create policy class_modules_delete on public.class_modules
  for delete to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_modules.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- mission_completions
-- Read: admin/counselor (own school), teacher (owned classes), Leader (own).
-- Insert: teacher for a student of an owned class (via confirm/edit RPCs).
-- Update: teacher (owned classes) and admin (own school, for undo). Column and
-- status-transition rules are enforced by the 0004 triggers. No delete policy.
-- ---------------------------------------------------------------------------

create policy mission_completions_select on public.mission_completions
  for select to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = mission_completions.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) in ('admin', 'counselor')
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
    or (
      (select public.app_role()) = 'student'
      and student_id = (select public.app_student_id())
    )
  );

create policy mission_completions_insert on public.mission_completions
  for insert to authenticated
  with check (
    (select public.app_role()) = 'teacher'
    and exists (
      select 1 from public.classes c
      where c.id = mission_completions.class_id
        and c.school_id = (select public.app_school_id())
        and c.teacher_id = (select auth.uid())
    )
    and exists (
      select 1 from public.students s
      where s.id = mission_completions.student_id
        and s.class_id = mission_completions.class_id
    )
  );

create policy mission_completions_update on public.mission_completions
  for update to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = mission_completions.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1 from public.classes c
      where c.id = mission_completions.class_id
        and c.school_id = (select public.app_school_id())
        and (
          (select public.app_role()) = 'admin'
          or ((select public.app_role()) = 'teacher' and c.teacher_id = (select auth.uid()))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- opportunities
-- Partner reads/writes own org's rows. Leaders, admins, and counselors read
-- rows from partners linked to their school. qr_token column privileges are
-- applied in 0003. No delete policy: deleting would cascade away check-ins
-- and Leaders' verified hours.
-- ---------------------------------------------------------------------------

create policy opportunities_select on public.opportunities
  for select to authenticated
  using (
    partner_org_id = (select public.app_partner_org_id())
    or (
      (select public.app_role()) in ('student', 'admin', 'counselor')
      and exists (
        select 1 from public.school_partners sp
        where sp.partner_org_id = opportunities.partner_org_id
          and sp.school_id = (select public.app_school_id())
      )
    )
  );

create policy opportunities_insert on public.opportunities
  for insert to authenticated
  with check (
    (select public.app_role()) = 'partner'
    and partner_org_id = (select public.app_partner_org_id())
  );

create policy opportunities_update on public.opportunities
  for update to authenticated
  using (
    (select public.app_role()) = 'partner'
    and partner_org_id = (select public.app_partner_org_id())
  )
  with check (
    (select public.app_role()) = 'partner'
    and partner_org_id = (select public.app_partner_org_id())
  );

-- ---------------------------------------------------------------------------
-- checkins
-- Read: partner (own org's opportunities), Leader (own), admin/counselor (own
-- school's students). Insert: Leader, own row, for a school-linked
-- opportunity (via leader_scan). Update: Leader (own, check-out) and partner
-- (own org, approval). The 0004 via_rpc guard blocks direct writes.
-- ---------------------------------------------------------------------------

create policy checkins_select on public.checkins
  for select to authenticated
  using (
    exists (
      select 1 from public.opportunities o
      where o.id = checkins.opportunity_id
        and o.partner_org_id = (select public.app_partner_org_id())
    )
    or (
      (select public.app_role()) = 'student'
      and student_id = (select public.app_student_id())
    )
    or (
      (select public.app_role()) in ('admin', 'counselor')
      and exists (
        select 1 from public.students s
        where s.id = checkins.student_id
          and s.school_id = (select public.app_school_id())
      )
    )
  );

create policy checkins_insert on public.checkins
  for insert to authenticated
  with check (
    (select public.app_role()) = 'student'
    and student_id = (select public.app_student_id())
    and exists (
      select 1
      from public.opportunities o
      join public.school_partners sp on sp.partner_org_id = o.partner_org_id
      where o.id = checkins.opportunity_id
        and sp.school_id = (select public.app_school_id())
    )
  );

create policy checkins_update on public.checkins
  for update to authenticated
  using (
    (
      (select public.app_role()) = 'student'
      and student_id = (select public.app_student_id())
    )
    or (
      (select public.app_role()) = 'partner'
      and exists (
        select 1 from public.opportunities o
        where o.id = checkins.opportunity_id
          and o.partner_org_id = (select public.app_partner_org_id())
      )
    )
  )
  with check (
    (
      (select public.app_role()) = 'student'
      and student_id = (select public.app_student_id())
    )
    or (
      (select public.app_role()) = 'partner'
      and exists (
        select 1 from public.opportunities o
        where o.id = checkins.opportunity_id
          and o.partner_org_id = (select public.app_partner_org_id())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- badges (catalog, no student data) and student_badges
-- ---------------------------------------------------------------------------

create policy badges_select on public.badges
  for select to authenticated
  using (true);

create policy student_badges_select on public.student_badges
  for select to authenticated
  using (
    (
      (select public.app_role()) = 'student'
      and student_id = (select public.app_student_id())
    )
    or exists (
      select 1
      from public.students s
      join public.classes c on c.id = s.class_id
      where s.id = student_badges.student_id
        and s.school_id = (select public.app_school_id())
        and (select public.app_role()) = 'teacher'
        and c.teacher_id = (select auth.uid())
    )
    or (
      (select public.app_role()) in ('admin', 'counselor')
      and exists (
        select 1 from public.students s
        where s.id = student_badges.student_id
          and s.school_id = (select public.app_school_id())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- audit_log: insert and select policies only (Requirement 4.1).
-- Select: admin/counselor see their school's log; everyone else sees only
-- entries they wrote. Insert: the actor must be the caller, and the entry's
-- school must be the caller's school (partners: null or a linked school).
-- ---------------------------------------------------------------------------

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (
      (select public.app_role()) in ('admin', 'counselor')
      and school_id = (select public.app_school_id())
    )
  );

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (
      school_id = (select public.app_school_id())
      or (
        (select public.app_role()) = 'partner'
        and (
          audit_log.school_id is null
          or exists (
            select 1 from public.school_partners sp
            where sp.school_id = audit_log.school_id
              and sp.partner_org_id = (select public.app_partner_org_id())
          )
        )
      )
    )
  );

-- rate_limits: RLS enabled, intentionally no policies (deny-all to clients).
