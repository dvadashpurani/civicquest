import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeStamps } from "@/lib/domain/points";
import type { Quality, Stamp } from "@/lib/domain/types";

// Property 3: Stamps awarded only to present students, once each.
// **Validates: Requirements 9.3, 9.4, 9.5, 9.6, 9.7**
//
// For any set of present student identifiers and a module quality,
// `computeStamps` yields exactly one stamp of that quality per distinct present
// student and nothing for absent students, counting duplicates once and
// yielding none for the empty set. The number of fast-check runs is set above
// the required minimum of 100.

const RUNS = 1000;

/** The exact `Quality` values the module stamp may carry (Requirement 9.3). */
const QUALITIES: readonly Quality[] = [
  "Safety",
  "Kindness",
  "Responsibility",
  "Respect",
  "Helping",
  "Civic action",
];

const qualityArb = fc.constantFrom(...QUALITIES);

/** Arbitrary list of present ids, allowing duplicates and the empty case. */
const presentIdsArb = fc.array(fc.string());

/** The distinct students `computeStamps` must reward, counting duplicates once. */
function distinctIds(presentIds: string[]): Set<string> {
  return new Set(presentIds);
}

function stampStudentIds(stamps: readonly Stamp[]): Set<string> {
  return new Set(stamps.map((stamp) => stamp.studentId));
}

describe("computeStamps property: stamps awarded only to present students, once each", () => {
  it("yields exactly one stamp of the given quality per distinct present student (Requirements 9.3, 9.5)", () => {
    fc.assert(
      fc.property(presentIdsArb, qualityArb, (presentIds, quality) => {
        const stamps = computeStamps(presentIds, quality);
        const distinct = distinctIds(presentIds);

        // One stamp per distinct present student: duplicates collapse to one.
        expect(stamps).toHaveLength(distinct.size);
        // No student appears more than once in the result.
        expect(stampStudentIds(stamps).size).toBe(stamps.length);
        // Every stamp carries the module quality that was passed in.
        for (const stamp of stamps) {
          expect(stamp.quality).toBe(quality);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("awards a stamp to every present student and to no absent student (Requirement 9.4)", () => {
    fc.assert(
      fc.property(presentIdsArb, qualityArb, fc.array(fc.string()), (presentIds, quality, others) => {
        const stamps = computeStamps(presentIds, quality);
        const present = distinctIds(presentIds);
        const stamped = stampStudentIds(stamps);

        // Exactly the present set is stamped — no more, no less.
        expect(stamped).toEqual(present);
        // Every present student is stamped.
        for (const id of present) {
          expect(stamped.has(id)).toBe(true);
        }
        // Any identifier outside the present set is never stamped.
        for (const id of others) {
          if (!present.has(id)) {
            expect(stamped.has(id)).toBe(false);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("is independent of the order the present ids arrive in (Requirement 9.7)", () => {
    fc.assert(
      fc.property(presentIdsArb, qualityArb, (presentIds, quality) => {
        const shuffled = [...presentIds].reverse();
        const original = computeStamps(presentIds, quality);
        const reordered = computeStamps(shuffled, quality);

        // Order never changes which students are stamped or how many stamps.
        expect(original).toHaveLength(reordered.length);
        expect(stampStudentIds(original)).toEqual(stampStudentIds(reordered));
      }),
      { numRuns: RUNS },
    );
  });

  it("yields no stamps for the empty present set (Requirement 9.6)", () => {
    for (const quality of QUALITIES) {
      expect(computeStamps([], quality)).toEqual([]);
    }
  });

  it("collapses repeated identifiers to a single stamp (Requirement 9.5)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 20 }), qualityArb, (id, times, quality) => {
        const stamps = computeStamps(Array.from({ length: times }, () => id), quality);
        expect(stamps).toEqual([{ studentId: id, quality }]);
      }),
      { numRuns: RUNS },
    );
  });
});
