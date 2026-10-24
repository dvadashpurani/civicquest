import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LOGIN_LIMITS,
  clientIpFromHeaders,
  emailRateLimitKey,
  ipRateLimitKey,
  isWithinLimit,
  windowStart,
} from "./login-rate-limit";

const HEX_KEY = /^login:(email|ip):[0-9a-f]{64}$/;

describe("login rate-limit keys (Requirement 35.1, child privacy)", () => {
  it("are hashed, prefixed, and never contain the raw input", () => {
    const key = emailRateLimitKey("teacher3@example.org");
    expect(key).toMatch(HEX_KEY);
    expect(key).not.toContain("teacher3");
    expect(ipRateLimitKey("203.0.113.7")).toMatch(HEX_KEY);
    expect(ipRateLimitKey("203.0.113.7")).not.toContain("203.0.113.7");
  });

  it("separate email and IP buckets even for the same string", () => {
    expect(emailRateLimitKey("x").slice(-64)).not.toBe(ipRateLimitKey("x").slice(-64));
  });

  it("property: email keys ignore case and surrounding whitespace", () => {
    // **Validates: Requirements 35.1**
    fc.assert(
      fc.property(fc.emailAddress(), fc.stringMatching(/^[ \t]{0,3}$/), (email, pad) => {
        expect(emailRateLimitKey(`${pad}${email.toUpperCase()}${pad}`)).toBe(
          emailRateLimitKey(email),
        );
      }),
    );
  });

  it("property: different emails get different keys", () => {
    // **Validates: Requirements 35.1**
    fc.assert(
      fc.property(fc.emailAddress(), fc.emailAddress(), (a, b) => {
        fc.pre(a.toLowerCase() !== b.toLowerCase());
        expect(emailRateLimitKey(a)).not.toBe(emailRateLimitKey(b));
      }),
    );
  });
});

describe("clientIpFromHeaders", () => {
  it("uses the first x-forwarded-for hop", () => {
    const headers = new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1", "x-real-ip": "10.0.0.2" });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to 'unknown'", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("ignores values that are not IP-shaped", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "<script>", "x-real-ip": "evil host" }))).toBe(
      "unknown",
    );
  });
});

describe("windowStart and limits (Requirement 35.2)", () => {
  it("floors to the minute for a one-minute window", () => {
    const now = Date.UTC(2026, 4, 12, 9, 30, 45, 123);
    expect(windowStart(now, 60_000)).toBe("2026-05-12T09:30:00.000Z");
  });

  it("property: every instant falls inside its own window", () => {
    // **Validates: Requirements 35.1**
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) }),
        fc.constantFrom(LOGIN_LIMITS.email.windowMs, 3_600_000),
        (now, windowMs) => {
          const start = Date.parse(windowStart(now, windowMs));
          expect(start).toBeLessThanOrEqual(now);
          expect(now - start).toBeLessThan(windowMs);
        },
      ),
    );
  });

  it("allows exactly `limit` attempts per window", () => {
    const { limit } = LOGIN_LIMITS.email;
    expect(limit).toBe(5);
    expect(LOGIN_LIMITS.ip.limit).toBe(20);
    expect(isWithinLimit(limit, limit)).toBe(true);
    expect(isWithinLimit(limit + 1, limit)).toBe(false);
  });
});
