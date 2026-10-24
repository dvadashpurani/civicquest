// Pure town placement and stage logic (Requirements 11, 12). These functions
// are the single source of the class-town rules: `townStage` maps a building
// count to its growth stage and grid, and `placeTown` assigns each distinct
// approved mission to a cell. Both are side-effect-free and never throw, so the
// server actions and the Vitest/fast-check suites import them directly. The
// database (`class_town` view) remains the source of truth for the rows fed in;
// these functions only order and bound them (design.md "Domain Layer").

import type { MissionRef, Rejected, TownCell, TownStage } from "./types";

/**
 * Highest building count still drawn on the pre-village stage (Requirement
 * 12.2): counts 0–9 inclusive.
 */
export const PRE_VILLAGE_MAX = 9;
/**
 * Highest building count still drawn on the village stage (Requirement 12.3):
 * counts 10–24 inclusive.
 */
export const VILLAGE_MAX = 24;
/**
 * Highest building count still drawn on the town stage (Requirement 12.4):
 * counts 25–35 inclusive. At 36 the stage becomes city and the grid grows to
 * 8×8 (Requirement 12.5).
 */
export const TOWN_MAX = 35;

/** Side length of the grid before the city stage (Requirement 12.2–12.4). */
const SMALL_GRID = 6;
/** Side length of the grid at the city stage (Requirement 12.5). */
const LARGE_GRID = 8;

/**
 * Computes the town stage and the grid it is drawn on from a building count
 * (Requirement 12.1):
 * - 0–9   → `pre-village` on a 6×6 grid (capacity 36) (Requirement 12.2)
 * - 10–24 → `village` on a 6×6 grid (capacity 36) (Requirement 12.3)
 * - 25–35 → `town` on a 6×6 grid (capacity 36) (Requirement 12.4)
 * - 36+   → `city` on an 8×8 grid (capacity 64) (Requirement 12.5)
 *
 * Because the thresholds only rise with the count and the stage rank order is
 * pre-village < village < town < city, a non-decreasing count can never yield a
 * lower-rank stage (Requirement 12.7).
 *
 * Any count that is not a non-negative integer — a negative number, a
 * fractional value, `NaN`, or `Infinity` — returns `{ rejected: true }` rather
 * than a stage, and the function never throws (Requirement 12.6).
 */
export function townStage(buildingCount: number): TownStage | Rejected {
  // Number.isInteger is false for NaN, Infinity, and any fractional value, so
  // the comparisons below only ever see a finite whole number.
  if (!Number.isInteger(buildingCount) || buildingCount < 0) {
    return { rejected: true };
  }
  if (buildingCount <= PRE_VILLAGE_MAX) {
    return { stage: "pre-village", gridSize: SMALL_GRID, capacity: 36 };
  }
  if (buildingCount <= VILLAGE_MAX) {
    return { stage: "village", gridSize: SMALL_GRID, capacity: 36 };
  }
  if (buildingCount <= TOWN_MAX) {
    return { stage: "town", gridSize: SMALL_GRID, capacity: 36 };
  }
  return { stage: "city", gridSize: LARGE_GRID, capacity: 64 };
}

/**
 * Places one building per distinct approved mission into the class-town grid
 * (Requirements 11.1, 11.2). Given the mission rows (from the `class_town`
 * view) and the grid capacity from {@link townStage}, it:
 *
 * - de-duplicates by `missionId`, keeping the earliest-placed occurrence, so a
 *   mission that appears more than once still yields a single building
 *   (Requirement 11.4);
 * - orders the distinct missions deterministically by placement time
 *   (`placedAt`), breaking ties by `missionId`, so the same mission always
 *   lands in the same cell regardless of the order completions arrive in
 *   (Requirement 11.5);
 * - fills cells in row-major order starting at index 0, stopping at the grid
 *   capacity so placement never exceeds it (Requirement 11.3).
 *
 * The input is not mutated and the function never throws. A capacity of 0 or
 * less (or a non-positive / non-integer capacity) yields an empty grid.
 */
export function placeTown(
  missions: MissionRef[],
  gridCapacity: number,
): TownCell[] {
  // De-duplicate by missionId, keeping the earliest-placed occurrence so the
  // retained ordering key is stable no matter which duplicate arrived first
  // (Requirement 11.4). Ties in placedAt are resolved later by missionId.
  const distinct = new Map<string, MissionRef>();
  for (const mission of missions) {
    const existing = distinct.get(mission.missionId);
    if (
      existing === undefined ||
      mission.placedAt.getTime() < existing.placedAt.getTime()
    ) {
      distinct.set(mission.missionId, mission);
    }
  }

  // Order deterministically: placement time first, then missionId as a stable
  // tie-breaker, so the cell assignment is identical for any input order
  // (Requirement 11.5).
  const ordered = [...distinct.values()].sort((a, b) => {
    const byTime = a.placedAt.getTime() - b.placedAt.getTime();
    if (byTime !== 0) return byTime;
    return a.missionId < b.missionId ? -1 : a.missionId > b.missionId ? 1 : 0;
  });

  // Fill cells up to the capacity in row-major order; never exceed it
  // (Requirement 11.3). A non-positive or non-integer capacity caps at 0.
  const limit =
    Number.isFinite(gridCapacity) && gridCapacity > 0
      ? Math.min(ordered.length, Math.floor(gridCapacity))
      : 0;

  const cells: TownCell[] = [];
  for (let cellIndex = 0; cellIndex < limit; cellIndex++) {
    const mission = ordered[cellIndex];
    cells.push({
      missionId: mission.missionId,
      townItem: mission.townItem,
      cellIndex,
    });
  }
  return cells;
}
