# Implementation Plan: CivicQuest

## Overview

Build CivicQuest in TypeScript (Next.js App Router, strict mode) on Supabase, in seven stop-and-commit steps plus optional stretch steps. Each step ends with a checkpoint: run lint, typecheck, and tests; the user tests and commits; and a short entry goes into the "Build log" in `docs/KIRO_WRITEUP.md`. Security and child-privacy work sits in the step where the feature is built, with its SQL tests next to it. Migrations are applied to the **development** Supabase project through the Supabase MCP server, and tokens stay out of committed files. The fast-check property tests from build-prompt section 10 are required.

## Tasks

- [x] 1. Step 1 — Setup, database, and security foundation
  - [x] 1.1 Scaffold the Next.js project with pinned dependencies
    - Create a Next.js (≥ 14.0.0) App Router project with TypeScript `strict: true`, Tailwind CSS, and shadcn/ui
    - Install `@supabase/ssr`, `@supabase/supabase-js`, `server-only`, `zod`, `motion`, `qrcode.react`, `@yudiel/react-qr-scanner`, `recharts`, plus dev deps `vitest`, `fast-check`, `tsx`, all at exact versions (no `^`/`~`); commit the lockfile
    - Add npm scripts `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest --run`), and `seed` (`tsx --conditions=react-server scripts/seed.ts`, so `server-only` resolves outside Next)
    - Create folders from `structure.md`: `app/(public)`, `app/(teacher)`, `app/(partner)`, `app/(leader)`, `app/(admin)`, `lib/domain`, `lib/validation`, `lib/supabase`, `supabase/migrations`, `supabase/tests`, `tests/domain`, `scripts`
    - _Requirements: 1.1, 1.2, 1.7_

  - [x] 1.2 Add environment validation
    - Create `lib/env.ts` that reads `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `DEMO_MODE`, and halts startup with an error naming every missing or empty variable
    - Split into a public part and a server-only part so the service role key never reaches client bundles; update `.env.example` (no real values); confirm `.env.local` is gitignored
    - _Requirements: 1.4, 1.5, 1.6, 35.4_

  - [x] 1.3 Create the three Supabase clients
    - `lib/supabase/browser.ts` (anon), `lib/supabase/server.ts` (anon + user cookies), `lib/supabase/admin.ts` (service role, first statement `import 'server-only'`), all via `@supabase/ssr`
    - No `NEXT_PUBLIC_` identifier ever refers to the service role key
    - _Requirements: 1.3, 1.6, 35.3_

  - [x] 1.4 Write and apply the schema migration
    - `supabase/migrations/0001_schema.sql`: every table, enum, view, and constraint from build-prompt section 3, including the `user_role`, `verification_type`, `review_status` enums, stored generated `students.level`, length/range checks, unique keys on `mission_completions (mission_id, student_id)` and `checkins (opportunity_id, student_id)`, and `students.kid_theme`
    - Views `class_points`, `class_town`, `student_stamps`, `student_hours` with `security_invoker = true`
    - Apply to the dev project via Supabase MCP; record any schema element that had to change, and why, in the build log
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 37.1, 37.2_

  - [x] 1.5 Add RLS helper functions and RLS policies
    - `supabase/migrations/0002_rls.sql`: `app_role()`, `app_school_id()`, `app_partner_org_id()`, `app_student_id()` as `security definer`, `search_path = ''`, fully qualified names
    - Enable RLS on every table; policies for admin/counselor (own school), admin writes (classes, students, rewards, profiles in own school), teacher (owned classes and their students, rewards, class modules, completions), partner (own org's opportunities and check-ins), Leader (own rows plus opportunities from school-linked partners), shared modules/missions (`school_id is null`) readable by any signed-in user; `audit_log` insert/select only
    - Apply via Supabase MCP
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 3.9, 3.10, 4.1_

  - [x] 1.6 Add opportunity column privileges, token functions, partner surface, and private helpers
    - `supabase/migrations/0003_opportunities_private.sql`: revoke table-level select/insert/update on `opportunities` from `anon, authenticated`, then grant column lists excluding `qr_token`; `qr_token` default `encode(extensions.gen_random_bytes(24), 'hex')`
    - `partner_opportunity_token(p_opportunity_id)` and `regenerate_opportunity_token(p_opportunity_id)` (`security definer`, `search_path = ''`, partner-org ownership check, regeneration writes an `audit_log` entry without the token value)
    - `partner_checkin_students` surface returning exactly `first_name`, `last_initial`, `grade` for the partner's own org's check-ins; partners get no column access to `students`
    - `private` schema (not exposed to PostgREST) with `opportunity_id_for_token`, `opportunity_checkin_count`, `consume_rate_limit` (keyed on `auth.uid()`); grant usage/execute to `authenticated` only, revoke from `anon`
    - Apply via Supabase MCP
    - _Requirements: 3.7, 25.2, 25.3, 25.4, 26.4, 35.1, 36.3_

  - [x] 1.7 Add protection triggers
    - `supabase/migrations/0004_triggers.sql`: `audit_log` before update/delete trigger raising "audit_log rows are immutable" (no role exempt)
    - `mission_completions` protection: protected columns changeable only by the class's teacher or school admin; `approved → reversed` by teacher within 24h of `confirmed_at` or by admin with no limit, with a 1–500 char reason and exactly one `audit_log` entry; `reversed → approved` only when `civicquest.via_rpc = 'on'`; every other transition rejected
    - `before delete` on `mission_completions` rejecting deletes
    - Via_rpc direct-write guard on `mission_completions` and `checkins` (`before insert or update`), exempting only `service_role`; protection trigger also exempts `service_role`
    - Apply via Supabase MCP
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 32.2, 32.4, 32.5, 36.4_

  - [x] 1.8 Add the storage bucket and policies
    - `supabase/migrations/0005_storage.sql`: private `mission-photos` bucket limited to `image/jpeg`, `image/png`, `image/webp` and 5,242,880 bytes; path `school_id/class_id/completion_id.jpg`; read only for the owning class's teacher or the school's admin
    - Add `lib/storage/signed-url.ts` helper that issues signed URLs with expiry ≤ 600 seconds
    - Apply via Supabase MCP
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 1.9 Write the Step 1 SQL security test script
    - `supabase/tests/01_foundation.sql`, impersonating users per case with `set local role authenticated;` and `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';` inside a transaction that rolls back
    - Assert: cross-teacher select returns zero rows; cross-school admin select returns zero rows; `audit_log` update/delete raise; direct `insert`/`update` on `mission_completions` and `checkins` raise the via_rpc guard error for a signed-in teacher and a signed-in Leader; protection trigger blocks non-owner and invalid/late status changes and `reversed → approved` outside RPCs; delete on completions raises; Leader `select qr_token from opportunities` raises and `partner_opportunity_token` returns null for a Leader; `partner_checkin_students` exposes only first name, last initial, grade
    - Run against the dev project via Supabase MCP
    - _Requirements: 3.3, 3.5, 3.7, 3.10, 4.1, 4.2, 4.3, 4.6, 4.9, 25.2, 32.4_

  - [x] 1.10 Set security headers and CSP
    - In `next.config`, set on every route: CSP (scripts self, fonts Google Fonts, images self + Supabase Storage domain, connect only to the Supabase origin, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, HSTS `max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`
    - _Requirements: 6.1, 6.2_

  - [x] 1.11 Add middleware and server auth helpers
    - `middleware.ts` using the `@supabase/ssr` cookie pattern (`httpOnly`, `secure`, `sameSite=lax`), verifying with `supabase.auth.getUser()` only
    - `lib/auth/roles.ts`: role → home map and route-group map; `lib/auth/require.ts`: `requireUser()` / `requireRole()` for server components and actions
    - No profile or null role → redirect `/login`; role outside its route group → redirect to own role home; counselor redirected to its home
    - _Requirements: 6.5, 6.6, 6.9, 6.10, 32.1, 32.3_

  - [x] 1.12 Build the `/login` page and disable public sign-up
    - `app/(public)/login/page.tsx` with email and password fields; server action validated with zod, rate-limited via `rate_limits`, redirecting to the role home; a generic "Sign-in failed" message that never says which field was wrong
    - No sign-up route or action exists; document in the README "Supabase setup" section that "Allow new users to sign up" must be turned off in the Supabase dashboard
    - _Requirements: 6.3, 6.4, 6.7, 6.8, 6.11, 33.1, 33.2, 35.1, 35.2, 36.1_

  - [x] 1.13 Add design tokens, fonts, and skins
    - In `app/globals.css` and the Tailwind config, define the calm and sticker-book tokens from `.kiro/steering/design.md` with light and dark values (`prefers-color-scheme` guarded by `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`), plus the four kid themes under `data-kid-theme`
    - Load Overpass, Public Sans, Baloo 2, and Lexend from Google Fonts; add `components/skin/SkinWrapper.tsx` that sets `data-skin` and `data-kid-theme`
    - _Requirements: 7.1, 7.2, 37.5_

  - [x] 1.14 Self-host Fluent Emoji 3D icons and build the Icon component
    - Download every Fluent Emoji 3D PNG listed in `.kiro/steering/design.md` (town items, badges, fox, animal avatars, balloon) into `public/icons/`
    - `components/Icon.tsx` mapping each icon name to its file, rendering a fallback placeholder for unknown names without throwing
    - Add the Fluent Emoji credit to the README
    - _Requirements: 7.3, 7.4, 7.5, 7.6_

  - [x] 1.15 Write unit tests for env validation and the Icon fallback
    - Missing variables are all named; unknown icon name renders the placeholder
    - _Requirements: 1.5, 7.5_

  - [x] 1.16 Start `SECURITY_TESTS.md`
    - List the Step 1 cases (isolation, `audit_log` immutability, direct-write guard, `qr_token` secrecy, headers present, sign-up disabled, non-image `.jpg` rejected by the bucket) with how to run each and expected result
    - _Requirements: 3.10, 4.2, 5.3, 6.2, 6.4_

- [x] 2. Step 1 checkpoint
  - Run lint, typecheck, and tests, and fix any failures.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Step 2 — Domain logic and property-based tests
  - [x] 3.1 Define domain types and implement `gradeToLevel`
    - `lib/domain/types.ts` (`Level`, `Quality`, `Stamp`, `MissionRef`, `TownCell`, `TownStage`, `Rejected`); `lib/domain/levels.ts` returning `learners` / `helpers` / `leaders` or `{ rejected: true }`, never throwing
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 3.2 Write property test for `gradeToLevel`
    - `tests/domain/levels.property.test.ts`, fast-check, ≥ 100 runs
    - **Property 1: Grade maps to exactly one level**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**

  - [x] 3.3 Implement `computePoints` and `computeStamps`
    - `lib/domain/points.ts`: de-duplicate present ids; 10 per student for learners/helpers, 15 for leaders; one stamp of the module quality per distinct present student; empty set → 0 / none
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 3.4 Write property test for `computePoints`
    - `tests/domain/points.property.test.ts`
    - **Property 2: Points awarded only to present students, once each**
    - **Validates: Requirements 9.2, 9.4, 9.5, 9.6, 9.7**

  - [x] 3.5 Write property test for `computeStamps`
    - `tests/domain/stamps.property.test.ts`
    - **Property 3: Stamps awarded only to present students, once each**
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7**

  - [x] 3.6 Implement `computeHours`
    - `lib/domain/hours.ts`: elapsed time floored to 0.25 h, then capped at 8; check-out before check-in → 0
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 3.7 Write property test for `computeHours`
    - `tests/domain/hours.property.test.ts`, including reversed timestamp pairs
    - **Property 4: Verified hours are bounded and never exceed elapsed time**
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6**

  - [x] 3.8 Implement `townStage` and `placeTown`
    - `lib/domain/town.ts`: stages pre-village (0–9), village (10–24), town (25–35) on 6×6, city (36+) on 8×8; invalid counts → `{ rejected: true }`
    - `placeTown` de-duplicates missions, orders deterministically (placement time, then mission id), and fills cells up to the capacity from `townStage`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 3.9 Write property test for `placeTown`
    - `tests/domain/town-placement.property.test.ts`, over permutations and duplicate inputs
    - **Property 5: Town placement is capacity-bounded, duplicate-free, and order-independent**
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6**

  - [x] 3.10 Write property test for `townStage`
    - `tests/domain/town-stage.property.test.ts`
    - **Property 6: Town stage is monotonic non-decreasing**
    - **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8**

  - [x] 3.11 Implement `sanitizeCsvCell`
    - `lib/domain/csv.ts`: prefix one apostrophe when the first character is `=`, `+`, `-`, `@`, tab, or CR; otherwise unchanged
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 3.12 Write property test for `sanitizeCsvCell`
    - `tests/domain/csv.property.test.ts`
    - **Property 7: Sanitized CSV cells never begin with a dangerous character**
    - **Validates: Requirements 13.2, 13.3, 13.4, 13.5**

  - [x] 3.13 Implement `safeRedirectPath`
    - `lib/domain/redirect.ts`: accept only a path starting with one `/` not followed by `/` or `\`, with no scheme, control characters, or surrounding whitespace; otherwise return `/`
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 3.14 Write property test for `safeRedirectPath`
    - `tests/domain/redirect.property.test.ts`
    - **Property 8: Only relative single-slash redirect paths are accepted**
    - **Validates: Requirements 14.2, 14.3, 14.4**

  - [x] 3.15 Wire `safeRedirectPath` into login and middleware
    - Pass the `next` parameter through `safeRedirectPath`; when it returns `/` (rejected), redirect to the role home instead
    - _Requirements: 6.12, 6.13_

  - [x] 3.16 Implement confirm/undo/edit equivalence helpers
    - `lib/domain/completions.ts`: `applyConfirm`, `applyUndo`, `applyEdit` over a per-mission map `studentId → { status, points }` plus derived `{ points, stamps, townSet }`; present input treated as a set; upsert semantics (missing or `reversed` → `approved` with fresh values, `approved` unchanged); uses `computePoints`/`computeStamps`
    - _Requirements: 15.1, 15.2, 15.3, 20.8, 21.3, 21.8_

  - [x] 3.17 Write property test for confirm/undo/edit equivalence
    - `tests/domain/completions-equivalence.property.test.ts`: confirm-then-undo restores prior state; undo-then-re-confirm equals a fresh confirm; edit A→B (including re-added students) equals confirm B; order never matters
    - **Property 9: Confirm/undo/edit are reversible and equivalent**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 21.3, 21.8**

  - [x] 3.18 Write property test for idempotent confirm
    - `tests/domain/completions-idempotent.property.test.ts`
    - **Property 10: Confirm upsert is idempotent**
    - **Validates: Requirements 20.8, 9.5, 15.1**

  - [x] 3.19 Write example unit tests for domain boundaries
    - `tests/domain/examples.test.ts`: grades 5/6/8/9, counts 9/10/24/25/35/36, 8h+ caps, `//evil.com`, `/\evil`, `javascript:` paths
    - _Requirements: 8.2, 8.3, 8.4, 10.2, 12.2, 12.5, 14.3_

- [x] 4. Step 2 checkpoint
  - Run lint, typecheck, and tests, and fix any failures.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Step 3 — Seed data and demo content
  - [x] 5.1 Parse `docs/missions.md` into typed content
    - `lib/seed/missions.ts`: parse 10 modules and 50 missions (story, discussion question, instructions, proof, points, minutes, town building); map "Teacher watched" → `class_activity`, "Short quiz" → `quiz`, "Photo" → `photo_review`, "QR check-in" → `qr_checkin`; throw naming any unmapped phrase or any missing field
    - _Requirements: 17.1, 17.2, 17.3_

  - [x]* 5.2 Write unit tests for the missions parser
    - Exactly 10 modules and 50 missions, no empty fields, unknown phrase halts with its name
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 5.3 Write the core seed script
    - `scripts/seed.ts` calling `lib/seed/run.ts` (reusable by demo reset) with the admin client; exit non-zero with "SUPABASE_SERVICE_ROLE_KEY is required" and seed nothing if absent
    - Seed Maple Street School; Grade 3 (Ms. Rivera, 24, Safe Streets), Grade 7 (Mr. Chen, 22, Respect Everywhere), Grade 11 Advisory (Ms. Okafor, 20, Civics Project), a Grade 4 and a Grade 10 class; students with only first name, last initial, grade, class, avatar; default rewards per class; modules and missions; Greater Community Food Bank (supervisor Dana K.) and Riverside Park Friends, each school-linked with two opportunities starting within 14 days
    - _Requirements: 16.1, 16.2, 16.3, 16.5, 16.6, 16.7, 17.1, 37.1_

  - [x] 5.4 Seed the demo accounts
    - `lib/seed/accounts.ts`, wired into `lib/seed/run.ts`: only when `DEMO_MODE` is exactly `true`, create exactly seven accounts (admin, teacher3, teacher7, teacher11, counselor, partner, leader) with password `demo1234` and matching `profiles`; link leader to Jordan M. (grade 11); no other student gets a login
    - _Requirements: 16.4, 17.4, 17.6, 37.3_

  - [x] 5.5 Seed two weeks of history
    - `lib/seed/history.ts` (pure plan) wired into `lib/seed/run.ts`: approved completions over the 14 days before the seed date using `computePoints`, so the Grade 3 town is 45–55% full, every student has ≥ 1 stamp, and `audit_log` has confirmation entries dated before today; class positions match Safe Streets day 1 / Respect Everywhere day 2 / Civics Project day 3
    - _Requirements: 17.5_

  - [ ]* 5.6 Write unit tests for the history plan
    - Grade 3 fill between 45% and 55% of 36; every student has a stamp; at least one confirmation before the seed date
    - _Requirements: 17.5_

- [~] 6. Step 3 checkpoint
  - Run lint, typecheck, and tests, and fix any failures; run `npm run seed` against the dev project.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Step 4 — Core loop
  - [~] 7.1 Write the `confirm_class_mission` RPC
    - `supabase/migrations/0006_confirm.sql`, `security invoker`: preamble `set_config('civicquest.via_rpc','on',true)`, `auth.uid()` required, in-body checks (teacher owns class, mission in the class's module, every id is a student of the class); de-duplicate ids; upsert (insert approved; re-approve `reversed` with fresh server values and a `re_approve` audit entry; leave `approved` untouched); one `confirm` audit entry; points from mission level, all actor/time fields server-set
    - Apply via Supabase MCP
    - _Requirements: 20.1, 20.2, 20.6, 20.7, 20.8, 32.2, 32.4, 36.3, 36.4_

  - [~] 7.2 Write the `edit_mission_participants` RPC
    - `supabase/migrations/0007_edit.sql`: same preamble and checks plus confirmation time < 24h; upsert students in B; reverse previously approved students not in B with reason `removed by edit`; audit entry per change; all in one transaction
    - Apply via Supabase MCP
    - _Requirements: 21.2, 21.3, 21.4, 21.5, 36.4_

  - [~] 7.3 Write the `undo_mission` RPC
    - `supabase/migrations/0008_undo.sql`: teacher caller needs < 24h and one of `pressed by mistake`, `the activity didn't happen`, `wrong class`; admin caller of the class's school, any age, reason 1–500 chars; reverse all approved completions for the mission and class; one audit entry with the reason
    - Apply via Supabase MCP
    - _Requirements: 4.5, 4.7, 4.8, 21.6, 21.7, 21.8, 21.9, 36.4_

  - [~] 7.4 Write the Step 4 SQL test script
    - `supabase/tests/04_core_loop.sql`: owner succeeds; non-owner teacher, wrong role, and late teacher undo are rejected with full rollback (no stray `audit_log` row); confirm → undo → confirm leaves rows approved with a later `confirmed_at` and fresh points; re-confirm changes nothing; edit removes then re-adds a student; invalid undo reason rejected; `pg_proc` scan finds `set_config` in exposed schemas only in the five RPC names with the constant `'civicquest.via_rpc'`
    - Run via Supabase MCP
    - _Requirements: 4.6, 15.2, 20.7, 20.8, 21.5, 21.7, 32.2, 32.3_

  - [~] 7.5 Add validation schemas and teacher data loaders
    - `lib/validation/mission.ts`: strict zod schemas (unknown fields rejected, UUIDs validated, undo reason enum, admin reason 1–500)
    - `lib/server/teacher.ts`: owned classes, `class_next_mission` (lowest unconfirmed `day_number`), `class_recent_confirmation` (min `confirmed_at` of approved rows < 24h), roster, today's proof log; all via the server client under RLS with explicit column lists
    - _Requirements: 18.2, 18.5, 21.1, 21.10, 33.1, 33.3_

  - [~] 7.6 Add teacher server actions
    - `app/(teacher)/teacher/actions.ts` (`'use server'`): `confirmMission`, `editParticipants`, `undoMission`; zod parse, `requireRole('teacher')`, ownership check, `.rpc()` with named params, friendly error messages (no SQL/stack), no secrets or student names in logs
    - _Requirements: 20.1, 20.2, 20.6, 21.2, 21.7, 32.1, 32.2, 32.3, 33.2, 34.1, 36.1, 36.2_

  - [~] 7.7 Build the class town components
    - `components/town/TownGrid.tsx`, `TownStageProgress.tsx`, `RewardsList.tsx`: rows from `class_town` passed through `placeTown`/`townStage`; Icon per town item; empty town for zero missions; village/town/city rewards with stages
    - _Requirements: 22.2, 22.3, 22.5_

  - [~] 7.8 Implement the leaderboard
    - `lib/domain/leaderboard.ts`: points per student from `class_points` (zero students → 0), descending, ties share rank and sort by class name; `components/Leaderboard.tsx` scoped to the school, no individual student rankings for Learners
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

  - [ ]* 7.9 Write unit tests for the leaderboard
    - Ties, zero-student class, ordering
    - _Requirements: 23.1, 23.2, 23.3_

  - [~] 7.10 Build the Today view and proof log panel
    - `app/(teacher)/teacher/page.tsx`: per owned class, a mini town preview and one of three layouts — Done-today card (no Start, with Edit/Undo) when confirmed < 24h plus the next mission below with its own Start; next mission only otherwise; module-complete state
    - Next mission shows module, day, quality, minutes, proof type, large "Start mission"; empty state for no classes; "Today's proof log" newest first with timestamps
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 21.1, 21.9, 21.10_

  - [~] 7.11 Build the three-step mission run screen
    - `app/(teacher)/teacher/class/[id]/run/[missionId]/page.tsx` in sticker skin, projector-sized, one step at a time: Story (story, discussion question, Pip for Learners, "Show today's mission"), Mission (title, quality, instructions, "We finished the activity"), Who took part (roster all checked, "Select everyone", "Clear all", error and blocked confirm if the roster fails)
    - All text through React, no `dangerouslySetInnerHTML`
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.7, 34.4_

  - [~] 7.12 Draw the Pip Safe Streets day 1 comic
    - `components/pip/SafeStreetsDay1.tsx`: inline SVG, original fox character, three panels (stop / look / listen), accessible title and description
    - _Requirements: 19.6, 37.5_

  - [~] 7.13 Add Confirm for class, celebration, and saved record
    - Confirm sends the ids checked at tap time to `confirmMission`; Motion balloon celebration with one balloon per checked student, max 28, then the building drops into the town; static message under `prefers-reduced-motion`
    - Saved mission record shows who confirmed and who was absent; failure shows an error and leaves state unchanged
    - _Requirements: 20.1, 20.3, 20.4, 20.5, 20.6_

  - [~] 7.14 Add Edit who took part and Undo UI
    - Edit reopens the roster with the saved selection and calls `editParticipants`; Undo dialog with exactly the three reasons as a radio group, calling `undoMission`; controls only while < 24h
    - _Requirements: 21.1, 21.3, 21.6, 21.7, 21.8, 21.9_

  - [~] 7.15 Build the class view
    - `app/(teacher)/teacher/class/[id]/page.tsx`: roster, class town with stage progress and rewards, rank from the leaderboard, module progress, 10 most recent mission records newest first; non-owners get no data
    - _Requirements: 22.1, 22.2, 22.3, 22.5, 18.5_

  - [~] 7.16 Build the full-screen projector town
    - `app/(teacher)/teacher/class/[id]/town/page.tsx`: sticker skin, viewport-filling, town, current stage, next reward
    - _Requirements: 22.4_

  - [~] 7.17 Update `SECURITY_TESTS.md` for the core loop
    - Cross-teacher RPC calls rejected, direct table writes rejected, `' OR 1=1 --` and `<script>alert(1)</script>` shown as plain text in rosters and records, re-confirm after undo
    - _Requirements: 20.7, 32.2, 33.4, 34.4_

- [~] 8. Step 4 checkpoint
  - Run lint, typecheck, and tests, and fix any failures; run `supabase/tests/04_core_loop.sql` via MCP.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Step 5 — Read-only roadmap
  - [~] 9.1 Build `/teacher/roadmap`
    - `app/(teacher)/teacher/roadmap/page.tsx` and `components/roadmap/TransitMap.tsx`: modules for the teacher's level as transit lines, days as stations, next-not-confirmed mission marked as current (dark dot, yellow ring); selecting a station opens a detail panel with story, discussion question, instructions, proof type, stamp quality, town building
    - No mutating controls; empty state when the level has no modules; non-teachers denied via `requireRole('teacher')`
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

  - [ ]* 9.2 Write a component test for the roadmap
    - Station selection shows the detail panel; current station matches the lowest unconfirmed day; no form or action is rendered
    - _Requirements: 24.1, 24.3, 24.4_

- [~] 10. Step 5 checkpoint
  - Run lint, typecheck, and tests, and fix any failures.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Step 6 — Leaders flow
  - [~] 11.1 Write the `approve_checkin` RPC
    - `supabase/migrations/0009_approve.sql`, `security invoker`: via_rpc preamble; caller is a partner of the check-in's org; no self-approval; check-in `pending` with `check_out_at`; set `approved`, `approved_by = auth.uid()`, `approved_at = now()`; one `approve` audit entry
    - Apply via Supabase MCP
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 32.6, 36.3, 36.4_

  - [~] 11.2 Write the `leader_scan` RPC
    - `supabase/migrations/0010_leader_scan.sql`, `security invoker`, input `p_token` only, returns `{ action, opportunity_title, hours }`: preamble; caller is a Leader; `private.consume_rate_limit('leader_scan', 10, '1 minute')`; resolve current token via `private.opportunity_id_for_token`
    - Existing open check-in → check out with `hours = least(8, floor(elapsed/900)*0.25)` (≥ 0), stays `pending`; already checked out → reject; otherwise check in after eligibility (school-linked, `grade >= min_grade`, capacity via `private.opportunity_checkin_count`, window 30 min before `starts_at` to `ends_at`) with `status = 'pending'`; audit entry for each check-in/check-out; friendly message per rejection
    - Apply via Supabase MCP
    - _Requirements: 25.4, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 32.4, 32.5, 35.1, 35.2_

  - [~] 11.3 Write the Step 6 SQL test script
    - `supabase/tests/06_leaders.sql`: old token rejected after `regenerate_opportunity_token` and new token checks in; out-of-window (both sides), below-`min_grade`, over-capacity, unlinked-school scans rejected with no row; second scan checks out with hours matching `computeHours`; third scan rejected; 11th scan in a minute rate-limited; `approve_checkin` from another org and self-approval rejected with rollback; non-pending approval rejected
    - Run via Supabase MCP
    - _Requirements: 25.4, 26.2, 26.4, 26.7, 27.2, 27.3, 27.4_

  - [~] 11.4 Build the partner opportunities list
    - `app/(partner)/partner/page.tsx`: own org's opportunities (explicit columns, no `qr_token`); `lib/validation/partner.ts` zod schemas
    - _Requirements: 25.5, 3.6, 33.1_

  - [~] 11.5 Build `/partner/opportunity/[id]`
    - Large QR (`qrcode.react`) from `partner_opportunity_token`; "Make a new code" calling `regenerate_opportunity_token` via a server action; live check-in list from `partner_checkin_students` polled every ≤ 10 s; "Approve hours" per row and for everyone, each via `approve_checkin`; other orgs' opportunities denied
    - _Requirements: 25.1, 25.2, 25.3, 25.5, 27.1, 27.2, 36.1_

  - [~] 11.6 Build `/me/scan`
    - `app/(leader)/me/scan/page.tsx` with `@yudiel/react-qr-scanner`; server action validates the token (non-empty, bounded length) and calls `leader_scan`; shows "Checked in to {title}" or "Checked out of {title}: {hours} hours, waiting for approval", and a friendly error for unreadable or rejected codes
    - _Requirements: 26.1, 26.3, 26.5, 26.7, 33.1, 36.1_

  - [~] 11.7 Build the Leader `/me` page
    - Verified and pending hours (`student_hours`), badges, upcoming opportunities, today's proof timeline (check-in, check-out, who approved), empty timeline when no activity; only the signed-in Leader's data
    - _Requirements: 28.1, 28.2, 28.4, 3.8_

  - [~] 11.8 Build `/me/certificate`
    - Printable certificate (print stylesheet) listing only the signed-in Leader's approved hours
    - _Requirements: 28.3, 28.4_

  - [~] 11.9 Update `SECURITY_TESTS.md` for the Leaders flow
    - Leader cannot read `qr_token`, cannot approve own hours or change points, old code rejected, eligibility rejections, scan rate limit
    - _Requirements: 25.4, 26.4, 26.7, 32.6_

- [~] 12. Step 6 checkpoint
  - Run lint, typecheck, and tests, and fix any failures; run `supabase/tests/06_leaders.sql` via MCP.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Step 7 — Landing, demo controls, and admin
  - [~] 13.1 Build the landing page with demo logins
    - `lib/demo.ts` (server-only): `isDemoMode()` checks `DEMO_MODE === 'true'` on the server; demo role list
    - `app/(public)/page.tsx`: concept, Massachusetts civics project requirement, Learners/Helpers/Leaders, "Google Classroom and Clever integration coming next"; when demo mode is on, one "Try the demo" button for admin, teacher3, teacher7, teacher11, partner, leader (not counselor) via a server action that re-checks demo mode, signs in, and redirects to the role home; only `http`/`https` links, no `dangerouslySetInnerHTML`
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5, 30.6, 34.5_

  - [~] 13.2 Add Reset demo data
    - Server action that verifies `DEMO_MODE=true` before anything, then reuses `lib/seed/run.ts` with the admin client, writes a `demo_reset` audit entry, and shows a success message; otherwise rejects with "Demo reset is unavailable" and changes nothing; control hidden when demo mode is off
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.5, 30.6, 35.3, 36.3_

  - [~] 13.3 Build the admin overview
    - `app/(admin)/admin/page.tsx`: total students in the school, missions confirmed in the last 7 days, total verified hours, class leaderboard, Civics Project progress chart (recharts); non-admins redirected; own school only
    - _Requirements: 31.1, 31.4, 31.5, 23.4_

  - [~] 13.4 Build `/admin/proof-log` with admin reversal
    - Paged `audit_log` newest first; for confirmation entries, a "Reverse" control with a 1–500 char reason calling `undo_mission` via a zod-validated admin server action
    - _Requirements: 31.2, 31.3, 31.4, 4.5, 4.7, 4.8, 21.9_

  - [~] 13.5 Write the Step 7 SQL test script
    - `supabase/tests/07_admin.sql`: admin reversal older than 24h succeeds with an audit entry; admin of another school is rejected; empty reason rejected
    - Run via Supabase MCP
    - _Requirements: 4.5, 4.8, 31.4_

  - [~] 13.6 Write the README
    - Setup (env vars, Supabase MCP migrations, disable public sign-up, `npm run seed`), demo accounts and password, a short demo script, Fluent Emoji credit, and a "Before real use" section (turn off `DEMO_MODE`, rotate keys, district review)
    - _Requirements: 7.6, 17.4, 35.4_

  - [~] 13.7 Finish `SECURITY_TESTS.md`
    - Demo reset rejected when `DEMO_MODE` is off, admin cross-school denial, headers check on every route group; note that all mutations are server actions and there are no data-changing route handlers, so any future one must use POST/PATCH/DELETE and an `Origin` check against `NEXT_PUBLIC_APP_URL`
    - _Requirements: 30.5, 31.4, 34.1, 34.2, 34.3, 6.2_

- [~] 14. Step 7 checkpoint
  - Run lint, typecheck, and tests, and fix any failures; run `supabase/tests/07_admin.sql` via MCP.
  - Ask the user to test the step and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Stretch Step 8 — Class-mode avatar picker and student dashboard (only if Steps 1–7 work)
  - [ ]* 15.1 Build the class-mode avatar picker
    - `app/(teacher)/teacher/class/[id]/play/page.tsx`, sticker skin, only for the class's signed-in teacher; avatar/card lookups rate-limited 10/min per teacher device via `rate_limits`; no student accounts created
    - _Requirements: 38.1, 38.2, 38.5, 38.6, 35.1, 37.3_

  - [ ]* 15.2 Build the student dashboard and stamp passport
    - Points, stamp passport (`student_stamps`), badges (locked greyscale 40%), today's mission, 10 recent missions newest first with who confirmed; "Next student" back to the picker
    - _Requirements: 38.3, 38.4_

- [ ] 16. Stretch Step 9 — Kid theme picker
  - [ ]* 16.1 Add the kid theme picker
    - Picker on the student dashboard for Hero, Bubblegum, Ocean, Classic; zod enum server action saving `students.kid_theme` (teacher-owned class check); invalid values rejected unchanged; dashboard applies the saved theme via `data-kid-theme`, default Classic
    - _Requirements: 39.1, 39.2, 39.3, 39.4_

- [ ] 17. Stretch Step 10 — Class rewards editing
  - [ ]* 17.1 Build `/teacher/class/[id]/rewards`
    - Edit village, town, city rewards; server action validates each non-empty and ≤ 140 chars, rejects otherwise with no change; non-owning teacher denied
    - _Requirements: 40.1, 40.2, 40.3, 40.4_

- [~] 18. Final checkpoint (after any stretch work)
  - Run lint, typecheck, and tests, and fix any failures.
  - Ask the user to test and commit.
  - Add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped (specs, steering, hooks, MCP, property-based tests).
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional. All stretch work (Steps 8–10) is optional and starts only after Step 7 works.
- The ten fast-check property tests (3.2, 3.4, 3.5, 3.7, 3.9, 3.10, 3.12, 3.14, 3.17, 3.18) are required by build-prompt section 10 and are not optional.
- SQL security tests sit in the step that builds the feature they test (1.9, 7.4, 11.3, 13.5).
- Migrations are applied to the dev Supabase project through the Supabase MCP server; no tokens go into committed files.
- Out of scope, no tasks: CSV roster upload, teacher invites, quizzes, photo review, counselor page, reports, parent notice, QR login cards.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.13"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.10", "1.14"] },
    { "id": 3, "tasks": ["1.6", "1.11", "1.15"] },
    { "id": 4, "tasks": ["1.7", "1.12"] },
    { "id": 5, "tasks": ["1.8"] },
    { "id": 6, "tasks": ["1.9", "1.16"] },
    { "id": 7, "tasks": ["3.1"] },
    { "id": 8, "tasks": ["3.2", "3.3", "3.6", "3.8", "3.11", "3.13"] },
    { "id": 9, "tasks": ["3.4", "3.5", "3.7", "3.9", "3.10", "3.12", "3.14", "3.15", "3.16"] },
    { "id": 10, "tasks": ["3.17", "3.18", "3.19"] },
    { "id": 11, "tasks": ["5.1"] },
    { "id": 12, "tasks": ["5.2", "5.3"] },
    { "id": 13, "tasks": ["5.4"] },
    { "id": 14, "tasks": ["5.5"] },
    { "id": 15, "tasks": ["5.6"] },
    { "id": 16, "tasks": ["7.1", "7.5", "7.7", "7.8", "7.12"] },
    { "id": 17, "tasks": ["7.2", "7.9", "7.11", "7.16"] },
    { "id": 18, "tasks": ["7.3"] },
    { "id": 19, "tasks": ["7.4", "7.6"] },
    { "id": 20, "tasks": ["7.10", "7.13"] },
    { "id": 21, "tasks": ["7.14", "7.15"] },
    { "id": 22, "tasks": ["7.17"] },
    { "id": 23, "tasks": ["9.1"] },
    { "id": 24, "tasks": ["9.2"] },
    { "id": 25, "tasks": ["11.1", "11.4", "11.7"] },
    { "id": 26, "tasks": ["11.2", "11.5", "11.8"] },
    { "id": 27, "tasks": ["11.3", "11.6"] },
    { "id": 28, "tasks": ["11.9"] },
    { "id": 29, "tasks": ["13.1", "13.3"] },
    { "id": 30, "tasks": ["13.2", "13.4"] },
    { "id": 31, "tasks": ["13.5", "13.6"] },
    { "id": 32, "tasks": ["13.7"] },
    { "id": 33, "tasks": ["15.1", "17.1"] },
    { "id": 34, "tasks": ["15.2"] },
    { "id": 35, "tasks": ["16.1"] }
  ]
}
```
