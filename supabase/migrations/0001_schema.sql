-- 0001_schema.sql
-- CivicQuest base schema: extensions, enums, tables, constraints, and views.
-- Source: docs/build-prompt.md section 3 (Requirements 2.1–2.7, 37.1, 37.2).
--
-- Deliberate differences from build-prompt section 3 (also recorded in the
-- build log in docs/KIRO_WRITEUP.md):
--   1. pgcrypto is created `with schema extensions` and `qr_token` calls
--      `extensions.gen_random_bytes(...)`. Supabase installs pgcrypto in the
--      `extensions` schema, so the explicit schema avoids depending on the
--      migration's search_path. 0003 replaces the default with a 24-byte token.
--   2. `students.first_name` also checks `char_length(first_name) >= 1`, so an
--      empty name is rejected (Requirement 2.4 requires 1–50 characters).
--   3. RLS is enabled (deny-all, no policies) on every table at creation, so the
--      tables are never reachable through the API before 0002 adds policies.
--      0002 re-enables RLS (idempotent) and adds the policies.
--
-- Child privacy (Requirement 37.1, 37.2): `students` holds only first name,
-- last initial, grade, class, avatar, and kid theme. No birthdays, addresses,
-- emails, photos of children, or location columns exist anywhere.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (Requirement 2.2)
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('admin','teacher','counselor','partner','student');
create type public.verification_type as enum ('class_activity','quiz','photo_review','qr_checkin');
create type public.review_status as enum ('pending','approved','rejected','reversed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'school' check (kind in ('school','after_school_program')),
  district text,
  created_at timestamptz not null default now()
);

create table public.partner_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text,
  city text,
  created_at timestamptz not null default now()
);

create table public.school_partners (
  school_id uuid references public.schools on delete cascade,
  partner_org_id uuid references public.partner_orgs on delete cascade,
  primary key (school_id, partner_org_id)
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  role public.user_role not null,
  full_name text not null,
  school_id uuid references public.schools on delete set null,
  partner_org_id uuid references public.partner_orgs on delete set null,
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools on delete cascade,
  name text not null,
  grade int not null check (grade between 2 and 12),
  teacher_id uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

create table public.class_rewards (
  class_id uuid references public.classes on delete cascade,
  stage text not null check (stage in ('village','town','city')),
  reward text not null check (char_length(reward) <= 140),
  primary key (class_id, stage)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools on delete cascade,
  class_id uuid references public.classes on delete set null,
  first_name text not null check (char_length(first_name) between 1 and 50),
  last_initial text not null check (char_length(last_initial) = 1),
  grade int not null check (grade between 2 and 12),
  -- Requirement 2.3: database is the source of truth for level.
  level text generated always as (
    case when grade <= 5 then 'learners'
         when grade <= 8 then 'helpers'
         else 'leaders' end
  ) stored,
  login_code text not null unique,
  auth_user_id uuid unique references auth.users on delete set null,
  avatar text not null default 'fox',
  kid_theme text not null default 'classic' check (kid_theme in ('hero','bubblegum','ocean','classic')),
  created_at timestamptz not null default now()
);

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  level text not null check (level in ('learners','helpers','leaders')),
  quality text not null check (quality in ('Safety','Kindness','Responsibility','Respect','Helping','Civic action')),
  week_order int not null,
  note text,
  sponsor_name text,
  school_id uuid references public.schools on delete cascade,
  created_at timestamptz not null default now()
);

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules on delete cascade,
  day_number int not null check (day_number between 1 and 5),
  title text not null,
  story text not null,
  ask text not null,
  instructions text not null,
  points int not null default 10,
  verification public.verification_type not null,
  est_minutes int not null default 10,
  town_item text not null,
  quiz jsonb,
  unique (module_id, day_number)
);

create table public.class_modules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes on delete cascade,
  module_id uuid not null references public.modules on delete cascade,
  start_date date not null default current_date,
  unique (class_id, module_id)
);

create table public.mission_completions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  class_id uuid not null references public.classes on delete cascade,
  status public.review_status not null default 'pending',
  photo_path text,
  quiz_score int,
  confirmed_by uuid references public.profiles on delete set null,
  confirmed_at timestamptz,
  points_awarded int not null default 0,
  created_at timestamptz not null default now(),
  unique (mission_id, student_id)
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references public.partner_orgs on delete cascade,
  title text not null,
  description text not null,
  location_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  min_grade int not null default 9,
  capacity int,
  -- 0003 replaces this default with a 24-byte token and hides the column.
  qr_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities on delete cascade,
  student_id uuid not null references public.students on delete cascade,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  hours numeric(4,2),
  status public.review_status not null default 'pending',
  approved_by uuid references public.profiles on delete set null,
  approved_at timestamptz,
  unique (opportunity_id, student_id)
);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  level text check (level in ('learners','helpers','leaders')),
  icon text not null,
  rule jsonb not null
);

create table public.student_badges (
  student_id uuid references public.students on delete cascade,
  badge_id uuid references public.badges on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (student_id, badge_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  school_id uuid references public.schools on delete cascade,
  actor_id uuid references public.profiles on delete set null,
  action text not null,
  target_table text not null,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

-- ---------------------------------------------------------------------------
-- Deny-all until 0002 adds policies (no table is ever exposed without RLS).
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
-- Views (Requirement 2.5). security_invoker = true: each view runs under the
-- querying user's RLS, so it can never leak rows across schools.
-- ---------------------------------------------------------------------------

create view public.class_points with (security_invoker = true) as
select c.id as class_id, c.school_id, c.name, c.grade,
       (select count(*) from public.students s where s.class_id = c.id) as student_count,
       coalesce(sum(mc.points_awarded), 0) as total_points
from public.classes c
left join public.mission_completions mc on mc.class_id = c.id and mc.status = 'approved'
group by c.id;

-- One building per distinct approved mission for a class, ordered by placed_at.
create view public.class_town with (security_invoker = true) as
select mc.class_id, m.town_item, min(mc.confirmed_at) as placed_at
from public.mission_completions mc
join public.missions m on m.id = mc.mission_id
where mc.status = 'approved'
group by mc.class_id, m.id, m.town_item;

create view public.student_stamps with (security_invoker = true) as
select mc.student_id, mo.quality, count(*) as stamps
from public.mission_completions mc
join public.missions m on m.id = mc.mission_id
join public.modules mo on mo.id = m.module_id
where mc.status = 'approved'
group by mc.student_id, mo.quality;

create view public.student_hours with (security_invoker = true) as
select s.id as student_id, s.school_id, s.first_name, s.last_initial, s.grade,
       coalesce(sum(ch.hours) filter (where ch.status = 'approved'), 0) as verified_hours,
       coalesce(sum(ch.hours) filter (where ch.status = 'pending'), 0) as pending_hours
from public.students s
left join public.checkins ch on ch.student_id = s.id
group by s.id;
