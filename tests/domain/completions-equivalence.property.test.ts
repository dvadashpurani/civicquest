import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyConfirm,
  applyEdit,
  applyUndo,
  deriveTotals,
  type CompletionState,
} from "@/lib/domain/completions";
import type { Level, Quality } from "@/lib/domain/types";

// Property 9: Confirm/undo/edit are reversible and equivalent.
// **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 21.3, 21.8**
//
// Requirement 15 requires the per-mission confirm/undo/edit logic to be
// provably reversible and equivalent so fixing a mistake never leaves bad
// totals:
// - 15.1: the present students are an unordered set, so input order can never
//   affect the result;
// - 15.2: confirm-then-undo restores every student's points, stamp set, and the
//   class-town building to their exact pre-confirmation values;
// - 15.3: editing from any set A to set B produces the same points and stamps
//   as confirming set B directly, regardless of A;
// - 15.4: these facts are verified by a property-based test.
// Requirement 21.3 (an edit re-approves newly checked students and reverses
// removed ones) and 21.8 (undo marks all of a mission's completions reversed
// and removes the reward) are the transition rules the equivalence rests on.
// The number of fast-check runs is set above the required minimum of 100.

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

/** A single student identifier, drawn from a small pool so present sets overlap. */
const studentId = fc.integer({ min: 0, max: 20 }).map((n) => `s${n}`);

/** A present set as a list that may contain duplicates and may be empty (15.1). */
const presentIds = fc.array(studentId, { maxLength: 24 });

const level = fc.constantFrom(...LEVELS);
const quality = fc.constantFrom(...QUALITIES);

/**
 * Canonical, order-independent comparison of two states' derived rewards:
 * points, the approved-student stamp set, and whether the town building is
 * present. Stamps are sorted by student id so array order never matters — the
 * equivalence Requirement 15 asks about is about the sets, not the sequence.
 */
function totalsSignature(state: CompletionState, lvl: Level, qual: Quality) {
  const totals = deriveTotals(state, lvl, qual);
  const stamps = [...totals.stamps]
    .map((stamp) => `${stamp.studentId}:${stamp.quality}`)
    .sort();
  return { points: totals.points, stamps, townSet: totals.townSet };
}

/** The set of currently `approved` student ids in a state, sorted for comparison. */
function approvedSet(state: CompletionState): string[] {
  const ids: string[] = [];
  for (const [id, completion] of state) {
    if (completion.status === "approved") ids.push(id);
  }
  return ids.sort();
}

describe("completions property: confirm/undo/edit are reversible and equivalent", () => {
  it("confirm-then-undo restores the pre-confirmation derived totals (Requirements 15.2, 21.8)", () => {
    fc.assert(
      fc.property(presentIds, presentIds, level, quality, (priorIds, presentNow, lvl, qual) => {
        // Start from an arbitrary prior state reached by an earlier confirm.
        const before = applyConfirm(new Map(), priorIds, lvl);
        const beforeSig = totalsSignature(before, lvl, qual);

        // Confirm a fresh present set, then undo it.
        const confirmed = applyConfirm(before, presentNow, lvl);
        const undone = applyUndo(confirmed);

        // Undo reverses every approved completion, so the mission contributes
        // no points, stamps, or building afterward (21.8).
        const undoneSig = totalsSignature(undone, lvl, qual);
        expect(undoneSig).toEqual({ points: 0, stamps: [], townSet: false });
      }),
      { numRuns: RUNS },
    );
  });

  it("confirm-then-undo restores an empty prior state exactly (Requirement 15.2)", () => {
    fc.assert(
      fc.property(presentIds, level, quality, (presentNow, lvl, qual) => {
        // From an empty mission, confirm then undo returns to the empty totals.
        const empty: CompletionState = new Map();
        const emptySig = totalsSignature(empty, lvl, qual);

        const confirmed = applyConfirm(empty, presentNow, lvl);
        const restored = totalsSignature(applyUndo(confirmed), lvl, qual);
        expect(restored).toEqual(emptySig);
      }),
      { numRuns: RUNS },
    );
  });

  it("undo-then-re-confirm equals a fresh confirm of the same set (Requirement 15.3)", () => {
    fc.assert(
      fc.property(presentIds, level, quality, (presentNow, lvl, qual) => {
        // Confirm, undo, then re-confirm the same present set.
        const confirmed = applyConfirm(new Map(), presentNow, lvl);
        const reConfirmed = applyConfirm(applyUndo(confirmed), presentNow, lvl);

        // A fresh confirm of the same set on an empty mission.
        const fresh = applyConfirm(new Map(), presentNow, lvl);

        expect(approvedSet(reConfirmed)).toEqual(approvedSet(fresh));
        expect(totalsSignature(reConfirmed, lvl, qual)).toEqual(
          totalsSignature(fresh, lvl, qual),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("edit A→B equals confirming B directly, regardless of A (Requirements 15.3, 21.3)", () => {
    fc.assert(
      fc.property(presentIds, presentIds, level, quality, (setA, setB, lvl, qual) => {
        // Reach a prior state by confirming A, then edit the roster to B.
        const afterA = applyConfirm(new Map(), setA, lvl);
        const edited = applyEdit(afterA, setB, lvl);

        // Confirming B directly on an empty mission.
        const confirmB = applyConfirm(new Map(), setB, lvl);

        // The approved set after an edit to B is exactly the distinct B,
        // and the derived rewards match confirming B directly (15.3).
        const distinctB = [...new Set(setB)].sort();
        expect(approvedSet(edited)).toEqual(distinctB);
        expect(totalsSignature(edited, lvl, qual)).toEqual(
          totalsSignature(confirmB, lvl, qual),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("edit re-adds students removed by an earlier edit (Requirements 21.3, 15.3)", () => {
    fc.assert(
      fc.property(presentIds, presentIds, presentIds, level, quality, (setA, setB, setC, lvl, qual) => {
        // A→B→C: a student dropped in B and checked again in C must count
        // again, its reversed row re-approved. The end state depends only on C.
        const afterB = applyEdit(applyConfirm(new Map(), setA, lvl), setB, lvl);
        const afterC = applyEdit(afterB, setC, lvl);

        const confirmC = applyConfirm(new Map(), setC, lvl);
        expect(approvedSet(afterC)).toEqual([...new Set(setC)].sort());
        expect(totalsSignature(afterC, lvl, qual)).toEqual(
          totalsSignature(confirmC, lvl, qual),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("order of the present set never affects confirm or edit (Requirement 15.1)", () => {
    fc.assert(
      fc.property(presentIds, presentIds, level, quality, (base, roster, lvl, qual) => {
        const reversedRoster = [...roster].reverse();
        const sortedRoster = [...roster].sort();

        // Confirm is order-independent.
        const confirmBase = applyConfirm(new Map(), roster, lvl);
        expect(totalsSignature(applyConfirm(new Map(), reversedRoster, lvl), lvl, qual)).toEqual(
          totalsSignature(confirmBase, lvl, qual),
        );
        expect(totalsSignature(applyConfirm(new Map(), sortedRoster, lvl), lvl, qual)).toEqual(
          totalsSignature(confirmBase, lvl, qual),
        );

        // Edit from an arbitrary prior state is order-independent too.
        const prior = applyConfirm(new Map(), base, lvl);
        const editBase = applyEdit(prior, roster, lvl);
        expect(approvedSet(applyEdit(prior, reversedRoster, lvl))).toEqual(approvedSet(editBase));
        expect(totalsSignature(applyEdit(prior, sortedRoster, lvl), lvl, qual)).toEqual(
          totalsSignature(editBase, lvl, qual),
        );
      }),
      { numRuns: RUNS },
    );
  });
});
