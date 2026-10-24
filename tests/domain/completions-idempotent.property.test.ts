import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyConfirm,
  deriveTotals,
  type Completion,
  type CompletionState,
} from "@/lib/domain/completions";
import type { Level, Quality } from "@/lib/domain/types";

// Property 10: Confirm upsert is idempotent.
// **Validates: Requirements 20.8, 9.5, 15.1**
//
// Requirement 20.8: once a mission is already confirmed, confirming again must
// not create duplicate completions or award points or stamps a second time.
// Requirement 9.5: each distinct present student is counted exactly once, so a
// duplicated id never doubles a reward. Requirement 15.1: the present set is
// unordered, so input order can never change the result.
//
// The property: for any starting completion state and any present set S,
// `applyConfirm(S)` applied twice yields the same state — and therefore the
// same derived points/stamps/town — as applying it once. Students already
// `approved` are left untouched; only missing or `reversed` entries become
// `approved`; and no student is ever awarded twice. The number of fast-check
// runs is set above the required minimum of 100.

const RUNS = 1000;

const LEVELS: readonly Level[] = ["learners", "helpers", "leaders"];
const QUALITIES: readonly Quality[] = [
  "Safety",
  "Kindness",
  "Responsibility",
  "Respect",
  "Helping",
  "Civic action",
];

/** A single student identifier, short enough to force frequent collisions. */
const studentId = fc.string({ minLength: 1, maxLength: 8 });

/** A present set that may contain duplicates and may be empty (Requirement 15.1, 9.5). */
const presentIds = fc.array(studentId, { maxLength: 30 });

const level = fc.constantFrom(...LEVELS);
const quality = fc.constantFrom(...QUALITIES);

/**
 * Generates an arbitrary prior completion state: a map of student ids to
 * `approved`/`reversed` records with arbitrary recorded points. This stands in
 * for a mission that has already been confirmed, edited, or undone, so the
 * idempotence property is exercised against every starting shape rather than
 * only an empty state.
 */
const completionState: fc.Arbitrary<CompletionState> = fc
  .array(
    fc.tuple(
      studentId,
      fc.record<Completion>({
        status: fc.constantFrom("approved", "reversed"),
        points: fc.integer({ min: 0, max: 100 }),
      }),
    ),
    { maxLength: 20 },
  )
  .map((entries) => new Map(entries));

/** Turns a completion state into a comparable plain object, sorted by id. */
function snapshot(state: CompletionState): Array<[string, Completion]> {
  return [...state.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("applyConfirm property: confirm upsert is idempotent", () => {
  it("applying confirm twice equals applying it once (Requirement 20.8)", () => {
    fc.assert(
      fc.property(completionState, presentIds, level, (state, ids, lvl) => {
        const once = applyConfirm(state, ids, lvl);
        const twice = applyConfirm(once, ids, lvl);
        // The second confirm is a no-op: the state map is unchanged.
        expect(snapshot(twice)).toEqual(snapshot(once));
      }),
      { numRuns: RUNS },
    );
  });

  it("derived points, stamps, and town are identical after one or two confirms (Requirements 20.8, 9.5)", () => {
    fc.assert(
      fc.property(
        completionState,
        presentIds,
        level,
        quality,
        (state, ids, lvl, qual) => {
          const once = applyConfirm(state, ids, lvl);
          const twice = applyConfirm(once, ids, lvl);
          const totalsOnce = deriveTotals(once, lvl, qual);
          const totalsTwice = deriveTotals(twice, lvl, qual);
          expect(totalsTwice.points).toBe(totalsOnce.points);
          expect(totalsTwice.townSet).toBe(totalsOnce.townSet);
          // One stamp per approved student, never two for the same student.
          const stampIdsOnce = totalsOnce.stamps.map((s) => s.studentId).sort();
          const stampIdsTwice = totalsTwice.stamps.map((s) => s.studentId).sort();
          expect(stampIdsTwice).toEqual(stampIdsOnce);
          // No student appears in the stamp set more than once.
          expect(new Set(stampIdsTwice).size).toBe(stampIdsTwice.length);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("leaves already-approved students completely untouched (Requirement 20.8)", () => {
    fc.assert(
      fc.property(completionState, presentIds, level, (state, ids, lvl) => {
        const next = applyConfirm(state, ids, lvl);
        for (const [id, before] of state) {
          if (before.status === "approved") {
            // An approved row keeps its exact status and recorded points: no
            // re-award, no duplicate completion (Requirement 20.8).
            expect(next.get(id)).toEqual(before);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("only promotes missing or reversed present students to approved (Requirement 20.8)", () => {
    fc.assert(
      fc.property(completionState, presentIds, level, (state, ids, lvl) => {
        const present = new Set(ids);
        const next = applyConfirm(state, ids, lvl);
        for (const [id, after] of next) {
          const before = state.get(id);
          if (before === undefined) {
            // A newly added id can only exist because it was present and is now approved.
            expect(present.has(id)).toBe(true);
            expect(after.status).toBe("approved");
          } else if (before.status === "approved") {
            expect(after).toEqual(before);
          } else if (present.has(id)) {
            // A present reversed student is re-approved (Requirement 20.8).
            expect(after.status).toBe("approved");
          } else {
            // An absent reversed student is left as it was.
            expect(after).toEqual(before);
          }
        }
        // Confirm never removes an existing entry.
        for (const id of state.keys()) {
          expect(next.has(id)).toBe(true);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("is independent of the order present ids are supplied in (Requirement 15.1)", () => {
    fc.assert(
      fc.property(completionState, presentIds, level, (state, ids, lvl) => {
        const forward = applyConfirm(state, ids, lvl);
        const reversed = applyConfirm(state, [...ids].reverse(), lvl);
        expect(snapshot(reversed)).toEqual(snapshot(forward));
      }),
      { numRuns: RUNS },
    );
  });

  it("treats duplicated present ids the same as distinct ones (Requirements 9.5, 20.8)", () => {
    fc.assert(
      fc.property(completionState, presentIds, level, (state, ids, lvl) => {
        const single = applyConfirm(state, ids, lvl);
        const duplicated = applyConfirm(state, [...ids, ...ids], lvl);
        // A student listed twice is still confirmed once, with no double award.
        expect(snapshot(duplicated)).toEqual(snapshot(single));
      }),
      { numRuns: RUNS },
    );
  });

  it("never mutates the input state (Requirement 20.8)", () => {
    fc.assert(
      fc.property(completionState, presentIds, level, (state, ids, lvl) => {
        const before = snapshot(state);
        applyConfirm(state, ids, lvl);
        expect(snapshot(state)).toEqual(before);
      }),
      { numRuns: RUNS },
    );
  });
});
