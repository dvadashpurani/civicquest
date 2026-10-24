# CivicQuest: full build specification

This is the complete specification. Steering files in `.kiro/steering/` summarize the rules that apply to every task. The intended flow is shown in `docs/simulation.html`, and all mission content is in `docs/missions.md`. Today's build scope is in `docs/kiro-spec-kickoff.md`.

## 1. What you are building

CivicQuest is a web app that teaches civic sense to students in grades 2–12 through one short real-world mission each school day. Schools and after-school programs use it. Parents do not have accounts.

Every mission starts with a short story or case study and a discussion question, so students understand why it matters. Then the class does the mission, and an adult confirms who took part. Each student who took part earns points and a stamp for the mission's quality. Each class builds a shared town, gaining one building per mission and unlocking teacher-set rewards. High school students earn verified volunteer hours through QR check-ins at partner organizations.

This is a hackathon build for Hackachusetts (Civic Action track, challenge V5: Pathways to education and opportunity). It must be demo-ready, reliable, and simple. Favor working end-to-end flows over extra features.

### Levels (assigned automatically from grade)

| Level | Grades | How students use it | Proof |
|---|---|---|---|
| Learners | 2–5 | Class mode on a teacher-signed-in tablet or projector. No student accounts. Students tap their avatar or scan a printed QR login card. | The teacher confirms the class in one tap and unchecks absent students, or the student passes a server-graded quiz. |
| Helpers | 6–8 | Class mode on school devices. | Teacher confirmation, or a photo of the place or the work (never of faces) that the teacher approves. |
| Leaders | 9–12 | Their own login on their own phone. | QR check-in and check-out timestamps plus approval from a partner supervisor who was there. |

### Roles
- **School admin:** manages the school, classes, and students, sees reports and the proof log, prints the parent notice letter.
- **Teacher (or after-school program staff):** runs missions, confirms who took part, reviews photos, sets class rewards, prints QR login cards.
- **Counselor:** sees verified service hours for Leaders and exports them.
- **Partner organization:** posts volunteer opportunities, displays a check-in QR code, approves hours.
- **Leader (grades 9–12):** browses opportunities, checks in and out, sees hours and badges, prints a certificate.

### The roadmap
One mission per school day, Monday to Friday. Each week is one five-day module. There are 10 modules and 50 missions, all written in `docs/missions.md`:
- Learners: Safe Streets, Kind Words, Clean Planet
- Helpers: Neighborhood Helpers, Respect Everywhere, Green Team
- Leaders: Civics Project, Serve Your Community, Know Your City, Lead the Way

Learner stories feature Pip the fox, an original character. Helper and Leader missions open with realistic case studies. The Civics Project module supports the Massachusetts requirement that every public school serving 8th grade and every high school provide at least one student-led, non-partisan civics project per student.

## 2. Tech stack

- **Framework:** Latest stable Next.js with the App Router and TypeScript in strict mode
- **Styling:** Tailwind CSS and shadcn/ui, restyled to `.kiro/steering/design.md`
- **Database, auth, storage:** Supabase (Postgres, Auth, Storage, Row Level Security) via `@supabase/ssr`
- **Validation and forms:** zod and react-hook-form
- **CSV parsing:** papaparse
- **QR codes:** `qrcode.react` to display, `@yudiel/react-qr-scanner` (or `html5-qrcode`) to scan
- **Animation:** Motion (formerly Framer Motion)
- **Charts:** recharts, for admin reports only
- **Tests:** Vitest and fast-check
- **Hosting:** Vercel

Do not add other services. Do not use any AI or LLM APIs in the app.

### Environment variables
Create `.env.local` (already in `.gitignore`) from `.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEMO_MODE=true
```
The service role key is used only on the server: in the seed script, the demo reset, and admin actions. Never import it into client code.

## 3. Database schema

Create this as a Supabase SQL migration in `supabase/migrations/`. Adjust only if something fails, and explain any change.

```sql
create extension if not exists pgcrypto;

create type user_role as enum ('admin','teacher','counselor','partner','student');
create type verification_type as enum ('class_activity','quiz','photo_review','qr_checkin');
create type review_status as enum ('pending','approved','rejected','reversed');

create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'school' check (kind in ('school','after_school_program')),
  district text,
  created_at timestamptz not null default now()
);

create table partner_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text,
  city text,
  created_at timestamptz not null default now()
);

create table school_partners (
  school_id uuid references schools on delete cascade,
  partner_org_id uuid references partner_orgs on delete cascade,
  primary key (school_id, partner_org_id)
);

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  role user_role not null,
  full_name text not null,
  school_id uuid references schools on delete set null,
  partner_org_id uuid references partner_orgs on delete set null,
  created_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools on delete cascade,
  name text not null,
  grade int not null check (grade between 2 and 12),
  teacher_id uuid references profiles on delete set null,
  created_at timestamptz not null default now()
);

create table class_rewards (
  class_id uuid references classes on delete cascade,
  stage text not null check (stage in ('village','town','city')),
  reward text not null check (char_length(reward) <= 140),
  primary key (class_id, stage)
);

create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools on delete cascade,
  class_id uuid references classes on delete set null,
  first_name text not null check (char_length(first_name) <= 50),
  last_initial text not null check (char_length(last_initial) = 1),
  grade int not null check (grade between 2 and 12),
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

create table modules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  level text not null check (level in ('learners','helpers','leaders')),
  quality text not null check (quality in ('Safety','Kindness','Responsibility','Respect','Helping','Civic action')),
  week_order int not null,
  note text,
  sponsor_name text,
  school_id uuid references schools on delete cascade,
  created_at timestamptz not null default now()
);

create table missions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references modules on delete cascade,
  day_number int not null check (day_number between 1 and 5),
  title text not null,
  story text not null,
  ask text not null,
  instructions text not null,
  points int not null default 10,
  verification verification_type not null,
  est_minutes int not null default 10,
  town_item text not null,
  quiz jsonb,
  unique (module_id, day_number)
);

create table class_modules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes on delete cascade,
  module_id uuid not null references modules on delete cascade,
  start_date date not null default current_date,
  unique (class_id, module_id)
);

create table mission_completions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions on delete cascade,
  student_id uuid not null references students on delete cascade,
  class_id uuid not null references classes on delete cascade,
  status review_status not null default 'pending',
  photo_path text,
  quiz_score int,
  confirmed_by uuid references profiles on delete set null,
  confirmed_at timestamptz,
  points_awarded int not null default 0,
  created_at timestamptz not null default now(),
  unique (mission_id, student_id)
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  partner_org_id uuid not null references partner_orgs on delete cascade,
  title text not null,
  description text not null,
  location_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  min_grade int not null default 9,
  capacity int,
  qr_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities on delete cascade,
  student_id uuid not null references students on delete cascade,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  hours numeric(4,2),
  status review_status not null default 'pending',
  approved_by uuid references profiles on delete set null,
  approved_at timestamptz,
  unique (opportunity_id, student_id)
);

create table badges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  level text check (level in ('learners','helpers','leaders')),
  icon text not null,
  rule jsonb not null
);

create table student_badges (
  student_id uuid references students on delete cascade,
  badge_id uuid references badges on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (student_id, badge_id)
);

create table audit_log (
  id bigint generated always as identity primary key,
  school_id uuid references schools on delete cascade,
  actor_id uuid references profiles on delete set null,
  action text not null,
  target_table text not null,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create view class_points with (security_invoker = true) as
select c.id as class_id, c.school_id, c.name, c.grade,
       (select count(*) from students s where s.class_id = c.id) as student_count,
       coalesce(sum(mc.points_awarded), 0) as total_points
from classes c
left join mission_completions mc on mc.class_id = c.id and mc.status = 'approved'
group by c.id;

create view class_town with (security_invoker = true) as
select mc.class_id, m.town_item, min(mc.confirmed_at) as placed_at
from mission_completions mc
join missions m on m.id = mc.mission_id
where mc.status = 'approved'
group by mc.class_id, m.id, m.town_item;

create view student_stamps with (security_invoker = true) as
select mc.student_id, mo.quality, count(*) as stamps
from mission_completions mc
join missions m on m.id = mc.mission_id
join modules mo on mo.id = m.module_id
where mc.status = 'approved'
group by mc.student_id, mo.quality;

create view student_hours with (security_invoker = true) as
select s.id as student_id, s.school_id, s.first_name, s.last_initial, s.grade,
       coalesce(sum(ch.hours) filter (where ch.status = 'approved'), 0) as verified_hours,
       coalesce(sum(ch.hours) filter (where ch.status = 'pending'), 0) as pending_hours
from students s
left join checkins ch on ch.student_id = s.id
group by s.id;
```

The class town has one building per distinct approved mission for that class, ordered by `placed_at`.

### Row Level Security
Enable RLS on every table. Write helper functions (`app_role()`, `app_school_id()`, `app_partner_org_id()`, `app_student_id()`) that read from `profiles` and `students` for `auth.uid()`, each declared `security definer` with `set search_path = ''`. Then:
- Admins and counselors read everything in their own school. Admins write classes, students, rewards, and profiles in their school.
- Teachers read and write only their own classes, those classes' students, rewards, class modules, and completions.
- Partners read and write only their own organization's opportunities and check-ins, and read only the first name, last initial, and grade of students who checked in.
- Leaders read only their own student row, completions, stamps, check-ins, and badges, plus opportunities from partners linked to their school.
- Modules and missions with `school_id is null` are readable by every signed-in user.
- `audit_log` has insert and select policies only. Add a trigger that raises an error on any update or delete.
- Add a trigger on `mission_completions` that blocks changes to protected columns (`status`, `points_awarded`, `confirmed_by`, `confirmed_at`) unless the caller is the class's teacher or a school admin. Approved completions can only change to `reversed`: by the class's teacher within 24 hours of `confirmed_at`, or by a school admin at any time. Every reversal writes to `audit_log` with the reason. Rows are never deleted.
- No one can read another school's data.

Write a SQL test script that checks a teacher can't see another teacher's class and that `audit_log` rows can't be updated or deleted.

### Storage
Create a private bucket `mission-photos`. Allow `image/jpeg`, `image/png`, and `image/webp` only, 5 MB maximum. Store files at `school_id/class_id/completion_id.jpg` with storage policies so only that class's teacher and the school's admins can read them. Serve photos with signed URLs that expire after 10 minutes. Re-encode every photo in the browser through a canvas before upload to strip EXIF data, including GPS.

## 4. Child privacy and content rules

- Store only a student's first name, last initial, grade, class, and avatar.
- No photos of children. The upload screen says: "Take a photo of the place, not of people."
- Never store a student's location.
- Learners and Helpers never get accounts. They use class mode on a teacher-signed-in device.
- Leaderboards are visible only inside the school. No public profiles, chat, or messaging.
- Stories use only original characters. No copyrighted or trademarked characters, brands, or logos.
- Stories for grades 2–5 show near misses and feelings, never injuries or anything frightening.
- All civics content is non-partisan.
- The admin can print a parent notice letter explaining what the app collects. It's informational, and parents don't need to act.

## 5. Pages and routes

Use route groups for each role, and redirect users to their home page after login based on `profiles.role`.

**Public**
- `/`: Landing page for judges and schools. Explains the idea, the Massachusetts civics project requirement, and the three levels. Includes "Try the demo" buttons for each demo role when `DEMO_MODE=true`, and mentions Google Classroom and Clever integration as coming next.
- `/login`: Email and password sign-in.

**Teacher**
- `/teacher`: Today view. For each class, today's mission with module, day, quality, minutes, and proof type, a mini town preview, and a large "Start mission" button. Shows "Done today" after confirmation.
- `/teacher/class/[id]/run/[missionId]`: Three steps, each large enough for a projector:
  1. **Story:** the story or case study, with the Pip comic or illustration for Learners, and the discussion question. Button: "Show today's mission."
  2. **Mission:** title, quality, and instructions. Button: "We finished the activity."
  3. **Who took part:** roster with everyone checked, plus "Select everyone" and "Clear all." The teacher unchecks absent students and taps "Confirm for class." This saves completions, awards points and stamps only to checked students, adds the town building, writes to `audit_log`, and triggers the balloon celebration. Then it shows the saved mission record.
- **Fixing mistakes:** For 24 hours after confirming, the Today view shows "Edit who took part" and "Undo" on that class's mission.
  - **Edit who took part** reopens the roster with the saved selection. Saving adds completions for newly checked students and marks removed students' completions `reversed`, updating their points and stamps. Each change is logged.
  - **Undo** asks for a reason (pressed by mistake, the activity didn't happen, or wrong class), then marks all of that mission's completions for the class `reversed`, which removes the points, stamps, and town building, and returns the mission to "not done" so it can be run again. The undo is logged with the reason.
  - After 24 hours, only a school admin can reverse a confirmation, from the proof log.
  - The Today view shows a "Today's proof log" panel with confirmations, edits, and undos.
- `/teacher/class/[id]`: Roster, class town, rank, module progress, and recent mission records.
- `/teacher/class/[id]/town`: Full-screen town for the projector, with the stage and next reward.
- `/teacher/class/[id]/rewards`: Edit the village, town, and city rewards. Defaults: "The class picks a game for Friday afternoon," "The class goes on the school's Good Citizens board," and "The principal visits for a class celebration."
- `/teacher/roadmap`: The roadmap for the teacher's level. Each module is a transit line, and each day is a station. Selecting a day shows its story, discussion question, instructions, proof type, stamp, and town building. Today's mission is marked.
- `/teacher/class/[id]/play`: Class mode, the student dashboard for grades 2–8. A student taps their avatar or scans their QR card and sees their own dashboard in the sticker book skin: points, stamp passport, badges, today's mission, and recent missions with who confirmed them. Students can pick their theme (Hero, Bubblegum, Ocean, or Classic), which is saved on their student row. Quizzes and photo uploads happen here too. A clear "Next student" button returns to the picker. Every student gets a dashboard, but only grades 9–12 get accounts.
- `/teacher/review`: Swipe-through review of pending photos with Approve and Reject, plus keyboard shortcuts A and R.
- `/teacher/class/[id]/cards`: Printable QR login cards, eight per page, with avatar and first name.

**Partner**
- `/partner`: Opportunities, plus "Post an opportunity."
- `/partner/opportunity/[id]`: A large QR code to display at the site, "Make a new code" (old code stops working), a live list of check-ins, and "Approve hours" per row or for everyone.

**Leader (grades 9–12)**
- `/me`: Verified hours, pending hours, badges, and upcoming opportunities, with a proof timeline for today: checked in, checked out, approved by whom.
- `/me/scan`: Camera QR scanner. The first scan checks in, and a second scan of the same code checks out. Hours are the difference rounded down to the nearest quarter hour, capped at 8.
- `/me/certificate`: Printable certificate of approved hours.

**Counselor**
- `/counselor`: Leaders with verified hours, searchable, with CSV export.

**School admin**
- `/admin`: Students, missions confirmed this week, verified hours, class leaderboard, and Civics Project progress.
- `/admin/proof-log`: The append-only proof log of confirmations, approvals, imports, invites, and resets, newest first.
- `/admin/roster`: CSV upload (`first_name, last_initial, grade, class_name`) with a validation preview before import, and a sample CSV.
- `/admin/teachers`: Invite teachers by email with `auth.admin.inviteUserByEmail` in a server action.
- `/admin/reports`: Missions by week, quality, and level, and total community impact.
- `/admin/parent-notice`: Printable notice letter.

## 6. Security requirements (mandatory)

This app stores data about children. Treat any violation as a bug.

**SQL injection.** Use only the Supabase query builder or `.rpc()` with named parameters. Never concatenate or interpolate SQL. Inside PL/pgSQL, use parameters, and if dynamic SQL is unavoidable, use `format()` with `%I` and `%L`. Every `security definer` function sets `search_path = ''` and fully qualifies table names.

**Authentication.** Turn off public sign-ups. Accounts come only from invites, the seed script, or admin-created Leader logins. Require at least 10-character passwords for real accounts, and enable Supabase Auth rate limits and leaked-password protection if available. On the server, check identity with `supabase.auth.getUser()`, never `getSession()` alone. Use the `@supabase/ssr` middleware pattern so cookies stay `httpOnly`, `secure`, and `sameSite=lax`. Redirect after login only to relative paths starting with a single `/`. Sign-out clears the session on the server and client.

**Authorization.** RLS is the main defense, and every server action and route handler also checks role and ownership. The service role key is used only in the seed, the demo reset, and invites, after re-checking that the caller is an admin of the right school. Never accept client values for `points_awarded`, `status`, `confirmed_by`, `approved_by`, `hours`, `role`, `school_id`, or `level`. Students can only create completions and check-ins with `status = 'pending'`. Nobody approves their own work.

**Input validation.** Validate every input with zod on the server, reject unknown fields, set maximum lengths (50 characters for names, 2,000 for descriptions), and validate UUIDs before use.

**XSS.** Render user text through React only. Never use `dangerouslySetInnerHTML` with user data. Allow only `http` and `https` links.

**CSRF.** Use server actions for mutations. Custom route handlers that change data accept only POST, PATCH, or DELETE and verify that the `Origin` header matches `NEXT_PUBLIC_APP_URL`.

**File uploads.** As in section 3: private bucket, image types only, 5 MB limit set on the bucket, server-generated names, EXIF stripped, 10-minute signed URLs.

**QR codes and login cards.** Generate all codes with `crypto.randomBytes` or `gen_random_bytes`, never `Math.random`. A login card code only selects a student inside class mode, on a device where that class's teacher is signed in, and the lookup is rate limited. A Leader can check in only if signed in, linked to that partner's school, at or above `min_grade`, within capacity, and between 30 minutes before the start and the end time. Hours stay pending until a partner approves. Partners can regenerate a code at any time.

**Quizzes.** Send questions and options only. Grade on the server.

**Rate limiting.** Use the `rate_limits` table in server actions for logins, QR lookups (10 per minute per teacher device), check-ins, quiz submissions, and uploads (20 per hour per class).

**Security headers.** In `next.config`, for every route: a CSP allowing scripts only from the app, fonts from Google Fonts, images from the app and the Supabase Storage domain, and connections only to the Supabase project; `frame-ancestors 'none'` and `X-Frame-Options: DENY`; `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.

**CSV safety.** Imports are limited to 1 MB and 2,000 rows. Exports prefix any cell starting with `=`, `+`, `-`, `@`, tab, or carriage return with a single quote.

**Errors and logging.** Users see clear, friendly messages, never stack traces or SQL errors. Never log passwords, tokens, keys, or student names. Write to `audit_log` for every confirmation, approval, rejection, reversal, roster import, invite, and demo reset.

**Demo mode.** Demo logins and "Reset demo data" exist only when `DEMO_MODE=true`, checked on the server. The README explains how to turn it off and delete demo accounts before real use.

**Secrets and dependencies.** The service role key never has the `NEXT_PUBLIC_` prefix and lives only in files that start with `import 'server-only'`. Commit `.env.example`, never `.env.local`. Never put tokens in committed Kiro MCP settings. Pin exact versions, commit the lockfile, and run `npm audit` before the demo.

**Security tests.** Write `SECURITY_TESTS.md` and automated tests where practical that confirm:
- A teacher can't read or modify another teacher's class, students, or photos through direct API calls.
- A Leader can't approve their own hours or change `points_awarded`.
- `' OR 1=1 --` and `<script>alert(1)</script>` in every text field change nothing and display as plain text.
- A non-image file renamed to `.jpg` is rejected.
- An old QR token stops working after regeneration.
- Quiz answers never appear in network responses.
- A CSV export of `=HYPERLINK(...)` opens as plain text.
- `audit_log` rows can't be updated or deleted.
- All security headers are present.

## 7. Game mechanics

- **Points:** Each approved mission awards its points (10 for Learners and Helpers, 15 for Leaders) to each student who took part.
- **Stamps:** Each approved mission adds one stamp for its module's quality to each student who took part. Stamps show in the stamp passport.
- **Class town:** A 6 × 6 grid. Each distinct approved mission adds its `town_item`. Stages: village at 10 buildings, town at 25, city at 36, after which the grid expands to 8 × 8. Show the progress toward the next stage as crosswalk stripes, with the teacher's reward for each stage.
- **Town items:** tree, park, bench, crosswalk, library, clinic, bus stop, recycling center, community garden, playground, food bank, school, bike lane, fire station. Use the Fluent Emoji 3D icons listed in `.kiro/steering/design.md`, self-hosted in `public/icons/`.
- **Celebration:** On confirmation, one balloon per student (up to 28) floats up and pops, followed by the building dropping into the town. Respect `prefers-reduced-motion` with a static message.
- **Leaderboard:** Classes ranked within the school by points per student. Learners never see individual rankings.
- **Badges** (checked after each approval): First Mission (one mission), Week Streak (all five missions of a module), Safety Star (all of Safe Streets), Kindness Champion (10 Kindness stamps), Community Server (10 verified hours), Youth Leader (25 verified hours).
- **No grades and no failing.** A wrong quiz answer explains the right one and allows another try.

## 8. Seed data and demo

Write `scripts/seed.ts`, run with `npm run seed` using the service role key. It reads `docs/missions.md` (or a JSON file generated from it) and creates:
- **School:** Maple Street School
- **Classes:** Grade 3 with Ms. Rivera (24 students, on Safe Streets, day 1), Grade 7 with Mr. Chen (22 students, on Respect Everywhere, day 2), Grade 11 Advisory with Ms. Okafor (20 students with logins, on Civics Project, day 3), plus Grade 4 and Grade 10 for a fuller leaderboard
- **Default class rewards** for every class
- **Partners:** Greater Community Food Bank (supervisor Dana K.) and Riverside Park Friends, linked to the school, each with two opportunities in the next two weeks
- **All 10 modules and 50 missions** with story, discussion question, instructions, verification, points, minutes, and town building. Map proof types: "Teacher watched" = `class_activity`, "Short quiz" = `quiz` (write three questions each), "Photo" = `photo_review`, "QR check-in" = `qr_checkin`.
- **Demo accounts**, password `demo1234`, only in demo mode: admin@demo.civicquest.app, teacher3@demo.civicquest.app, teacher7@demo.civicquest.app, teacher11@demo.civicquest.app, counselor@demo.civicquest.app, partner@demo.civicquest.app, leader@demo.civicquest.app (linked to Jordan M., grade 11)
- **Two weeks of history:** the grade 3 town about half full, realistic stamps for every student, and audit log entries for past confirmations.

## 9. Design

Follow `.kiro/steering/design.md` exactly: the calm skin for adult screens and the sticker book skin with four kid themes for kid-facing and projector screens. `docs/themes-sample.html` shows both. Use `docs/simulation.html` for the flow and screen content, not for colors or fonts.

## 10. How we use Kiro (this is judged)

- **Specs:** Build from a spec in `.kiro/specs/`, generated from `docs/kiro-spec-kickoff.md`. Requirements, design, and tasks should trace back to this document.
- **Steering:** Six always-on files in `.kiro/steering/`: product, tech, structure, security, child-privacy, and design.
- **Hooks:** Create the hooks in `docs/kiro-hooks.md`.
- **MCP:** Use the Supabase MCP server against the development project to apply migrations and inspect tables. Keep tokens out of committed files.
- **Property-based tests:** Put these rules in `lib/domain/` and test them with fast-check:
  - Hours are never negative, always a multiple of 0.25, never more than 8, and never more than the real elapsed time.
  - Grade maps to exactly one level for every grade from 2 to 12, and rejects anything else.
  - Town placement never exceeds the grid, never duplicates a mission, and is the same regardless of the order completions arrive in.
  - Town stage is monotonic: adding a building never lowers the stage.
  - Points and stamps are awarded only to students marked present, exactly once per mission.
  - Confirming and then undoing a mission leaves every student's points and stamps and the class town exactly as they were before.
  - Editing who took part from set A to set B gives the same totals as confirming set B directly.
  - Sanitized CSV cells never start with `=`, `+`, `-`, `@`, tab, or carriage return, and normal text is unchanged.
  - Redirect paths that aren't relative single-slash paths are always rejected.
- **Write-up:** Keep notes in `docs/KIRO_WRITEUP.md` as features are built.

## 11. Out of scope

Parent accounts, chat or messaging, payments, push notifications, native apps, Google Classroom or Clever integration (mention as coming next), AI features in the app, and public profiles.

## 12. Definition of done

This demo works end to end on a laptop and a phone:
1. As the grade 3 teacher, open the roadmap and see this week's Safe Streets line.
2. Start today's mission. Show Pip's story, then the mission, then confirm the class with one absent student. Balloons pop, a crosswalk drops into the town, and the saved mission record shows who confirmed it and who was absent. Then use "Edit who took part" to add the absent student back, and "Undo" to reverse the whole mission. Points, stamps, and the town return to how they were, and all three actions appear in the proof log.
3. In class mode, a student who took part sees a new Safety stamp, while the absent student doesn't.
4. As the partner, display an opportunity's QR code. As the Leader on a phone, check in and out, then approve the hours as the partner. The Leader's proof timeline and certificate update.
5. As the counselor, the hours appear and the CSV export works.
6. As the admin, the leaderboard, Civics Project progress, and proof log reflect everything above.
7. Every check in `SECURITY_TESTS.md` passes, all property-based tests pass, and `npm audit` shows no high or critical issues.

Finish with a README that covers setup, demo accounts, the demo script above, and a "Before real use" section: set `DEMO_MODE=false`, delete demo accounts, and rotate keys.
