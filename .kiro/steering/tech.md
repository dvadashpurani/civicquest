---
inclusion: always
---

# Tech stack and conventions

## Stack (do not add other services)
- Latest stable Next.js, App Router, TypeScript in strict mode
- Tailwind CSS and shadcn/ui, restyled to `.kiro/steering/design.md`
- Supabase: Postgres, Auth, Storage, Row Level Security, via `@supabase/ssr`
- zod and react-hook-form for validation and forms
- `qrcode.react` to show QR codes, `@yudiel/react-qr-scanner` to scan them
- Motion (formerly Framer Motion) for the balloons, stamps, and town animation
- Vitest and fast-check for unit and property-based tests
- Hosting on Vercel
- No AI or LLM APIs in the app

## Conventions
- Mutations use server actions. Every server action validates input with zod and checks the user’s role before doing anything.
- Server-only code (service role key, admin actions) lives in files that start with `import 'server-only'`.
- Database changes go in `supabase/migrations/` as SQL files. Never edit the database by hand.
- Business rules are pure functions in `lib/domain/`, with property-based tests.
- Pin exact dependency versions and commit the lockfile.
- Plain, sentence-case copy. Buttons say exactly what they do.

## Environment variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`), `NEXT_PUBLIC_APP_URL`, `DEMO_MODE`.

## Commands
- `npm run dev`: start the app
- `npm run seed`: load demo data from `docs/missions.md`
- `npm run test`: unit and property-based tests
- `npm run lint` and `npm run typecheck`: run before every commit
