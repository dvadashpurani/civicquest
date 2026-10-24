// Seed CLI entry point, run with `npm run seed`
// (`tsx --conditions=react-server scripts/seed.ts`, so `server-only` resolves
// outside Next). It owns argument handling and the process exit code; the
// actual inserts live in `lib/seed/run.ts` so the demo-reset flow can reuse
// them to produce the identical known state (design.md "Seed and Demo
// Design").
//
// The service role key must be present before anything is seeded
// (Requirement 16.2): if `SUPABASE_SERVICE_ROLE_KEY` is absent or empty, the
// script prints exactly "SUPABASE_SERVICE_ROLE_KEY is required" and exits
// non-zero, writing no data. The check runs before the admin client is built,
// so the required-key message is what the operator sees rather than the
// generic startup env error.

import { createAdminSupabase } from "@/lib/supabase/admin";
import { runSeed } from "@/lib/seed/run";
import { seedAccounts } from "@/lib/seed/accounts";
import { seedHistory } from "@/lib/seed/history";

/** The exact message required when the service role key is missing. */
const MISSING_KEY_MESSAGE = "SUPABASE_SERVICE_ROLE_KEY is required";

async function main(): Promise<void> {
  // Requirement 16.2: no key, no seed. Checked here (not via getServerEnv) so
  // the operator sees the exact required-key message and nothing is written.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    console.error(MISSING_KEY_MESSAGE);
    process.exit(1);
  }

  const supabase = createAdminSupabase();

  // The demo-account hook (task 5.4) self-gates on DEMO_MODE, so passing it
  // unconditionally seeds zero accounts unless DEMO_MODE is exactly "true". The
  // history hook (task 5.5) seeds two weeks of approved completions and their
  // confirmation audit entries after the core content exists.
  const result = await runSeed(supabase, { seedAccounts, seedHistory });

  const studentCount = result.classes.reduce((sum, c) => sum + c.students.length, 0);
  console.log(
    `Seeded ${result.classes.length} classes (${studentCount} students) and ` +
      `${result.modulesByTitle.size} modules for the demo school.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Seed failed: ${message}`);
  process.exit(1);
});
