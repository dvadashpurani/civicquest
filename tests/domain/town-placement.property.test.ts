import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { placeTown } from "@/lib/domain/town";
import type { MissionRef, TownCell } from "@/lib/domain/types";

// Property 5: Town placement is capacity-bounded, duplicate-free, and order-independent.
// **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6**
//
// Requirement 11 defines pure town placement: one building per distinct
// approved mission (11.2), never more buildings than the grid capacity (11.3),
// never more than one building for the same mission even when it appears more
// than once in the input (11.4), and the same building assigned to the same
// cell regardless of the order completions arrive in (11.5). Requirement 11.6
// requires this to be verified with a property test over input permutations and
// duplicate inputs. The number of fast-check runs is set above the required
// minimum of 100.

const RUNS = 500;

/**
 * Generates one distinct mission. `placedAt` is drawn from a small range of
 * timestamps so ties on placement time occur often, exercising the `missionId`
 * tie-breaker in `placeTown`.
 */
const distinctMissionArb: fc.Arbitrary<MissionRef> = fc.record({
  missionId: fc.integer({ min: 0, max: 11 }).map((n) => `m${n}`),
  townItem: fc.constantFrom("house", "school", "park", "library", "clinic"),
  // A narrow range of epoch seconds keeps placement-time ties common.
  placedAt: fc.integer({ min: 0, max: 20 }).map((n) => new Date(n * 1000)),
});

/**
 * An arbitrary list of MissionRefs built from a pool of *distinct* missions:
 * each `missionId` carries exactly one `townItem` and `placedAt`, mirroring the
 * `class_town` view where a mission's building type and placement time are
 * functionally determined by its id. The input list may repeat pool entries so
 * duplicates appear, but a duplicate always carries identical fields — the only
 * kind of duplicate that can occur in real data.
 */
const missionsArb: fc.Arbitrary<MissionRef[]> = fc
  .uniqueArray(distinctMissionArb, {
    minLength: 1,
    maxLength: 12,
    selector: (m) => m.missionId,
  })
  .chain((pool) =>
    fc.array(fc.constantFrom(...pool), { maxLength: 40 }),
  );

/** Grid capacities to test: the real stage capacities plus small/zero edges. */
const capacityArb: fc.Arbitrary<number> = fc.constantFrom(0, 1, 5, 36, 64);

/** Compares two cell lists for exact equality (missionId, townItem, cellIndex). */
function cellsEqual(a: readonly TownCell[], b: readonly TownCell[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cell, i) => {
    const other = b[i];
    return (
      cell.missionId === other.missionId &&
      cell.townItem === other.townItem &&
      cell.cellIndex === other.cellIndex
    );
  });
}

describe("placeTown property: capacity-bounded, duplicate-free, order-independent", () => {
  it("never places more buildings than the grid capacity (Requirement 11.3)", () => {
    fc.assert(
      fc.property(missionsArb, capacityArb, (missions, capacity) => {
        const cells = placeTown(missions, capacity);
        expect(cells.length).toBeLessThanOrEqual(Math.max(0, capacity));
      }),
      { numRuns: RUNS },
    );
  });

  it("places exactly one building per distinct mission, up to capacity (Requirements 11.2, 11.4)", () => {
    fc.assert(
      fc.property(missionsArb, capacityArb, (missions, capacity) => {
        const cells = placeTown(missions, capacity);
        const distinctInput = new Set(missions.map((m) => m.missionId));
        const expectedCount = Math.min(distinctInput.size, Math.max(0, capacity));
        expect(cells.length).toBe(expectedCount);
      }),
      { numRuns: RUNS },
    );
  });

  it("never places duplicate missions (Requirement 11.4)", () => {
    fc.assert(
      fc.property(missionsArb, capacityArb, (missions, capacity) => {
        const cells = placeTown(missions, capacity);
        const placedIds = cells.map((c) => c.missionId);
        const uniqueIds = new Set(placedIds);
        expect(uniqueIds.size).toBe(placedIds.length);
      }),
      { numRuns: RUNS },
    );
  });

  it("assigns contiguous 0..n-1 row-major cell indices (Requirement 11.3)", () => {
    fc.assert(
      fc.property(missionsArb, capacityArb, (missions, capacity) => {
        const cells = placeTown(missions, capacity);
        const indices = cells.map((c) => c.cellIndex);
        const expected = Array.from({ length: cells.length }, (_, i) => i);
        expect(indices).toEqual(expected);
      }),
      { numRuns: RUNS },
    );
  });

  it("yields identical cell assignments for any permutation of the input (Requirement 11.5)", () => {
    fc.assert(
      fc.property(
        missionsArb.chain((missions) =>
          fc.record({
            missions: fc.constant(missions),
            // A full-length permutation of the same elements.
            permuted: fc.shuffledSubarray(missions, { minLength: missions.length }),
          }),
        ),
        capacityArb,
        ({ missions, permuted }, capacity) => {
          const baseline = placeTown(missions, capacity);
          const result = placeTown(permuted, capacity);
          expect(cellsEqual(result, baseline)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("collapses duplicate missions to one building regardless of order (Requirements 11.4, 11.5)", () => {
    fc.assert(
      fc.property(
        missionsArb.chain((missions) => {
          // Duplicate every mission, then permute: duplicates must collapse to
          // one building each and match placing the originals.
          const duplicated = [...missions, ...missions];
          return fc.record({
            missions: fc.constant(missions),
            shuffledDuplicated: fc.shuffledSubarray(duplicated, {
              minLength: duplicated.length,
            }),
          });
        }),
        capacityArb,
        ({ missions, shuffledDuplicated }, capacity) => {
          const baseline = placeTown(missions, capacity);
          const withDuplicates = placeTown(shuffledDuplicated, capacity);
          expect(cellsEqual(withDuplicates, baseline)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("never throws for any permutation or duplicate input (Requirement 11.6)", () => {
    fc.assert(
      fc.property(missionsArb, capacityArb, (missions, capacity) => {
        const duplicated = [...missions, ...missions];
        expect(() => placeTown(duplicated, capacity)).not.toThrow();
      }),
      { numRuns: RUNS },
    );
  });
});
