// Pure level-assignment logic (Requirement 8). Maps an integer grade to its
// level band and never throws: invalid input returns an explicit rejection
// result so callers handle it deterministically (Requirement 8.5). This mirrors
// the `students.level` generated column in supabase/migrations/0001_schema.sql
// (`learners` 2–5, `helpers` 6–8, `leaders` 9–12); the database stays the
// source of truth and `level` is never accepted from the client (design.md
// "Generated level column", Requirement 32.4). No I/O and no `server-only`, so
// the server and the fast-check suite import it directly.

import type { Level, Rejected } from "./types";

/** Inclusive lowest grade CivicQuest serves (glossary "Level"). */
export const MIN_GRADE = 2;
/** Inclusive highest grade CivicQuest serves. */
export const MAX_GRADE = 12;

/**
 * Maps an integer grade to its {@link Level}:
 * - grades 2–5 → `learners` (Requirement 8.2)
 * - grades 6–8 → `helpers` (Requirement 8.3)
 * - grades 9–12 → `leaders` (Requirement 8.4)
 *
 * Any value that is not an integer in the inclusive range 2–12 — a fractional
 * number, a value below 2 or above 12, `NaN`, or `Infinity` — returns
 * `{ rejected: true }` rather than a level, and the function never throws
 * (Requirement 8.5).
 */
export function gradeToLevel(grade: number): Level | Rejected {
  // Number.isInteger is false for NaN, Infinity, and any fractional value, so
  // the range check below only ever sees a finite whole number.
  if (!Number.isInteger(grade) || grade < MIN_GRADE || grade > MAX_GRADE) {
    return { rejected: true };
  }
  if (grade <= 5) return "learners";
  if (grade <= 8) return "helpers";
  return "leaders";
}
