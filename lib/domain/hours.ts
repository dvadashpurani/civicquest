// Pure verified-hours logic (Requirement 10). Computes volunteer hours from a
// check-in time and a check-out time and keeps them valid, bounded, and never
// greater than the real elapsed time. No I/O and no `server-only`, so the
// server action and the fast-check suite import it directly. This mirrors the
// check-out branch of `leader_scan` in the migrations, which computes hours as
// `greatest(0, floor(extract(epoch from (now() - check_in_at)) / 900) * 0.25)`
// clamped at 8 (design.md "Leader scan", Requirement 26.2); the database stays
// the source of truth and `hours` is never accepted from the client
// (Requirement 32.4).

/** Hard cap on verified hours for a single check-in (Requirement 10.2, 10.4). */
export const MAX_HOURS = 8;
/** The increment hours are floored to: a quarter hour (Requirement 10.2). */
export const HOURS_INCREMENT = 0.25;

const MILLIS_PER_HOUR = 60 * 60 * 1000;

/**
 * Computes verified hours between a check-in and a check-out time.
 *
 * - When check-out is at or after check-in, the elapsed time is rounded down to
 *   the nearest 0.25 hour and then capped at 8 (Requirement 10.2).
 * - When check-out is before check-in, the result is 0 (Requirement 10.3).
 *
 * The result is never negative, is always a multiple of 0.25, never exceeds 8,
 * and never exceeds the real elapsed time (Requirements 10.4, 10.5): flooring
 * to a 0.25 increment can only lower the elapsed value, and the cap only lowers
 * it further. If either timestamp is not a valid `Date`, the result is 0.
 */
export function computeHours(checkInAt: Date, checkOutAt: Date): number {
  const checkInMs = checkInAt.getTime();
  const checkOutMs = checkOutAt.getTime();

  // An invalid Date yields NaN; treat either side being unusable as 0 hours so
  // the function never returns NaN and never throws.
  if (Number.isNaN(checkInMs) || Number.isNaN(checkOutMs)) {
    return 0;
  }

  // Check-out before check-in → 0 (Requirement 10.3). This also covers the
  // reversed-pair case the property test exercises (Requirement 10.6).
  if (checkOutMs < checkInMs) {
    return 0;
  }

  const elapsedHours = (checkOutMs - checkInMs) / MILLIS_PER_HOUR;
  // Floor to the nearest 0.25 h, then cap at 8 (Requirement 10.2).
  const flooredHours = Math.floor(elapsedHours / HOURS_INCREMENT) * HOURS_INCREMENT;
  return Math.min(flooredHours, MAX_HOURS);
}
