---
inclusion: always
---

# Project structure

```
app/
  (public)/            landing page, login
  (admin)/admin/       overview, proof log, reports
  (teacher)/teacher/   today, mission run, class town, roadmap, rewards, class mode
  (partner)/partner/   opportunities, check-in QR, hour approvals
  (leader)/me/         hours, QR scanner, certificate
components/            town grid, balloon celebration, stamp passport, story card, QR display
lib/
  supabase/            browser, server, and admin (server-only) clients
  domain/              pure logic: points, stamps, hours, levels, town stages, CSV sanitizing
  validation/          zod schemas
supabase/migrations/   SQL migrations, including RLS policies and triggers
scripts/seed.ts        demo data, reading docs/missions.md
tests/                 Vitest unit and property-based tests
docs/
  build-prompt.md      full specification
  missions.md          all 50 missions with stories
  simulation.html      clickable reference for flow
  design-directions.html
  themes-sample.html   the two skins and four kid themes
  kiro-hooks.md        hooks to create in Kiro
  kiro-run-plan.md     phase-by-phase execution plan
  KIRO_WRITEUP.md      notes for the submission write-up
.kiro/
  steering/            always-on rules
  specs/               specs Kiro generates
  hooks/               hooks created in Kiro
```

Keep `.kiro/` committed. It is required for judging.
