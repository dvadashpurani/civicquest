# Kiro hooks to create

Create each hook in the Kiro panel under Agent Hooks, describing it in plain language as below. Kiro saves them in `.kiro/hooks/`, which must stay committed.

## 1. Type check and lint on save
- **When:** A `.ts` or `.tsx` file is saved
- **Do:** Run `npm run typecheck` and `npm run lint`. If anything fails, explain the error and suggest a fix without changing unrelated code.
- **Why:** Catches errors the moment they appear instead of at the end.

## 2. Database security guard
- **When:** A file in `supabase/migrations/` is saved
- **Do:** Check that every new table has Row Level Security enabled and at least one policy, that every `security definer` function sets `search_path = ''`, that no function builds SQL from strings, and that `audit_log` has no update or delete policy. Report anything missing.
- **Why:** The app stores children's data, so every table must be locked down.

## 3. Secret leak guard
- **When:** A file in `app/`, `components/`, or `lib/` is saved
- **Do:** If the file contains `"use client"`, make sure it doesn't import `lib/supabase/admin`, any file with `import 'server-only'`, or reference `SUPABASE_SERVICE_ROLE_KEY`. Also check that no file uses `dangerouslySetInnerHTML` with user data. Report any problem.
- **Why:** Stops the service role key from ever reaching the browser.

## 4. Property tests on domain changes
- **When:** A file in `lib/domain/` or `tests/` is saved
- **Do:** Run `npm run test`. If a property-based test fails, show the smallest failing example fast-check found and explain which rule it breaks.
- **Why:** The business rules (hours, points, stamps, town) are where subtle bugs hide.

## 5. Child content check
- **When:** `docs/missions.md` or `scripts/seed.ts` is saved
- **Do:** Check that every story uses only original characters (no copyrighted or trademarked characters or brands), that grade 2–5 stories show near misses and feelings rather than injuries, that civics content is non-partisan, and that no story names a real person. List anything that breaks these rules.
- **Why:** Content safety for young students, and protection against copyright problems in the submission.

## 6. Update the write-up (run by hand)
- **When:** Manually triggered
- **Do:** Read the recent changes and add a short entry to the "Build log" section of `docs/KIRO_WRITEUP.md`: what was built, which spec tasks it completed, and which Kiro features were involved.
- **Why:** The Kiro write-up is judged, and writing it as you go is far easier than writing it at the end.
