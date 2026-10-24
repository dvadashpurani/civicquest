// Shared domain types for the pure rule functions in `lib/domain` (Requirements
// 8–15). These are side-effect-free type definitions with no I/O and no
// `server-only`, so both the server actions and the Vitest/fast-check suites
// import them directly. The database remains the source of truth for the
// values these mirror (levels, qualities, town items); these types exist so the
// pure functions and the RPCs agree on the same shapes (design.md "Domain
// Layer").

/**
 * The band a student's grade maps to (Requirement 8). Mirrors the
 * `students.level` generated column and the `missions.level` check constraint
 * in supabase/migrations/0001_schema.sql: `learners` for grades 2–5, `helpers`
 * for 6–8, `leaders` for 9–12. Lowercase to match the database values.
 */
export type Level = "learners" | "helpers" | "leaders";

/**
 * The civic value a module teaches and that its stamp represents (Requirement
 * 9.3, glossary "Quality"). Mirrors the `missions.quality` /`modules.quality`
 * check constraint in supabase/migrations/0001_schema.sql exactly, including
 * capitalization and the two-word "Civic action".
 */
export type Quality =
  | "Safety"
  | "Kindness"
  | "Responsibility"
  | "Respect"
  | "Helping"
  | "Civic action";

/**
 * A quality marker earned by a present student for an approved mission, shown
 * in the stamp passport (glossary "Stamp"). `computeStamps` emits one `Stamp`
 * per distinct present student for a mission (Requirement 9.3).
 */
export type Stamp = {
  /** The student the stamp belongs to. */
  readonly studentId: string;
  /** The module quality the stamp represents. */
  readonly quality: Quality;
};

/**
 * One distinct approved mission contributing a single building to a class town
 * (Requirement 11.2). Mirrors a row of the `class_town` view: the mission's
 * `town_item` and its placement time (`min(confirmed_at)`), used by `placeTown`
 * to order buildings deterministically regardless of input order
 * (Requirements 11.5, 12). `missionId` lets `placeTown` de-duplicate missions.
 */
export type MissionRef = {
  /** Identifier of the distinct approved mission. */
  readonly missionId: string;
  /** The building type placed for the mission (glossary "Town_Item"). */
  readonly townItem: string;
  /**
   * When the building was placed: `min(confirmed_at)` for the mission and
   * class. Buildings order by this time, then by `missionId` to break ties.
   */
  readonly placedAt: Date;
};

/**
 * A placed building in the class town grid (Requirement 11), the result of
 * `placeTown`. Cells are assigned deterministically so the same mission always
 * lands in the same cell regardless of the order completions arrive in
 * (Requirement 11.5).
 */
export type TownCell = {
  /** The mission whose building occupies this cell. */
  readonly missionId: string;
  /** The building type placed in this cell. */
  readonly townItem: string;
  /** Zero-based cell index within the grid, in row-major order. */
  readonly cellIndex: number;
};

/**
 * The growth stage of a class town and the grid it is drawn on (Requirement
 * 12). Stage rank increases pre-village < village < town < city as the building
 * count rises, and the grid expands from 6×6 to 8×8 at the city stage
 * (Requirements 12.2–12.5, 12.7). `gridSize` is the side length (6 or 8);
 * `capacity` is `gridSize * gridSize`, the cap `placeTown` is given.
 */
export type TownStage = {
  /** The named stage, in ascending rank order. */
  readonly stage: "pre-village" | "village" | "town" | "city";
  /** The grid side length: 6 before the city stage, 8 at the city stage. */
  readonly gridSize: 6 | 8;
  /** Total cells in the grid (`gridSize * gridSize`): 36 or 64. */
  readonly capacity: 36 | 64;
};

/**
 * The explicit rejection result returned by pure functions that validate their
 * input instead of throwing, so callers handle invalid input deterministically
 * (Requirements 8.5, 12.6; design.md "Domain Layer"). Functions such as
 * `gradeToLevel` and `townStage` return this rather than raising an error.
 */
export type Rejected = { readonly rejected: true };
