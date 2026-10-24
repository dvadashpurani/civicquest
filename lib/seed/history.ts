// The two-weeks-of-history step of the seed (Requirement 17.5), wired into
// `lib/seed/run.ts` through the `seedHistory` hook on `SeedHooks`. Like
// `lib/seed/plan.ts`, the planning here is a PURE function: `planHistory` takes
// the `SeedResult` and the seed date and returns the exact rows to insert — it
// performs no I/O, reads no env, and constructs no client. The thin write (the
// `seedHistory` hook) hands these rows to the admin Supabase client, mirroring
// how `lib/seed/accounts.ts` keeps its gating and writes separate from the
// env-free `run.ts` core.
//
// What the history must achieve (Requirement 17.5, design.md "History") and the
// invariant that was missing before:
//
//   * History may fully confirm a class's HISTORY modules (its other same-level
//     modules) but must NEVER complete the class's CURRENT module. Each class
//     is assigned several modules (current + history, see lib/seed/plan.ts); the
//     next-mission lookup scans them by week_order and returns the current
//     module's first unconfirmed day, so a fully-confirmed history module is
//     skipped and the class always has a Start button on its real mission.
//
//   * The current module is confirmed only for days strictly BEFORE the class's
//     start day, which positions the three focus classes exactly as the spec
//     requires: Grade 3 confirms no Safe Streets day (on day 1), Grade 7
//     confirms Respect Everywhere day 1 (on day 2), Grade 11 confirms Civics
//     Project days 1-2 (on day 3). A class whose start day is 1 confirms nothing
//     in its current module.
//
//   * Fully confirming the history modules fills the class town (one building
//     per distinct approved mission) and gives every student many stamps, so
//     every seeded student has at least one stamp.
//
//   * Every confirmation is dated within the 14 days before the seed date, and
//     the audit log holds one `confirm` entry per confirmed mission, dated
//     before now.
//
// Points mirror the domain rules by computing each completion's award with
// `computePoints` from `lib/domain/points.ts`, so seeded totals agree with what
// the confirm RPC would have produced (design.md "Domain Layer").

import type { SupabaseClient } from "@supabase/supabase-js";

import { computePoints } from "@/lib/domain/points";
import { gradeToLevel } from "@/lib/domain/levels";
import type { Level } from "@/lib/domain/types";
import type { SeededClass, SeededModule, SeedResult } from "./run";

/** Milliseconds in one day, for spacing confirmations across the window. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** The history window: the 14 days before the seed date (Requirement 17.5). */
const HISTORY_DAYS = 14;

/**
 * One `mission_completions` row the history step inserts. Every field mirrors a
 * writable column in supabase/migrations/0001_schema.sql; `status` is always
 * `approved` and `confirmedBy` is null because no profile need exist at history
 * time (the service-role seed is exempt from the protection trigger, design.md
 * "Service-role exemption"). `pointsAwarded` comes from `computePoints`.
 */
export type HistoryCompletion = {
  readonly missionId: string;
  readonly studentId: string;
  readonly classId: string;
  readonly confirmedAt: Date;
  readonly pointsAwarded: number;
};

/**
 * One `audit_log` row recording a seeded confirmation (Requirement 17.5). `action`
 * is `confirm`, `targetTable` is `mission_completions`, and `createdAt` is dated
 * before the seed date so the proof log shows prior activity. `actorId` is null
 * (no demo profile is required for seeded history).
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
 * matching confirmation audit entries. Returned by `planHistory` so the
 * `seedHistory` hook in `run.ts` can insert them with the admin client.
 */
export type HistoryPlan = {
  readonly completions: readonly HistoryCompletion[];
  readonly auditLog: readonly HistoryAuditEntry[];
};

/**
 * Resolves a class's level from its roster grade, falling back to `learners`
 * for the (never-expected) rejected case so this pure planner never throws.
 * Used only to pick the per-student point value via `computePoints`.
 */
function levelForClass(seededClass: SeededClass): Level {
  const level = gradeToLevel(seededClass.plan.grade);
  return typeof level === "string" ? level : "learners";
}

/**
 * A confirmation time for a confirmed mission, spread across the 14 days before
 * the seed date so the proof log shows a fortnight of activity. `rank` is the
 * mission's position in the class's overall confirmation order (oldest first),
 * and `total` the number of confirmed missions, so earlier missions are dated
 * further back and every date is strictly before `now` (Requirement 17.5).
 */
function confirmedAtFor(now: Date, rank: number, total: number): Date {
  const span = Math.max(total, 1);
  // Days back in [HISTORY_DAYS .. 1]; never 0, so always before the seed date.
  const daysBack = HISTORY_DAYS - Math.floor((rank * (HISTORY_DAYS - 1)) / span);
  return new Date(now.getTime() - daysBack * DAY_MS);
}

/** The missions of a module in ascending day order, as [day, missionId] pairs. */
function missionsByDay(mod: SeededModule): Array<[number, string]> {
  return [...mod.missionIdByDay.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Builds the complete two-weeks-of-history plan from the `SeedResult` and the
 * seed date (Requirement 17.5). Pure: given the same inputs it returns the same
 * rows, and it never touches a database.
 *
 * For each class it collects the missions to confirm — every day of each
 * history module, plus the current module's days strictly before the class's
 * start day — then writes an approved completion for the whole roster of each,
 * and one `confirm` audit entry per mission, dated across the window. The
 * current module's start-day mission and everything after it are left
 * unconfirmed, so the class is never "complete".
 */
export function planHistory(result: SeedResult, now: Date = new Date()): HistoryPlan {
  const completions: HistoryCompletion[] = [];
  const auditLog: HistoryAuditEntry[] = [];

  for (const seededClass of result.classes) {
    const level = levelForClass(seededClass);
    const studentIds = seededClass.students.map((s) => s.id);
    if (studentIds.length === 0) continue;
    const pointsEach = computePoints([studentIds[0]!], level);

    // The missions to confirm for this class, as module-ordered [moduleId, day,
    // missionId] — history modules first (fully), then the current module's
    // pre-start days. The confirmation dates are assigned by overall rank so
    // the oldest sit furthest back in the 14-day window.
    const toConfirm: Array<{ missionId: string; day: number; moduleTitle: string }> = [];

    for (const title of seededClass.plan.historyModuleTitles) {
      const mod = result.modulesByTitle.get(title);
      if (mod === undefined) continue;
      for (const [day, missionId] of missionsByDay(mod)) {
        toConfirm.push({ missionId, day, moduleTitle: title });
      }
    }

    // Current module: confirm only days strictly before the class's start day.
    const current = result.modulesByTitle.get(seededClass.plan.moduleTitle);
    if (current !== undefined) {
      for (const [day, missionId] of missionsByDay(current)) {
        if (day < seededClass.plan.startDay) {
          toConfirm.push({ missionId, day, moduleTitle: seededClass.plan.moduleTitle });
        }
      }
    }

    const total = toConfirm.length;
    toConfirm.forEach((entry, rank) => {
      const confirmedAt = confirmedAtFor(now, rank, total);
      for (const studentId of studentIds) {
        completions.push({
          missionId: entry.missionId,
          studentId,
          classId: seededClass.id,
          confirmedAt,
          pointsAwarded: pointsEach,
        });
      }
      auditLog.push({
        schoolId: result.schoolId,
        action: "confirm",
        targetTable: "mission_completions",
        targetId: entry.missionId,
        details: {
          class_id: seededClass.id,
          mission_id: entry.missionId,
          module: entry.moduleTitle,
          day: entry.day,
          present: studentIds.length,
          seeded: true,
        },
        createdAt: confirmedAt,
      });
    });
  }

  return { completions, auditLog };
}

/** Throws with a readable message when a Supabase write returns an error. */
function assertOk(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`Seed failed while ${context}: ${error.message}`);
  }
}

/**
 * The thin write for the history step, supplied to `runSeed` as the
 * `seedHistory` hook. It calls the pure `planHistory` to compute the rows and
 * then inserts them with the already-built admin (service-role) client, so the
 * writes reach Postgres as `service_role` and pass the via_rpc direct-write
 * guard and the completion-protection trigger (design.md "Service-role
 * exemption"). All domain computation stays in `planHistory`; this function
 * only maps the plan rows to column names and performs the inserts.
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
