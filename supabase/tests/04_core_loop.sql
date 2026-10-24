-- 04_core_loop.sql
-- Step 4 core-loop RPC checks for 0006_confirm.sql, 0007_edit.sql, and
-- 0008_undo.sql (Requirements 4.6, 15.2, 20.7, 20.8, 21.5, 32.2, 32.3). Run
-- against the dev project via Supabase MCP.
--
-- How it works (same shape as 01_foundation.sql):
--   * One DO block, run by `postgres`. Fixtures (auth.users, profiles, school,
--     classes, students, a module + its missions, a class_modules assignment,
--     and one pre-aged approved completion) are inserted first. The pre-aged
--     completion is written as service_role, the only role the direct-write
--     guard and protection trigger exempt, so the test can exercise the
--     teacher's 24-hour undo window without waiting a day.
--   * Each case impersonates a signed-in user exactly as PostgREST does:
--       set local role authenticated;
--       set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--     then calls the RPCs with `perform public.<rpc>(...)`. The RPCs are
--     security invoker and set the via_rpc flag themselves, so no flag is set
--     here. `reset role` returns to postgres for after-the-fact checks.
--   * Every case is its own sub-block that ends by raising the sentinel CQCAS,
--     so its role, claims, RPC writes, and audit rows all roll back before the
--     next case (this is how "rejected WITH FULL ROLLBACK, no stray audit_log
--     row" is proven: the whole case, success or not, is undone, and the
--     negative cases additionally assert no audit row was written). The whole
--     block ends with the sentinel CQRBK so the fixtures roll back too.
--     PL/pgSQL variables survive rollbacks, so failures are collected in an
--     array and reported at the end: the script succeeds silently when every
--     check passes and raises "core-loop test failed" with the list of
--     failing checks otherwise.
--   * Each negative check is paired with a positive control so a check cannot
--     pass just because nothing works.
--
-- The final SELECT (outside the DO block) is the pg_proc scan: in the
-- PostgREST-exposed schemas (public and graphql_public), set_config appears
-- ONLY inside the five core RPC names and ONLY with the constant
-- 'civicquest.via_rpc' (0004 contract B / design "Why the client cannot set
-- the flag itself"). Only three of the five exist so far (confirm/edit/undo);
-- the scan asserts set_config lives only in those RPC names with that constant,
-- which stays correct as 11.1/11.2 (approve_checkin, leader_scan) are added to
-- the same public schema with the same preamble.

do $$
declare
  failures text[] := '{}';

  -- Error texts the RPCs raise (see 0006/0007/0008).
  e_perm   constant text := 'not permitted';
  e_signin constant text := 'sign in required';
  e_reason constant text := 'an undo reason must be one of the three permitted reasons';
  e_window constant text := 'the 24-hour undo window for this mission has passed';

  -- Fixture users (fixed so the jwt claims can be literal SET statements).
  u_t1  constant uuid := 'c9f40000-0000-4000-8000-000000000001'; -- teacher, owns class A1
  u_t2  constant uuid := 'c9f40000-0000-4000-8000-000000000002'; -- teacher, same school, owns class A2 (non-owner of A1)
  u_adA constant uuid := 'c9f40000-0000-4000-8000-000000000003'; -- admin, school A
  u_pP  constant uuid := 'c9f40000-0000-4000-8000-000000000004'; -- partner (wrong role)

  v_school_a uuid;
  v_org_p uuid;
  v_class_a1 uuid; v_class_a2 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s_a2 uuid;
  v_module uuid; v_module_leaders uuid;
  v_m1 uuid; v_m2 uuid;              -- missions in the class A1 module (learners, 10 pts)
  v_m_unassigned uuid;               -- mission in a module NOT assigned to class A1
  v_c_late uuid;                     -- approved 25h ago (service_role), class A1, mission m2
  v_c_old_rev uuid;                  -- reversed, confirmed_at 2h ago (service_role), class A1, mission m2, s2
  v_old_conf timestamptz;            -- the 2h-ago confirmed_at of v_c_old_rev

  n int;
  v_ts1 timestamptz; v_ts2 timestamptz;
  v_pts1 int; v_pts2 int;
  v_status public.review_status;
  r record;
begin
  begin
    -- -----------------------------------------------------------------------
    -- Fixtures (as postgres; the one pre-aged completion as service_role)
    -- -----------------------------------------------------------------------
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           'coreloop-test-' || right(u::text, 2) || '@example.test', now(), now()
    from unnest(array[u_t1, u_t2, u_adA, u_pP]) as u;

    insert into public.schools (name) values ('Core Loop Test School A') returning id into v_school_a;
    insert into public.partner_orgs (name) values ('Core Loop Test Partner P') returning id into v_org_p;

    insert into public.profiles (id, role, full_name, school_id, partner_org_id) values
      (u_t1,  'teacher', 'Core Teacher One', v_school_a, null),
      (u_t2,  'teacher', 'Core Teacher Two', v_school_a, null),
      (u_adA, 'admin',   'Core Admin A',     v_school_a, null),
      (u_pP,  'partner', 'Core Partner P',   null, v_org_p);

    insert into public.classes (school_id, name, grade, teacher_id)
      values (v_school_a, 'Core A1', 4, u_t1) returning id into v_class_a1;
    insert into public.classes (school_id, name, grade, teacher_id)
      values (v_school_a, 'Core A2', 4, u_t2) returning id into v_class_a2;

    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school_a, v_class_a1, 'Ada', 'A', 4, 'coreloop-test-s1') returning id into v_s1;
    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school_a, v_class_a1, 'Ben', 'B', 4, 'coreloop-test-s2') returning id into v_s2;
    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school_a, v_class_a1, 'Cal', 'C', 4, 'coreloop-test-s3') returning id into v_s3;
    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school_a, v_class_a2, 'Dot', 'D', 4, 'coreloop-test-sa2') returning id into v_s_a2;

    -- Module assigned to class A1 (learners -> 10 points per student).
    insert into public.modules (title, level, quality, week_order)
      values ('Core Loop Module', 'learners', 'Safety', 1) returning id into v_module;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 1, 'cm1', 's', 'a', 'i', 'class_activity', 'tree') returning id into v_m1;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 2, 'cm2', 's', 'a', 'i', 'class_activity', 'bench') returning id into v_m2;
    insert into public.class_modules (class_id, module_id) values (v_class_a1, v_module);

    -- A second module NOT assigned to class A1; its mission must be rejected.
    insert into public.modules (title, level, quality, week_order)
      values ('Core Loop Unassigned Module', 'leaders', 'Civic action', 2) returning id into v_module_leaders;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module_leaders, 1, 'um1', 's', 'a', 'i', 'class_activity', 'park') returning id into v_m_unassigned;

    -- Pre-aged completions, written as service_role (the only role exempt from
    -- the guard/trigger), so the test can stand in for actions taken in an
    -- EARLIER transaction. The RPCs stamp confirmed_at = now(), which is the
    -- transaction start time and is therefore constant within this test's
    -- single transaction; to prove a re-confirm writes a strictly LATER
    -- confirmed_at (Requirement 15.2) the "earlier confirm" must carry an
    -- older timestamp than this transaction's now(), which is what these rows
    -- provide.
    --   * v_c_late:    approved 25h ago, for the teacher late-undo window case.
    --   * v_c_old_rev: a reversed row whose last confirmed_at is 2h ago,
    --                  standing in for an undone earlier confirm; re-confirming
    --                  it must restore it to approved with a later timestamp.
    set local role service_role;
    insert into public.mission_completions
      (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m2, v_s1, v_class_a1, 'approved', u_t1, now() - interval '25 hours', 10)
      returning id into v_c_late;
    insert into public.mission_completions
      (mission_id, student_id, class_id, status, confirmed_by, confirmed_at, points_awarded)
      values (v_m2, v_s2, v_class_a1, 'reversed', u_t1, now() - interval '2 hours', 10)
      returning id into v_c_old_rev;
    reset role;
    v_old_conf := now() - interval '2 hours';

    -- =======================================================================
    -- 1. The owning teacher succeeds at confirm (Requirements 20.1, 32.3).
    --    Two present students -> two approved rows at 10 points, server-set
    --    confirmed_by/confirmed_at, plus one 'confirm' audit entry.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000001","role":"authenticated"}';

      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);

      reset role;
      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'approved'
         and confirmed_by = u_t1 and points_awarded = 10;
      if n <> 2 then failures := failures || format('[confirm] owner confirm left %s/2 approved rows', n); end if;

      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and student_id = v_s3;
      if n <> 0 then failures := failures || '[confirm] an absent student got a completion'::text; end if;

      select count(*) into n
        from public.audit_log
       where action = 'confirm' and actor_id = u_t1 and target_id = v_m1;
      if n <> 1 then failures := failures || format('[confirm] %s/1 confirm audit entries', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[confirm] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 2. A non-owner teacher's confirm is rejected WITH FULL ROLLBACK
    --    (Requirement 20.7). No row, no audit entry.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000002","role":"authenticated"}';

      begin
        perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1]);
        failures := failures || '[non-owner] teacher 2 confirmed teacher 1''s class'::text;
      exception when others then
        if sqlerrm <> e_perm then failures := failures || ('[non-owner] confirm raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n from public.mission_completions where mission_id = v_m1 and class_id = v_class_a1;
      if n <> 0 then failures := failures || format('[non-owner] %s stray completion rows after rejection', n); end if;
      select count(*) into n from public.audit_log where actor_id = u_t2 and target_id = v_m1;
      if n <> 0 then failures := failures || format('[non-owner] %s stray audit rows after rejection', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[non-owner] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 3. A wrong-role caller (partner) confirm is rejected WITH FULL ROLLBACK
    --    (Requirement 20.7). No row, no audit entry.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000004","role":"authenticated"}';

      begin
        perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1]);
        failures := failures || '[wrong-role] partner confirmed a class mission'::text;
      exception when others then
        if sqlerrm <> e_perm then failures := failures || ('[wrong-role] confirm raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n from public.mission_completions where mission_id = v_m1 and class_id = v_class_a1;
      if n <> 0 then failures := failures || format('[wrong-role] %s stray completion rows after rejection', n); end if;
      select count(*) into n from public.audit_log where actor_id = u_pP;
      if n <> 0 then failures := failures || format('[wrong-role] %s stray audit rows after rejection', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[wrong-role] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 4. A late (> 24h) teacher undo is rejected WITH FULL ROLLBACK
    --    (Requirements 4.6, 21.5). The pre-aged completion (25h old) stays
    --    approved and no 'undo' audit row survives. Positive control: the
    --    school admin may undo the same 25h-old completion (no time limit).
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000001","role":"authenticated"}';

      begin
        perform public.undo_mission(v_class_a1, v_m2, 'pressed by mistake');
        failures := failures || '[late-undo] teacher undid a mission confirmed > 24h ago'::text;
      exception when others then
        if sqlerrm <> e_window then failures := failures || ('[late-undo] teacher late undo raised: ' || sqlerrm); end if;
      end;

      reset role;
      select status into v_status from public.mission_completions where id = v_c_late;
      if v_status is distinct from 'approved' then
        failures := failures || format('[late-undo] late completion is now %s, expected approved', v_status);
      end if;
      select count(*) into n from public.audit_log where action = 'undo' and target_id = v_m2;
      if n <> 0 then failures := failures || format('[late-undo] %s stray undo audit rows after rejection', n); end if;

      -- Positive control: admin of school A may undo the 25h-old completion.
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000003","role":"authenticated"}';
      begin
        perform public.undo_mission(v_class_a1, v_m2, 'admin reversal after review');
      exception when others then
        failures := failures || ('[late-undo] control: admin undo raised: ' || sqlerrm);
      end;
      reset role;
      select status into v_status from public.mission_completions where id = v_c_late;
      if v_status is distinct from 'reversed' then
        failures := failures || format('[late-undo] control: admin undo left status %s, expected reversed', v_status);
      end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[late-undo] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 5. confirm -> undo -> confirm leaves rows approved with a LATER
    --    confirmed_at and fresh points (Requirement 15.2). The re-confirm
    --    restores the exact prior state with a fresh server timestamp and
    --    fresh points.
    --
    --    Because every RPC stamps confirmed_at = now() (the transaction start
    --    time, constant within this single test transaction), the "LATER
    --    confirmed_at" property is observable only across transactions. The
    --    pre-aged reversed row v_c_old_rev (m2/s2, confirmed_at 2h ago) stands
    --    in for the earlier confirm-then-undo: this transaction's re-confirm
    --    must restore it to approved with a confirmed_at that equals now() and
    --    is strictly later than its prior 2h-old stamp, with points re-awarded.
    --    The live confirm -> undo -> confirm on m1/{s1,s2} below additionally
    --    proves the full cycle ends approved with fresh points.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000001","role":"authenticated"}';

      -- Record the pre-aged reversed row's prior confirmed_at (2h ago).
      select confirmed_at into v_ts1 from public.mission_completions where id = v_c_old_rev;

      -- Re-confirm only s2 on m2: the reversed row is restored to approved.
      perform public.confirm_class_mission(v_class_a1, v_m2, array[v_s2]);

      reset role;
      select status, confirmed_at, points_awarded into v_status, v_ts2, v_pts2
        from public.mission_completions where id = v_c_old_rev;
      if v_status is distinct from 'approved' then
        failures := failures || format('[cycle] re-confirm left aged row %s, expected approved', v_status);
      end if;
      if not (v_ts2 > v_ts1) then
        failures := failures || format('[cycle] re-confirmed confirmed_at %s is not later than prior %s', v_ts2, v_ts1);
      end if;
      if v_ts2 is distinct from v_old_conf + interval '2 hours' then
        -- now() is the transaction time; v_old_conf = now() - 2h, so the fresh
        -- stamp must be exactly now(). (Guards against a stale-timestamp bug.)
        failures := failures || format('[cycle] re-confirmed confirmed_at %s is not the transaction now()', v_ts2);
      end if;
      if v_pts2 <> 10 then failures := failures || format('[cycle] re-confirmed points are %s, expected 10', v_pts2); end if;

      -- Full live cycle on m1/{s1,s2}: confirm -> undo -> confirm ends approved.
      set local role authenticated;
      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);
      perform public.undo_mission(v_class_a1, v_m1, 'the activity didn''t happen');
      reset role;
      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'reversed';
      if n <> 2 then failures := failures || format('[cycle] undo left %s/2 reversed rows', n); end if;

      set local role authenticated;
      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);
      reset role;
      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'approved'
         and confirmed_by = u_t1 and points_awarded = 10;
      if n <> 2 then failures := failures || format('[cycle] re-confirm left %s/2 approved rows', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[cycle] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 6. A re-confirm (confirming an already-approved mission) changes nothing
    --    (Requirement 20.8): same confirmed_at, same points, no second confirm
    --    audit entry.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000001","role":"authenticated"}';

      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);
      select confirmed_at into v_ts1
        from public.mission_completions where mission_id = v_m1 and student_id = v_s1;

      perform pg_sleep(0.05);

      -- Confirm the same roster again: idempotent, nothing changes.
      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);

      reset role;
      select confirmed_at into v_ts2
        from public.mission_completions where mission_id = v_m1 and student_id = v_s1;
      if v_ts2 is distinct from v_ts1 then
        failures := failures || format('[reconfirm] confirmed_at changed from %s to %s on re-confirm', v_ts1, v_ts2);
      end if;

      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'approved' and points_awarded = 10;
      if n <> 2 then failures := failures || format('[reconfirm] %s/2 approved rows after re-confirm', n); end if;

      -- Only ONE confirm audit entry: the second call changed nothing.
      select count(*) into n from public.audit_log where action = 'confirm' and target_id = v_m1 and actor_id = u_t1;
      if n <> 1 then failures := failures || format('[reconfirm] %s confirm audit entries, expected 1', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[reconfirm] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 7. An edit that removes then re-adds a student works (Requirements 21.3,
    --    21.4, 15.3). Confirm {s1,s2}; edit to {s1} (remove s2 -> reversed);
    --    edit back to {s1,s2} (re-approve s2). s2 ends approved with 10 points;
    --    editing from any prior set to B equals confirming B directly.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000001","role":"authenticated"}';

      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);

      -- Remove s2.
      perform public.edit_mission_participants(v_class_a1, v_m1, array[v_s1]);
      reset role;
      select status into v_status from public.mission_completions where mission_id = v_m1 and student_id = v_s2;
      if v_status is distinct from 'reversed' then
        failures := failures || format('[edit] after removal s2 status is %s, expected reversed', v_status);
      end if;

      -- Re-add s2.
      set local role authenticated;
      perform public.edit_mission_participants(v_class_a1, v_m1, array[v_s1, v_s2]);

      reset role;
      select status, points_awarded into v_status, v_pts1
        from public.mission_completions where mission_id = v_m1 and student_id = v_s2;
      if v_status is distinct from 'approved' or v_pts1 <> 10 then
        failures := failures || format('[edit] after re-add s2 is %s at %s points, expected approved at 10', v_status, v_pts1);
      end if;

      -- Final roster totals equal confirming {s1,s2} directly: two approved.
      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'approved' and points_awarded = 10;
      if n <> 2 then failures := failures || format('[edit] %s/2 approved rows after remove+re-add', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[edit] unexpected error: ' || sqlerrm);
    end;

    -- =======================================================================
    -- 8. An invalid undo reason is rejected WITH FULL ROLLBACK (Requirements
    --    21.5, 4.6). The rows stay approved and no 'undo' audit row survives.
    --    Positive control: a permitted reason undoes the just-confirmed rows.
    -- =======================================================================
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"c9f40000-0000-4000-8000-000000000001","role":"authenticated"}';

      perform public.confirm_class_mission(v_class_a1, v_m1, array[v_s1, v_s2]);

      begin
        perform public.undo_mission(v_class_a1, v_m1, 'because I felt like it');
        failures := failures || '[bad-reason] undo accepted a non-permitted reason'::text;
      exception when others then
        if sqlerrm <> e_reason then failures := failures || ('[bad-reason] undo raised: ' || sqlerrm); end if;
      end;

      reset role;
      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'approved';
      if n <> 2 then failures := failures || format('[bad-reason] %s/2 rows still approved after rejected undo', n); end if;
      select count(*) into n from public.audit_log where action = 'undo' and target_id = v_m1;
      if n <> 0 then failures := failures || format('[bad-reason] %s stray undo audit rows after rejection', n); end if;

      -- Positive control: a permitted reason succeeds.
      set local role authenticated;
      begin
        perform public.undo_mission(v_class_a1, v_m1, 'wrong class');
      exception when others then
        failures := failures || ('[bad-reason] control: permitted-reason undo raised: ' || sqlerrm);
      end;
      reset role;
      select count(*) into n
        from public.mission_completions
       where mission_id = v_m1 and class_id = v_class_a1 and status = 'reversed';
      if n <> 2 then failures := failures || format('[bad-reason] control: permitted undo left %s/2 reversed', n); end if;

      raise exception using errcode = 'CQCAS', message = 'case rollback';
    exception
      when sqlstate 'CQCAS' then null;
      when others then failures := failures || ('[bad-reason] unexpected error: ' || sqlerrm);
    end;

    raise exception using errcode = 'CQRBK', message = 'rollback';
  exception when sqlstate 'CQRBK' then
    null; -- all fixtures above are rolled back
  end;

  if array_length(failures, 1) > 0 then
    raise exception 'core-loop test failed: %', array_to_string(failures, '; ');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- pg_proc scan (Requirement 32.2; 0004 contract B / design "Why the client
-- cannot set the flag itself"). In the PostgREST-exposed schemas (public,
-- graphql_public), every function body that mentions set_config must:
--   * be one of the five core-loop RPC names
--       (confirm_class_mission, edit_mission_participants, undo_mission, and
--        later approve_checkin, leader_scan), and
--   * mention set_config ONLY with the single constant flag name
--     'civicquest.via_rpc' and no other setting.
-- Three of the five exist now; the two WHERE clauses below express the
-- invariant directly, so the query returns ZERO rows while it holds and names
-- the offending function if it ever does not. The scan is scoped to the API
-- surface a client can actually reach: Supabase's internal schemas (realtime,
-- auth, storage, extensions, vault, graphql, private, ...) are not exposed
-- through PostgREST and their own use of set_config is irrelevant here.
with exposed as (
  select p.oid, n.nspname as schema, p.proname as name, p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'graphql_public')
    and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
)
select schema, name,
       case
         when name not in ('confirm_class_mission', 'edit_mission_participants',
                           'undo_mission', 'approve_checkin', 'leader_scan')
           then 'set_config in a non-RPC function'
         else 'set_config with a setting other than civicquest.via_rpc'
       end as violation
from exposed
where prosrc ~ '\mset_config\M'
  and (
    -- not one of the five permitted RPC names
    name not in ('confirm_class_mission', 'edit_mission_participants',
                 'undo_mission', 'approve_checkin', 'leader_scan')
    -- or it sets some config key other than the one constant flag: any
    -- set_config call whose first argument is not the literal
    -- 'civicquest.via_rpc' string.
    or prosrc ~ 'set_config\s*\(\s*(?!''civicquest\.via_rpc'')'
  );
