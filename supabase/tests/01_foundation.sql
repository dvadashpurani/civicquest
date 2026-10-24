-- 01_foundation.sql
-- Step 1 security checks for 0002_rls.sql, 0003_opportunities_private.sql, and
-- 0004_triggers.sql (Requirements 3.3, 3.5, 3.7, 3.10, 4.1, 4.2, 4.3, 4.6,
-- 4.9, 25.2, 32.4). Run against the dev project via Supabase MCP.
--
-- How it works:
--   * One DO block, run by `postgres`. Fixtures (auth.users, profiles,
--     schools, classes, students, completions, check-ins, audit rows) are
--     inserted first. Completions and check-ins are written as service_role,
--     the only role the direct-write guard and protection trigger exempt.
--   * Each case impersonates a user with literal
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--     exactly as PostgREST does. `reset role` returns to postgres for
--     after-the-fact checks. The fixture users have fixed UUIDs so the claims
--     can be literal statements.
--   * "Inside an RPC" is simulated with `set local civicquest.via_rpc = 'on'`
--     (the constant flag the five RPCs set; see 0004 contract A).
--   * Every case is its own sub-block that ends by raising the sentinel
--     CQCAS, so its role, claims, flag, and writes all roll back before the
--     next case. The whole block ends with the sentinel CQRBK, so the
--     fixtures roll back too. PL/pgSQL variables survive rollbacks, so
--     failures are collected and reported at the end: the script succeeds
--     silently when every check passes and raises "foundation security test
--     failed" with the list of failing checks otherwise.
--   * Each negative check is paired with a positive control (the owner/admin
--     can see or do the thing), so a check cannot pass just because nothing
--     works.

do $$
declare
  failures  text[] := '{}';
  c_guard   constant text := 'writes to this table must go through CivicQuest actions';
  c_denied  constant text := 'completion status change not permitted';
  c_unauth  constant text := 'not authorized to change protected completion fields';
  c_reason  constant text := 'a valid reversal reason (1-500 characters) is required';
  c_immut   constant text := 'audit_log rows are immutable';
  c_nodel   constant text := 'mission completions cannot be deleted';

  -- Fixture users (fixed so the jwt claims can be literal SET statements).
  u_t1  constant uuid := 'c9f00000-0000-4000-8000-000000000001'; -- teacher, owns class A1
  u_t2  constant uuid := 'c9f00000-0000-4000-8000-000000000002'; -- teacher, same school, owns class A2
  u_adA constant uuid := 'c9f00000-0000-4000-8000-000000000003'; -- admin, school A
  u_adB constant uuid := 'c9f00000-0000-4000-8000-000000000004'; -- admin, school B
  u_pP  constant uuid := 'c9f00000-0000-4000-8000-000000000005'; -- partner, org P (linked to school A)
  u_pQ  constant uuid := 'c9f00000-0000-4000-8000-000000000006'; -- partner, org Q (unlinked)
  u_L   constant uuid := 'c9f00000-0000-4000-8000-000000000007'; -- Leader (student role), school A, grade 10

  v_school_a uuid; v_school_b uuid;
  v_org_p uuid; v_org_q uuid;
  v_class_a1 uuid; v_class_a2 uuid;
  v_s_leader uuid; v_s2 uuid; v_s3 uuid;
  v_module uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid;
  v_c_recent uuid;   -- approved 1 h ago, class A1 (teacher may reverse)
  v_c_late uuid;     -- approved 25 h ago, class A1 (teacher may not reverse)
  v_c_reversed uuid; -- reversed, class A1
  v_c_other uuid;    -- approved, class A2 (teacher 2's)
  v_c_leader uuid;   -- approved, the Leader's own completion
  v_opp uuid; v_opp2 uuid; v_token text;
  v_checkin uuid;
  v_audit bigint;

  n int;
  v_text text;
  v_detail text;
  v_keys text[];
  r record;
begin
  begin
    -- -----------------------------------------------------------------------
    -- Fixtures (as postgres, completions/check-ins as service_role)
    -- -----------------------------------------------------------------------
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'foundation-test-' || right(u::text, 2) || '@example.test', now(), now()
    from unnest(array[u_t1, u_t2, u_adA, u_adB, u_pP, u_pQ, u_L]) as u;

    insert into public.schools (name) values ('Foundation Test School A') returning id into v_school_a;
    insert into public.schools (name) values ('Foundation Test School B') returning id into v_school_b;
    insert into public.partner_orgs (name) values ('Foundation Test Partner P') returning id into v_org_p;
    insert into public.partner_orgs (name) values ('Foundation Test Partner Q') returning id into v_org_q;
    insert into public.school_partners (school_id, partner_org_id) values (v_school_a, v_org_p);

    insert into public.profiles (id, role, full_name, school_id, partner_org_id) values
      (u_t1,  'teacher', 'Test Teacher One', v_school_a, null),
      (u_t2,  'teacher', 'Test Teacher Two', v_school_a, null),
      (u_adA, 'admin',   'Test Admin A',     v_school_a, null),
      (u_adB, 'admin',   'Test Admin B',     v_school_b, null),
      (u_pP,  'partner', 'Test Partner P',   null, v_org_p),
      (u_pQ,  'partner', 'Test Partner Q',   null, v_org_q),
      (u_L,   'student', 'Test Leader',      v_school_a, null);

    insert into public.classes (school_id, name, grade, teacher_id)
      values (v_school_a, 'Foundation A1', 10, u_t1) returning id into v_class_a1;
    insert into public.classes (school_id, name, grade, teacher_id)
      values (v_school_a, 'Foundation A2', 10, u_t2) returning id into v_class_a2;

    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code, auth_user_id)
      values (v_school_a, v_class_a1, 'Lena', 'Q', 10, 'foundation-test-leader', u_L) returning id into v_s_leader;
    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school_a, v_class_a1, 'Ben', 'R', 10, 'foundation-test-s2') returning id into v_s2;
    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school_a, v_class_a2, 'Cara', 'S', 10, 'foundation-test-s3') returning id into v_s3;

    insert into public.modules (title, level, quality, week_order)
      values ('Foundation Test Module', 'leaders', 'Civic action', 1) returning id into v_module;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 1, 't1', 's', 'a', 'i', 'class_activity', 'tree') returning id into v_m1;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 2, 't2', 's', 'a', 'i', 'class_activity', 'bench') returning id into v_m2;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 3, 't3', 's', 'a', 'i', 'class_activity', 'lamp') returning id into v_m3;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 4, 't4', 's', 'a', 'i', 'class_activity', 'park') returning id into v_m4;

    insert into public.opportunities (partner_org_id, title, description, location_name, starts_at, ends_at)
      values (v_org_p, 'Foundation Test Opp', 'd', 'l', now() - interval '1 hour', now() + interval '2 hours')
      returning id, qr_token into v_opp, v_token;
    insert into public.opportunities (partner_org_id, title, description, location_name, starts_at, ends_at)
      values (v_org_p, 'Foundation Test Opp 2', 'd', 'l', now() - interval '1 hour', now() + interval '2 hours')
      returning id into v_opp2;

    insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details)
      values (v_school_a, u_adA, 'foundation_test', 'classes', v_class_a1, '{"note":"fixture"}')
      returning id into v_audit;

    set local role service_role;
    insert into public.mission_completions (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m1, v_s2, v_class_a1, 'approved', u_t1, now() - interval '1 hour', 10) returning id into v_c_recent;
    insert into public.mission_completions (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m2, v_s2, v_class_a1, 'approved', u_t1, now() - interval '25 hours', 10) returning id into v_c_late;
    insert into public.mission_completions (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m3, v_s2, v_class_a1, 'reversed', u_t1, now() - interval '2 hours', 10) returning id into v_c_reversed;
    insert into public.mission_completions (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m1, v_s3, v_class_a2, 'approved', u_t2, now() - interval '1 hour', 10) returning id into v_c_other;
    insert into public.mission_completions (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m1, v_s_leader, v_class_a1, 'approved', u_t1, now() - interval '1 hour', 10) returning id into v_c_leader;
    insert into public.checkins (opportunity_id, student_id, check_in_at)
      values (v_opp, v_s_leader, now() - interval '30 minutes') returning id into v_checkin;
    reset role;

    -- =======================================================================
    -- 1. Cross-teacher select returns zero rows (Requirements 3.5, 3.10)
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000002","role":"authenticated"}';

      -- Positive control: teacher 2 sees their own class, student, completion.
      select count(*) into n from public.classes where id = v_class_a2;
      if n <> 1 then failures := failures || format('[cross-teacher] control: teacher 2 sees %s own classes', n); end if;
      select count(*) into n from public.students where class_id = v_class_a2;
      if n <> 1 then failures := failures || format('[cross-teacher] control: teacher 2 sees %s own students', n); end if;
      select count(*) into n from public.mission_completions where id = v_c_other;
      if n <> 1 then failures := failures || format('[cross-teacher] control: teacher 2 sees %s own completions', n); end if;

      -- Teacher 1's class, students, completions are invisible to teacher 2.
      select count(*) into n from public.classes where id = v_class_a1;
      if n <> 0 then failures := failures || format('[cross-teacher] teacher 2 sees %s of teacher 1''s classes', n); end if;
      select count(*) into n from public.students where class_id = v_class_a1 or id in (v_s_leader, v_s2);
      if n <> 0 then failures := failures || format('[cross-teacher] teacher 2 sees %s of teacher 1''s students', n); end if;
      select count(*) into n from public.mission_completions where class_id = v_class_a1;
      if n <> 0 then failures := failures || format('[cross-teacher] teacher 2 sees %s of teacher 1''s completions', n); end if;
      select count(*) into n from public.class_points where class_id = v_class_a1;
      if n <> 0 then failures := failures || format('[cross-teacher] teacher 2 sees %s class_points rows of class A1', n); end if;

      -- ... and cannot write them (zero rows affected).
      update public.classes set name = 'hijacked' where id = v_class_a1;
      get diagnostics n = row_count;
      if n <> 0 then failures := failures || format('[cross-teacher] teacher 2 updated %s of teacher 1''s classes', n); end if;
      update public.students set first_name = 'Hijacked' where class_id = v_class_a1;
      get diagnostics n = row_count;
      if n <> 0 then failures := failures || format('[cross-teacher] teacher 2 updated %s of teacher 1''s students', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[cross-teacher] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 2. Cross-school admin select returns zero rows (Requirements 3.3, 3.10)
    -- =======================================================================
    begin
      -- Positive control: admin A sees school A's rows in every table checked.
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000003","role":"authenticated"}';
      select count(*) into n from public.classes where school_id = v_school_a;
      if n <> 2 then failures := failures || format('[cross-school] control: admin A sees %s/2 classes', n); end if;
      select count(*) into n from public.students where school_id = v_school_a;
      if n <> 3 then failures := failures || format('[cross-school] control: admin A sees %s/3 students', n); end if;
      select count(*) into n from public.mission_completions where class_id in (v_class_a1, v_class_a2);
      if n <> 5 then failures := failures || format('[cross-school] control: admin A sees %s/5 completions', n); end if;
      select count(*) into n from public.audit_log where school_id = v_school_a;
      if n <> 1 then failures := failures || format('[cross-school] control: admin A sees %s/1 audit rows', n); end if;
      select count(*) into n from public.profiles where school_id = v_school_a;
      if n <> 4 then failures := failures || format('[cross-school] control: admin A sees %s/4 profiles', n); end if;
      select count(*) into n from public.checkins where id = v_checkin;
      if n <> 1 then failures := failures || format('[cross-school] control: admin A sees %s/1 check-ins', n); end if;

      -- Admin B (school B) sees nothing of school A.
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000004","role":"authenticated"}';
      select count(*) into n from public.schools where id = v_school_b;
      if n <> 1 then failures := failures || format('[cross-school] control: admin B sees %s own school rows', n); end if;
      select count(*) into n from public.schools where id = v_school_a;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A rows in schools', n); end if;
      select count(*) into n from public.classes where school_id = v_school_a;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A classes', n); end if;
      select count(*) into n from public.students where school_id = v_school_a;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A students', n); end if;
      select count(*) into n from public.mission_completions where class_id in (v_class_a1, v_class_a2);
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A completions', n); end if;
      select count(*) into n from public.audit_log where school_id = v_school_a or id = v_audit;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A audit rows', n); end if;
      select count(*) into n from public.profiles where school_id = v_school_a;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A profiles', n); end if;
      select count(*) into n from public.checkins where id = v_checkin;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A check-ins', n); end if;
      select count(*) into n from public.opportunities where id in (v_opp, v_opp2);
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s opportunities of school A''s partner', n); end if;
      select count(*) into n from public.student_hours where school_id = v_school_a;
      if n <> 0 then failures := failures || format('[cross-school] admin B sees %s school A student_hours rows', n); end if;

      update public.students set first_name = 'Hijacked' where school_id = v_school_a;
      get diagnostics n = row_count;
      if n <> 0 then failures := failures || format('[cross-school] admin B updated %s school A students', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[cross-school] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 3. audit_log update/delete raise (Requirements 4.1, 4.2)
    -- =======================================================================
    begin
      -- As a signed-in admin who can read the row: no update/delete privilege.
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000003","role":"authenticated"}';
      select count(*) into n from public.audit_log where id = v_audit;
      if n <> 1 then failures := failures || format('[audit_log] control: admin A sees %s/1 rows', n); end if;
      begin
        update public.audit_log set action = 'tampered' where id = v_audit;
        failures := failures || '[audit_log] authenticated update succeeded'::text;
      exception when insufficient_privilege then null;
      end;
      begin
        delete from public.audit_log where id = v_audit;
        failures := failures || '[audit_log] authenticated delete succeeded'::text;
      exception when insufficient_privilege then null;
      end;
      -- Even with the RPC flag set.
      set local civicquest.via_rpc = 'on';
      begin
        update public.audit_log set action = 'tampered' where id = v_audit;
        failures := failures || '[audit_log] authenticated update with via_rpc succeeded'::text;
      exception when insufficient_privilege then null;
      end;

      -- Privileged roles hit the immutability trigger.
      reset role;
      begin
        update public.audit_log set action = 'tampered' where id = v_audit;
        failures := failures || '[audit_log] postgres update succeeded'::text;
      exception when others then
        if sqlerrm <> c_immut then failures := failures || ('[audit_log] postgres update raised: ' || sqlerrm); end if;
      end;
      begin
        delete from public.audit_log where id = v_audit;
        failures := failures || '[audit_log] postgres delete succeeded'::text;
      exception when others then
        if sqlerrm <> c_immut then failures := failures || ('[audit_log] postgres delete raised: ' || sqlerrm); end if;
      end;
      set local role service_role;
      begin
        update public.audit_log set action = 'tampered' where id = v_audit;
        failures := failures || '[audit_log] service_role update succeeded'::text;
      exception when others then
        if sqlerrm <> c_immut then failures := failures || ('[audit_log] service_role update raised: ' || sqlerrm); end if;
      end;
      begin
        delete from public.audit_log where id = v_audit;
        failures := failures || '[audit_log] service_role delete succeeded'::text;
      exception when others then
        if sqlerrm <> c_immut then failures := failures || ('[audit_log] service_role delete raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n from public.audit_log where id = v_audit and action = 'foundation_test';
      if n <> 1 then failures := failures || '[audit_log] fixture row changed or removed'::text; end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[audit_log] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 4. Direct writes raise the via_rpc guard (Requirements 32.4; design
    --    "Direct writes rejected"): teacher and Leader, insert and update, on
    --    mission_completions and checkins. Client-chosen status/points/hours.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000001","role":"authenticated"}';
      begin
        insert into public.mission_completions (mission_id, student_id, class_id) values (v_m4, v_s2, v_class_a1);
        failures := failures || '[guard] teacher insert mission_completions succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] teacher insert mission_completions raised: ' || sqlerrm); end if;
      end;
      begin
        update public.mission_completions set points_awarded = 999 where id = v_c_recent;
        failures := failures || '[guard] teacher update mission_completions succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] teacher update mission_completions raised: ' || sqlerrm); end if;
      end;
      begin
        insert into public.checkins (opportunity_id, student_id) values (v_opp2, v_s2);
        failures := failures || '[guard] teacher insert checkins succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] teacher insert checkins raised: ' || sqlerrm); end if;
      end;
      begin
        update public.checkins set status = 'approved', hours = 8 where id = v_checkin;
        failures := failures || '[guard] teacher update checkins succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] teacher update checkins raised: ' || sqlerrm); end if;
      end;

      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000007","role":"authenticated"}';
      begin
        insert into public.mission_completions (mission_id, student_id, class_id, status, points_awarded)
          values (v_m4, v_s_leader, v_class_a1, 'approved', 999);
        failures := failures || '[guard] Leader insert mission_completions succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] Leader insert mission_completions raised: ' || sqlerrm); end if;
      end;
      begin
        update public.mission_completions set points_awarded = 999 where id = v_c_leader;
        failures := failures || '[guard] Leader update mission_completions succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] Leader update mission_completions raised: ' || sqlerrm); end if;
      end;
      begin
        insert into public.checkins (opportunity_id, student_id, status, hours) values (v_opp2, v_s_leader, 'approved', 8);
        failures := failures || '[guard] Leader insert checkins succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] Leader insert checkins raised: ' || sqlerrm); end if;
      end;
      begin
        -- Leader approving their own hours.
        update public.checkins set status = 'approved', hours = 8, approved_by = u_L, approved_at = now()
          where id = v_checkin;
        failures := failures || '[guard] Leader update checkins succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[guard] Leader update checkins raised: ' || sqlerrm); end if;
      end;

      -- No row changed.
      reset role;
      select count(*) into n from public.mission_completions where mission_id = v_m4;
      if n <> 0 then failures := failures || format('[guard] %s completions inserted', n); end if;
      select count(*) into n from public.checkins where opportunity_id = v_opp2;
      if n <> 0 then failures := failures || format('[guard] %s check-ins inserted', n); end if;
      select count(*) into n from public.mission_completions
        where id in (v_c_recent, v_c_leader) and points_awarded = 10;
      if n <> 2 then failures := failures || '[guard] completion points changed'::text; end if;
      select count(*) into n from public.checkins
        where id = v_checkin and status = 'pending' and hours is null and approved_by is null;
      if n <> 1 then failures := failures || '[guard] check-in changed'::text; end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[guard] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 5. Protection trigger: non-owner changes (Requirement 4.3)
    --    Simulated RPC context (via_rpc = 'on') so the guard lets the write
    --    through to RLS and the trigger.
    -- =======================================================================
    begin
      set local civicquest.via_rpc = 'on';

      -- Signed-in non-owners: RLS hides the row, zero rows change.
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000002","role":"authenticated"}';
      update public.mission_completions set status = 'reversed' where id = v_c_recent;
      get diagnostics n = row_count;
      if n <> 0 then failures := failures || format('[non-owner] teacher 2 reversed %s of teacher 1''s completions', n); end if;

      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000007","role":"authenticated"}';
      update public.mission_completions set points_awarded = 999 where id = v_c_leader;
      get diagnostics n = row_count;
      if n <> 0 then failures := failures || format('[non-owner] Leader changed points on %s own completions', n); end if;

      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000004","role":"authenticated"}';
      update public.mission_completions set status = 'reversed' where id = v_c_recent;
      get diagnostics n = row_count;
      if n <> 0 then failures := failures || format('[non-owner] admin B reversed %s school A completions', n); end if;

      -- A privileged path that bypasses RLS (postgres) with a non-owner's
      -- identity still hits the trigger's own ownership check.
      reset role;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000002","role":"authenticated"}';
      begin
        update public.mission_completions set status = 'reversed' where id = v_c_recent;
        failures := failures || '[non-owner] trigger let teacher 2 identity reverse class A1 completion'::text;
      exception when others then
        if sqlerrm <> c_unauth then failures := failures || ('[non-owner] teacher 2 identity raised: ' || sqlerrm); end if;
      end;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000007","role":"authenticated"}';
      begin
        update public.mission_completions set points_awarded = 999 where id = v_c_leader;
        failures := failures || '[non-owner] trigger let Leader identity change points'::text;
      exception when others then
        if sqlerrm <> c_unauth then failures := failures || ('[non-owner] Leader identity raised: ' || sqlerrm); end if;
      end;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000004","role":"authenticated"}';
      begin
        update public.mission_completions set status = 'reversed' where id = v_c_recent;
        failures := failures || '[non-owner] trigger let admin B identity reverse school A completion'::text;
      exception when others then
        if sqlerrm <> c_unauth then failures := failures || ('[non-owner] admin B identity raised: ' || sqlerrm); end if;
      end;

      select count(*) into n from public.mission_completions
        where id in (v_c_recent, v_c_leader) and status = 'approved' and points_awarded = 10;
      if n <> 2 then failures := failures || '[non-owner] protected columns changed'::text; end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[non-owner] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 6. Protection trigger: late teacher reversal is rejected; in-window
    --    teacher reversal and late admin reversal succeed (Requirements 4.4,
    --    4.5, 4.6, 4.8). Each reversal carries its audit entry (contract B).
    -- =======================================================================
    begin
      set local civicquest.via_rpc = 'on';
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000001","role":"authenticated"}';

      -- Late (25 h) teacher reversal, with a valid audit entry: rejected.
      begin
        insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details)
          values (v_school_a, u_t1, 'undo', 'mission_completions', v_c_late,
                  jsonb_build_object('reason', 'test late', 'reversed_completion_ids', jsonb_build_array(v_c_late::text)));
        update public.mission_completions set status = 'reversed' where id = v_c_late;
        failures := failures || '[late] teacher reversed a completion after 24 hours'::text;
      exception when others then
        get stacked diagnostics v_detail = pg_exception_detail;
        if sqlerrm <> c_denied or coalesce(v_detail, '') not like '%24-hour%' then
          failures := failures || format('[late] teacher late reversal raised: %s (%s)', sqlerrm, v_detail);
        end if;
      end;

      -- Reversal without an audit entry / reason: rejected.
      begin
        update public.mission_completions set status = 'reversed' where id = v_c_recent;
        failures := failures || '[late] teacher reversed without a reason'::text;
      exception when others then
        if sqlerrm <> c_reason then failures := failures || ('[late] reversal without reason raised: ' || sqlerrm); end if;
      end;

      -- Positive control: in-window teacher reversal with reason succeeds.
      begin
        insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details)
          values (v_school_a, u_t1, 'undo', 'mission_completions', v_c_recent,
                  jsonb_build_object('reason', 'test undo', 'reversed_completion_ids', jsonb_build_array(v_c_recent::text)));
        update public.mission_completions set status = 'reversed' where id = v_c_recent;
        get diagnostics n = row_count;
        if n <> 1 then failures := failures || format('[late] control: in-window teacher reversal changed %s rows', n); end if;
      exception when others then
        failures := failures || ('[late] control: in-window teacher reversal raised: ' || sqlerrm);
      end;

      -- Positive control: admin reverses the 25 h old completion (no limit).
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000003","role":"authenticated"}';
      begin
        insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details)
          values (v_school_a, u_adA, 'undo', 'mission_completions', v_c_late,
                  jsonb_build_object('reason', 'admin undo', 'reversed_completion_ids', jsonb_build_array(v_c_late::text)));
        update public.mission_completions set status = 'reversed' where id = v_c_late;
        get diagnostics n = row_count;
        if n <> 1 then failures := failures || format('[late] control: admin late reversal changed %s rows', n); end if;
      exception when others then
        failures := failures || ('[late] control: admin late reversal raised: ' || sqlerrm);
      end;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[late] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 7. Protection trigger: invalid transitions and client-chosen protected
    --    values are rejected even inside an RPC (Requirements 4.6, 32.4)
    -- =======================================================================
    begin
      set local civicquest.via_rpc = 'on';
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000001","role":"authenticated"}';

      begin
        update public.mission_completions set status = 'pending' where id = v_c_recent;
        failures := failures || '[invalid] teacher moved approved -> pending'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] approved -> pending raised: ' || sqlerrm); end if;
      end;
      begin
        update public.mission_completions set status = 'rejected' where id = v_c_recent;
        failures := failures || '[invalid] teacher moved approved -> rejected'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] approved -> rejected raised: ' || sqlerrm); end if;
      end;
      begin
        update public.mission_completions set points_awarded = 999 where id = v_c_recent;
        failures := failures || '[invalid] teacher changed points_awarded on an approved completion'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] points edit raised: ' || sqlerrm); end if;
      end;
      begin
        -- Reversal that also rewrites the proof (points) is rejected.
        insert into public.audit_log (school_id, actor_id, action, target_table, target_id, details)
          values (v_school_a, u_t1, 'undo', 'mission_completions', v_c_recent,
                  jsonb_build_object('reason', 'test', 'reversed_completion_ids', jsonb_build_array(v_c_recent::text)));
        update public.mission_completions set status = 'reversed', points_awarded = 0 where id = v_c_recent;
        failures := failures || '[invalid] reversal also changed points_awarded'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] reversal with points edit raised: ' || sqlerrm); end if;
      end;
      begin
        -- Approved insert with a client-chosen confirmer (not the caller).
        insert into public.mission_completions (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
          values (v_m4, v_s2, v_class_a1, 'approved', u_adA, now(), 10);
        failures := failures || '[invalid] approved insert with a foreign confirmed_by succeeded'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] foreign confirmed_by insert raised: ' || sqlerrm); end if;
      end;
      begin
        -- Pending insert with client-chosen points.
        insert into public.mission_completions (mission_id, student_id, class_id, status, points_awarded)
          values (v_m4, v_s2, v_class_a1, 'pending', 50);
        failures := failures || '[invalid] pending insert with points succeeded'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] pending insert with points raised: ' || sqlerrm); end if;
      end;

      -- Admin is also limited to approved -> reversed.
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000003","role":"authenticated"}';
      begin
        update public.mission_completions set status = 'pending' where id = v_c_late;
        failures := failures || '[invalid] admin moved approved -> pending'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[invalid] admin approved -> pending raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n from public.mission_completions
        where id in (v_c_recent, v_c_late) and status = 'approved' and points_awarded = 10;
      if n <> 2 then failures := failures || '[invalid] protected columns changed'::text; end if;
      select count(*) into n from public.mission_completions where mission_id = v_m4;
      if n <> 0 then failures := failures || '[invalid] a completion was inserted'::text; end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[invalid] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 8. reversed -> approved only inside an RPC with fresh server values
    --    (design "Triggers"; Requirement 32.4)
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000001","role":"authenticated"}';

      -- Outside an RPC: the direct-write guard rejects it first.
      begin
        update public.mission_completions set status = 'approved', confirmed_by = u_t1, confirmed_at = now()
          where id = v_c_reversed;
        failures := failures || '[re-approve] reversed -> approved outside an RPC succeeded'::text;
      exception when others then
        if sqlerrm <> c_guard then failures := failures || ('[re-approve] outside RPC raised: ' || sqlerrm); end if;
      end;

      set local civicquest.via_rpc = 'on';
      -- Inside an RPC but with the stale confirmed_at: rejected.
      begin
        update public.mission_completions set status = 'approved' where id = v_c_reversed;
        failures := failures || '[re-approve] reversed -> approved with stale confirmed_at succeeded'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[re-approve] stale confirmed_at raised: ' || sqlerrm); end if;
      end;
      -- Inside an RPC but confirmed_by is someone else: rejected.
      begin
        update public.mission_completions set status = 'approved', confirmed_by = u_adA, confirmed_at = now()
          where id = v_c_reversed;
        failures := failures || '[re-approve] reversed -> approved with foreign confirmed_by succeeded'::text;
      exception when others then
        if sqlerrm <> c_denied then failures := failures || ('[re-approve] foreign confirmed_by raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n from public.mission_completions where id = v_c_reversed and status = 'reversed';
      if n <> 1 then failures := failures || '[re-approve] reversed completion changed'::text; end if;

      -- Positive control: fresh server values inside an RPC succeed.
      set local role authenticated;
      begin
        update public.mission_completions set status = 'approved', confirmed_by = u_t1, confirmed_at = now()
          where id = v_c_reversed;
        get diagnostics n = row_count;
        if n <> 1 then failures := failures || format('[re-approve] control: re-approve changed %s rows', n); end if;
      exception when others then
        failures := failures || ('[re-approve] control: re-approve raised: ' || sqlerrm);
      end;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[re-approve] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 9. mission_completions delete raises for every role (Requirement 4.9)
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000001","role":"authenticated"}';
      begin
        delete from public.mission_completions where id = v_c_recent;
        failures := failures || '[delete] teacher delete succeeded'::text;
      exception when insufficient_privilege then null;
      end;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000003","role":"authenticated"}';
      begin
        delete from public.mission_completions where id = v_c_recent;
        failures := failures || '[delete] admin delete succeeded'::text;
      exception when insufficient_privilege then null;
      end;

      reset role;
      begin
        delete from public.mission_completions where id = v_c_recent;
        failures := failures || '[delete] postgres delete succeeded'::text;
      exception when others then
        if sqlerrm <> c_nodel then failures := failures || ('[delete] postgres delete raised: ' || sqlerrm); end if;
      end;
      set local role service_role;
      begin
        delete from public.mission_completions where id = v_c_recent;
        failures := failures || '[delete] service_role delete succeeded'::text;
      exception when others then
        if sqlerrm <> c_nodel then failures := failures || ('[delete] service_role delete raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n from public.mission_completions where id = v_c_recent;
      if n <> 1 then failures := failures || '[delete] completion row is gone'::text; end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[delete] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 10. QR token secrecy (Requirement 25.2; design "Token secrecy")
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000007","role":"authenticated"}';

      -- Positive control: the Leader can see the opportunity itself.
      select count(*) into n from public.opportunities where id = v_opp and title = 'Foundation Test Opp';
      if n <> 1 then failures := failures || format('[token] control: Leader sees %s/1 linked opportunities', n); end if;

      begin
        select qr_token into v_text from public.opportunities where id = v_opp;
        failures := failures || '[token] Leader select qr_token succeeded'::text;
      exception when insufficient_privilege then null;
      end;
      begin
        select o.* into r from public.opportunities o where o.id = v_opp;
        failures := failures || '[token] Leader select * on opportunities succeeded'::text;
      exception when insufficient_privilege then null;
      end;
      select public.partner_opportunity_token(v_opp) into v_text;
      if v_text is not null then failures := failures || '[token] partner_opportunity_token returned a value to a Leader'::text; end if;

      -- Another partner gets null too.
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000006","role":"authenticated"}';
      select public.partner_opportunity_token(v_opp) into v_text;
      if v_text is not null then failures := failures || '[token] partner_opportunity_token returned a value to another org'::text; end if;

      -- The owning partner gets the current token, but still cannot select the column.
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000005","role":"authenticated"}';
      select public.partner_opportunity_token(v_opp) into v_text;
      if v_text is distinct from v_token then failures := failures || '[token] control: owning partner did not get the token'::text; end if;
      begin
        select qr_token into v_text from public.opportunities where id = v_opp;
        failures := failures || '[token] partner select qr_token succeeded'::text;
      exception when insufficient_privilege then null;
      end;

      if v_token !~ '^[0-9a-f]{48}$' then failures := failures || '[token] qr_token is not 24 random bytes in hex'::text; end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[token] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 11. partner_checkin_students exposes only first name, last initial,
    --     grade (Requirement 3.7). checkin_id is a check-in key, not a
    --     student field (documented in 0003).
    -- =======================================================================
    begin
      v_text := pg_get_function_result('public.partner_checkin_students(uuid)'::regprocedure);
      if v_text is distinct from 'TABLE(checkin_id uuid, first_name text, last_initial text, grade integer)' then
        failures := failures || ('[partner view] result type is ' || coalesce(v_text, 'null'));
      end if;

      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000005","role":"authenticated"}';

      select count(*) into n from public.partner_checkin_students(v_opp);
      if n <> 1 then failures := failures || format('[partner view] owning partner got %s/1 rows', n); end if;
      select array_agg(distinct k order by k) into v_keys
        from public.partner_checkin_students(v_opp) t, jsonb_object_keys(to_jsonb(t)) k;
      if v_keys is distinct from array['checkin_id', 'first_name', 'grade', 'last_initial'] then
        failures := failures || ('[partner view] returned columns ' || coalesce(array_to_string(v_keys, ','), 'none'));
      end if;
      select count(*) into n from public.partner_checkin_students(v_opp) t
        where t.checkin_id = v_checkin and t.first_name = 'Lena' and t.last_initial = 'Q' and t.grade = 10;
      if n <> 1 then failures := failures || '[partner view] row values do not match the check-in'::text; end if;

      -- Partners have no direct access to students.
      select count(*) into n from public.students;
      if n <> 0 then failures := failures || format('[partner view] partner reads %s students rows directly', n); end if;

      -- Everyone else gets zero rows.
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000006","role":"authenticated"}';
      select count(*) into n from public.partner_checkin_students(v_opp);
      if n <> 0 then failures := failures || format('[partner view] other partner got %s rows', n); end if;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000007","role":"authenticated"}';
      select count(*) into n from public.partner_checkin_students(v_opp);
      if n <> 0 then failures := failures || format('[partner view] Leader got %s rows', n); end if;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000003","role":"authenticated"}';
      select count(*) into n from public.partner_checkin_students(v_opp);
      if n <> 0 then failures := failures || format('[partner view] admin got %s rows', n); end if;
      set local request.jwt.claims = '{"sub":"c9f00000-0000-4000-8000-000000000001","role":"authenticated"}';
      select count(*) into n from public.partner_checkin_students(v_opp);
      if n <> 0 then failures := failures || format('[partner view] teacher got %s rows', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[partner view] unexpected error: ' || sqlerrm);
    end;

    raise exception using errcode = 'CQRBK', message = 'rollback';
  exception when sqlstate 'CQRBK' then
    null; -- all fixtures above are rolled back
  end;

  if array_length(failures, 1) > 0 then
    raise exception 'foundation security test failed: %', array_to_string(failures, '; ');
  end if;
end
$$;

-- No test rows may survive.
select
  (select count(*) from auth.users where id::text like 'c9f00000-0000-4000-8000-%') as leftover_users,
  (select count(*) from public.schools where name like 'Foundation Test School%') as leftover_schools,
  (select count(*) from public.partner_orgs where name like 'Foundation Test Partner%') as leftover_partner_orgs,
  (select count(*) from public.audit_log
     where action = 'foundation_test' or actor_id::text like 'c9f00000-0000-4000-8000-%') as leftover_audit_rows;
