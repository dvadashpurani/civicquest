// Pure points-and-stamps logic (Requirement 9). Given the set of students
// present for an approved mission, these functions compute the points awarded
// and the stamps earned. Both treat the present ids as an unordered set: the
// caller may pass the same id more than once (for example when the same tap is
// recorded twice), and each distinct student is rewarded exactly once
// (Requirements 9.1, 9.5; design.md "Domain Layer"). No I/O and no
// `server-only`, so the RPCs, the server actions, and the fast-check suite all
// import these directly; the database RPCs mirror the same amounts so totals
// agree (design.md "confirm_class_mission").

import type { Level, Quality, Stamp } from "./types";

/** Points awarded per present student for a learners or helpers mission. */
export const LEARNER_HELPER_POINTS = 10;
/** Points awarded per present student for a leaders mission. */
export const LEADER_POINTS = 15;

/**
 * Points awarded per present student for a mission at the given level: 15 for
 * `leaders`, 10 for `learners` and `helpers` (Requirement 9.2).
 */
function pointsPerStudent(level: Level): number {
  return level === "leaders" ? LEADER_POINTS : LEARNER_HELPER_POINTS;
}

/**
 * Total points for an approved mission: the per-student amount for `level`
 * (10 for `learners`/`helpers`, 15 for `leaders`) times the count of
 * **distinct** present students (Requirements 9.2, 9.5).
 *
 * `presentIds` is treated as an unordered set, so duplicate identifiers are
 * counted once (Requirement 9.5) and order never affects the result
 * (Requirement 15.1). An empty set yields 0 (Requirement 9.6). Points go only
 * to students in the set and to no one else (Requirement 9.4).
 */
export function computePoints(presentIds: string[], level: Level): number {
  const distinct = new Set(presentIds).size;
  return distinct * pointsPerStudent(level);
}

/**
 * Stamps for an approved mission: exactly one {@link Stamp} of the module
 * `quality` per distinct present student (Requirement 9.3), and none for any
 * absent student (Requirement 9.4).
 *
 * `presentIds` is treated as an unordered set, so duplicate identifiers yield a
 * single stamp for that student (Requirement 9.5) and an empty set yields no
 * stamps (Requirement 9.6). The returned array has one entry per distinct id.
 */
export function computeStamps(presentIds: string[], quality: Quality): Stamp[] {
  const distinct = new Set(presentIds);
  return Array.from(distinct, (studentId) => ({ studentId, quality }));
}
