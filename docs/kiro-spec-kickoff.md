# Spec kickoff (paste this into a new Kiro spec)

I'm building CivicQuest solo in one day for Hackachusetts (Civic Action track, challenge V5). Submissions lock at 8 PM.

Read these first:
- `docs/build-prompt.md`: the full specification
- `docs/missions.md`: all 50 missions with stories and case studies
- `docs/simulation.html`: the intended flow and screen content
- `.kiro/steering/`: rules that apply to every task, including the design in `design.md`

Build ONLY this scope, in this order. Stop after each step so I can test and commit.

1. **Setup:** Next.js, Tailwind, shadcn/ui, Supabase clients, the full schema migration, RLS policies, triggers, storage policies, security headers, middleware role redirects, and the login page. Public sign-ups off. Both skins' design tokens and fonts from `design.md`. Download the Fluent Emoji 3D icons listed in `design.md` into `public/icons/` and build a small icon component that maps names to files.
2. **Domain logic and tests:** `lib/domain/` functions for levels, points, stamps, hours, town placement, town stages, CSV sanitizing, and safe redirects, with the fast-check property-based tests listed in section 10 of the build prompt.
3. **Seed:** The seed script with the demo school, classes, students, default rewards, partners, demo accounts, all 10 modules and 50 missions from `docs/missions.md`, and two weeks of history. `DEMO_MODE=true`.
4. **Core loop:** Teacher Today view, the three-step mission run screen (story, mission, who took part), one-tap "Confirm for class," "Edit who took part" and "Undo" for 24 hours after confirming (as in `docs/demo.html`), balloon celebration, saved mission record, class town with stage progress and rewards, full-screen projector view, and the class leaderboard. Include the Pip comic for Safe Streets day 1 as an SVG illustration.
5. **Roadmap:** The read-only `/teacher/roadmap` page with modules drawn as transit lines and days as stations.
6. **Leaders flow:** Partner opportunity page with QR code and "Make a new code," Leader QR check-in and check-out, partner "Approve hours," the Leader's `/me` page with proof timeline, and the certificate.
7. **Landing and demo:** Landing page with one-click demo logins and "Reset demo data," and the admin overview with the proof log.

**Stretch, only if steps 1–7 work:**
8. Class mode: the avatar picker and the student dashboard with stamp passport, in the sticker book skin.
9. Kid theme picker (Hero, Bubblegum, Ocean, Classic), saved per student.
10. Class rewards editing page.

**Skip for now:** CSV roster upload, teacher invites, quizzes, photo review, counselor page, reports, parent notice, QR login cards. Still follow every security rule that applies to what you build.

Before writing code, show me the requirements, design, and task list so I can approve them. After each step, add two or three sentences to the "Build log" section of `docs/KIRO_WRITEUP.md` describing what was built and which Kiro features helped.
