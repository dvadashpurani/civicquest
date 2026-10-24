import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOURS_INCREMENT, MAX_HOURS, computeHours } from "@/lib/domain/hours";

// Property 4: Verified hours are bounded and never exceed elapsed time.
// **Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6**
//
// Requirement 10 defines verified hours as the elapsed check-in-to-check-out
// time floored to the nearest 0.25 h, then capped at 8, with a reversed pair
// (check-out before check-in) yielding 0. The property below asserts, over
// both ordered and reversed timestamp pairs, that the result is always a
// non-negative multiple of 0.25, never exceeds 8, and never exceeds the real
// elapsed hours. The number of fast-check runs is set above the required
// minimum of 100.

const RUNS = 1000;

const MILLIS_PER_HOUR = 60 * 60 * 1000;

// Bound the generated dates to a wide but finite window so elapsed arithmetic
// stays in a sane range while still exercising large gaps well beyond the 8 h
// cap. ~Jan 2000 to ~Jan 2030.
const DATE_MIN = new Date("2000-01-01T00:00:00.000Z");
const DATE_MAX = new Date("2030-01-01T00:00:00.000Z");

/** A valid (non-NaN) Date within the test window. */
const validDate = fc.date({ min: DATE_MIN, max: DATE_MAX, noInvalidDate: true });

/** Real elapsed hours between two dates (may be negative for reversed pairs). */
function elapsedHours(checkIn: Date, checkOut: Date): number {
  return (checkOut.getTime() - checkIn.getTime()) / MILLIS_PER_HOUR;
}

/** Whether a value is an exact multiple of 0.25 (tolerant of float dust). */
function isQuarterMultiple(value: number): boolean {
  const quarters = value / HOURS_INCREMENT;
  return Math.abs(quarters - Math.round(quarters)) < 1e-9;
}

describe("computeHours property: verified hours are bounded and never exceed elapsed time", () => {
  it("for ordered pairs, hours are a bounded 0.25 multiple that never exceeds elapsed time (Requirements 10.2, 10.4, 10.5)", () => {
    fc.assert(
      fc.property(validDate, validDate, (a, b) => {
        // Order the pair so check-out is at or after check-in.
        const [checkIn, checkOut] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
        const hours = computeHours(checkIn, checkOut);
        const elapsed = elapsedHours(checkIn, checkOut);

        // Never negative, never above the cap (Requirement 10.4).
        expect(hours).toBeGreaterThanOrEqual(0);
        expect(hours).toBeLessThanOrEqual(MAX_HOURS);
        // Always a multiple of 0.25 (Requirement 10.4).
        expect(isQuarterMultiple(hours)).toBe(true);
        // Never exceeds the real elapsed time (Requirement 10.5). A tiny
        // epsilon absorbs floating-point error in the elapsed computation.
        expect(hours).toBeLessThanOrEqual(elapsed + 1e-9);
      }),
      { numRuns: RUNS },
    );
  });

  it("for reversed pairs (check-out before check-in), hours are exactly 0 (Requirements 10.3, 10.6)", () => {
    fc.assert(
      fc.property(validDate, validDate, (a, b) => {
        // Order the pair so check-out is strictly before check-in.
        const [checkOut, checkIn] = a.getTime() < b.getTime() ? [a, b] : [b, a];
        fc.pre(checkOut.getTime() < checkIn.getTime());
        expect(computeHours(checkIn, checkOut)).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });

  it("for any pair in any order, hours stay bounded and never exceed elapsed time (Requirements 10.2, 10.3, 10.4, 10.5, 10.6)", () => {
    fc.assert(
      fc.property(validDate, validDate, (checkIn, checkOut) => {
        const hours = computeHours(checkIn, checkOut);
        const elapsed = elapsedHours(checkIn, checkOut);

        // Bounds hold regardless of ordering (Requirement 10.4).
        expect(hours).toBeGreaterThanOrEqual(0);
        expect(hours).toBeLessThanOrEqual(MAX_HOURS);
        expect(isQuarterMultiple(hours)).toBe(true);

        if (elapsed < 0) {
          // Reversed pair → 0 (Requirements 10.3, 10.6).
          expect(hours).toBe(0);
        } else {
          // Ordered pair → never exceeds real elapsed hours (Requirement 10.5).
          expect(hours).toBeLessThanOrEqual(elapsed + 1e-9);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("caps at 8 whenever the elapsed span is at least 8 hours (Requirement 10.2)", () => {
    fc.assert(
      fc.property(
        validDate,
        // At least 8 h of extra span, up to a generous upper bound.
        fc.integer({ min: 8 * 60, max: 400 * 60 }),
        (checkIn, extraMinutes) => {
          const checkOut = new Date(checkIn.getTime() + extraMinutes * 60 * 1000);
          // Stay inside the generated window so the pair remains realistic.
          fc.pre(checkOut.getTime() <= DATE_MAX.getTime());
          expect(computeHours(checkIn, checkOut)).toBe(MAX_HOURS);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("never throws for any pair of dates, including invalid ones (Requirement 10.6)", () => {
    const anyDate = fc.oneof(
      fc.date({ noInvalidDate: true }),
      fc.constant(new Date(Number.NaN)),
    );
    fc.assert(
      fc.property(anyDate, anyDate, (checkIn, checkOut) => {
        expect(() => computeHours(checkIn, checkOut)).not.toThrow();
        const hours = computeHours(checkIn, checkOut);
        expect(hours).toBeGreaterThanOrEqual(0);
        expect(hours).toBeLessThanOrEqual(MAX_HOURS);
      }),
      { numRuns: RUNS },
    );
  });
});
