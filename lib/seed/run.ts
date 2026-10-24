// The reusable seed routine (Requirements 16.3, 16.5, 16.6, 16.7, 17.1). Both
// `scripts/seed.ts` (run via `npm run seed`) and the demo-reset flow call
// `runSeed(supabase, options)`: the script owns argument parsing and the exit
// code, and the reset owns the DEMO_MODE check, but the actual inserts live
// here so the two paths produce an identical known state (design.md "Seed and
// Demo Design").
//
// The caller passes an already-built admin Supabase client (service role), so
// writes reach Postgres as `service_role` and pass the via_rpc direct-write
// guard (design.md "Service-role exemption"). This module performs no env
// reads and no client construction, which keeps it usable from both a Node
// script and a Next server action.
//
// Scope note: this task (5.3) seeds the core content only. Demo accounts
// (task 5.4, `lib/seed/accounts.ts`) and two weeks of history (task 5.5,
// `lib/seed/history.ts`) are wired in through the `seedAccounts` and
// `seedHistory` hooks on {@link SeedHooks}; until those tasks land the hooks
// are simply absent and the core content seeds on its own.

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseMissions, type SeedModule } from "./missions";
import {
  DEMO_LEADER,
  PLAN_CLASSES,
  PLAN_PARTNERS,
  PLAN_REWARDS,
  SCHOOL_NAME,
  SEED_AVATARS,
  SEED_FIRST_NAMES,
  SEED_LAST_INITIALS,
  type ClassKey,
  type PlanClass,
} from "./plan";

/**
 * A student the core seed created, with the identifiers the history step
 * (task 5.5) needs to write approved completions. Exposes only the non-PII
 * fields already stored on the row (Requirements 16.5, 37.1).
 */
export type SeededStudent = {
  readonly id: string;
  readonly classKey: ClassKey;
  readonly firstName: string;
  readonly lastInitial: string;
  readonly grade: number;
};

/**
 * A class the core seed created, carrying the ids the accounts step (teacher
 * ownership, task 5.4) and the history step (completions, task 5.5) build on,
 * plus the plan entry so those steps know the class's module and start day.
 */
export type SeededClass = {
  readonly id: string;
  readonly plan: PlanClass;
  /** The id of the module assigned to this class (`class_modules.module_id`). */
  readonly moduleId: string;
  readonly students: readonly SeededStudent[];
};

/**
 * One parsed module as written to the database, mapping each mission's
 * `day_number` to its row id so the history step can target a specific day.
 */
export type SeededModule = {
  readonly id: string;
  readonly title: string;
  /** Mission row ids keyed by `day_number` (1–5). */
  readonly missionIdByDay: ReadonlyMap<number, string>;
};

/**
 * The result of a core seed: everything later steps and the reset need to find
 * seeded rows again without re-querying by name.
 */
export type SeedResult = {
  readonly schoolId: string;
  readonly classes: readonly SeededClass[];
  readonly modulesByTitle: ReadonlyMap<string, SeededModule>;
};

/**
 * Optional follow-on steps wired into the seed. Task 5.4 supplies
 * `seedAccounts` (demo logins) and task 5.5 supplies `seedHistory` (two weeks
 * of approved completions). Both run after the core content exists and receive
 * the {@link SeedResult} so they can attach to the rows just created.
 */
export type SeedHooks = {
  readonly seedAccounts?: (supabase: SupabaseClient, result: SeedResult) => Promise<void>;
  readonly seedHistory?: (supabase: SupabaseClient, result: SeedResult) => Promise<void>;
};

/** Options for {@link runSeed}. */
export type SeedOptions = SeedHooks & {
  /**
   * The reference date the demo is anchored to (opportunity start times are
   * offset from it; history, task 5.5, spans the 14 days before it). Defaults
   * to now; injectable so seeds and tests are reproducible.
   */
  readonly now?: Date;
};

/** Throws with a readable message when a Supabase write returns an error. */
function assertOk(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`Seed failed while ${context}: ${error.message}`);
  }
}

/**
 * Inserts rows and returns them, failing loudly if the insert errored or
 * returned nothing. Centralizes the `.insert(...).select()` pattern so each
 * caller reads as a single intent.
 */
async function insertReturning<Row>(
  supabase: SupabaseClient,
  table: string,
  rows: readonly Record<string, unknown>[],
  context: string,
): Promise<Row[]> {
  const { data, error } = await supabase.from(table).insert(rows).select();
  assertOk(error, context);
  if (data === null) {
    throw new Error(`Seed failed while ${context}: no rows returned`);
  }
  return data as Row[];
}

/** Writes the one demo school and returns its id (Requirement 16.3). */
async function seedSchool(supabase: SupabaseClient): Promise<string> {
  const [school] = await insertReturning<{ id: string }>(
    supabase,
    "schools",
    [{ name: SCHOOL_NAME, kind: "school" }],
    "creating the school",
  );
  return school.id;
}

/**
 * Writes all parsed modules and their missions (Requirement 17.1) and returns
 * them indexed by title and by mission day. Shared modules carry a null
 * `school_id` so every signed-in user can read them (Requirement 3.9).
 */
async function seedModules(
  supabase: SupabaseClient,
  parsed: readonly SeedModule[],
): Promise<Map<string, SeededModule>> {
  const byTitle = new Map<string, SeededModule>();

  for (const mod of parsed) {
    const [moduleRow] = await insertReturning<{ id: string }>(
      supabase,
      "modules",
      [
        {
          title: mod.title,
          level: mod.level,
          quality: mod.quality,
          week_order: mod.weekOrder,
          school_id: null,
        },
      ],
      `creating module "${mod.title}"`,
    );

    const missionRows = mod.missions.map((mission) => ({
      module_id: moduleRow.id,
      day_number: mission.dayNumber,
      title: mission.title,
      story: mission.story,
      ask: mission.ask,
      instructions: mission.instructions,
      points: mission.points,
      verification: mission.verification,
      est_minutes: mission.estMinutes,
      town_item: mission.townItem,
    }));

    const missions = await insertReturning<{ id: string; day_number: number }>(
      supabase,
      "missions",
      missionRows,
      `creating missions for module "${mod.title}"`,
    );

    const missionIdByDay = new Map<number, string>();
    for (const mission of missions) {
      missionIdByDay.set(mission.day_number, mission.id);
    }

    byTitle.set(mod.title, { id: moduleRow.id, title: mod.title, missionIdByDay });
  }

  return byTitle;
}

/**
 * Builds the roster rows for one class. Each student carries only first name,
 * single last initial, grade, class, and avatar (Requirements 16.5, 37.1).
 * The demo Leader Jordan M. is placed first in Grade 11 Advisory so task 5.4
 * can attach the one Grade 11 login to a known row; every other student gets
 * no login (`auth_user_id` stays null). `login_code` is a unique, non-PII
 * placeholder required by the schema.
 */
function buildStudentRows(
  plan: PlanClass,
  schoolId: string,
  classId: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  const makeRow = (firstName: string, lastInitial: string, index: number) => ({
    school_id: schoolId,
    class_id: classId,
    first_name: firstName,
    last_initial: lastInitial,
    grade: plan.grade,
    avatar: SEED_AVATARS[index % SEED_AVATARS.length],
    login_code: `${plan.key}-${String(index + 1).padStart(2, "0")}`,
  });

  let index = 0;

  // Grade 11 Advisory leads with Jordan M. so the one Leader login (task 5.4)
  // attaches to a deterministic student (Requirement 16.4).
  if (plan.key === "grade11") {
    rows.push(makeRow(DEMO_LEADER.firstName, DEMO_LEADER.lastInitial, index));
    index += 1;
  }

  while (rows.length < plan.studentCount) {
    const firstName = SEED_FIRST_NAMES[index % SEED_FIRST_NAMES.length];
    const lastInitial = SEED_LAST_INITIALS[index % SEED_LAST_INITIALS.length];
    rows.push(makeRow(firstName, lastInitial, index));
    index += 1;
  }

  return rows;
}

/**
 * Writes the five classes, their default rewards, rosters, and module
 * assignments (Requirements 16.3, 16.5, 16.6). `teacher_id` is left null here;
 * the accounts step (task 5.4) creates teacher logins and claims ownership.
 */
async function seedClasses(
  supabase: SupabaseClient,
  schoolId: string,
  modulesByTitle: ReadonlyMap<string, SeededModule>,
): Promise<SeededClass[]> {
  const seeded: SeededClass[] = [];

  for (const plan of PLAN_CLASSES) {
    const mod = modulesByTitle.get(plan.moduleTitle);
    if (mod === undefined) {
      throw new Error(
        `Seed failed: class "${plan.name}" references unknown module "${plan.moduleTitle}"`,
      );
    }

    const [classRow] = await insertReturning<{ id: string }>(
      supabase,
      "classes",
      [{ school_id: schoolId, name: plan.name, grade: plan.grade, teacher_id: null }],
      `creating class "${plan.name}"`,
    );

    const rewardRows = PLAN_REWARDS.map((reward) => ({
      class_id: classRow.id,
      stage: reward.stage,
      reward: reward.reward,
    }));
    assertOk(
      (await supabase.from("class_rewards").insert(rewardRows)).error,
      `creating rewards for class "${plan.name}"`,
    );

    const studentRows = buildStudentRows(plan, schoolId, classRow.id);
    const students = await insertReturning<{
      id: string;
      first_name: string;
      last_initial: string;
      grade: number;
    }>(supabase, "students", studentRows, `creating students for class "${plan.name}"`);

    assertOk(
      (
        await supabase.from("class_modules").insert({
          class_id: classRow.id,
          module_id: mod.id,
        })
      ).error,
      `assigning module "${plan.moduleTitle}" to class "${plan.name}"`,
    );

    seeded.push({
      id: classRow.id,
      plan,
      moduleId: mod.id,
      students: students.map((student) => ({
        id: student.id,
        classKey: plan.key,
        firstName: student.first_name,
        lastInitial: student.last_initial,
        grade: student.grade,
      })),
    });
  }

  return seeded;
}

/**
 * Writes the two partners, links each to the school, and creates exactly two
 * opportunities per partner starting within 14 days of the seed date
 * (Requirement 16.7). Opportunity start/end times are offsets from `now`.
 */
async function seedPartners(
  supabase: SupabaseClient,
  schoolId: string,
  now: Date,
): Promise<void> {
  const dayMs = 24 * 60 * 60 * 1000;

  for (const partner of PLAN_PARTNERS) {
    const [partnerRow] = await insertReturning<{ id: string }>(
      supabase,
      "partner_orgs",
      [{ name: partner.name, kind: partner.kind, city: partner.city }],
      `creating partner "${partner.name}"`,
    );

    assertOk(
      (
        await supabase
          .from("school_partners")
          .insert({ school_id: schoolId, partner_org_id: partnerRow.id })
      ).error,
      `linking partner "${partner.name}" to the school`,
    );

    const opportunityRows = partner.opportunities.map((opportunity) => {
      const startsAt = new Date(now.getTime() + opportunity.startInDays * dayMs);
      const endsAt = new Date(startsAt.getTime() + opportunity.durationHours * 60 * 60 * 1000);
      return {
        partner_org_id: partnerRow.id,
        title: opportunity.title,
        description: opportunity.description,
        location_name: opportunity.locationName,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        min_grade: opportunity.minGrade,
        capacity: opportunity.capacity,
      };
    });

    assertOk(
      (await supabase.from("opportunities").insert(opportunityRows)).error,
      `creating opportunities for partner "${partner.name}"`,
    );
  }
}

/**
 * Seeds the full demo known state with the given admin (service role) client
 * (Requirements 16.3, 16.5, 16.6, 16.7, 17.1). Parses `docs/missions.md` for
 * module and mission content (Requirement 17.1), then writes the school,
 * modules and missions, classes with rewards and rosters, and the two
 * school-linked partners with their opportunities.
 *
 * After the core content is in place it runs any supplied hooks — `seedAccounts`
 * (demo logins, task 5.4) and `seedHistory` (two weeks of history, task 5.5) —
 * so the reset flow and the CLI share one ordering. Returns the {@link
 * SeedResult} describing what was created.
 */
export async function runSeed(
  supabase: SupabaseClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const now = options.now ?? new Date();

  const parsedModules = parseMissions();

  const schoolId = await seedSchool(supabase);
  const modulesByTitle = await seedModules(supabase, parsedModules);
  const classes = await seedClasses(supabase, schoolId, modulesByTitle);
  await seedPartners(supabase, schoolId, now);

  const result: SeedResult = { schoolId, classes, modulesByTitle };

  // Follow-on steps (tasks 5.4 and 5.5) attach to the rows just created.
  await options.seedAccounts?.(supabase, result);
  await options.seedHistory?.(supabase, result);

  return result;
}
