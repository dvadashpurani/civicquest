import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_GRADE, MIN_GRADE, gradeToLevel } from "@/lib/domain/levels";
import type { Level, Rejected } from "@/lib/domain/types";

// Property 1: Grade maps to exactly one level.
// **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**
//
// Requirement 8 defines three non-overlapping bands — learners (grades 2–5),
// helpers (6–8), leaders (9–12) — and requires that any value which is not an
// integer in the inclusive range 2–12 returns an explicit rejection result
// rather than a level, and that `gradeToLevel` never throws (Requirement 8.5).
// The number of fast-check runs is set above the required minimum of 100.

const RUNS = 1000;

const LEVELS: readonly Level[] = ["learners", "helpers", "leaders"];

/** The one band an integer grade 2–12 must fall in, per Requirements 8.2–8.4. */
function expectedLevel(grade: number): Level {
  if (grade <= 5) return "learners";
  if (grade <= 8) return "helpers";
  return "leaders";
}

function isRejected(value: Level | Rejected): value is Rejected {
  return typeof value === "object" && value !== null && "rejected" in value;
}

describe("gradeToLevel property: grade maps to exactly one level", () => {
  it("maps every valid integer grade to exactly one level (Requirements 8.2, 8.3, 8.4, 8.6)", () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_GRADE, max: MAX_GRADE }), (grade) => {
        const result = gradeToLevel(grade);
        // Exactly one level: a string that is one of the three bands, never a rejection.
        expect(isRejected(result)).toBe(false);
        expect(LEVELS).toContain(result);
        // It is the single band Requirement 8 assigns to that grade.
        expect(result).toBe(expectedLevel(grade));
        // Membership in exactly one band: it matches its own band and no other.
        const matches = LEVELS.filter((level) => level === result);
        expect(matches).toHaveLength(1);
      }),
      { numRuns: RUNS },
    );
  });

  it("places the 5/6 and 8/9 boundaries in non-overlapping bands (Requirement 8.6)", () => {
    // Explicit boundary checks reinforce the non-overlap the property asserts.
    expect(gradeToLevel(5)).toBe("learners");
    expect(gradeToLevel(6)).toBe("helpers");
    expect(gradeToLevel(8)).toBe("helpers");
    expect(gradeToLevel(9)).toBe("leaders");
  });

  it("rejects integers outside 2–12 without returning a level (Requirements 8.5)", () => {
    fc.assert(
      fc.property(
        fc.integer().filter((n) => n < MIN_GRADE || n > MAX_GRADE),
        (grade) => {
          const result = gradeToLevel(grade);
          expect(result).toEqual({ rejected: true });
          expect(LEVELS).not.toContain(result);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("rejects non-integer finite values (Requirements 8.5)", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
        (grade) => {
          expect(gradeToLevel(grade)).toEqual({ rejected: true });
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("rejects NaN and Infinity without throwing (Requirements 8.5)", () => {
    for (const grade of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => gradeToLevel(grade)).not.toThrow();
      expect(gradeToLevel(grade)).toEqual({ rejected: true });
    }
  });

  it("never throws for any numeric input (Requirement 8.5)", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.double(),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        (grade) => {
          expect(() => gradeToLevel(grade)).not.toThrow();
        },
      ),
      { numRuns: RUNS },
    );
  });
});
