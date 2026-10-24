import "server-only";

// Login attempt counters in `public.rate_limits` (Requirements 35.1, 35.2).
//
// Why the admin client: a sign-in has no `auth.uid()` yet, so the
// `private.consume_rate_limit` helper (keyed on the caller's uid) cannot be
// used, and `anon`/`authenticated` have no privileges on `rate_limits` (0002).
// `service_role` keeps its privileges (verified on the dev project), so this
// module is the one narrow, server-only use of the service role outside the
// seed and demo reset: it touches only `rate_limits`, and only rows whose key
// it derives itself from hashed input (see `login-rate-limit.ts`).
//
// Atomicity without a migration: the first attempt in a window is an
// `INSERT ... ON CONFLICT DO NOTHING`; later attempts are compare-and-swap
// updates (`count = n + 1 WHERE count = n`), retried a few times. Concurrent
// attempts can never be undercounted, and heavy contention on one key fails
// closed (treated as limited).

import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  LOGIN_LIMITS,
  emailRateLimitKey,
  ipRateLimitKey,
  isWithinLimit,
  windowStart,
  type LoginLimit,
} from "./login-rate-limit";

const MAX_CAS_ATTEMPTS = 4;

class RateLimitStoreError extends Error {
  constructor(step: string, code: string | undefined) {
    // Only the step and the Postgres/PostgREST code; never the key or input.
    super(`rate_limits ${step} failed${code ? ` (${code})` : ""}`);
    this.name = "RateLimitStoreError";
  }
}

/**
 * Counts one attempt against `key` for the current window and returns
 * whether it is within the limit. Once a key is over its limit the counter
 * stops growing, so a flood cannot overflow it.
 */
async function consumeAttempt(key: string, { limit, windowMs }: LoginLimit, nowMs: number) {
  const admin = createAdminSupabase();
  const start = windowStart(nowMs, windowMs);

  const inserted = await admin
    .from("rate_limits")
    .upsert(
      { key, window_start: start, count: 1 },
      { onConflict: "key,window_start", ignoreDuplicates: true },
    )
    .select("count");
  if (inserted.error) throw new RateLimitStoreError("insert", inserted.error.code);

  if (inserted.data.length > 0) {
    // First attempt in this window: drop this key's expired windows. Best
    // effort; a leftover row only costs storage.
    await admin.from("rate_limits").delete().eq("key", key).lt("window_start", start);
    return isWithinLimit(1, limit);
  }

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await admin
      .from("rate_limits")
      .select("count")
      .eq("key", key)
      .eq("window_start", start)
      .maybeSingle();
    if (current.error || !current.data) {
      throw new RateLimitStoreError("read", current.error?.code);
    }

    const count = Number(current.data.count);
    if (!isWithinLimit(count + 1, limit)) return false;

    const updated = await admin
      .from("rate_limits")
      .update({ count: count + 1 })
      .eq("key", key)
      .eq("window_start", start)
      .eq("count", count)
      .select("count");
    if (updated.error) throw new RateLimitStoreError("update", updated.error.code);
    if (updated.data.length === 1) return true;
    // Another attempt won the race; re-read and try again.
  }
  return false;
}

export type LoginRateLimitResult = "ok" | "limited" | "unavailable";

/**
 * Counts a sign-in attempt against both the email and the client IP. Both
 * counters always advance, so rotating emails from one IP still hits the IP
 * limit. Store errors fail closed as "unavailable".
 */
export async function consumeLoginRateLimit(
  email: string,
  ip: string,
  nowMs: number = Date.now(),
): Promise<LoginRateLimitResult> {
  try {
    const [emailOk, ipOk] = await Promise.all([
      consumeAttempt(emailRateLimitKey(email), LOGIN_LIMITS.email, nowMs),
      consumeAttempt(ipRateLimitKey(ip), LOGIN_LIMITS.ip, nowMs),
    ]);
    return emailOk && ipOk ? "ok" : "limited";
  } catch (error) {
    console.error(
      "[login] rate limit check failed:",
      error instanceof RateLimitStoreError ? error.message : "unexpected error",
    );
    return "unavailable";
  }
}
