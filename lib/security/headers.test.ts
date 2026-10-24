import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  supabaseOriginFrom,
} from "./headers";

const SUPABASE = "https://abcdefgh.supabase.co";

/** Parses a CSP string into directive -> sources. */
function parseCsp(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

function headerMap(options: Parameters<typeof buildSecurityHeaders>[0]) {
  return new Map(buildSecurityHeaders(options).map((h) => [h.key, h.value]));
}

describe("buildSecurityHeaders", () => {
  const headers = headerMap({ supabaseUrl: `${SUPABASE}/`, isDev: false });

  it("sets every required header with its exact value (Req 6.2)", () => {
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(self), microphone=(), geolocation=()",
    );
    expect(headers.has("Content-Security-Policy")).toBe(true);
  });

  it("has no duplicate header keys", () => {
    const keys = buildSecurityHeaders({ supabaseUrl: SUPABASE, isDev: false }).map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildContentSecurityPolicy (Req 6.1, 6.2)", () => {
  const csp = parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE, isDev: false }));

  it("forbids framing", () => {
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("loads scripts only from the app origin, without eval in production", () => {
    const scripts = csp.get("script-src")!;
    expect(scripts).toContain("'self'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.filter((s) => /^https?:/.test(s))).toEqual([]);
  });

  it("allows fonts from the app and Google Fonts only", () => {
    expect(csp.get("font-src")).toEqual(["'self'", "https://fonts.gstatic.com"]);
  });

  it("allows images from the app and the Supabase origin only", () => {
    const hosts = csp.get("img-src")!.filter((s) => /^https?:/.test(s));
    expect(csp.get("img-src")).toContain("'self'");
    expect(hosts).toEqual([SUPABASE]);
  });

  it("connects only to the app and the Supabase origin", () => {
    expect(csp.get("connect-src")).toEqual(["'self'", SUPABASE]);
  });

  it("blocks plugins and base-tag hijacking, and upgrades insecure requests", () => {
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
  });

  it("adds 'unsafe-eval' and drops the https upgrade only in development", () => {
    const dev = parseCsp(buildContentSecurityPolicy({ supabaseUrl: SUPABASE, isDev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });

  it("fails closed when the Supabase URL is missing or invalid", () => {
    for (const supabaseUrl of [undefined, "", "   ", "not a url", "javascript:alert(1)"]) {
      const policy = parseCsp(buildContentSecurityPolicy({ supabaseUrl, isDev: false }));
      expect(policy.get("connect-src")).toEqual(["'self'"]);
      expect(policy.get("img-src")!.some((s) => /^https?:/.test(s))).toBe(false);
    }
  });
});

describe("supabaseOriginFrom", () => {
  it("reduces a URL to its origin", () => {
    expect(supabaseOriginFrom(` ${SUPABASE}/rest/v1?x=1 `)).toBe(SUPABASE);
    expect(supabaseOriginFrom("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
  });

  it("rejects non-http(s) and unparsable values", () => {
    expect(supabaseOriginFrom("ftp://example.com")).toBeNull();
    expect(supabaseOriginFrom("nope")).toBeNull();
    expect(supabaseOriginFrom(undefined)).toBeNull();
  });
});
