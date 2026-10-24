# Kiro run plan

Run one phase at a time. After each phase: check it works, commit and push, and add a line to the build log in `docs/KIRO_WRITEUP.md` (or run the "Update the write-up" hook).

## Saving credits
- Keep the model on **Auto**.
- Run **one spec task at a time** with the task's Start button. Don't ask Kiro to "build everything."
- Don't repeat rules in chat. They're already in the steering files.
- When something breaks, paste **only the error message** and the file name, not the whole log.
- If Kiro goes in the wrong direction, use **checkpoints** to rewind instead of asking it to undo by hand.
- Never regenerate the whole spec. Edit the one task that's wrong.

## Phase 0: Create the spec (about 15 minutes, by 12:45)
1. Open the Kiro panel and create a new **Spec**.
2. Paste all of `docs/kiro-spec-kickoff.md`.
3. Review the requirements, design, and tasks. Check that:
   - The tasks follow steps 1–7, with 8–10 marked as stretch.
   - Nothing from the skip list appears.
   - Leaderboard, edit and undo, proof log, and stage rewards are in the tasks.
4. Approve. Kiro saves it in `.kiro/specs/`.
5. Create the six hooks from `docs/kiro-hooks.md`.
6. **Commit:** "Add Kiro spec and hooks"

## Phase 1: Setup and database (by 1:45)
Run the setup tasks. If Kiro asks for anything, use this:
> Use the Supabase keys in `.env.local`. Apply the migration with the Supabase MCP server if it's connected, otherwise give me the SQL to run in the Supabase SQL editor.

**Check:**
- `npm run dev` starts, and `/login` loads in the calm skin.
- In Supabase, every table shows RLS enabled.
- The database security hook ran on the migration with no warnings.
- Sign-ups are turned off in Supabase Auth settings.

**Commit:** "Setup, schema, RLS, and security headers"

## Phase 2: Domain logic and property tests (by 2:15)
Run the domain logic tasks. If tests are missing, use:
> Make sure every property in section 10 of `docs/build-prompt.md` has a fast-check test, including undo restoring the original state and editing matching a direct confirm.

**Check:** `npm run test` passes. Note any bug a property test caught for the write-up.

**Commit:** "Domain logic with property-based tests"

## Phase 3: Seed data (by 2:45)
Run the seed tasks, then `npm run seed`.

**Check:**
- Every demo account logs in and lands on the right page.
- 10 modules and 50 missions exist, with stories.
- The grade 3 town is about half full, and the leaderboard has five classes.

**Commit:** "Seed demo school and all 50 missions"

## Phase 4: Core loop (by 4:00, the most important phase)
Run the core loop tasks. If the look is off, use:
> Match the student dashboard and mission screens in `docs/demo.html`, using the sticker book skin with the light turquoise background and Fluent Emoji 3D icons.

**Check, as the grade 3 teacher:**
1. Start the mission. Pip's story, then the mission, then who took part.
2. Uncheck one student and confirm. Balloons, a crosswalk in the town, and a saved mission record.
3. The leaderboard updates the points per student.
4. "Edit who took part" adds the student back, and "Undo" reverses everything, with all three entries in today's proof log.
5. The projector view of the town fills the screen.
6. Everything works on your phone.

**Deploy now:** Connect the repo in Vercel, add the five environment variables, and check the live link works.

**Commit:** "Core mission loop with edit, undo, and proof log"

## Phase 5: Roadmap page (by 4:20)
Run the roadmap task.

**Check:** `/teacher/roadmap` shows the transit lines, today is marked, and tapping a day shows its story and details.

**Commit:** "Mission roadmap"

## Phase 6: Leaders flow (by 5:00)
Run the Leaders tasks.

**Check, with the partner on your laptop and the Leader on your phone:**
1. The partner shows the QR code.
2. The Leader scans to check in, then again to check out.
3. The partner approves the hours, and the Leader's proof timeline and certificate update.
4. "Make a new code" makes the old code stop working.

**Commit:** "Leader QR check-in and verified hours"

## Phase 7: Landing page, admin, and demo mode (by 5:30)
Run the remaining tasks.

**Check:** The landing page explains the idea and the Massachusetts civics law, the demo login buttons work, the admin sees the leaderboard and proof log, and "Reset demo data" restores everything.

**Commit:** "Landing page, admin overview, demo mode"

## Stretch, only if everything above works by 5:30
Phase 8 is class mode with the student dashboard, Phase 9 is the theme picker, and Phase 10 is the rewards editor. Stop at 6:00 regardless.

## Phase 11: Security and submission (5:30 or 6:00 to 7:30)
1. Ask Kiro:
   > Go through `SECURITY_TESTS.md` and section 6 of `docs/build-prompt.md`, run every check that can be automated, run `npm audit`, and fix anything high or critical.
2. Ask Kiro to write the README with setup steps, demo accounts, the demo script, Fluent Emoji credits, and "Before real use."
3. Finish `docs/KIRO_WRITEUP.md`.
4. Record the video, under three minutes: the problem, the Massachusetts law, the grade 3 mission with edit and undo, the Leader check-in, and how you used Kiro. Upload it to YouTube as **public**.
5. Make sure the GitHub repo is public and `.kiro/` is in it.
6. **Submit by 7:30.**

## If you fall behind
- **Behind at 4:00:** skip Phase 5 and show the roadmap from `docs/demo.html` in the video instead.
- **Behind at 5:00:** cut the certificate and "Make a new code," and keep the basic check-in and approval.
- **Behind at 6:30:** stop building and go straight to the video and submission. A working core loop and a strong write-up beat an unfinished extra feature.
