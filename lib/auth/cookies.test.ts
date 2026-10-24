import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authCookieOptions, hardenCookieOptions } from "./cookies";

describe("authCookieOptions (Requirement 6.6)", () => {
  it("is httpOnly, secure, and sameSite=lax in production", () => {
    expect(authCookieOptions({ nodeEnv: "production", appUrl: "https://civicquest.example" })).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it("stays secure in production even on an http localhost URL", () => {
    expect(authCookieOptions({ nodeEnv: "production", appUrl: "http://localhost:3000" }).secure).toBe(true);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000"])(
    "drops secure only for development on %s",
    (appUrl) => {
      const options = authCookieOptions({ nodeEnv: "development", appUrl });
      expect(options).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax" });
    },
  );

  it.each(["https://localhost:3000", "http://192.168.1.5:3000", "http://localhost.evil.test", "not a url"])(
    "keeps secure in development for %s",
    (appUrl) => {
      expect(authCookieOptions({ nodeEnv: "development", appUrl }).secure).toBe(true);
    },
  );

  it("hardening overrides weaker library options but keeps maxAge", () => {
    const enforced = authCookieOptions({ nodeEnv: "production", appUrl: "https://civicquest.example" });
    expect(
      hardenCookieOptions({ httpOnly: false, secure: false, sameSite: "none", maxAge: 60 }, enforced),
    ).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 });
  });
});

describe("session verification (Requirements 6.5, 32.1)", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
  /** Source with line and block comments removed, so prose does not count. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("proxy and server helpers verify with getUser() and never call getSession()", () => {
    for (const src of [code(read("proxy.ts")), code(read("lib", "auth", "require.ts"))]) {
      expect(src).toMatch(/auth\.getUser\(\)/);
      expect(src).not.toMatch(/getSession\(/);
    }
  });

  it("require.ts is server-only and both server clients use the hardened cookie options", () => {
    expect(read("lib", "auth", "require.ts")).toMatch(/^import "server-only";/);
    for (const src of [read("proxy.ts"), read("lib", "supabase", "server.ts")]) {
      expect(src).toMatch(/cookieOptions,/);
      expect(src).toMatch(/hardenCookieOptions\(options, cookieOptions\)/);
    }
  });
});
