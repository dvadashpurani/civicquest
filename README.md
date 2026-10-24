# CivicQuest

CivicQuest helps schools and after-school programs teach civic sense in grades 2 to 12 with one short, real-world mission each school day. The teacher shows a story, the class does the mission, and the teacher confirms who took part. That confirmation is the proof. Each student who took part gets points and a sticker, and the class adds a building to its shared town.

Massachusetts law requires every public school serving 8th grade, and every high school, to provide at least one student-led, non-partisan civics project for each student. The Civics Project module walks a class through one in five days.

It is a Hackachusetts entry in the Civic Action track.

## Who uses it

| Level | Grades | How they take part |
|---|---|---|
| Learners | 2 to 5 | Class mode on the teacher's device. Stories with Pip the fox. No student accounts. |
| Helpers | 6 to 8 | Class mode. Short case studies. Photo proof of places, never faces. |
| Leaders | 9 to 12 | Their own login, QR check-in at partner sites, hours approved by the supervisor who was there. |

Teachers run missions, admins see the school proof log and leaderboard, and partner organizations (a food bank, a park group) show a check-in code and approve hours. Parents have no accounts.

## Stack

Next.js 16 (App Router, `cacheComponents`), TypeScript, Tailwind CSS, Supabase (Postgres, Auth, Row Level Security), zod, `qrcode.react`, `@yudiel/react-qr-scanner`, Motion, Vitest and fast-check. Hosted on Vercel.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `NEXT_PUBLIC_APP_URL`, and `DEMO_MODE` (`true` for the demo).
3. In the Supabase SQL Editor, run every file in `supabase/migrations/` in order, `0001` through `0009`.
4. In the Supabase dashboard, go to **Authentication → Sign In / Providers** and turn **Allow new users to sign up** off. Accounts come only from invites, the seed, or admin-created Leader logins.
5. `npm run seed` loads the demo school, classes, rosters, all 50 missions from `docs/missions.md`, two weeks of history, partners, and the demo logins.
6. `npm run dev`, then open http://localhost:3000.

Checks: `npm run check` (types, lint, client guard), `npm run test` (unit and property-based tests), `npm run build`.

## Demo accounts

With `DEMO_MODE=true`, the landing page has one-click "Try the demo" buttons. You can also sign in at `/login`. Every password is `demo1234`.

| Account | Email | Lands on |
|---|---|---|
| Grade 3 teacher (Ms. Rivera) | `teacher3@demo.civicquest.app` | `/teacher`, Safe Streets day 1 |
| Grade 7 teacher (Mr. Chen) | `teacher7@demo.civicquest.app` | `/teacher`, Respect Everywhere |
| Grade 11 teacher (Ms. Okafor) | `teacher11@demo.civicquest.app` | `/teacher`, Civics Project |
| School admin | `admin@demo.civicquest.app` | `/admin` |
| Food bank partner (Dana K.) | `partner@demo.civicquest.app` | `/partner` |
| High schooler (Jordan M., grade 11) | `leader@demo.civicquest.app` | `/me` |

"View student dashboard" signs in as the Grade 3 teacher and opens class mode.

## Demo script (about 5 minutes)

1. **Landing.** Show what CivicQuest is and the Massachusetts civics project requirement. Click **Grade 3 teacher**.
2. **Today.** Grade 3 is on Safe Streets, day 1, "Stop, look, listen". Point out the week transit line and the school leaderboard ("Classes compete, not kids"). Click **Start mission**.
3. **Run the mission** on the projector: Pip's story, the discussion question, the activity. Tap **We finished the activity**, untick one student as absent, and **Confirm for class**. Balloons.
4. **Back on Today**, the card says Done today, with **Edit who took part** and **Undo** for 24 hours. Every change lands in today's proof log.
5. **Student dashboard.** Tap a student: "Welcome back", stat pills, the hero mission card, the week strip, the class town, and the sticker passport. Change the theme to Ocean. Open the absent student: no new sticker, but the class still got its crosswalk.
6. **Projector town** from the class page: the town, "What the class earns" with Unlocked rewards, and the legend.
7. **Partner.** Sign out and click **Food bank partner**. Open the event that is open now: a big QR code, **Make a new code**, and "Who came today".
8. **Leader.** On a phone, sign in as Jordan and open **Scan**. Scan the partner's code to check in, and scan again to check out. (On one laptop, use "Show the code as text" on the partner page and "Can't use the camera?" on the scanner.)
9. **Partner** approves the hours. Jordan's **/me** shows verified hours and the proof timeline, and **/me/certificate** prints.
10. **Admin.** The school totals, leaderboard, Civics Project progress, and the proof log, where an admin can reverse an older confirmation with a reason.

If the demo event is no longer open (the seed dates are relative to when it ran), the partner page shows **Open this event now (demo)** when `DEMO_MODE=true`.

## Security summary

- **Row Level Security on every table.** Teachers see only their own classes, admins only their school, partners only their org, and Leaders only their own rows. Anonymous users match no policy.
- **Writes go through RPCs.** Inserts and updates on `mission_completions`, `checkins`, and `audit_log` are blocked by triggers unless they come from one of five `security invoker` functions (`confirm_class_mission`, `edit_mission_participants`, `undo_mission`, `approve_checkin`, `leader_scan`) that set a transaction-local flag. Each re-checks role and ownership in its own body and writes its audit entry in the same transaction.
- **Never trust the client.** Points, stamps, hours, status, approver, school, and level are computed on the server. Every server action validates input with a strict zod schema, rejects unknown fields, calls `supabase.auth.getUser()`, and checks role and ownership.
- **Proof can't be edited.** `audit_log` is append-only and nothing is deleted. Teachers can edit or undo for 24 hours with a reason; after that only a school admin can reverse, and the reversal is logged.
- **QR codes.** Tokens are 24 random bytes, not selectable by users, shown only to the owning partner, and invalidated by "Make a new code". Check-in requires the school link, minimum grade, capacity, and the window from 30 minutes before the start to the end. Hours round down to 0.25 and cap at 8. Leaders are limited to 10 scans per minute inside the RPC.
- **The leaderboard** (`school_leaderboard()`) returns class totals for the caller's school only, never student data.
- **Child privacy.** Students are stored with first name, last initial, grade, class, avatar, and theme only. Learners and Helpers have no accounts. Partners see first name, last initial, and grade.
- **Headers.** A strict CSP (scripts and connections only to the app and Supabase; `'unsafe-eval'` and `ws:` only in development), `frame-ancestors 'none'`, HSTS, `nosniff`, a strict referrer policy, and camera allowed only for the app. The QR decoder's WASM is self-hosted for that reason.
- **Secrets.** The service role key is read only in `server-only` modules. Demo logins exist only when `DEMO_MODE=true`, checked on the server.

See `SECURITY_TESTS.md` for the security test plan.

## Before real use

- Turn `DEMO_MODE` off and remove the demo accounts and seeded data.
- Get a data privacy agreement in place with each district, and review it against FERPA, COPPA, and the Massachusetts Student Data Privacy Agreement.
- Add roster import (spreadsheet now, then Google Classroom and Clever), teacher invites, and printed QR login cards for younger students.
- Finish the photo review and quiz flows for Helpers, and the counselor export of verified hours.
- Load-test the RPCs, add monitoring and alerting, and schedule backups and a restore test.
- Have an external security review and a penetration test, and an accessibility audit with real screen reader users.
- Have teachers review every mission and story for age fit and non-partisan wording.

## Credits

Icons and characters are [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) by Microsoft, in the 3D style, used under the [MIT License](https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE). The PNGs are self-hosted in `public/icons/`. Pip the fox and all stories are original.
