import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Public sign-up is off (Requirements 6.3, 6.4): the app ships no sign-up
// route, page, or action. Supabase's own endpoint is disabled in the
// dashboard (README, "Supabase setup").

const ROOTS = ["app", "components", "lib"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...files(path)] : [path];
  });
}

const all = ROOTS.flatMap((root) => files(join(process.cwd(), root)));

describe("no public sign-up", () => {
  it("has no sign-up or register route", () => {
    const routes = all
      .map((p) => relative(process.cwd(), p).replace(/\\/g, "/"))
      .filter((p) => /(^|\/)(sign-?up|register)(\/|$|\.)/i.test(p));
    expect(routes).toEqual([]);
  });

  it("never calls supabase.auth.signUp", () => {
    const callers = all
      .filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts"))
      .filter((p) => /auth\s*\.\s*signUp\s*\(/.test(readFileSync(p, "utf8")));
    expect(callers).toEqual([]);
  });

  it("the login page exists with email and password fields", () => {
    const form = readFileSync(join(process.cwd(), "app", "(public)", "login", "LoginForm.tsx"), "utf8");
    expect(form).toMatch(/name="email"/);
    expect(form).toMatch(/autoComplete="email"/);
    expect(form).toMatch(/name="password"/);
    expect(form).toMatch(/autoComplete="current-password"/);
  });
});
