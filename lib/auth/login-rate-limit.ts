// Pure rules for login rate limiting (Requirements 35.1, 35.2). The store that
// reads and writes `public.rate_limits` is `login-rate-limit-store.ts`.
//
// `private.consume_rate_limit` keys on `auth.uid()`, so it cannot limit a
// sign-in that has no user yet. Login attempts are instead counted per email
// and per client IP. Neither is stored raw: each key is a SHA-256 digest with
// a purpose prefix, so `rate_limits` never holds an email address or an IP
// (child privacy; see .kiro/steering/child-privacy.md).

import { createHash } from "node:crypto";
import { normalizeEmail } from "@/lib/validation/login";

export type LoginLimit = {
  /** Attempts allowed per window, inclusive. */
  readonly limit: number;
  readonly windowMs: number;
};

/** 5 attempts a minute for one email, 20 a minute from one IP. */
export const LOGIN_LIMITS = {
  email: { limit: 5, windowMs: 60_000 },
  ip: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, LoginLimit>;

export type LoginLimitKind = keyof typeof LOGIN_LIMITS;

/** Same origin as `date_bin(..., '2000-01-01 00:00:00+00')` in 0003. */
const WINDOW_ORIGIN_MS = Date.UTC(2000, 0, 1);

const UNKNOWN_IP = "unknown";
const MAX_IP_LENGTH = 64;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `login:email:<sha256>`; the same for any casing or surrounding spaces. */
export function emailRateLimitKey(email: string): string {
  return `login:email:${sha256Hex(`civicquest:login:email:${normalizeEmail(email)}`)}`;
}

/** `login:ip:<sha256>` for an already-extracted client IP. */
export function ipRateLimitKey(ip: string): string {
  return `login:ip:${sha256Hex(`civicquest:login:ip:${ip.toLowerCase()}`)}`;
}

/** Accepts only characters that can appear in an IPv4 or IPv6 address. */
function cleanIp(value: string | null | undefined): string | null {
  const ip = value?.trim();
  if (!ip || ip.length > MAX_IP_LENGTH || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip;
}

/**
 * The client IP from proxy headers: the first `x-forwarded-for` hop, else
 * `x-real-ip`, else "unknown" (every unknown client then shares one bucket).
 * On Vercel both headers are set by the platform, not the client.
 */
export function clientIpFromHeaders(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  return cleanIp(forwarded) ?? cleanIp(headers.get("x-real-ip")) ?? UNKNOWN_IP;
}

/** Start of the fixed window containing `nowMs`, as an ISO timestamp. */
export function windowStart(nowMs: number, windowMs: number): string {
  const start = WINDOW_ORIGIN_MS + Math.floor((nowMs - WINDOW_ORIGIN_MS) / windowMs) * windowMs;
  return new Date(start).toISOString();
}

/** True while the attempt count (including this one) is within the limit. */
export function isWithinLimit(count: number, limit: number): boolean {
  return count <= limit;
}
