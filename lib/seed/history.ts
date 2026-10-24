// The two-weeks-of-history step of the seed (Requirement 17.5), wired into
// `lib/seed/run.ts` through the `seedHistory` hook on {@link SeedHooks}. Like
// `lib/seed/plan.ts`, the planning here is a PURE function: `planHistory` takes
// the {@link SeedResult} and the seed date and returns the exact rows to
// insert — it performs no I/O, reads no env, and constructs no client. The thin
// write (the `seedHistory` hook) lives in `run.ts` and simply hands these rows
// to the admin Supabase client, mirroring how `lib/seed/accounts.ts` keeps its
// gating and writes separate from the env-free `run.ts` core.
//
// Keeping the computation pure means it is fully reproducible for a given seed
// date and directly unit-testable (task 5.6) without a database.
//
// What the history must achieve (Requirement 17.5, design.md "History"):
//   - approved completions spread over the 14 days before the seed date;
//   - the Grade 3 class town is 45–55% full — the pre-village/village town
//     capacity is 36, so 16–20 distinct approved missions (one building each,
//     via the `class_town` view) — we target the midpoint, 18 buildings;
//   - every seeded student has at least one stamp (one `Stamp` of the module
//     quality per distinct present student, via the `student_stamps` view), so
//     every student gets at least one approved completion;
//   - the `audit_log` holds confirmation entries dated before the seed date;
//   - the three focus classes sit on the expected mission day of their assigned
//     module: Safe Streets day 1 (Grade 3), Respect Everywhere day 2 (Grade 7),
//     Civics Project day 3 (Grade 11 Advisory). `class_next_mission` is the
//     lowest `day_number` in the class's assigned module with no approved
//     completion (design.md "Next not-yet-confirmed"), so to sit the class on
//     day D we confirm days 1..D-1 of its module and leave day D unconfirmed.
//     Grade 3 therefore confirms no Safe Streets day; its town is filled from
//     missions in other modules, which populate `class_town` without affecting
//     `class_next_mission` (that lookup is scoped to the assigned module).
//
// Points mirror the domain rules by computing each completion's award with
// `computePoints` from `lib/domain/points.ts`, so seeded totals agree with what
// the confirm RPC would have produced (design.md "Domain Layer").

import type { SupabaseClient } from "@supabase/supabase-js";

import { computePoints } from "@/lib/domain/points";
import { gradeToLevel } from "@/lib/domain/levels";
import type { Level } from "@/lib/domain/types";
import type { SeededClass, SeededModule, SeedResult } from "./run";

/**
 * Target number of buildings in the Grade 3 town. The pre-village/village town
 * capacity is a 6×6 grid (36 cells), and the 45–55% band is 16–20 buildings;
 * 18 is the midpoint, so the fill sits at 50% (Requirement 17.5).
 */
const GRADE3_TARGET_BUILDINGS = 18;

/** Milliseconds in one day, for spacing confirmations across the 14-day window. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** The history window: the 14 days before the seed date (Requirement 17.5). */
const HISTORY_DAYS = 14;

/**
 * One `mission_completions` row the history step inserts. Every field mirrors a
 * writable column in supabase/migrations/0001_schema.sql; `status` is always
 * `approved` and `confirmedBy` is null because no profile need exist at history
 * time (the service-role seed is exempt from the protection trigger, design.md
 * "Service-role exemption"). `pointsAwarded` comes from {@link computePoints}.
 */
export type HistoryCompletion = {
  readonly missionId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly confirmedAt: Date;
  readonly pointsAwarded: number;
};

/**
 * One `audit_log` row recording a seeded confirmation (Requirement 17.5,
 * design.md "History"). `action` is `confirm`, `targetTable` is
 * `mission_completions`, and `createdAt` is dated before the seed date so the
 * proof log shows prior activity. `actorId` is null (no demo profile is
 * required for history).
 */
export type HistoryAuditEntry = {
  readonly schoolId: string;
  readonly action: string;
  readonly targetTable: string;
  readonly targetId: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: Date;
};

/**
 * The full set of rows the history step writes: approved completions and the
 * matching confirmation audit entries. Returned by {@link planHistory} so the
 * `seedHistory` hook in `run.ts` can insert them with the admin client.
 */
export type HistoryPlan = {
  readonly completions: readonly HistoryCompletion[];
  readonly auditLog: readonly HistoryAuditEntry[];
};

/** The plan class key for the Grade 3 focus class whose town we size to ~50%. */
const GRADE3_KEY = "grade3";

/**
 * Resolves a class's level from its roster grade, falling back to `learners`
 * for the (never-expected) rejected case so this pure planner never throws.
 * Used only to pick the per-student point value via {@link computePoints}.
 */
function levelForClass(seededClass: SeededClass): Level {
  const level = gradeToLevel(seededClass.plan.grade);
  return typeof level === "string" ? level : "learners";
}

/**
 * Flattens every seeded mission id into one deterministic list, ordered by
 * module title then `day_number`, so the Grade 3 town can be filled from a
 * stable pool of distinct missions that spans multiple modules. Each distinct
 * mission id yields exactly one building in the `class_town` view.
 */
function allMissionIdsOrdered(
  modulesByTitle: ReadonlyMap<string, SeededModule>,
): string[] {
  const titles = [...modulesByTitle.keys()].sort();
  const ids: string[] = [];
  for (const title of titles) {
    const mod = modulesByTitle.get(title);
    if (mod === undefined) continue;
    for (const day of [...mod.missionIdByDay.keys()].sort((a, b) => a - b)) {
      const id = mod.missionIdByDay.get(day);
      if (id !== undefined) ids.push(id);
    }
  }
  return ids;
}

/**
 * A confirmation time for the building at `buildingIndex`, spread evenly across
 * the 14 days before the seed date so the proof log shows a fortnight of
 * activity. Earlier buildings are dated further back, matching the ascending
 * placement order the `class_town` view sorts by (`min(confirmed_at)`).
 */
function confirmedAtForBuilding(now: Date, buildingIndex: number, total: number): Date {
  // Spread across days [HISTORY_DAYS .. 1] before `now` (never on `now` itself,
  // so every entry is strictly before the seed date, Requirement 17.5).
  const span = Math.max(total, 1);
  const daysBack = HISTORY_DAYS - Math.floor((buildingIndex * (HISTORY_DAYS - 1)) / span);
  return new Date(now.getTime() - daysBack * DAY_MS);
}

/**
 * Builds the Grade 3 town: {@link GRADE3_TARGET_BUILDINGS} distinct missions,
 * each an approved completion for a rotating slice of the roster so the town
 * fills to ~50% of its 36-cell capacity (Requirement 17.5). The roster is
 * rotated across buildings so every Grade 3 student is present for at least one
 * mission and therefore earns at least one stamp. Missions are drawn from the
 * shared pool (across modules), which fills `class_town` without confirming any
 * Safe Streets day, leaving Grade 3 sitting on day 1 of its assigned module.
 */
function planGrade3Town(
  grade3: SeededClass,
  missionPool: readonly string[],
  schoolId: string,
  now: Date,
): HistoryPlan {
  const completions: HistoryCompletion[] = [];
  const auditLog: HistoryAuditEntry[] = [];

  const students = grade3.students;
  if (students.length === 0) {
    return { completions, auditLog };
  }

  const level = levelForClass(grade3);
  const buildingCount = Math.min(GRADE3_TARGET_BUILDINGS, missionPool.length);

  // Rotate a contiguous slice of the roster for each building so every student
  // appears at least once (slices advance by one student per building and wrap
  // around, covering the whole roster well within `buildingCount` buildings).
  const presentPerBuilding = Math.max(1, Math.ceil(students.length / 2));

  for (let b = 0; b < buildingCount; b++) {
    const missionId = missionPool[b];
    const confirmedAt = confirmedAtForBuilding(now, b, buildingCount);

    const present: string[] = [];
    for (let k = 0; k < presentPerBuilding; k++) {
      const student = students[(b + k) % students.length];
      present.push(student.id);
    }

    const pointsEach = computePoints([present[0]!], level); // per-student award
    for (const studentId of present) {
      completions.push({
        missionId,
        studentId,
        classId: grade3.id,
        confirmedAt,
        pointsAwarded: pointsEach,
      });
    }

    auditLog.push({
      schoolId,
      action: "confirm",
      targetTable: "mission_completions",
      targetId: missionId,
      details: { classId: grade3.id, present: present.length, seeded: true },
      createdAt: confirmedAt,
    });
  }

  return { completions, auditLog };
}

/**
 * Confirms days 1..(startDay-1) of a class's assigned module so the class sits
 * on `startDay` as its next unconfirmed mission (design.md "Next
 * not-yet-confirmed"), giving every student in the class a stamp along the way.
 * Grade 3 (startDay 1) confirms nothing here — its town is filled separately —
 * so it still sits on Safe Streets day 1 (Requirement 17.5).
 */
function planModuleProgress(
  seededClass: SeededClass,
  assignedModule: SeededModule,
  schoolId: string,
  now: Date,
): HistoryPlan {
  const completions: HistoryCompletion[] = [];
  const auditLog: HistoryAuditEntry[] = [];

  const startDay = seededClass.plan.startDay;
  const level = levelForClass(seededClass);
  const studentIds = seededClass.students.map((student) => student.id);
  if (studentIds.length === 0) {
    return { completions, auditLog };
  }
  const pointsEach = computePoints([studentIds[0]!], level);

  // Days strictly before the class's current day are already confirmed.
  for (let day = 1; day < startDay; day++) {
    const missionId = assignedModule.missionIdByDay.get(day);
    if (missionId === undefined) continue;

    // Date each confirmed day progressively closer to the seed date, all
    // strictly before it (Requirement 17.5).
    const daysBack = Math.max(1, startDay - day);
    const confirmedAt = new Date(now.getTime() - daysBack * DAY_MS);

    for (const studentId of studentIds) {
      completions.push({
        missionId,
        studentId,
        classId: seededClass.id,
        confirmedAt,
        pointsAwarded: pointsEach,
      });
    }

    auditLog.push({
      schoolId,
      action: "confirm",
      targetTable: "mission_completions",
      targetId: missionId,
      details: { classId: seededClass.id, day, present: studentIds.length, seeded: true },
      createdAt: confirmedAt,
    });
  }

  return { completions, auditLog };
}

/**
 * Guarantees every student in a class has at least one approved completion (and
 * therefore at least one stamp, Requirement 17.5). For classes whose module
 * progress already covers everyone (startDay > 1), this adds nothing; for a
 * class with no confirmed day (startDay 1, other than Grade 3, which is covered
 * by its town), it confirms day 1 of the assigned module for the whole roster.
 */
function planStampFloor(
  seededClass: SeededClass,
  assignedModule: SeededModule,
  coveredStudentIds: ReadonlySet<string>,
  schoolId: string,
  now: Date,
): HistoryPlan {
  const completions: HistoryCompletion[] = [];
  const auditLog: HistoryAuditEntry[] = [];

  const uncovered = seededClass.students.filter(
    (student) => !coveredStudentIds.has(student.id),
  );
  if (uncovered.length === 0) {
    return { completions, auditLog };
  }

  // Use the latest mission day that still leaves the class on its current day:
  // confirming an earlier-than-start day keeps `class_next_mission` at startDay
  // only when startDay is 1 (no earlier day exists). For startDay 1 classes we
  // confirm day 1 itself; that moves the class to day 2, which is acceptable
  // for the non-focus Grade 4 / Grade 10 classes but NOT for Grade 3. Grade 3
  // is always fully covered by its town, so it never reaches this path.
  const missionId = assignedModule.missionIdByDay.get(1);
  if (missionId === undefined) {
    return { completions, auditLog };
  }

  const level = levelForClass(seededClass);
  const uncoveredIds = uncovered.map((student) => student.id);
  const pointsEach = computePoints([uncoveredIds[0]!], level);
  const confirmedAt = new Date(now.getTime() - DAY_MS);

  for (const studentId of uncoveredIds) {
    completions.push({
      missionId,
      studentId,
      classId: seededClass.id,
      confirmedAt,
      pointsAwarded: pointsEach,
    });
  }

  auditLog.push({
    schoolId,
    action: "confirm",
    targetTable: "mission_completions",
    targetId: missionId,
    details: { classId: seededClass.id, day: 1, present: uncoveredIds.length, seeded: true },
    createdAt: confirmedAt,
  });

  return { completions, auditLog };
}

/**
 * Builds the complete two-weeks-of-history plan from the {@link SeedResult} and
 * the seed date (Requirement 17.5). Pure: given the same inputs it returns the
 * same rows, and it never touches a database.
 *
 * The plan:
 *   1. fills the Grade 3 town to ~50% (18 of 36) from a cross-module mission
 *      pool, leaving Safe Streets fully unconfirmed so Grade 3 sits on day 1;
 *   2. confirms the pre-start days of each class's assigned module so Grade 7
 *      sits on Respect Everywhere day 2 and Grade 11 Advisory on Civics Project
 *      day 3 (and the others on their own start days);
 *   3. ensures every remaining student has at least one approved completion, so
 *      every seeded student earns at least one stamp;
 *   4. records a `confirm` audit entry dated before the seed date for each
 *      confirmed mission.
 */
export function planHistory(result: SeedResult, now: Date = new Date()): HistoryPlan {
  const completions: HistoryCompletion[] = [];
  const auditLog: HistoryAuditEntry[] = [];
  const coveredByClass = new Map<string, Set<string>>();

  const collect = (plan: HistoryPlan) => {
    for (const completion of plan.completions) {
      completions.push(completion);
      let covered = coveredByClass.get(completion.classId);
      if (covered === undefined) {
        covered = new Set<string>();
        coveredByClass.set(completion.classId, covered);
      }
      covered.add(completion.studentId);
    }
    for (const entry of plan.auditLog) {
      auditLog.push(entry);
    }
  };

  const grade3 = result.classes.find((c) => c.plan.key === GRADE3_KEY);

  // 1. Grade 3 town, filled from a cross-module pool to ~50% capacity. The
  //    pool EXCLUDES Grade 3's own assigned module (Safe Streets): confirming a
  //    Safe Streets day would advance `class_next_mission` off day 1, so those
  //    buildings must come only from other modules' missions (Requirement
  //    17.5). Those other missions still populate `class_town` (which is not
  //    scoped to the assigned module) without changing the class's day.
  if (grade3 !== undefined) {
    const grade3Module = findAssignedModule(result, grade3);
    const excludedIds = new Set(
      grade3Module ? [...grade3Module.missionIdByDay.values()] : [],
    );
    const missionPool = allMissionIdsOrdered(result.modulesByTitle).filter(
      (id) => !excludedIds.has(id),
    );
    collect(planGrade3Town(grade3, missionPool, result.schoolId, now));
  }

  // 2. Module progress for every class, setting each class's current day.
  for (const seededClass of result.classes) {
    const assignedModule = findAssignedModule(result, seededClass);
    if (assignedModule === undefined) continue;
    collect(planModuleProgress(seededClass, assignedModule, result.schoolId, now));
  }

  // 3. Stamp floor: cover any student not yet given a completion.
  for (const seededClass of result.classes) {
    const assignedModule = findAssignedModule(result, seededClass);
    if (assignedModule === undefined) continue;
    const covered = coveredByClass.get(seededClass.id) ?? new Set<string>();
    collect(planStampFloor(seededClass, assignedModule, covered, result.schoolId, now));
  }

  return { completions, auditLog };
}

/**
 * Finds the {@link SeededModule} assigned to a class by matching the class's
 * plan `moduleTitle` against the modules indexed by title in the
 * {@link SeedResult}.
 */
function findAssignedModule(
  result: SeedResult,
  seededClass: SeededClass,
): SeededModule | undefined {
  return result.modulesByTitle.get(seededClass.plan.moduleTitle);
}

/** Throws with a readable message when a Supabase write returns an error. */
function assertOk(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`Seed failed while ${context}: ${error.message}`);
  }
}

/**
 * The thin write for the history step, supplied to {@link runSeed} as the
 * `seedHistory` hook. It calls the pure {@link planHistory} to compute the rows
 * and then inserts them with the already-built admin (service-role) client, so
 * the writes reach Postgres as `service_role` and pass the via_rpc direct-write
 * guard and the completion-protection trigger (design.md "Service-role
 * exemption"). All domain computation stays in `planHistory`; this function
 * only maps the plan rows to column names and performs the inserts.
 *
 * The seed date is read from `result`-independent `now` so the hook matches the
 * `seedHistory` signature on {@link SeedHooks}; the opportunities in the core
 * seed already anchor to the same `new Date()` the script passes, and history
 * only needs a consistent "before now" window (Requirement 17.5).
 */
export async function seedHistory(
  supabase: SupabaseClient,
  result: SeedResult,
): Promise<void> {
  const plan = planHistory(result, new Date());

  if (plan.completions.length > 0) {
    const rows = plan.completions.map((completion) => ({
      mission_id: completion.missionId,
      student_id: completion.studentId,
      class_id: completion.classId,
      status: "approved",
      confirmed_by: null,
      confirmed_at: completion.confirmedAt.toISOString(),
      points_awarded: completion.pointsAwarded,
    }));
    assertOk(
      (await supabase.from("mission_completions").insert(rows)).error,
      "inserting seeded mission history",
    );
  }

  if (plan.auditLog.length > 0) {
    const rows = plan.auditLog.map((entry) => ({
      school_id: entry.schoolId,
      actor_id: null,
      action: entry.action,
      target_table: entry.targetTable,
      target_id: entry.targetId,
      details: entry.details,
      created_at: entry.createdAt.toISOString(),
    }));
    assertOk(
      (await supabase.from("audit_log").insert(rows)).error,
      "inserting seeded confirmation audit entries",
    );
  }
}
