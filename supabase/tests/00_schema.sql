-- 00_schema.sql
-- Checks the 0001_schema.sql constraints and generated level column
-- (Requirements 2.3, 2.4, 2.6). Run against the dev project via Supabase MCP.
--
-- Everything runs inside an inner block that always ends by raising a sentinel
-- error, so every row it inserts is rolled back. PL/pgSQL variables survive the
-- rollback, so failures are collected and reported afterwards. The script
-- succeeds silently when every check passes and raises "schema test failed"
-- with the list of failing checks otherwise.

do $$
declare
  failures text[] := '{}';
  v_school uuid;
  v_class uuid;
  v_student uuid;
  v_module uuid;
  v_mission uuid;
  v_partner uuid;
  v_opp uuid;
  v_level text;
  v_theme text;
  v_token text;
  v_constraint text;
begin
  begin
    insert into public.schools (name) values ('Schema Test School') returning id into v_school;
    insert into public.classes (school_id, name, grade) values (v_school, 'Test class', 3) returning id into v_class;
    insert into public.modules (title, level, quality, week_order)
      values ('Test module', 'learners', 'Safety', 1) returning id into v_module;
    insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
      values (v_module, 1, 't', 's', 'a', 'i', 'class_activity', 'tree') returning id into v_mission;
    insert into public.partner_orgs (name) values ('Test partner') returning id into v_partner;

    -- Requirement 2.3: generated level at every boundary.
    for g in 2..12 loop
      insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
        values (v_school, v_class, 'Kid', 'K', g, 'schema-test-' || g)
        returning level into v_level;
      if v_level is distinct from (case when g <= 5 then 'learners' when g <= 8 then 'helpers' else 'leaders' end) then
        failures := failures || format('level for grade %s was %s', g, v_level);
      end if;
    end loop;

    -- level cannot be written directly.
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code, level)
        values (v_school, 'Kid', 'K', 3, 'schema-test-level', 'leaders');
      failures := failures || 'students.level accepted a direct write'::text;
    exception when generated_always then null;
    end;

    -- kid_theme default and check.
    insert into public.students (school_id, class_id, first_name, last_initial, grade, login_code)
      values (v_school, v_class, repeat('a', 50), 'K', 3, 'schema-test-main')
      returning id, kid_theme into v_student, v_theme;
    if v_theme <> 'classic' then failures := failures || 'kid_theme default is not classic'::text; end if;
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code, kid_theme)
        values (v_school, 'Kid', 'K', 3, 'schema-test-theme', 'neon');
      failures := failures || 'kid_theme accepted neon'::text;
    exception when check_violation then null;
    end;

    -- first_name 1..50.
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code)
        values (v_school, '', 'K', 3, 'schema-test-fn0');
      failures := failures || 'first_name accepted empty'::text;
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'students_first_name_check' then failures := failures || ('empty first_name hit ' || v_constraint); end if;
    end;
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code)
        values (v_school, repeat('a', 51), 'K', 3, 'schema-test-fn51');
      failures := failures || 'first_name accepted 51 chars'::text;
    exception when check_violation then null;
    end;

    -- last_initial exactly 1.
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code)
        values (v_school, 'Kid', 'KL', 3, 'schema-test-li2');
      failures := failures || 'last_initial accepted 2 chars'::text;
    exception when check_violation then null;
    end;
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code)
        values (v_school, 'Kid', '', 3, 'schema-test-li0');
      failures := failures || 'last_initial accepted empty'::text;
    exception when check_violation then null;
    end;

    -- grade 2..12 on students and classes.
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code)
        values (v_school, 'Kid', 'K', 1, 'schema-test-g1');
      failures := failures || 'students.grade accepted 1'::text;
    exception when check_violation then null;
    end;
    begin
      insert into public.students (school_id, first_name, last_initial, grade, login_code)
        values (v_school, 'Kid', 'K', 13, 'schema-test-g13');
      failures := failures || 'students.grade accepted 13'::text;
    exception when check_violation then null;
    end;
    begin
      insert into public.classes (school_id, name, grade) values (v_school, 'Bad', 1);
      failures := failures || 'classes.grade accepted 1'::text;
    exception when check_violation then null;
    end;
    begin
      insert into public.classes (school_id, name, grade) values (v_school, 'Bad', 13);
      failures := failures || 'classes.grade accepted 13'::text;
    exception when check_violation then null;
    end;

    -- class_rewards.reward <= 140.
    insert into public.class_rewards (class_id, stage, reward) values (v_class, 'village', repeat('r', 140));
    begin
      insert into public.class_rewards (class_id, stage, reward) values (v_class, 'town', repeat('r', 141));
      failures := failures || 'reward accepted 141 chars'::text;
    exception when check_violation then null;
    end;

    -- missions.day_number 1..5.
    begin
      insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
        values (v_module, 0, 't', 's', 'a', 'i', 'class_activity', 'tree');
      failures := failures || 'day_number accepted 0'::text;
    exception when check_violation then null;
    end;
    begin
      insert into public.missions (module_id, day_number, title, story, ask, instructions, verification, town_item)
        values (v_module, 6, 't', 's', 'a', 'i', 'class_activity', 'tree');
      failures := failures || 'day_number accepted 6'::text;
    exception when check_violation then null;
    end;

    -- Unique (mission_id, student_id).
    insert into public.mission_completions (mission_id, student_id, class_id) values (v_mission, v_student, v_class);
    begin
      insert into public.mission_completions (mission_id, student_id, class_id) values (v_mission, v_student, v_class);
      failures := failures || 'duplicate mission_completion accepted'::text;
    exception when unique_violation then null;
    end;

    -- qr_token default and unique (opportunity_id, student_id).
    insert into public.opportunities (partner_org_id, title, description, location_name, starts_at, ends_at)
      values (v_partner, 't', 'd', 'l', now(), now() + interval '2 hours')
      returning id, qr_token into v_opp, v_token;
    if v_token !~ '^[0-9a-f]{32,}$' then failures := failures || 'qr_token default is not random hex'::text; end if;
    insert into public.checkins (opportunity_id, student_id) values (v_opp, v_student);
    begin
      insert into public.checkins (opportunity_id, student_id) values (v_opp, v_student);
      failures := failures || 'duplicate checkin accepted'::text;
    exception when unique_violation then null;
    end;

    raise exception using errcode = 'CQRBK', message = 'rollback';
  exception when sqlstate 'CQRBK' then
    null; -- all inserts above are rolled back
  end;

  if array_length(failures, 1) > 0 then
    raise exception 'schema test failed: %', array_to_string(failures, '; ');
  end if;
end
$$;

-- No test rows may survive.
select count(*) as leftover_test_schools from public.schools where name = 'Schema Test School';
