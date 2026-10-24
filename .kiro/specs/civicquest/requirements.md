# Requirements Document

## Introduction

CivicQuest is a web app that teaches civic sense to students in grades 2–12 through one short real-world mission per school day. Schools and after-school programs use it; parents have no accounts. The core loop is: a short story or case study with a discussion question, then the class does the mission, then an adult confirms who took part. Each student present earns points and a stamp for the mission's quality, and each class builds a shared town that grows one building per distinct approved mission. Leaders (grades 9–12) earn verified volunteer hours through QR check-in and check-out at partner organizations, approved by a partner supervisor.

This document specifies **only the day-one hackathon build scope** (Hackachusetts, Civic Action track, challenge V5), traced to `docs/build-prompt.md`, `docs/missions.md`, and the always-on steering files in `.kiro/steering/`. Requirements are numbered sequentially and the title of each names the build **Step** it belongs to, so the builder can stop, test, and commit after each step. Stretch items (Steps 8–10) are titled "Stretch". Items listed as out of scope are not specified here, but every security and child-privacy rule that applies to what IS built remains mandatory.

This application stores data about children. Every security and privacy requirement in this document is mandatory, and any violation is treated as a bug (per `docs/build-prompt.md` sections 4 and 6 and the `security.md` and `child-privacy.md` steering files).

### Build steps and requirement map

- **Step 1 — Setup, database, security foundation:** Requirements 1–7
- **Step 2 — Domain logic and property-based tests:** Requirements 8–15
- **Step 3 — Seed data and demo content:** Requirements 16–17
- **Step 4 — Core loop:** Requirements 18–23
- **Step 5 — Roadmap:** Requirement 24
- **Step 6 — Leaders flow:** Requirements 25–28
- **Step 7 — Landing, demo controls, admin overview:** Requirements 29–31
- **Cross-cutting — Mandatory security and child privacy (applies to all steps):** Requirements 32–37
- **Stretch (only if Steps 1–7 work):** Requirements 38–40

## Glossary

- **CivicQuest_System**: The complete web application, including Next.js app, Supabase database, auth, and storage.
- **Level**: The automatically assigned band derived from a student's grade. Exactly one of Learners (grades 2–5), Helpers (grades 6–8), or Leaders (grades 9–12).
- **Learner**: A student in grades 2–5. Uses class mode only; has no personal account.
- **Helper**: A student in grades 6–8. Uses class mode only; has no personal account.
- **Leader**: A student in grades 9–12. Has a personal login and checks in to partner opportunities.
- **Class_Mode**: A shared view on a teacher-signed-in device used by Learners and Helpers; no student login occurs.
- **Module**: A themed week of five missions (one per school day). There are 10 modules.
- **Mission**: One school-day activity within a module, including story/case study, discussion question, instructions, points, proof type, estimated minutes, and a town building. There are 50 missions.
- **Quality**: The civic value a module teaches and that its stamp represents. One of Safety, Kindness, Responsibility, Respect, Helping, Civic action.
- **Stamp**: A quality marker awarded to a present student for an approved mission, shown in the stamp passport.
- **Completion**: A `mission_completions` row linking a student, mission, and class with a review status, points awarded, and who confirmed it.
- **Verification_Type**: How a mission is proven: `class_activity`, `quiz`, `photo_review`, or `qr_checkin`. (Only `class_activity` and `qr_checkin` flows are built in this scope.)
- **Review_Status**: The lifecycle state of a completion or check-in: `pending`, `approved`, `rejected`, or `reversed`.
- **Points**: Numeric reward for an approved mission: 10 for Learners and Helpers, 15 for Leaders, awarded to each present student.
- **Class_Town**: A shared 6×6 grid per class. Each distinct approved mission for the class adds one building (the mission's `town_item`), ordered by placement time.
- **Town_Stage**: The class town's growth stage by building count: village at 10, town at 25, city at 36, after which the grid expands to 8×8.
- **Town_Item**: The building type placed for a mission (e.g., tree, park, bench, crosswalk, library, clinic, bus stop, recycling center, community garden, playground, food bank, school, bike lane, fire station).
- **Reward**: A teacher-set text reward unlocked at a town stage (village, town, city).
- **Opportunity**: A partner-posted volunteer event with title, description, location, start/end times, minimum grade, optional capacity, and a QR token.
- **Check_In**: A `checkins` row recording a Leader's check-in and check-out timestamps at an opportunity, computed hours, and approval status.
- **Verified_Hours**: Elapsed check-in-to-check-out time, rounded down to the nearest 0.25 hour, capped at 8, counted only after a partner approves.
- **Audit_Log**: An append-only record (`audit_log`) of confirmations, edits, reversals, approvals, invites, and demo resets. Cannot be updated or deleted.
- **Proof_Log**: The human-readable view of audit log entries shown to teachers (today's actions) and admins (full history).
- **Demo_Mode**: The state where `DEMO_MODE=true`; enables one-click demo logins and demo data reset, checked on the server.
- **Service_Role_Key**: The Supabase service role key, used only on the server (seed, demo reset, admin actions after re-checking admin), never exposed to client code.
- **Calm_Skin**: The visual skin for adult-facing screens (teacher, admin, partner, counselor, Leader by default).
- **Sticker_Skin**: The visual skin for kid-facing and projector screens.
- **Kid_Theme**: A per-student color theme: Hero, Bubblegum, Ocean, or Classic.

## Requirements

### Requirement 1: Step 1 — Project Scaffolding and Supabase Clients

**User Story:** As the developer, I want a configured Next.js project with Supabase clients, so that every later step builds on a secure, typed foundation.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL be built on Next.js version 14.0.0 or higher using the App Router, with TypeScript configured in strict mode (`strict: true` in tsconfig.json).
2. THE CivicQuest_System SHALL use Tailwind CSS and shadcn/ui for all component styling.
3. THE CivicQuest_System SHALL provide exactly three Supabase clients — a browser client, a server client, and an admin client — each created through the `@supabase/ssr` package.
4. THE CivicQuest_System SHALL read configuration from the `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, and `DEMO_MODE` environment variables.
5. IF any of the five required environment variables is absent or empty at application startup, THEN THE CivicQuest_System SHALL halt startup and emit an error message identifying each missing variable by name.
6. THE CivicQuest_System SHALL restrict the Service_Role_Key to server-only files whose first statement is `import 'server-only'`, and SHALL never reference the Service_Role_Key through any identifier bearing the `NEXT_PUBLIC_` prefix.
7. THE CivicQuest_System SHALL pin every production and development dependency to an exact version (no range specifiers such as `^` or `~`) and SHALL commit the dependency lockfile to the repository.

### Requirement 2: Step 1 — Database Schema Migration

**User Story:** As the developer, I want the full schema applied as a migration, so that all later features have the tables, views, enums, and constraints they depend on.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL apply a Supabase SQL migration located in `supabase/migrations/` that creates every table, enum, view, and constraint defined in `docs/build-prompt.md` section 3, such that no object listed in that section is absent from the resulting schema.
2. THE CivicQuest_System SHALL define the `user_role` enum with exactly the values `admin`, `teacher`, `counselor`, `partner`, `student`; the `verification_type` enum with exactly the values `class_activity`, `quiz`, `photo_review`, `qr_checkin`; and the `review_status` enum with exactly the values `pending`, `approved`, `rejected`, `reversed`.
3. THE CivicQuest_System SHALL define `students.level` as a stored generated column that resolves to `learners` for grade 2 through 5, `helpers` for grade 6 through 8, and `leaders` for grade 9 through 12.
4. THE CivicQuest_System SHALL enforce the column constraints `students.first_name` length of 1 to 50 characters, `students.last_initial` length of exactly 1 character, `class_rewards.reward` length of 0 to 140 characters, `classes.grade` and `students.grade` within the range 2 to 12 inclusive, `missions.day_number` within the range 1 to 5 inclusive, and unique keys on `mission_completions (mission_id, student_id)` and `checkins (opportunity_id, student_id)`.
5. THE CivicQuest_System SHALL create the `class_points`, `class_town`, `student_stamps`, and `student_hours` views, each declared with `security_invoker = true`.
6. IF a value violates any constraint defined in criterion 4, THEN THE CivicQuest_System SHALL reject the write, leave the stored data unchanged, and return an error indicating the violated constraint.
7. IF a schema element must be changed for the migration to apply successfully, THEN THE CivicQuest_System SHALL record the changed element and the reason for the change in the build log before the migration completes.

### Requirement 3: Step 1 — Row Level Security and Helper Functions

**User Story:** As a school administrator, I want every table protected by row level security, so that no one can read or modify another school's children's data.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL enable row level security on every table in the schema, such that no table has row level security disabled.
2. THE CivicQuest_System SHALL define the `app_role()`, `app_school_id()`, `app_partner_org_id()`, and `app_student_id()` helper functions as `security definer`, each with `search_path = ''` and all referenced table names fully qualified.
3. WHEN a user with the admin or counselor role reads data, THE CivicQuest_System SHALL return only rows whose school matches the user's own `school_id`.
4. WHEN a user with the admin role writes to classes, students, rewards, or profiles, THE CivicQuest_System SHALL permit the write only for rows whose school matches the user's own `school_id`.
5. WHEN a user with the teacher role reads or writes classes, those classes' students, rewards, class modules, or completions, THE CivicQuest_System SHALL permit the operation only for rows belonging to classes the user owns.
6. WHEN a user with the partner role reads or writes opportunities or check-ins, THE CivicQuest_System SHALL permit the operation only for rows belonging to the user's own organization.
7. WHEN a user with the partner role reads student data for a check-in, THE CivicQuest_System SHALL expose only the first name, last initial, and grade of students who checked in, and no other student fields.
8. WHEN a user with the Leader role reads data, THE CivicQuest_System SHALL return only that user's own student row, completions, stamps, check-ins, and badges, plus opportunities from partners linked to the user's own school.
9. WHEN any signed-in user reads modules or missions whose `school_id` is null, THE CivicQuest_System SHALL return those rows regardless of the user's school.
10. IF a user attempts to read data belonging to a school other than the user's own, THEN THE CivicQuest_System SHALL return zero rows for that data.

### Requirement 4: Step 1 — Audit Log and Completion Protection Triggers

**User Story:** As a school administrator, I want the proof log to be tamper-proof and approved work protected, so that records of children's participation stay trustworthy.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL restrict `audit_log` to insert and select operations only, rejecting any update or delete operation.
2. IF any process attempts to update or delete an `audit_log` row, THEN THE CivicQuest_System SHALL reject the operation, return an error indicating that `audit_log` rows are immutable, and leave the targeted row unchanged.
3. IF a caller who is neither the class's teacher nor a school admin attempts to modify any of the `mission_completions` protected columns `status`, `points_awarded`, `confirmed_by`, or `confirmed_at`, THEN THE CivicQuest_System SHALL reject the change, return an error indicating insufficient authorization, and leave the affected columns unchanged.
4. WHEN the class's teacher changes an approved completion's `status` within 24 hours of `confirmed_at`, THE CivicQuest_System SHALL allow the change only if the new value is `reversed`.
5. WHERE the caller is a school admin, THE CivicQuest_System SHALL allow an approved completion's `status` to change only to `reversed`, with no time limit relative to `confirmed_at`.
6. IF the class's teacher attempts to change an approved completion's `status` more than 24 hours after `confirmed_at`, OR IF any caller attempts to change `status` to a value other than `reversed`, THEN THE CivicQuest_System SHALL reject the change, return an error indicating the change is not permitted, and leave `status` unchanged.
7. WHEN a completion is reversed, THE CivicQuest_System SHALL write exactly one `audit_log` entry that includes a non-empty reversal reason of 1 to 500 characters.
8. IF a reversal is attempted without a reversal reason of 1 to 500 characters, THEN THE CivicQuest_System SHALL reject the reversal, return an error indicating a valid reason is required, and leave `status` unchanged.
9. IF any process attempts to delete a `mission_completions` row, THEN THE CivicQuest_System SHALL reject the operation, return an error indicating completions cannot be deleted, and retain the row.

### Requirement 5: Step 1 — Storage Bucket and Policies

**User Story:** As a school administrator, I want mission photos stored privately, so that only the right staff can view them and no child's image or location leaks.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a storage bucket named `mission-photos` that is not publicly accessible.
2. WHEN a file is uploaded to the `mission-photos` bucket, THE CivicQuest_System SHALL accept it only if its type is `image/jpeg`, `image/png`, or `image/webp` and its size is 5 MB (5,242,880 bytes) or less.
3. IF an upload to the `mission-photos` bucket has a type other than `image/jpeg`, `image/png`, or `image/webp`, OR exceeds 5 MB (5,242,880 bytes), THEN THE CivicQuest_System SHALL reject the upload, return an error indicating the file type or size is not allowed, and store no file.
4. THE CivicQuest_System SHALL store each accepted file at the path `school_id/class_id/completion_id.jpg`.
5. WHEN a caller requests read access to an object in the `mission-photos` bucket, THE CivicQuest_System SHALL grant access only if the caller is the owning class's teacher or an admin of the owning school.
6. IF a caller who is neither the owning class's teacher nor an admin of the owning school requests read access to an object in the `mission-photos` bucket, THEN THE CivicQuest_System SHALL deny access and return an error indicating insufficient authorization.
7. WHEN an authorized caller requests a stored photo, THE CivicQuest_System SHALL serve it via a signed URL that expires within 10 minutes (600 seconds) of issuance.

### Requirement 6: Step 1 — Security Headers, Middleware, and Login Page

**User Story:** As a security-conscious administrator, I want secure headers, role-based routing, and a locked-down sign-in, so that the app resists common web attacks and public sign-ups are impossible.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL set security headers in `next.config` on the response for every route, including a Content Security Policy that allows scripts only from the app origin, fonts from Google Fonts, images from the app origin and the Supabase Storage domain, and network connections only to the Supabase project origin.
2. THE CivicQuest_System SHALL set `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(self), microphone=(), geolocation=()` on the response for every route.
3. THE CivicQuest_System SHALL restrict account creation so that new accounts originate only from invites, the seed script, or admin-created Leader logins.
4. IF an unauthenticated request attempts a public self-service sign-up, THEN THE CivicQuest_System SHALL reject the request without creating an account and return a response indicating that public sign-up is disabled.
5. WHEN a request requires authentication, THE CivicQuest_System SHALL verify identity on the server with `supabase.auth.getUser()` and SHALL NOT rely on `getSession()` alone.
6. THE CivicQuest_System SHALL issue session cookies using the `@supabase/ssr` middleware pattern with the attributes `httpOnly`, `secure`, and `sameSite=lax`.
7. WHEN a user submits valid credentials on the `/login` page, THE CivicQuest_System SHALL authenticate the user and redirect the user to the home page associated with the user's `profiles.role`.
8. IF a user submits invalid credentials, empty email, or empty password on the `/login` page, THEN THE CivicQuest_System SHALL reject the sign-in without establishing a session and display an error message indicating that authentication failed, without revealing which field was incorrect.
9. IF an authenticated user has no `profiles` row or a null `profiles.role`, THEN THE CivicQuest_System SHALL deny access to role-protected routes and redirect the user to the `/login` page.
10. WHEN a signed-in user requests a route outside the user's role group, THE CivicQuest_System SHALL redirect the user to the home page associated with the user's own `profiles.role`.
11. THE CivicQuest_System SHALL provide a `/login` page with email and password sign-in fields.
12. WHEN the CivicQuest_System redirects after login, THE CivicQuest_System SHALL redirect only to a relative path that begins with a single `/` character.
13. IF a post-login redirect target does not begin with a single `/` character, begins with `//`, or resolves to an external origin, THEN THE CivicQuest_System SHALL ignore the requested target and redirect the user to the home page associated with the user's `profiles.role`.

### Requirement 7: Step 1 — Design Skins and Icon System

**User Story:** As a user, I want the calm and sticker-book skins with their design tokens and self-hosted icons, so that every screen matches the design system and stays within the content security policy.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL define the Calm_Skin and Sticker_Skin design tokens and fonts matching the values specified in `.kiro/steering/design.md`, including both light and dark values.
2. THE CivicQuest_System SHALL select the active skin via `data-skin="calm"` or `data-skin="sticker"` on a layout wrapper and select the Kid_Theme via the `data-kid-theme` attribute.
3. THE CivicQuest_System SHALL store the Fluent Emoji 3D icons listed in `.kiro/steering/design.md` under `public/icons/` and serve those icons only from the app origin.
4. THE CivicQuest_System SHALL provide an icon component that maps each defined icon name to its corresponding file in `public/icons/`.
5. IF the icon component receives an icon name that has no matching file in `public/icons/`, THEN THE CivicQuest_System SHALL render a fallback placeholder icon without raising an unhandled error.
6. THE CivicQuest_System SHALL credit Fluent Emoji in the README.

### Requirement 8: Step 2 — Level Assignment Logic

**User Story:** As the developer, I want pure level-assignment logic, so that every grade maps to exactly one level reliably.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a pure function in `lib/domain/` that maps an integer grade to its level.
2. WHEN an integer grade from 2 to 5 inclusive is provided, THE CivicQuest_System SHALL return `learners`.
3. WHEN an integer grade from 6 to 8 inclusive is provided, THE CivicQuest_System SHALL return `helpers`.
4. WHEN an integer grade from 9 to 12 inclusive is provided, THE CivicQuest_System SHALL return `leaders`.
5. IF a value is not an integer in the range 2 to 12 inclusive, THEN THE CivicQuest_System SHALL return an explicit rejection result rather than a level and SHALL NOT throw an unhandled error.
6. THE CivicQuest_System SHALL verify with a property-based test that every integer grade from 2 to 12 maps to exactly one level, that the boundaries 5/6 and 8/9 fall in non-overlapping bands, and that out-of-range or non-integer values are rejected.

### Requirement 9: Step 2 — Points and Stamps Logic

**User Story:** As the developer, I want pure points and stamp logic, so that only present students are rewarded, exactly once per mission.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide pure functions in `lib/domain/` that compute points and stamps for a mission given the set of present students, where the present students are treated as a distinct set of student identifiers.
2. WHEN points are computed for an approved mission, THE CivicQuest_System SHALL award 10 points to each present student for a Learners or Helpers mission and 15 points to each present student for a Leaders mission.
3. WHEN stamps are computed for an approved mission, THE CivicQuest_System SHALL award exactly one stamp of the mission's module quality to each present student.
4. THE CivicQuest_System SHALL award points and stamps only to students in the present set and to no other student.
5. WHEN the present set contains duplicate identifiers for a student, THE CivicQuest_System SHALL award that student points and stamps exactly once for the mission.
6. WHEN the present set is empty, THE CivicQuest_System SHALL award 0 total points and 0 stamps.
7. THE CivicQuest_System SHALL verify with a property-based test that total points equal the per-student amount times the count of distinct present students, that stamps equal the count of distinct present students, and that absent students receive nothing.

### Requirement 10: Step 2 — Verified Hours Logic

**User Story:** As the developer, I want pure hours logic, so that volunteer hours are always valid, bounded, and never exceed real elapsed time.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a pure function in `lib/domain/` that computes verified hours from a check-in time and a check-out time.
2. WHEN check-out is at or after check-in, THE CivicQuest_System SHALL compute elapsed time, round it down to the nearest 0.25 hour, and then cap the result at 8.
3. IF check-out is before check-in, THEN THE CivicQuest_System SHALL return 0.
4. THE CivicQuest_System SHALL return hours that are never negative, are always a multiple of 0.25, and never exceed 8.
5. THE CivicQuest_System SHALL return hours that never exceed the real elapsed time between check-in and check-out.
6. THE CivicQuest_System SHALL verify with a property-based test, including reversed timestamp pairs, that hours are never negative, are always a multiple of 0.25, never exceed 8, and never exceed the real elapsed time.

### Requirement 11: Step 2 — Town Placement Logic

**User Story:** As the developer, I want pure town-placement logic, so that the class town is consistent and never corrupts regardless of input order.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a pure function in `lib/domain/` that places buildings in the class town from a set of distinct approved missions.
2. THE CivicQuest_System SHALL add exactly one building per distinct approved mission.
3. THE CivicQuest_System SHALL never place more buildings than the current grid capacity (36 cells on a 6×6 grid, 64 cells on an 8×8 grid), and WHEN the distinct mission count exceeds capacity THE CivicQuest_System SHALL place buildings only up to capacity.
4. THE CivicQuest_System SHALL never place more than one building for the same mission even when a mission appears multiple times in the input.
5. THE CivicQuest_System SHALL assign the same building to the same cell regardless of the order in which completions arrive.
6. THE CivicQuest_System SHALL verify with a property-based test, over input permutations and duplicate inputs, that placement never exceeds the grid capacity, never duplicates a mission, and yields an identical cell assignment regardless of order.

### Requirement 12: Step 2 — Town Stage Logic

**User Story:** As the developer, I want pure town-stage logic, so that stage progression is predictable and never regresses.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a pure function in `lib/domain/` that computes the town stage and grid size from a building count.
2. WHEN the building count is 0 to 9 inclusive, THE CivicQuest_System SHALL report the pre-village stage on a 6×6 grid.
3. WHEN the building count is 10 to 24 inclusive, THE CivicQuest_System SHALL report the village stage on a 6×6 grid.
4. WHEN the building count is 25 to 35 inclusive, THE CivicQuest_System SHALL report the town stage on a 6×6 grid.
5. WHEN the building count is 36 or greater, THE CivicQuest_System SHALL report the city stage on an 8×8 grid.
6. IF the building count is negative or not an integer, THEN THE CivicQuest_System SHALL return an explicit rejection result and SHALL NOT throw an unhandled error.
7. WHEN the building count does not decrease, THE CivicQuest_System SHALL never report a stage of lower rank than before, where the rank order is pre-village < village < town < city.
8. THE CivicQuest_System SHALL verify with a property-based test that the town stage is monotonic non-decreasing as the building count increases.

### Requirement 13: Step 2 — CSV Cell Sanitizing Logic

**User Story:** As the developer, I want pure CSV-sanitizing logic, so that exported spreadsheets cannot execute injected formulas.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a pure function in `lib/domain/` that sanitizes a CSV cell value for export.
2. IF a cell value's first character is `=`, `+`, `-`, `@`, a tab, or a carriage return, THEN THE CivicQuest_System SHALL prefix the value with a single leading apostrophe and leave all other characters unchanged.
3. WHEN a cell value's first character is none of `=`, `+`, `-`, `@`, tab, or carriage return, THE CivicQuest_System SHALL return the value unchanged.
4. WHEN the cell value is an empty string, THE CivicQuest_System SHALL return an empty string unchanged.
5. THE CivicQuest_System SHALL verify with a property-based test that sanitized cells never start with `=`, `+`, `-`, `@`, tab, or carriage return, and that values not starting with a dangerous character are returned unchanged.

### Requirement 14: Step 2 — Safe Redirect Logic

**User Story:** As the developer, I want pure safe-redirect logic, so that post-login redirects cannot send users to external or crafted destinations.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a pure function in `lib/domain/` that validates a redirect path and returns a safe path.
2. WHEN a path begins with exactly one `/` not immediately followed by `/` or `\`, THE CivicQuest_System SHALL accept the path and return it.
3. IF a path is empty, lacks a leading `/`, begins with `//`, begins with `/\`, contains a URL scheme, contains control characters, or has leading or trailing whitespace, THEN THE CivicQuest_System SHALL reject the path and return the safe default `/`.
4. THE CivicQuest_System SHALL verify with a property-based test that any path which is not a relative single-slash path is rejected and that the function returns the safe default `/` for all rejected inputs.

### Requirement 15: Step 2 — Reversal and Edit Equivalence Logic

**User Story:** As the developer, I want confirm, undo, and edit logic to be provably reversible and equivalent, so that fixing mistakes never leaves bad totals.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL treat the set of present students for a mission as an unordered set so that input order cannot affect totals.
2. WHEN a mission is confirmed for a set of students and then undone, THE CivicQuest_System SHALL restore every student's points total, stamp set, and the class-town building set to exactly their pre-confirmation values.
3. WHEN who-took-part is edited from set A to set B, THE CivicQuest_System SHALL produce point totals and stamp sets equal to those produced by confirming set B directly, regardless of the contents of set A.
4. THE CivicQuest_System SHALL verify with a property-based test that confirm-then-undo restores the exact prior state and that editing from any set A to set B equals confirming set B directly.

### Requirement 16: Step 3 — Demo School, Classes, and Students

**User Story:** As a judge, I want realistic demo data, so that I can explore a believable school during the demo.

#### Acceptance Criteria

1. WHILE Demo_Mode is enabled, THE CivicQuest_System SHALL provide a seed script `scripts/seed.ts` executed with the Service_Role_Key via `npm run seed`.
2. IF the Service_Role_Key is absent when `npm run seed` runs, THEN THE CivicQuest_System SHALL exit with a non-zero status and emit an error indicating the key is required, seeding no data.
3. WHEN the seed script runs, THE CivicQuest_System SHALL create exactly one school named Maple Street School and exactly five classes: Grade 3 (Ms. Rivera, 24 students, on Safe Streets day 1), Grade 7 (Mr. Chen, 22 students, on Respect Everywhere day 2), Grade 11 Advisory (Ms. Okafor, 20 students each with a Leader login, on Civics Project day 3), plus a Grade 4 class and a Grade 10 class.
4. THE CivicQuest_System SHALL store for each seeded student only the first name, a single-character last initial, grade, class, and avatar, and no other personally identifying fields.
5. THE CivicQuest_System SHALL seed at least one default reward for every one of the five classes.
6. THE CivicQuest_System SHALL seed exactly two partners — Greater Community Food Bank (supervisor Dana K.) and Riverside Park Friends — each linked to Maple Street School, and SHALL seed exactly two opportunities per partner with start times between the seed date and 14 days after the seed date.

### Requirement 17: Step 3 — Modules, Missions, and Demo Accounts

**User Story:** As a judge, I want all content and demo logins seeded, so that every roadmap, mission, and role is explorable.

#### Acceptance Criteria

1. WHEN the seed script runs, THE CivicQuest_System SHALL create all 10 modules and all 50 missions from `docs/missions.md`, with no mission missing a story, discussion question, instructions, verification type, points, estimated minutes, or town building.
2. WHEN seeding missions, THE CivicQuest_System SHALL map the proof phrase "Teacher watched" to `class_activity`, "Short quiz" to `quiz`, "Photo" to `photo_review`, and "QR check-in" to `qr_checkin`.
3. IF a mission's proof phrase in `docs/missions.md` matches none of the four known phrases, THEN THE CivicQuest_System SHALL halt seeding and emit an error identifying the unmapped phrase.
4. WHILE Demo_Mode is enabled, THE CivicQuest_System SHALL seed exactly seven demo accounts, each with password `demo1234`: admin, teacher3, teacher7, teacher11, counselor, partner, and leader (linked to Jordan M., grade 11).
5. THE CivicQuest_System SHALL seed history spanning the 14 days before the seed date such that the Grade 3 town is 45% to 55% full, every student has at least one stamp, and the audit log contains at least one confirmation entry dated before the seed date.
6. IF `DEMO_MODE` is not exactly `true`, THEN THE CivicQuest_System SHALL seed zero demo accounts.

### Requirement 18: Step 4 — Teacher Today View

**User Story:** As a teacher, I want a Today view, so that I can start the right mission for each class in one tap.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/teacher` Today view that lists each class owned by the signed-in teacher.
2. WHEN displaying a class on the Today view, THE CivicQuest_System SHALL show the mission scheduled for the current date in the teacher's local time zone with its module, day, quality, estimated minutes, and proof type, a mini town preview, and a large "Start mission" button.
3. WHEN a class's mission has been confirmed for the current date, THE CivicQuest_System SHALL show "Done today" for that class and disable its "Start mission" control.
4. WHEN the signed-in teacher owns no classes, THE CivicQuest_System SHALL show an empty-state message on the Today view.
5. IF a user who is not the owning teacher requests the Today view's class data, THEN THE CivicQuest_System SHALL deny access and disclose no class data.

### Requirement 19: Step 4 — Three-Step Mission Run

**User Story:** As a teacher, I want a three-step projector-sized mission screen, so that the class sees the story, the mission, and who took part in order.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/teacher/class/[id]/run/[missionId]` screen with exactly three ordered steps sized for a projector, showing one step at a time.
2. WHEN the Story step is shown, THE CivicQuest_System SHALL display the story or case study and the discussion question, with the Pip illustration for Learners, and a "Show today's mission" button that advances to the Mission step.
3. WHEN the Mission step is shown, THE CivicQuest_System SHALL display the mission title, quality, and instructions, and a "We finished the activity" button that advances to the Who-took-part step.
4. WHEN the Who-took-part step is shown, THE CivicQuest_System SHALL display the class roster with every student checked, plus "Select everyone" and "Clear all" controls, where "Select everyone" checks all students and "Clear all" unchecks all students.
5. IF the roster fails to load on the Who-took-part step, THEN THE CivicQuest_System SHALL show an error message and SHALL NOT allow confirmation until the roster loads.
6. THE CivicQuest_System SHALL render the Safe Streets day 1 Pip comic as an SVG illustration using only original characters.
7. THE CivicQuest_System SHALL render all story, mission, and roster text through React without `dangerouslySetInnerHTML`.

### Requirement 20: Step 4 — Confirm for Class

**User Story:** As a teacher, I want to confirm the whole class in one tap, so that recording participation takes under two minutes.

#### Acceptance Criteria

1. WHEN the teacher taps "Confirm for class", THE CivicQuest_System SHALL, through a single server action, save completions for the students checked at the moment of activation, award points and stamps only to those checked students, add the town building, and write an `audit_log` entry.
2. THE CivicQuest_System SHALL ignore any client-supplied values for `points_awarded`, `status`, `confirmed_by`, `school_id`, or `level` and compute each value on the server.
3. WHEN a confirmation succeeds, THE CivicQuest_System SHALL trigger a balloon celebration with one balloon per checked student up to a maximum of 28 balloons, followed by the building dropping into the town.
4. WHILE the device has `prefers-reduced-motion` set, THE CivicQuest_System SHALL show a static celebration message instead of the balloon animation.
5. WHEN a confirmation succeeds, THE CivicQuest_System SHALL show the saved mission record, including who confirmed it and who was absent.
6. IF the confirmation server action fails, THEN THE CivicQuest_System SHALL leave stored points, stamps, completions, and the town unchanged and show an error message.
7. IF a non-teacher or a teacher who does not own the class attempts to confirm, THEN THE CivicQuest_System SHALL reject the action with no side effects.
8. IF the mission is already confirmed for the current date, THEN THE CivicQuest_System SHALL not create duplicate completions or award points or stamps again.

### Requirement 21: Step 4 — Edit Who Took Part and Undo

**User Story:** As a teacher, I want to fix mistakes for a day, so that participation records stay accurate without deleting proof.

#### Acceptance Criteria

1. WHILE fewer than 24 hours have passed since a mission was confirmed, THE CivicQuest_System SHALL show "Edit who took part" and "Undo" controls for that class's mission on the Today view.
2. WHEN the teacher saves an edited roster, THE CivicQuest_System SHALL add completions for newly checked students and mark removed students' completions `reversed`.
3. WHEN an edited roster is saved, THE CivicQuest_System SHALL recalculate affected students' points and stamps and write an `audit_log` entry for each change.
4. IF saving an edited roster fails, THEN THE CivicQuest_System SHALL make no partial changes and retain the pre-edit state.
5. WHEN the teacher chooses Undo, THE CivicQuest_System SHALL require exactly one reason of "pressed by mistake", "the activity didn't happen", or "wrong class".
6. IF Undo is confirmed without one of the three permitted reasons, THEN THE CivicQuest_System SHALL reject the Undo and make no changes.
7. WHEN an Undo is confirmed with a valid reason, THE CivicQuest_System SHALL mark all of that mission's completions for the class `reversed`, remove the points, stamps, and town building, return the mission to "not done", and write an `audit_log` entry with the reason.
8. WHILE 24 hours or more have passed since confirmation, THE CivicQuest_System SHALL hide the teacher Undo control and allow reversal only by a school admin from the proof log.
9. THE CivicQuest_System SHALL show a "Today's proof log" panel on the Today view listing confirmations, edits, and undos in reverse chronological order, each with a timestamp.

### Requirement 22: Step 4 — Class Town, Projector View, and Rewards Display

**User Story:** As a teacher, I want to show the class town and rewards, so that the class sees its shared progress.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/teacher/class/[id]` view with the roster, class town, rank, module progress, and the 10 most recent mission records in reverse chronological order.
2. WHEN displaying the class town, THE CivicQuest_System SHALL show one building per distinct approved mission on a 6×6 grid, the current town stage, and progress toward the next stage.
3. WHEN a class has zero approved missions, THE CivicQuest_System SHALL show an empty town.
4. WHEN a class has more than 36 distinct approved missions, THE CivicQuest_System SHALL show the 36 most recent on the 6×6 grid until the grid expands at the city stage.
5. THE CivicQuest_System SHALL provide a `/teacher/class/[id]/town` full-screen projector view showing the town, the current stage, and the next reward.
6. THE CivicQuest_System SHALL display the class's village, town, and city rewards with their stages.

### Requirement 23: Step 4 — Class Leaderboard

**User Story:** As a teacher, I want a within-school leaderboard, so that classes see friendly standing without exposing children individually.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL rank classes within the school by points per student, defined as total approved class points divided by the number of enrolled students, in descending order.
2. WHEN a class has zero enrolled students, THE CivicQuest_System SHALL treat its points per student as 0.
3. WHEN two classes have equal points per student, THE CivicQuest_System SHALL assign them the same rank and order them by class name.
4. THE CivicQuest_System SHALL restrict leaderboard visibility to within the school.
5. WHERE the viewer's class is a Learners class, THE CivicQuest_System SHALL not show individual student rankings.

### Requirement 24: Step 5 — Read-Only Teacher Roadmap

**User Story:** As a teacher, I want a read-only roadmap of the week, so that I can preview the module and see today's mission at a glance.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/teacher/roadmap` page for the teacher's level that contains no controls that mutate data.
2. THE CivicQuest_System SHALL draw each module as a transit line and each day as a station.
3. WHEN a day station is selected, THE CivicQuest_System SHALL show that day's story, discussion question, instructions, proof type, stamp quality, and town building.
4. THE CivicQuest_System SHALL mark the mission scheduled for the current date as the current station.
5. WHEN the teacher's level has no modules, THE CivicQuest_System SHALL show an empty-state message.
6. IF a user who is not a teacher requests `/teacher/roadmap`, THEN THE CivicQuest_System SHALL deny access.

### Requirement 25: Step 6 — Partner Opportunity and QR Code

**User Story:** As a partner organization, I want an opportunity page with a regenerable QR code, so that Leaders can check in and I can invalidate a leaked code.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/partner/opportunity/[id]` page showing a large QR code, a "Make a new code" control, a live list of check-ins that refreshes at least every 10 seconds, and an "Approve hours" control per row and for everyone.
2. THE CivicQuest_System SHALL generate every QR token using cryptographically strong randomness and SHALL NOT use `Math.random`.
3. WHEN a partner chooses "Make a new code", THE CivicQuest_System SHALL issue a new QR token for the opportunity.
4. IF a Leader presents a QR token that is not the opportunity's current token, THEN THE CivicQuest_System SHALL reject the check-in.
5. IF a partner requests an opportunity or check-in that does not belong to the partner's own organization, THEN THE CivicQuest_System SHALL deny access.

### Requirement 26: Step 6 — Leader QR Check-In and Check-Out

**User Story:** As a Leader, I want to check in and out by scanning a code, so that my volunteer time is recorded accurately.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/me/scan` camera QR scanner where the first valid scan of an opportunity's current code checks the Leader in and a second valid scan of the same code checks the Leader out.
2. WHEN a check-out occurs, THE CivicQuest_System SHALL set hours to the elapsed time rounded down to the nearest 0.25 hour, capped at 8.
3. IF a scanned code is unreadable or does not match a current opportunity token, THEN THE CivicQuest_System SHALL show an error and record no check-in.
4. IF a Leader is not signed in, not linked to the partner's school, below the opportunity's `min_grade`, over `capacity`, or outside the window from 30 minutes before `starts_at` to `ends_at`, THEN THE CivicQuest_System SHALL reject the check-in.
5. WHEN a check-in or check-out is created, THE CivicQuest_System SHALL set its status to `pending` on the server and ignore any client-supplied `hours`, `status`, or `approved_by` value.
6. THE CivicQuest_System SHALL keep check-in hours pending until a partner approves them.
7. THE CivicQuest_System SHALL rate-limit QR lookups to 10 per minute per teacher device.

### Requirement 27: Step 6 — Partner Hour Approval

**User Story:** As a partner supervisor, I want to approve hours, so that only hours I witnessed become verified.

#### Acceptance Criteria

1. WHEN a partner approves a pending check-in, THE CivicQuest_System SHALL set its status to `approved`, record `approved_by` and `approved_at` on the server, and write an `audit_log` entry.
2. IF a partner attempts to approve a check-in that does not belong to the partner's own organization, THEN THE CivicQuest_System SHALL reject the approval.
3. IF a user attempts to approve the user's own work, THEN THE CivicQuest_System SHALL reject the approval.
4. IF an approval targets a check-in that is not in the `pending` status, THEN THE CivicQuest_System SHALL reject the approval.

### Requirement 28: Step 6 — Leader Proof Page and Certificate

**User Story:** As a Leader, I want a proof timeline and a printable certificate, so that I can show verified service hours.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide a `/me` page showing the signed-in Leader's verified hours, pending hours, badges, upcoming opportunities, and a proof timeline for today with check-in, check-out, and who approved.
2. WHEN the signed-in Leader has no activity for today, THE CivicQuest_System SHALL show an empty proof timeline.
3. THE CivicQuest_System SHALL provide a `/me/certificate` printable certificate listing only the signed-in Leader's approved hours.
4. IF a Leader requests another Leader's data on any `/me` page, THEN THE CivicQuest_System SHALL deny access and disclose no other student's data.

### Requirement 29: Step 7 — Landing Page with Demo Logins

**User Story:** As a judge, I want a landing page with one-click demo logins, so that I can enter each role quickly.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL serve a `/` landing page without requiring authentication that describes the product concept, states the Massachusetts civics project requirement, names the three levels (Learners, Helpers, Leaders), and states that Google Classroom and Clever integration are coming next.
2. WHILE Demo_Mode is enabled, THE CivicQuest_System SHALL show on the `/` landing page one "Try the demo" control for each seeded demo role (admin, teacher3, teacher7, teacher11, counselor, partner, and leader).
3. WHEN a visitor selects a "Try the demo" control for a demo role, THE CivicQuest_System SHALL sign the visitor in as that role's demo account and redirect the visitor to that role's home page.
4. WHILE Demo_Mode is not enabled, THE CivicQuest_System SHALL hide every "Try the demo" control on the `/` landing page.
5. THE CivicQuest_System SHALL render all `/` landing page content through React without `dangerouslySetInnerHTML` and SHALL allow only `http` and `https` links.

### Requirement 30: Step 7 — Reset Demo Data

**User Story:** As a demo presenter, I want to reset demo data, so that I can return the demo to a known state between runs.

#### Acceptance Criteria

1. WHILE Demo_Mode is enabled, THE CivicQuest_System SHALL provide a "Reset demo data" action.
2. WHEN "Reset demo data" is invoked, THE CivicQuest_System SHALL verify on the server that `DEMO_MODE=true` before performing any reset operation.
3. WHEN the server confirms `DEMO_MODE=true` for a reset, THE CivicQuest_System SHALL restore the demo data to the seeded known state using the Service_Role_Key on the server only.
4. WHEN a demo reset completes successfully, THE CivicQuest_System SHALL write an `audit_log` entry recording the reset and SHALL show the presenter a success message confirming the reset.
5. IF `DEMO_MODE` is not `true` when a reset is invoked, THEN THE CivicQuest_System SHALL reject the demo reset, leave all stored data unchanged, and show an error message indicating that demo reset is unavailable.
6. WHILE `DEMO_MODE` is not `true`, THE CivicQuest_System SHALL hide the demo login controls and the "Reset demo data" action.

### Requirement 31: Step 7 — Admin Overview and Proof Log

**User Story:** As a school administrator, I want an overview and the full proof log, so that I can see participation and trust the records.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL provide an `/admin` overview showing the total number of students in the admin's school, the count of missions confirmed within the most recent 7-day period, total verified hours, the class leaderboard, and Civics Project progress.
2. THE CivicQuest_System SHALL provide an `/admin/proof-log` page listing the append-only log of confirmations, approvals, reversals, and resets ordered newest first by timestamp.
3. WHEN the `/admin/proof-log` page displays more entries than fit in a single page view, THE CivicQuest_System SHALL page the entries while preserving the newest-first order.
4. IF an admin requests any `/admin` page for data outside the admin's own school, THEN THE CivicQuest_System SHALL deny the request and return no cross-school data.
5. IF a signed-in user who is not an admin requests any `/admin` page, THEN THE CivicQuest_System SHALL redirect the user to the user's own role home page.

### Requirement 32: Cross-Cutting — Authentication and Authorization Enforcement

**User Story:** As a security-conscious administrator, I want server-verified identity and ownership on every mutation, so that no one acts outside their role.

#### Acceptance Criteria

1. WHEN an authenticated action is requested, THE CivicQuest_System SHALL verify identity with `supabase.auth.getUser()` on the server before performing the action.
2. THE CivicQuest_System SHALL check role and ownership in every server action and route handler in addition to row level security.
3. IF server-side identity verification fails for an authenticated action, THEN THE CivicQuest_System SHALL reject the action and perform no data change.
4. THE CivicQuest_System SHALL never accept client values for `points_awarded`, `status`, `confirmed_by`, `approved_by`, `hours`, `role`, `school_id`, or `level`, computing each on the server.
5. WHEN a student creates a completion or check-in, THE CivicQuest_System SHALL set its status to `pending` and reject any other status value.
6. IF a user attempts to approve the user's own work, THEN THE CivicQuest_System SHALL reject the approval.

### Requirement 33: Cross-Cutting — Input Validation and Injection Defense

**User Story:** As a security-conscious administrator, I want strict server-side validation and parameterized queries, so that malicious input changes nothing.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL validate every input with zod on the server, reject unknown fields, enforce maximum lengths of 50 characters for names and 2,000 characters for descriptions, and validate UUIDs before use.
2. IF server-side zod validation fails for an input, THEN THE CivicQuest_System SHALL reject the request, make no data change, and return a validation error.
3. THE CivicQuest_System SHALL use only the Supabase query builder or `.rpc()` with named parameters and SHALL never build SQL from concatenated strings.
4. WHEN text containing `' OR 1=1 --` or `<script>alert(1)</script>` is submitted in any field, THE CivicQuest_System SHALL store and display the text as inert plain text with no other effect.

### Requirement 34: Cross-Cutting — CSRF, XSS, and Link Safety

**User Story:** As a security-conscious administrator, I want mutations protected and user text rendered safely, so that cross-site and script attacks fail.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL perform data mutations through server actions.
2. WHEN a custom route handler changes data, THE CivicQuest_System SHALL accept only POST, PATCH, or DELETE and verify that the `Origin` header matches `NEXT_PUBLIC_APP_URL`.
3. IF a data-changing route handler receives a disallowed method or an `Origin` header that does not match `NEXT_PUBLIC_APP_URL`, THEN THE CivicQuest_System SHALL reject the request and make no data change.
4. THE CivicQuest_System SHALL render all user text through React and SHALL never use `dangerouslySetInnerHTML` with user data.
5. THE CivicQuest_System SHALL allow only `http` and `https` links.

### Requirement 35: Cross-Cutting — Rate Limiting and Secrets Handling

**User Story:** As a security-conscious administrator, I want rate limits and protected secrets, so that abuse and key leaks are prevented.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL enforce rate limits using the `rate_limits` table for logins, QR lookups (10 per minute per teacher device), check-ins, quiz submissions, and uploads (20 per hour per class).
2. IF a rate limit is exceeded, THEN THE CivicQuest_System SHALL reject the request and indicate that the limit was exceeded.
3. THE CivicQuest_System SHALL keep the Service_Role_Key server-only and use it only in the seed script, the demo reset, and admin actions after re-checking that the caller is an admin of the right school.
4. THE CivicQuest_System SHALL commit `.env.example`, SHALL never commit `.env.local`, and SHALL never place tokens in committed Kiro MCP settings.

### Requirement 36: Cross-Cutting — Friendly Errors and Audit Logging

**User Story:** As a user, I want clear error messages and complete proof records, so that failures are understandable and participation is traceable.

#### Acceptance Criteria

1. IF an action fails, THEN THE CivicQuest_System SHALL show the user a message that names the failed action and the corrective step, and SHALL NOT show a stack trace or SQL error.
2. THE CivicQuest_System SHALL never log passwords, tokens, keys, or student names.
3. WHEN a confirmation, approval, reversal, invite, or demo reset occurs, THE CivicQuest_System SHALL write a corresponding `audit_log` entry.
4. IF writing an `audit_log` entry for a confirmation, approval, or reversal fails, THEN THE CivicQuest_System SHALL roll back the associated change so that no unlogged state change persists.

### Requirement 37: Cross-Cutting — Child Privacy and Content

**User Story:** As a parent, I want my child's data minimized and content age-appropriate, so that the app is safe for children.

#### Acceptance Criteria

1. THE CivicQuest_System SHALL store only a student's first name, last initial, grade, class, and avatar.
2. THE CivicQuest_System SHALL never store photos of children and SHALL never store a student's location.
3. THE CivicQuest_System SHALL give accounts only to Leaders in grades 9 to 12, and Learners and Helpers SHALL use Class_Mode on a teacher-signed-in device.
4. THE CivicQuest_System SHALL provide no public profiles, chat, or messaging between students.
5. THE CivicQuest_System SHALL use only original characters and non-partisan civics content, with no copyrighted or trademarked characters, brands, or logos.

### Requirement 38: Stretch — Class Mode Avatar Picker and Student Dashboard

**User Story:** As a Learner or Helper, I want to find myself in class mode and see my dashboard, so that I can view my own stamps without an account.

#### Acceptance Criteria

1. WHERE Step 8 is built, WHILE a teacher is signed in on the device, THE CivicQuest_System SHALL provide a `/teacher/class/[id]/play` class-mode avatar picker in the Sticker_Skin.
2. WHERE Step 8 is built, IF the device has no signed-in teacher or the requester is not the class's teacher, THEN THE CivicQuest_System SHALL deny access to the class-mode picker.
3. WHERE Step 8 is built, WHEN a student taps an avatar, THE CivicQuest_System SHALL show that student's dashboard with points, stamp passport, badges, today's mission, and the 10 most recent missions newest first with who confirmed them.
4. WHERE Step 8 is built, THE CivicQuest_System SHALL provide a "Next student" control that returns to the picker.
5. WHERE Step 8 is built, THE CivicQuest_System SHALL not create student accounts for Learners or Helpers.
6. WHERE Step 8 is built, IF avatar lookups exceed 10 per minute per teacher device, THEN THE CivicQuest_System SHALL reject further lookups until the limit resets.

### Requirement 39: Stretch — Kid Theme Picker

**User Story:** As a student, I want to pick a theme, so that my dashboard feels personal.

#### Acceptance Criteria

1. WHERE Step 9 is built, THE CivicQuest_System SHALL let a student pick exactly one of Hero, Bubblegum, Ocean, or Classic from the student dashboard.
2. WHERE Step 9 is built, WHEN a student selects a valid theme, THE CivicQuest_System SHALL save the choice on that student's row and apply it as the Kid_Theme.
3. WHERE Step 9 is built, IF a theme value other than Hero, Bubblegum, Ocean, or Classic is submitted, THEN THE CivicQuest_System SHALL reject it and leave the saved theme unchanged.
4. WHERE Step 9 is built, WHEN a student dashboard loads, THE CivicQuest_System SHALL apply the student's saved theme, defaulting to Classic when none is set.

### Requirement 40: Stretch — Class Rewards Editing

**User Story:** As a teacher, I want to edit the class rewards, so that stage rewards fit my class.

#### Acceptance Criteria

1. WHERE Step 10 is built, THE CivicQuest_System SHALL provide a `/teacher/class/[id]/rewards` page to edit the village, town, and city rewards.
2. WHERE Step 10 is built, WHEN a teacher saves rewards, THE CivicQuest_System SHALL validate on the server that each of the three rewards is non-empty and at most 140 characters.
3. WHERE Step 10 is built, IF any reward fails validation, THEN THE CivicQuest_System SHALL reject the save, leave the stored rewards unchanged, and return a validation error.
4. WHERE Step 10 is built, IF a user who is not the class's own teacher attempts to edit rewards, THEN THE CivicQuest_System SHALL deny the edit.
