// Pure confirm/undo/edit equivalence helpers (Requirements 15, 20.8, 21.3,
// 21.8). These model the state transitions the `confirm_class_mission`,
// `edit_mission_participants`, and `undo_mission` RPCs perform on a single
// mission's completions, so the same reversibility and upsert rules can be
// proven with fast-check (Property 9, Property 10) and be guaranteed to agree
// with the database. Side-effect-free, no I/O, no `server-only`: the RPCs are
// the source of truth for the stored rows, while these functions pin down the
// rules those rows must obey (design.md "Domain Layer").
//
// A `CompletionState` is the per-mission map `studentId → { status, points }`.
// Every helper returns a brand-new state and never mutates its input, so a
// caller can compare before/after states directly (Requirement 15.2). Present
// students are always treated as an unordered set, so input order can never
// affect the result (Requirement 15.1). The upsert rule shared by
// `applyConfirm` and `applyEdit` mirrors the RPCs exactly: a student who is
// missing or currently `reversed` becomes `approved` with freshly computed
// values, while a student already `approved` is left untouched so no one is
// rewarded twice (Requirements 20.8, 21.3).

import { computePoints, computeStamps } from "./points";
import type { Level, Quality, Stamp } from "./types";

/**
 * The stored status of a single student's completion for a mission. Mirrors the
 * `review_status` values the protection trigger allows to toggle:
 * `approved` while the student counts toward points, stamps, and the town, and
 * `reversed` once an undo or edit has taken the reward away
 * (supabase/migrations/0004_triggers.sql; Requirements 20.1, 21.3, 21.8).
 */
export type CompletionStatus = "approved" | "reversed";

/**
 * One student's completion record for a mission: its current status and the
 * points it was awarded at confirmation time. Points persist on the row even
 * when `reversed` so the RPC history is preserved; only `approved` rows count
 * toward the derived totals (see {@link deriveTotals}).
 */
export type Completion = {
  /** Whether the completion currently counts (`approved`) or not (`reversed`). */
  readonly status: CompletionStatus;
  /**
   * Points awarded to this student for the mission, fixed at the per-student
   * amount for the mission level (Requirement 9.2). Retained on `reversed`
   * rows but excluded from the derived total.
   */
  readonly points: number;
};

/**
 * The per-mission completion map keyed by `studentId` — the state all three
 * helpers transform (design.md "applyConfirm / applyUndo / applyEdit"). Treated
 * as immutable: helpers return a new map rather than mutating this one.
 */
export type CompletionState = ReadonlyMap<string, Completion>;

/**
 * The reward totals derived from a {@link CompletionState} for a single
 * mission — the values Requirement 15.2 requires confirm-then-undo to restore
 * exactly. Computed only from `approved` rows:
 * - `points`: sum of the approved students' points (Requirement 20.1);
 * - `stamps`: one stamp of the module quality per approved student
 *   (Requirement 9.3);
 * - `townSet`: whether this mission contributes its building to the class town,
 *   i.e. `true` when at least one student is `approved` (Requirement 11.2,
 *   15.2). A single mission adds at most one building, so this is a boolean
 *   rather than a set of ids.
 */
export type DerivedTotals = {
  /** Total points across the mission's currently `approved` students. */
  readonly points: number;
  /** One stamp per `approved` student, each carrying the module quality. */
  readonly stamps: Stamp[];
  /** Whether the mission's town building is present (any student approved). */
  readonly townSet: boolean;
};

/** The subset of students in `state` whose status is `approved`. */
function approvedIds(state: CompletionState): string[] {
  const ids: string[] = [];
  for (const [studentId, completion] of state) {
    if (completion.status === "approved") ids.push(studentId);
  }
  return ids;
}

/**
 * Derives the reward totals for a mission from its completion state
 * (Requirement 15.2). Points, stamps, and the town building all follow from the
 * set of currently `approved` students, so two states with the same approved
 * set always derive identical totals regardless of how they were reached —
 * the equivalence Requirements 15.2–15.3 depend on. Reuses `computePoints` and
 * `computeStamps` so these totals match the ones the RPCs award
 * (design.md "confirm_class_mission").
 */
export function deriveTotals(state: CompletionState, level: Level, quality: Quality): DerivedTotals {
  const approved = approvedIds(state);
  return {
    points: computePoints(approved, level),
    stamps: computeStamps(approved, quality),
    townSet: approved.length > 0,
  };
}

/**
 * Applies the confirm upsert for a mission to a present set of students
 * (Requirements 20.1, 20.8). Treating `presentIds` as an unordered set
 * (duplicates collapsed, order ignored — Requirement 15.1), each present
 * student is upserted:
 * - missing or currently `reversed` → `approved` with freshly computed points
 *   for `level` (Requirement 20.8, re-approving a reversed row);
 * - already `approved` → left exactly as-is, so points and stamps are never
 *   awarded twice (Requirements 20.8, 9.5).
 *
 * Students not in the present set keep their existing records untouched, so
 * confirming only ever adds or re-approves. Because the per-student amount is
 * fixed and `approved` rows are left alone, applying this twice yields the same
 * state as applying it once (Property 10). Returns a new state; the input is
 * not mutated.
 */
export function applyConfirm(state: CompletionState, presentIds: string[], level: Level): CompletionState {
  const present = new Set(presentIds);
  const pointsPerStudent = computePoints(["one"], level);
  const next = new Map(state);
  for (const studentId of present) {
    const existing = next.get(studentId);
    if (existing === undefined || existing.status === "reversed") {
      next.set(studentId, { status: "approved", points: pointsPerStudent });
    }
    // An already-`approved` student is left untouched (idempotent upsert).
  }
  return next;
}

/**
 * Applies an undo for a mission (Requirement 21.8). Every currently `approved`
 * completion becomes `reversed`, which removes the mission's points, stamps,
 * and town building from the derived totals and returns the mission to "not
 * done". Reversed rows retain their recorded points so the history is
 * preserved; they simply stop counting (see {@link deriveTotals}). Students
 * already `reversed` are left as-is. Returns a new state; the input is not
 * mutated.
 *
 * Because undo only flips `approved → reversed` and a later confirm re-approves
 * the same rows, confirm-then-undo restores the exact pre-confirmation derived
 * totals (Requirement 15.2) and undo-then-re-confirm reproduces a fresh
 * confirm (Requirement 15.3).
 */
export function applyUndo(state: CompletionState): CompletionState {
  const next = new Map(state);
  for (const [studentId, completion] of state) {
    if (completion.status === "approved") {
      next.set(studentId, { status: "reversed", points: completion.points });
    }
  }
  return next;
}

/**
 * Applies an edit of who-took-part from the current state to a new present set
 * `B` (Requirements 21.3, 21.4). Two moves in one transaction:
 * - upsert every student in `B` with the same rule as {@link applyConfirm}
 *   (missing or `reversed` → `approved` with fresh points; `approved`
 *   unchanged), so students removed by an earlier edit and re-added are
 *   re-approved;
 * - reverse every student that is currently `approved` but not in `B`, marking
 *   their completion `reversed` (Requirement 21.3).
 *
 * The result depends only on `B` and never on the prior present set `A`: the
 * approved set afterward is exactly `B` (any student in `B` ends `approved`;
 * any approved student not in `B` ends `reversed`). So the derived totals equal
 * those of confirming `B` directly on an empty state (Requirement 15.3).
 * `presentIds` is treated as an unordered set (Requirement 15.1). Returns a new
 * state; the input is not mutated.
 */
export function applyEdit(state: CompletionState, presentIds: string[], level: Level): CompletionState {
  const present = new Set(presentIds);
  // Upsert the students in B (re-approving reversed rows, leaving approved ones).
  const next = new Map(applyConfirm(state, [...present], level));
  // Reverse previously approved students who are no longer in B.
  for (const [studentId, completion] of next) {
    if (completion.status === "approved" && !present.has(studentId)) {
      next.set(studentId, { status: "reversed", points: completion.points });
    }
  }
  return next;
}
