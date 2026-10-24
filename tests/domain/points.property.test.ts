import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LEADER_POINTS,
  LEARNER_HELPER_POINTS,
  computePoints,
} from "@/lib/domain/points";
import type { Level } from "@/lib/domain/types";

// Property 2: Points awarded only to present students, once each.
// **Validates: Requirements 9.2, 9.4, 9.5, 9.6, 9.7**
//
// Requirement 9 awards 10 points per present student for learners/helpers
// missions and 15 for leaders (9.2), counts each distinct present student
// exactly once even when ids are duplicated (9.5), gives nothing to absent
// students (9.4), and yields 0 for an empty present set (9.6). Requirement 9.7
// asks that a property test confirm total points equal the per-student amount
// times the count of distinct present students. The number of fast-check runs
// is set above the required minimum of 100.

const RUNS = 1000;

const LEVELS: readonly Level[] = ["learners", "helpers", "leaders"];

/** The per-student amount Requirement 9.2 assigns to a mission level. */
function expectedRate(level: Level): number {
  return level === "leaders" ? LEADER_POINTS : LEARNER_HELPER_POINTS;
}

/** A single student identifier: distinct enough to exercise de-duplication. */
const studentId = fc.string({ minLength: 1, maxLength: 12 });

/** A list of present ids that may contain duplicates and may be empty. */
const presentIds = fc.array(studentId, { maxLength: 40 });

/** A list of present ids guaranteed non-empty. */
const nonEmptyPresentIds = fc.array(studentId, { minLength: 1, maxLength: 40 });

const level = fc.constantFrom(...LEVELS);

describe("computePoints property: points awarded only to present students, once each", () => {
  it("equals the per-level rate times the distinct present count (Requirements 9.2, 9.7)", () => {
    fc.assert(
      fc.property(presentIds, level, (ids, lvl) => {
        const distinctCount = new Set(ids).size;
        expect(computePoints(ids, lvl)).toBe(distinctCount * expectedRate(lvl));
      }),
      { numRuns: RUNS },
    );
  });

  it("uses 10 per student for learners and helpers, 15 for leaders (Requirement 9.2)", () => {
    fc.assert(
      fc.property(nonEmptyPresentIds, level, (ids, lvl) => {
        const distinctCount = new Set(ids).size;
        const total = computePoints(ids, lvl);
        // Total divided by the distinct count recovers the per-student rate.
        expect(total / distinctCount).toBe(lvl === "leaders" ? 15 : 10);
      }),
      { numRuns: RUNS },
    );
  });

  it("counts duplicate identifiers exactly once (Requirement 9.5)", () => {
    fc.assert(
      fc.property(nonEmptyPresentIds, level, (ids, lvl) => {
        // Duplicating every id must not change the result: each student is
        // counted once regardless of how many times they appear.
        const duplicated = [...ids, ...ids];
        expect(computePoints(duplicated, lvl)).toBe(computePoints(ids, lvl));
      }),
      { numRuns: RUNS },
    );
  });

  it("is independent of the order ids are presented in (Requirements 9.4, 9.5)", () => {
    fc.assert(
      fc.property(presentIds, level, (ids, lvl) => {
        const reversed = [...ids].reverse();
        const sorted = [...ids].sort();
        const base = computePoints(ids, lvl);
        expect(computePoints(reversed, lvl)).toBe(base);
        expect(computePoints(sorted, lvl)).toBe(base);
      }),
      { numRuns: RUNS },
    );
  });

  it("awards 0 points for an empty present set (Requirement 9.6)", () => {
    fc.assert(
      fc.property(level, (lvl) => {
        expect(computePoints([], lvl)).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });

  it("gives nothing for absent students: adding an absent id adds exactly its rate (Requirement 9.4)", () => {
    fc.assert(
      fc.property(presentIds, studentId, level, (ids, extra, lvl) => {
        // `extra` stands in for a student who is absent from `ids`. Only once
        // they are added to the present set do they contribute, and then by
        // exactly the per-student rate — never more, never for being "known".
        fc.pre(!ids.includes(extra));
        const before = computePoints(ids, lvl);
        const after = computePoints([...ids, extra], lvl);
        expect(after).toBe(before + expectedRate(lvl));
      }),
      { numRuns: RUNS },
    );
  });

  it("scales linearly with the distinct present count (Requirements 9.2, 9.7)", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(studentId, { maxLength: 40 }),
        level,
        (distinctIds, lvl) => {
          // With already-distinct ids the total is exactly count * rate.
          expect(computePoints(distinctIds, lvl)).toBe(
            distinctIds.length * expectedRate(lvl),
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});
