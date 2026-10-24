import "server-only";

// Server-side data loaders for the teacher Today view and class views
// (Requirements 18.2, 18.5, 21.1, 21.10, 33.1, 33.3). Every query runs through
// the request-scoped server Supabase client (`createServerSupabase`), so it
// executes as the signed-in user under RLS: a teacher sees only the classes
// they own and those classes' students and completions, and a non-owner gets
// zero rows with no error (Requirement 18.5). None of these loaders mutate;
// the Step 4 writes go through the `security invoker` RPCs (task 7.6).
//
// Two conventions hold throughout, matching `lib/auth/require.ts`:
//   * Explicit column lists only, never `select *` — so a Leader-style column
//     leak can never happen and the shapes below stay authoritative
//     (design.md "QR token secrecy", Requirement 33.3 parameterized access).
//   * The class's position in its module is derived, not stored, from two
//     separate lookups — the next not-yet-confirmed mission and the most recent
//     confirmation within 24h (design.md "Two Today-view lookups").
//
// "Confirmed" means at least one `approved` completion exists for the mission
// and class, the same rule the domain equivalence helpers model
// (lib/domain/completions.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Level, Quality } from "@/lib/domain/types";

/** How recent a confirmation must be to allow teacher Edit/Undo (Requirement 21.1, 21.9). */
export const RECENT_CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const CLASS_COLUMNS = "id, school_id, name, grade, teacher_id";
// `quality` lives on `modules`, not `missions`, so it comes through the
// many-to-one embed. Selecting a bare `quality` on missions errors (42703).
const MISSION_COLUMNS =
  "id, module_id, day_number, title, est_minutes, verification, town_item, modules(quality)";
/**
 * The mission columns the three-step run screen needs (Requirement 19.2, 19.3):
 * the narrative fields (`story`, `ask`, `instructions`) on top of the summary
 * columns. Kept separate from {@link MISSION_COLUMNS} so the lighter Today-view
 * lookups never pull the long text.
 */
const MISSION_RUN_COLUMNS =
  "id, module_id, day_number, title, est_minutes, verification, town_item, story, ask, instructions, modules(quality)";
const STUDENT_COLUMNS = "id, first_name, last_initial, grade, avatar, kid_theme";

/**
 * Extracts a module's `week_order` from a Supabase embedded join, which may be
 * typed as the related row, an array of rows, or null depending on the FK
 * cardinality in the generated types. Returns a large sentinel when absent so
 * an unordered module sorts last rather than throwing.
 */
function weekOrderOf(modules: unknown): number {
  const row = Array.isArray(modules) ? modules[0] : modules;
  const weekOrder = (row as { week_order?: number } | null | undefined)?.week_order;
  return typeof weekOrder === "number" ? weekOrder : Number.MAX_SAFE_INTEGER;
}

/** Extracts the module quality from a `modules(quality)` embed. */
function qualityOf(modules: unknown): Quality {
  const row = Array.isArray(modules) ? modules[0] : modules;
  return ((row as { quality?: string } | null | undefined)?.quality ?? "Safety") as Quality;
}

/** A class owned by the signed-in teacher (a row of `classes` under RLS). */
export type OwnedClass = {
  readonly id: string;
  readonly schoolId: string;
  readonly name: string;
  readonly grade: number;
  readonly teacherId: string | null;
};

/**
 * The next not-yet-confirmed mission for a class — `class_next_mission`
 * (Requirements 18.2, 24.4). The lowest `day_number` in the class's assigned
 * module with no `approved` completion for the class. Calendar-independent, so
 * the demo works any day; an undone mission becomes "next" again because it has
 * no approved completion (Requirement 21.8). `null` when every mission in the
 * module is confirmed (the class is module complete) or no module is assigned.
 */
export type NextMission = {
  readonly id: string;
  readonly moduleId: string;
  readonly dayNumber: number;
  readonly title: string;
  readonly quality: Quality;
  readonly estMinutes: number;
  readonly verification: string;
  readonly townItem: string;
};

/**
 * The most recent confirmation for a class within the last 24h —
 * `class_recent_confirmation` (Requirements 21.1, 21.9). The mission (if any) in
 * the class's assigned module whose confirmation time (`min(confirmed_at)` over
 * its currently `approved` completions) is less than 24 hours ago. Students
 * added later by an edit do not extend the window, while a re-confirm after
 * undo starts a fresh one. Drives "Done today", "Edit who took part", "Undo",
 * and the 24h gate the RPCs re-check. `null` when nothing was confirmed in the
 * window.
 */
export type RecentConfirmation = {
  readonly missionId: string;
  readonly confirmedAt: string;
};

/** A student on a class roster (a row of `students` under RLS). */
export type RosterStudent = {
  readonly id: string;
  readonly firstName: string;
  readonly lastInitial: string;
  readonly grade: number;
  readonly avatar: string;
  readonly kidTheme: string;
};

/**
 * One entry in the Today's proof log panel (Requirement 21.10): a confirm,
 * edit, or undo the signed-in teacher performed, newest first, each with its
 * timestamp. RLS on `audit_log` only lets a user read rows they wrote
 * (`actor_id = auth.uid()`), so this is naturally scoped to the teacher's own
 * actions without an extra filter (supabase/migrations/0002_rls.sql).
 */
export type ProofLogEntry = {
  readonly id: number;
  readonly action: string;
  readonly targetTable: string;
  readonly targetId: string | null;
  readonly details: unknown;
  readonly createdAt: string;
};

/** The audit_log actions the Today's proof log surfaces (confirm/edit/undo). */
const PROOF_LOG_ACTIONS = ["confirm", "re_approve", "edit", "undo"] as const;

/**
 * The classes the signed-in teacher owns (Requirement 18.1). RLS limits the
 * `classes` rows to `teacher_id = auth.uid()`, so a non-owner request simply
 * returns an empty list with no error (Requirement 18.5). Ordered by grade then
 * name for a stable Today view.
 */
export async function getOwnedClasses(
  client?: SupabaseClient,
): Promise<OwnedClass[]> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("classes")
    .select(CLASS_COLUMNS)
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    schoolId: row.school_id,
    name: row.name,
    grade: row.grade,
    teacherId: row.teacher_id ?? null,
  }));
}

/**
 * A single class the signed-in teacher owns, by id (Requirements 18.5, 19.1).
 * RLS limits `classes` to `teacher_id = auth.uid()`, so a non-owner — or an
 * unknown id — gets `null` with no error, which the run screen turns into a
 * not-found. Used to confirm ownership before rendering the projector screen.
 */
export async function getOwnedClass(
  classId: string,
  client?: SupabaseClient,
): Promise<OwnedClass | null> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("classes")
    .select(CLASS_COLUMNS)
    .eq("id", classId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    schoolId: data.school_id,
    name: data.name,
    grade: data.grade,
    teacherId: data.teacher_id ?? null,
  };
}

/**
 * A mission belonging to a class's assigned module, with the narrative text the
 * three-step run screen shows (Requirements 19.2, 19.3). Mirrors
 * {@link NextMission} plus `story`, `ask`, and `instructions`.
 */
export type RunMission = NextMission & {
  readonly story: string;
  readonly ask: string;
  readonly instructions: string;
};

/**
 * Loads a single mission for the run screen (Requirement 19.1), constrained to
 * the module assigned to `classId` via `class_modules` so a teacher can only
 * run a mission that belongs to the class they own. A non-owner sees no
 * `class_modules` row under RLS and gets `null`; an id outside the class's
 * module also returns `null`. Explicit column list, never `select *`
 * (Requirement 33.3).
 */
export async function getClassMission(
  classId: string,
  missionId: string,
  client?: SupabaseClient,
): Promise<RunMission | null> {
  const supabase = client ?? (await createServerSupabase());

  const { data: assigned, error: assignedError } = await supabase
    .from("class_modules")
    .select("module_id")
    .eq("class_id", classId);
  if (assignedError || !assigned || assigned.length === 0) return null;

  // The mission must belong to ONE of the class's assigned modules (the current
  // module or an earlier history module). RLS already limits class_modules to
  // the owning teacher, so a non-owner sees none and gets null.
  const assignedModuleIds = assigned.map((row) => row.module_id as string);
  const { data, error } = await supabase
    .from("missions")
    .select(MISSION_RUN_COLUMNS)
    .eq("id", missionId)
    .in("module_id", assignedModuleIds)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    moduleId: data.module_id,
    dayNumber: data.day_number,
    title: data.title,
    quality: qualityOf(data.modules),
    estMinutes: data.est_minutes,
    verification: data.verification,
    townItem: data.town_item,
    story: data.story,
    ask: data.ask,
    instructions: data.instructions,
  };
}

/**
 * The next not-yet-confirmed mission for a class — `class_next_mission`
 * (Requirements 18.2, 21.8, 24.4). Reads the class's assigned module from
 * `class_modules`, its missions ordered by `day_number`, and the set of mission
 * ids with at least one `approved` completion for the class, then returns the
 * lowest-day mission not in that set. `null` when the class has no module, the
 * module has no missions, or every mission is confirmed (module complete).
 *
 * Done as explicit per-table reads rather than `select *` so the column lists
 * stay authoritative and RLS applies to each (Requirement 33.3). A non-owner
 * sees no `class_modules`/`missions` rows for the class and gets `null`.
 */
export async function getClassNextMission(
  classId: string,
  client?: SupabaseClient,
): Promise<NextMission | null> {
  const state = await getClassNextMissionState(classId, client);
  return state.status === "next" ? state.mission : null;
}

/**
 * Where a class stands in its assigned modules. Separates "every mission is
 * confirmed" from "nothing assigned" and "a query failed", so the Today view
 * only says "complete" when it really is.
 */
export type NextMissionState =
  | { readonly status: "next"; readonly mission: NextMission }
  | { readonly status: "complete" }
  | { readonly status: "unassigned" }
  | { readonly status: "error" };

export async function getClassNextMissionState(
  classId: string,
  client?: SupabaseClient,
): Promise<NextMissionState> {
  const supabase = client ?? (await createServerSupabase());

  // A class can have MORE THAN ONE assigned module: the current module plus
  // earlier same-level modules that hold its seeded history. The "next"
  // mission is the lowest unconfirmed day in the EARLIEST assigned module
  // (by week_order) that still has one, so a fully-confirmed history module is
  // skipped and the class lands on its real current mission. A single-module
  // class behaves exactly as before.
  const { data: assigned, error: assignedError } = await supabase
    .from("class_modules")
    .select("module_id, modules(week_order)")
    .eq("class_id", classId);
  if (assignedError) return { status: "error" };
  if (!assigned || assigned.length === 0) return { status: "unassigned" };

  // Order assigned modules by their week_order ascending; ties keep a stable
  // order by module id so the scan is deterministic.
  const orderedModuleIds = assigned
    .map((row) => ({
      moduleId: row.module_id as string,
      weekOrder: weekOrderOf(row.modules),
    }))
    .sort((a, b) =>
      a.weekOrder !== b.weekOrder
        ? a.weekOrder - b.weekOrder
        : a.moduleId < b.moduleId
          ? -1
          : a.moduleId > b.moduleId
            ? 1
            : 0,
    )
    .map((row) => row.moduleId);

  const { data: missions, error: missionsError } = await supabase
    .from("missions")
    .select(MISSION_COLUMNS)
    .in("module_id", orderedModuleIds)
    .order("day_number", { ascending: true });
  if (missionsError || !missions) return { status: "error" };
  if (missions.length === 0) return { status: "unassigned" };

  const { data: approved, error: approvedError } = await supabase
    .from("mission_completions")
    .select("mission_id")
    .eq("class_id", classId)
    .eq("status", "approved");
  if (approvedError) return { status: "error" };

  const confirmedMissionIds = new Set((approved ?? []).map((row) => row.mission_id));

  // Walk the assigned modules in week_order; within each, missions are already
  // ordered by day_number. Return the first unconfirmed mission found.
  for (const moduleId of orderedModuleIds) {
    const next = missions.find(
      (mission) => mission.module_id === moduleId && !confirmedMissionIds.has(mission.id),
    );
    if (next) {
      return {
        status: "next",
        mission: {
          id: next.id,
          moduleId: next.module_id,
          dayNumber: next.day_number,
          title: next.title,
          quality: qualityOf(next.modules),
          estMinutes: next.est_minutes,
          verification: next.verification,
          townItem: next.town_item,
        },
      };
    }
  }

  // Every mission in every assigned module is confirmed.
  return { status: "complete" };
}

/**
 * The most recent confirmation for a class within the last 24h —
 * `class_recent_confirmation` (Requirements 21.1, 21.9). For the class's
 * currently `approved` completions, groups by mission to find each mission's
 * confirmation time (`min(confirmed_at)`), then returns the most recent mission
 * whose confirmation time is less than 24 hours before `now`. Students added
 * later by an edit do not extend the window because the earliest `confirmed_at`
 * per mission is used. `null` when nothing qualifies.
 *
 * `now` is injectable so the Today view and tests use a single consistent clock.
 */
export async function getClassRecentConfirmation(
  classId: string,
  now: Date = new Date(),
  client?: SupabaseClient,
): Promise<RecentConfirmation | null> {
  const supabase = client ?? (await createServerSupabase());

  const { data, error } = await supabase
    .from("mission_completions")
    .select("mission_id, confirmed_at")
    .eq("class_id", classId)
    .eq("status", "approved")
    .not("confirmed_at", "is", null);
  if (error || !data || data.length === 0) return null;

  // Earliest confirmed_at per mission = that mission's confirmation time.
  const confirmedAtByMission = new Map<string, number>();
  for (const row of data) {
    if (row.confirmed_at === null) continue;
    const ms = new Date(row.confirmed_at).getTime();
    if (Number.isNaN(ms)) continue;
    const existing = confirmedAtByMission.get(row.mission_id);
    if (existing === undefined || ms < existing) {
      confirmedAtByMission.set(row.mission_id, ms);
    }
  }

  const cutoff = now.getTime() - RECENT_CONFIRMATION_WINDOW_MS;
  let best: RecentConfirmation | null = null;
  let bestMs = -Infinity;
  for (const [missionId, ms] of confirmedAtByMission) {
    if (ms <= cutoff) continue; // outside the 24h window
    if (ms > bestMs) {
      bestMs = ms;
      best = { missionId, confirmedAt: new Date(ms).toISOString() };
    }
  }
  return best;
}

/**
 * The assigned module for a class — its display title and week order
 * (Requirement 18.2). The Today view shows the module name next to the next
 * mission and in the "Week N: <module>" panel. Reads `class_modules` for the
 * assigned module id, then the `modules` row (explicit columns, never
 * `select *`). RLS scopes both to the owning teacher, so a non-owner gets
 * `null`; `null` is also returned when no module is assigned.
 */
export type ClassModule = {
  readonly id: string;
  readonly title: string;
  readonly weekOrder: number;
  readonly quality: Quality;
};

export async function getClassModule(
  classId: string,
  moduleId?: string,
  client?: SupabaseClient,
): Promise<ClassModule | null> {
  const supabase = client ?? (await createServerSupabase());

  // A class can have several assigned modules (the current module plus earlier
  // history modules). Callers that know the current module (e.g. the one the
  // next mission belongs to) pass its id so the display reflects that module;
  // otherwise fall back to the lowest-week_order assigned module.
  const { data: assigned, error: assignedError } = await supabase
    .from("class_modules")
    .select("module_id, modules(week_order)")
    .eq("class_id", classId);
  if (assignedError || !assigned || assigned.length === 0) return null;

  const assignedIds = new Set(assigned.map((row) => row.module_id as string));

  let targetId: string | undefined;
  if (moduleId !== undefined && assignedIds.has(moduleId)) {
    // Only honor a requested module the class is actually assigned.
    targetId = moduleId;
  } else {
    // Fall back to the earliest assigned module by week_order.
    const earliest = assigned
      .map((row) => ({
        id: row.module_id as string,
        weekOrder: weekOrderOf(row.modules),
      }))
      .sort((a, b) =>
        a.weekOrder !== b.weekOrder
          ? a.weekOrder - b.weekOrder
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
      )[0];
    targetId = earliest?.id;
  }
  if (targetId === undefined) return null;

  const { data, error } = await supabase
    .from("modules")
    .select("id, title, week_order, quality")
    .eq("id", targetId)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: data.id,
    title: data.title,
    weekOrder: data.week_order,
    quality: data.quality as Quality,
  };
}

/**
 * The number of students on a class roster (Requirement 18.1). A lightweight
 * count used by the Today view's class rows ("24 students") that avoids pulling
 * full roster rows. RLS scopes `students` to the owning teacher's classes, so a
 * non-owner gets 0.
 */
export async function getClassStudentCount(
  classId: string,
  client?: SupabaseClient,
): Promise<number> {
  const supabase = client ?? (await createServerSupabase());
  const { count, error } = await supabase
    .from("students")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId);
  if (error || count === null) return 0;
  return count;
}

/**
 * The roster for a class (Requirements 18.5, 19.4): the students in the class,
 * ordered by first name then last initial for a stable projector roster. RLS
 * limits `students` to the owning teacher's classes, so a non-owner gets an
 * empty roster (Requirement 18.5). Only the child-safe columns are selected —
 * no login code, no auth link (Requirement 37.1).
 */
export async function getClassRoster(
  classId: string,
  client?: SupabaseClient,
): Promise<RosterStudent[]> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("students")
    .select(STUDENT_COLUMNS)
    .eq("class_id", classId)
    .order("first_name", { ascending: true })
    .order("last_initial", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastInitial: row.last_initial,
    grade: row.grade,
    avatar: row.avatar,
    kidTheme: row.kid_theme,
  }));
}

/**
 * Today's proof log for the signed-in teacher (Requirement 21.10): the
 * confirm, edit, and undo entries the teacher wrote since the start of the
 * current day, newest first, each with its timestamp. RLS restricts `audit_log`
 * to rows the caller wrote (`actor_id = auth.uid()`), so this reflects only the
 * teacher's own actions (supabase/migrations/0002_rls.sql).
 *
 * `now` is injectable so the day boundary matches the rest of the view; "today"
 * is the local calendar day of `now`.
 */
export async function getTodaysProofLog(
  now: Date = new Date(),
  client?: SupabaseClient,
): Promise<ProofLogEntry[]> {
  const supabase = client ?? (await createServerSupabase());

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, target_table, target_id, details, created_at")
    .in("action", [...PROOF_LOG_ACTIONS])
    .gte("created_at", startOfToday.toISOString())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    action: row.action,
    targetTable: row.target_table,
    targetId: row.target_id ?? null,
    details: row.details ?? null,
    createdAt: row.created_at,
  }));
}

// `Level` is re-exported for callers that pair a roster with the class level
// when calling the domain point/stamp helpers; the level itself is derived from
// grade by `gradeToLevel` (lib/domain/levels.ts), never stored on these shapes.
export type { Level };

// ---------------------------------------------------------------------------
// Class town and rewards loaders (Requirements 22.2, 22.4, 22.5)
// ---------------------------------------------------------------------------
//
// The class view and the full-screen projector town read the `class_town` view
// (one row per distinct approved mission) and the `class_rewards` table (the
// three teacher-set rewards). Both run under RLS through the server client, so
// a non-owning teacher simply gets zero rows — the projector page pairs these
// with an explicit ownership check so a non-owner sees a denied/empty screen
// (Requirement 22.4). `class_town` does not expose a mission id, but each row
// is already one distinct approved mission, so a stable synthetic id built from
// its placement time and town item is enough for `placeTown` to order and
// de-duplicate deterministically (lib/domain/town.ts).

import type { MissionRef } from "@/lib/domain/types";
import type { ClassRewards } from "@/components/town/RewardsList";

const CLASS_TOWN_COLUMNS = "class_id, town_item, placed_at";
const CLASS_REWARDS_COLUMNS = "stage, reward";

/**
 * The buildings for a class town — the `class_town` view rows for the class as
 * {@link MissionRef}s ready for `placeTown`/`townStage` (Requirements 22.2,
 * 11). Each row is one distinct approved mission; since the view exposes no
 * mission id, a stable id is synthesised from the placement time and town item
 * so ordering and de-duplication stay deterministic. RLS limits the view to the
 * owning teacher's classes, so a non-owner gets an empty list (Requirement
 * 18.5). Returns an empty list when the class has no approved missions, which
 * renders as an empty town (Requirement 22.3).
 */
export async function getClassTown(
  classId: string,
  client?: SupabaseClient,
): Promise<MissionRef[]> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("class_town")
    .select(CLASS_TOWN_COLUMNS)
    .eq("class_id", classId);
  if (error || !data) return [];
  return data.map((row) => {
    const placedAt = new Date(row.placed_at);
    return {
      missionId: `${row.placed_at}:${row.town_item}`,
      townItem: row.town_item,
      placedAt,
    };
  });
}

/**
 * The three teacher-set rewards for a class — the `class_rewards` rows mapped to
 * the {@link ClassRewards} shape the rewards display expects (Requirement
 * 22.5). A stage with no row becomes an empty string, which the display renders
 * as "No reward set yet". RLS scopes the rows to the class's school, so a
 * non-owner gets all-empty rewards.
 */
export async function getClassRewards(
  classId: string,
  client?: SupabaseClient,
): Promise<ClassRewards> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("class_rewards")
    .select(CLASS_REWARDS_COLUMNS)
    .eq("class_id", classId);

  const rewards: ClassRewards = { village: "", town: "", city: "" };
  if (error || !data) return rewards;
  const byStage = new Map(data.map((row) => [row.stage as string, row.reward as string]));
  return {
    village: byStage.get("village") ?? "",
    town: byStage.get("town") ?? "",
    city: byStage.get("city") ?? "",
  };
}

// ---------------------------------------------------------------------------
// Edit / Undo loader (task 7.14, Requirements 21.1, 21.3)
// ---------------------------------------------------------------------------
//
// "Edit who took part" reopens the roster with the SAVED selection preselected
// (design.md "Edit / Undo UI", Requirement 21.1). The saved selection for a
// recently-confirmed mission is exactly the set of students with an `approved`
// completion for that mission and class — the same set the edit RPC reverses
// out of when a student is unchecked (design.md "edit_mission_participants",
// Requirement 21.3). This loader returns those student ids so the Today view's
// Edit control can preselect them. RLS limits `mission_completions` to the
// owning teacher's classes, so a non-owner gets an empty set (Requirement
// 18.5).

/**
 * The saved present selection for a confirmed mission in a class — the student
 * ids with an `approved` completion for `(classId, missionId)` (Requirements
 * 21.1, 21.3). Used to preselect the roster when a teacher taps "Edit who took
 * part" so the dialog opens on the exact set that was last confirmed. A
 * non-owner, an unknown mission, or a mission with no approved completions all
 * return an empty array.
 */
export async function getConfirmedParticipantIds(
  classId: string,
  missionId: string,
  client?: SupabaseClient,
): Promise<string[]> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("mission_completions")
    .select("student_id")
    .eq("class_id", classId)
    .eq("mission_id", missionId)
    .eq("status", "approved");
  if (error || !data) return [];
  return data.map((row) => row.student_id as string);
}

// ---------------------------------------------------------------------------
// Class view loaders — leaderboard rank and recent mission records
// (Requirements 22.1, 23, 18.5). Added for the class detail view (task 7.15).
// Appended rather than editing the existing loaders so the Today-view reads
// above stay untouched. Both run under RLS through the server client, so a
// non-owning teacher — or a request for a class in another school — gets zero
// rows with no error (Requirement 18.5), and the page pairs these with an
// explicit ownership check before rendering anything.
// ---------------------------------------------------------------------------

import type { ClassPointsRow } from "@/lib/domain/leaderboard";

const CLASS_POINTS_COLUMNS = "class_id, name, student_count, total_points";

/**
 * The within-school `class_points` rows the signed-in teacher can see, mapped
 * to the {@link ClassPointsRow} shape {@link rankLeaderboard} consumes
 * (Requirement 23, 23.4). The view is `security_invoker`, so RLS already scopes
 * it to the viewer's school — this loader adds no cross-school data. A
 * non-owner with no visible classes gets an empty list. Explicit column list,
 * never `select *` (Requirement 33.3).
 */
export async function getSchoolLeaderboardRows(
  client?: SupabaseClient,
): Promise<ClassPointsRow[]> {
  const supabase = client ?? (await createServerSupabase());
  // `school_leaderboard()` (0009) ranks every class in the caller's school,
  // totals only. Before that migration is applied, fall back to the
  // `class_points` view, which a teacher sees only for their own classes.
  const ranked = await supabase.rpc("school_leaderboard");
  if (!ranked.error && Array.isArray(ranked.data)) {
    return (ranked.data as { class_id: string; name: string; student_count: number; approved_points: number }[]).map(
      (row) => ({
        classId: row.class_id,
        name: row.name,
        studentCount: row.student_count ?? 0,
        totalPoints: row.approved_points ?? 0,
      }),
    );
  }
  const { data, error } = await supabase
    .from("class_points")
    .select(CLASS_POINTS_COLUMNS);
  if (error || !data) return [];
  return data.map((row) => ({
    classId: row.class_id,
    name: row.name,
    studentCount: row.student_count ?? 0,
    totalPoints: row.total_points ?? 0,
  }));
}

/** One of the class's recent mission records — a distinct confirmed mission. */
export type MissionRecord = {
  /** The mission's id. */
  readonly missionId: string;
  /** The mission's title. */
  readonly title: string;
  /** The mission's day number within its module. */
  readonly dayNumber: number;
  /** The mission's stamp quality. */
  readonly quality: Quality;
  /** The mission's town building item. */
  readonly townItem: string;
  /**
   * When the mission was confirmed for the class — the earliest `confirmed_at`
   * over its currently `approved` completions, matching the `class_town`
   * placement time. `null` only when none of the approved rows carry a time.
   */
  readonly confirmedAt: string | null;
  /** How many students took part (currently `approved` completions). */
  readonly participantCount: number;
};

/** How many recent mission records the class view shows (Requirement 22.1). */
export const RECENT_MISSION_RECORD_LIMIT = 10;

/**
 * The class's most recent mission records, newest first (Requirements 22.1,
 * 18.5). Reads the class's currently `approved` `mission_completions`, groups
 * them by mission to get each mission's participant count and confirmation time
 * (earliest `confirmed_at`, the same rule `class_town` uses), joins the mission
 * summary columns, then returns the {@link RECENT_MISSION_RECORD_LIMIT} most
 * recently confirmed missions ordered newest first. A mission with no
 * `confirmed_at` sorts last.
 *
 * RLS limits `mission_completions` to the owning teacher's classes, so a
 * non-owner gets an empty list (Requirement 18.5); a class with zero approved
 * missions also yields an empty list. Per-table explicit column lists, never
 * `select *` (Requirement 33.3).
 */
export async function getClassRecentMissionRecords(
  classId: string,
  client?: SupabaseClient,
): Promise<MissionRecord[]> {
  const supabase = client ?? (await createServerSupabase());

  const { data: completions, error: completionsError } = await supabase
    .from("mission_completions")
    .select("mission_id, confirmed_at")
    .eq("class_id", classId)
    .eq("status", "approved");
  if (completionsError || !completions || completions.length === 0) return [];

  // Group by mission: participant count and the earliest confirmation time.
  const byMission = new Map<
    string,
    { participantCount: number; confirmedAtMs: number | null }
  >();
  for (const row of completions) {
    const existing = byMission.get(row.mission_id) ?? {
      participantCount: 0,
      confirmedAtMs: null,
    };
    existing.participantCount += 1;
    if (row.confirmed_at !== null) {
      const ms = new Date(row.confirmed_at).getTime();
      if (!Number.isNaN(ms)) {
        existing.confirmedAtMs =
          existing.confirmedAtMs === null
            ? ms
            : Math.min(existing.confirmedAtMs, ms);
      }
    }
    byMission.set(row.mission_id, existing);
  }

  const missionIds = [...byMission.keys()];
  const { data: missions, error: missionsError } = await supabase
    .from("missions")
    .select(MISSION_COLUMNS)
    .in("id", missionIds);
  if (missionsError || !missions) return [];

  const records: MissionRecord[] = missions.map((mission) => {
    const grouped = byMission.get(mission.id);
    const confirmedAtMs = grouped?.confirmedAtMs ?? null;
    return {
      missionId: mission.id,
      title: mission.title,
      dayNumber: mission.day_number,
      quality: qualityOf(mission.modules),
      townItem: mission.town_item,
      confirmedAt: confirmedAtMs === null ? null : new Date(confirmedAtMs).toISOString(),
      participantCount: grouped?.participantCount ?? 0,
    };
  });

  // Newest first; a record with no confirmation time sorts last, then by day.
  records.sort((a, b) => {
    const aMs = a.confirmedAt === null ? -Infinity : new Date(a.confirmedAt).getTime();
    const bMs = b.confirmedAt === null ? -Infinity : new Date(b.confirmedAt).getTime();
    if (aMs !== bMs) return bMs - aMs;
    return b.dayNumber - a.dayNumber;
  });

  return records.slice(0, RECENT_MISSION_RECORD_LIMIT);
}

// ---------------------------------------------------------------------------
// Week view: the five missions of a module with the class's progress, for the
// Today transit line, the student week strip, and the roadmap.
// ---------------------------------------------------------------------------

/** One day of a module, with whether the class has confirmed it. */
export type WeekDay = RunMission & {
  readonly confirmed: boolean;
};

/**
 * The missions of `moduleId` (ordered Monday to Friday) with a `confirmed`
 * flag for the class. RLS scopes the completions to the owning teacher, so a
 * non-owner sees every day as not confirmed and learns nothing.
 */
export async function getModuleWeek(
  classId: string,
  moduleId: string,
  client?: SupabaseClient,
): Promise<WeekDay[]> {
  const supabase = client ?? (await createServerSupabase());
  const [{ data: missions, error }, { data: approved }] = await Promise.all([
    supabase
      .from("missions")
      .select(MISSION_RUN_COLUMNS)
      .eq("module_id", moduleId)
      .order("day_number", { ascending: true }),
    supabase
      .from("mission_completions")
      .select("mission_id")
      .eq("class_id", classId)
      .eq("status", "approved"),
  ]);
  if (error || !missions) return [];
  const done = new Set((approved ?? []).map((row) => row.mission_id as string));
  return missions.map((data) => ({
    id: data.id,
    moduleId: data.module_id,
    dayNumber: data.day_number,
    title: data.title,
    quality: qualityOf(data.modules),
    estMinutes: data.est_minutes,
    verification: data.verification,
    townItem: data.town_item,
    story: data.story,
    ask: data.ask,
    instructions: data.instructions,
    confirmed: done.has(data.id),
  }));
}
