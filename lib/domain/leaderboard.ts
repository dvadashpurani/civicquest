// Pure class-leaderboard ranking logic (Requirement 23). This is the single
// source of the leaderboard rule: it turns `class_points` view rows into a
// ranked standing by *points per student* — total approved class points
// divided by the number of enrolled students — descending, with ties sharing a
// rank and ordered by class name. Like the rest of `lib/domain`, it is
// side-effect-free, typed, never throws, and does no I/O: the database
// (`class_points` view, which already runs under the viewer's RLS so only the
// viewer's school is visible — Requirement 23.4) remains the source of truth for
// the rows fed in, and this function only derives the score and ordering
// (design.md "Leaderboard").

/**
 * One row of the `class_points` view (supabase/migrations/0001_schema.sql),
 * the input to {@link rankLeaderboard}. `totalPoints` is the sum of approved
 * `points_awarded` for the class (0 when it has none) and `studentCount` is the
 * number of enrolled students (0 for an empty class).
 */
export type ClassPointsRow = {
  /** Identifier of the class. */
  readonly classId: string;
  /** Display name of the class (the tie-breaker for equal scores). */
  readonly name: string;
  /** Number of students enrolled in the class; 0 for an empty class. */
  readonly studentCount: number;
  /** Sum of approved `points_awarded` for the class; 0 when it has none. */
  readonly totalPoints: number;
};

/**
 * One ranked entry in the class leaderboard, the result of
 * {@link rankLeaderboard}.
 */
export type LeaderboardEntry = {
  /** Identifier of the class. */
  readonly classId: string;
  /** Display name of the class. */
  readonly name: string;
  /** Number of students enrolled in the class. */
  readonly studentCount: number;
  /** Sum of approved points for the class. */
  readonly totalPoints: number;
  /**
   * Points per student: `totalPoints / studentCount`, or 0 when the class has
   * zero enrolled students (Requirement 23.2). This is the ranking score.
   */
  readonly pointsPerStudent: number;
  /**
   * 1-based competition rank. Classes with the same `pointsPerStudent` share
   * the same rank (Requirement 23.3); the next distinct score skips ranks by
   * the number of tied classes (standard "1224" competition ranking).
   */
  readonly rank: number;
};

/**
 * Points per student for a class (Requirement 23.1): total approved points
 * divided by the number of enrolled students. A class with zero enrolled
 * students scores 0 rather than dividing by zero (Requirement 23.2). A
 * non-positive, non-finite, or non-integer student count is treated as "no
 * students" and also scores 0, so the function never yields `NaN` or
 * `Infinity`.
 */
function pointsPerStudentOf(row: ClassPointsRow): number {
  if (!Number.isFinite(row.studentCount) || row.studentCount <= 0) {
    return 0;
  }
  const points = Number.isFinite(row.totalPoints) ? row.totalPoints : 0;
  return points / row.studentCount;
}

/**
 * Ranks classes within a school for the leaderboard (Requirement 23). Given the
 * `class_points` rows the viewer can see (already scoped to their school by RLS
 * — Requirement 23.4), it:
 *
 * - scores each class by points per student (total approved points ÷ enrolled
 *   students; zero students → 0) (Requirements 23.1, 23.2);
 * - sorts by that score descending, breaking ties by class name ascending
 *   (Requirement 23.3);
 * - assigns 1-based competition ranks so that classes with an equal score share
 *   a rank and the following distinct score skips ranks by the size of the tie
 *   (Requirement 23.3).
 *
 * The input is not mutated and the function never throws. An empty input yields
 * an empty leaderboard. This function ranks *classes*, never individual
 * students, so it cannot expose a child's standing (Requirement 23.5); the
 * component layer is responsible for not rendering any per-student ranking.
 */
export function rankLeaderboard(rows: readonly ClassPointsRow[]): LeaderboardEntry[] {
  // Score every class first, then sort a copy so the caller's array is left
  // untouched.
  const scored = rows.map((row) => ({
    classId: row.classId,
    name: row.name,
    studentCount: row.studentCount,
    totalPoints: row.totalPoints,
    pointsPerStudent: pointsPerStudentOf(row),
  }));

  scored.sort((a, b) => {
    // Higher points per student ranks first (Requirement 23.1).
    if (a.pointsPerStudent !== b.pointsPerStudent) {
      return b.pointsPerStudent - a.pointsPerStudent;
    }
    // Equal score: order by class name ascending (Requirement 23.3).
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  // Assign competition ranks: a run of equal scores shares the rank of the
  // first class in the run, and the next distinct score takes the position
  // index + 1, so ranks skip by the size of each tie (Requirement 23.3).
  const entries: LeaderboardEntry[] = [];
  for (let index = 0; index < scored.length; index++) {
    const current = scored[index];
    const previous = index > 0 ? entries[index - 1] : undefined;
    const rank =
      previous !== undefined &&
      previous.pointsPerStudent === current.pointsPerStudent
        ? previous.rank
        : index + 1;
    entries.push({ ...current, rank });
  }
  return entries;
}
