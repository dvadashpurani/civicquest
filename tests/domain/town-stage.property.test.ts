import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PRE_VILLAGE_MAX,
  TOWN_MAX,
  VILLAGE_MAX,
  townStage,
} from "@/lib/domain/town";
import type { Rejected, TownStage } from "@/lib/domain/types";

// Property 6: Town stage is monotonic non-decreasing.
// **Validates: Requirements 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8**
//
// Requirement 12 defines four non-overlapping bands by building count —
// pre-village (0–9), village (10–24), town (25–35), city (36+) — on a 6×6 grid
// until the city stage grows it to 8×8 (Requirements 12.2–12.5). As the count
// rises the stage rank, in the order pre-village < village < town < city, must
// never decrease and the grid must never shrink (Requirements 12.7, 12.8). Any
// count that is not a non-negative integer returns an explicit rejection
// result without throwing (Requirement 12.6). The number of fast-check runs is
// set above the required minimum of 100.

const RUNS = 1000;

/** Ascending rank of each stage, so a higher number is a later stage. */
const STAGE_RANK: Record<TownStage["stage"], number> = {
  "pre-village": 0,
  village: 1,
  town: 2,
  city: 3,
};

/** Largest count worth exercising: comfortably past the city threshold. */
const MAX_COUNT = 500;

function isRejected(value: TownStage | Rejected): value is Rejected {
  return typeof value === "object" && value !== null && "rejected" in value;
}

/** The single band Requirement 12 assigns to a non-negative integer count. */
function expectedStage(count: number): TownStage {
  if (count <= PRE_VILLAGE_MAX) {
    return { stage: "pre-village", gridSize: 6, capacity: 36 };
  }
  if (count <= VILLAGE_MAX) {
    return { stage: "village", gridSize: 6, capacity: 36 };
  }
  if (count <= TOWN_MAX) {
    return { stage: "town", gridSize: 6, capacity: 36 };
  }
  return { stage: "city", gridSize: 8, capacity: 64 };
}

describe("townStage property: town stage is monotonic non-decreasing", () => {
  it("maps every valid count to its single expected stage and grid (Requirements 12.2, 12.3, 12.4, 12.5)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_COUNT }), (count) => {
        const result = townStage(count);
        // A valid count always yields a stage, never a rejection.
        expect(isRejected(result)).toBe(false);
        expect(result).toEqual(expectedStage(count));
      }),
      { numRuns: RUNS },
    );
  });

  it("never lowers stage rank or shrinks the grid from n to n+1 (Requirements 12.7, 12.8)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_COUNT }), (count) => {
        const current = townStage(count);
        const next = townStage(count + 1);
        // Adjacent valid counts are both stages, never rejections.
        if (isRejected(current) || isRejected(next)) {
          throw new Error("valid counts must not reject");
        }
        // Rank never decreases and the grid never shrinks as the count rises.
        expect(STAGE_RANK[next.stage]).toBeGreaterThanOrEqual(
          STAGE_RANK[current.stage],
        );
        expect(next.gridSize).toBeGreaterThanOrEqual(current.gridSize);
        expect(next.capacity).toBeGreaterThanOrEqual(current.capacity);
      }),
      { numRuns: RUNS },
    );
  });

  it("is monotonic across any non-decreasing pair of counts (Requirements 12.7, 12.8)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_COUNT }),
        fc.integer({ min: 0, max: MAX_COUNT }),
        (a, b) => {
          const lower = Math.min(a, b);
          const higher = Math.max(a, b);
          const lowerStage = townStage(lower);
          const higherStage = townStage(higher);
          if (isRejected(lowerStage) || isRejected(higherStage)) {
            throw new Error("valid counts must not reject");
          }
          // A higher-or-equal count never yields a lower-rank stage or a
          // smaller grid than a lower count.
          expect(STAGE_RANK[higherStage.stage]).toBeGreaterThanOrEqual(
            STAGE_RANK[lowerStage.stage],
          );
          expect(higherStage.gridSize).toBeGreaterThanOrEqual(
            lowerStage.gridSize,
          );
          expect(higherStage.capacity).toBeGreaterThanOrEqual(
            lowerStage.capacity,
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("places the 9/10, 24/25, and 35/36 boundaries in the right stages (Requirements 12.2, 12.3, 12.4, 12.5)", () => {
    // Explicit boundary checks reinforce the bands the property asserts.
    expect(townStage(0)).toEqual({ stage: "pre-village", gridSize: 6, capacity: 36 });
    expect(townStage(PRE_VILLAGE_MAX)).toEqual({ stage: "pre-village", gridSize: 6, capacity: 36 });
    expect(townStage(PRE_VILLAGE_MAX + 1)).toEqual({ stage: "village", gridSize: 6, capacity: 36 });
    expect(townStage(VILLAGE_MAX)).toEqual({ stage: "village", gridSize: 6, capacity: 36 });
    expect(townStage(VILLAGE_MAX + 1)).toEqual({ stage: "town", gridSize: 6, capacity: 36 });
    expect(townStage(TOWN_MAX)).toEqual({ stage: "town", gridSize: 6, capacity: 36 });
    expect(townStage(TOWN_MAX + 1)).toEqual({ stage: "city", gridSize: 8, capacity: 64 });
  });

  it("rejects negative integers without returning a stage (Requirement 12.6)", () => {
    fc.assert(
      fc.property(fc.integer({ max: -1 }), (count) => {
        expect(townStage(count)).toEqual({ rejected: true });
      }),
      { numRuns: RUNS },
    );
  });

  it("rejects non-integer finite values (Requirement 12.6)", () => {
    fc.assert(
      fc.property(
        fc
          .double({ noNaN: true, noDefaultInfinity: true })
          .filter((n) => !Number.isInteger(n)),
        (count) => {
          expect(townStage(count)).toEqual({ rejected: true });
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("rejects NaN and Infinity without throwing (Requirement 12.6)", () => {
    for (const count of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() => townStage(count)).not.toThrow();
      expect(townStage(count)).toEqual({ rejected: true });
    }
  });

  it("never throws for any numeric input (Requirement 12.6)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.double(),
          fc.constantFrom(
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
          ),
        ),
        (count) => {
          expect(() => townStage(count)).not.toThrow();
        },
      ),
      { numRuns: RUNS },
    );
  });
});
