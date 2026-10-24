import { describe, expect, it } from "vitest";
import { MissingEnvError, REQUIRED_ENV_VARS, parseServerEnv } from "./env";
import { PUBLIC_ENV_VARS, findMissingEnvVars, parsePublicEnv } from "./env.public";

// Placeholder values only; nothing here is a real credential.
const complete = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "service-placeholder",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DEMO_MODE: "true",
};

function missingFrom(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof MissingEnvError) return err.missing;
    throw err;
  }
  throw new Error("expected a MissingEnvError");
}

describe("REQUIRED_ENV_VARS", () => {
  it("lists exactly the five required variables", () => {
    expect([...REQUIRED_ENV_VARS].sort()).toEqual(Object.keys(complete).sort());
  });

  it("never exposes the service role key through a NEXT_PUBLIC_ name", () => {
    expect(PUBLIC_ENV_VARS.some((name) => name.includes("SERVICE_ROLE"))).toBe(false);
  });
});

describe("parseServerEnv", () => {
  it("maps a complete environment", () => {
    expect(parseServerEnv(complete)).toEqual({
      supabaseUrl: complete.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: complete.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      appUrl: complete.NEXT_PUBLIC_APP_URL,
      serviceRoleKey: complete.SUPABASE_SERVICE_ROLE_KEY,
      demoMode: true,
    });
  });

  it("names every missing variable when the environment is empty", () => {
    const missing = missingFrom(() => parseServerEnv({}));
    expect(missing).toEqual([...REQUIRED_ENV_VARS]);
  });

  it("treats empty and whitespace-only values as missing", () => {
    const missing = missingFrom(() =>
      parseServerEnv({ ...complete, SUPABASE_SERVICE_ROLE_KEY: "", DEMO_MODE: "   " }),
    );
    expect(missing).toEqual(["SUPABASE_SERVICE_ROLE_KEY", "DEMO_MODE"]);
  });

  it("puts each missing name in the error message but no values", () => {
    const { NEXT_PUBLIC_APP_URL: _omitted, ...rest } = complete;
    void _omitted;
    let message = "";
    try {
      parseServerEnv({ ...rest, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(message).toContain("NEXT_PUBLIC_APP_URL");
    expect(message).not.toContain(complete.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("enables demo mode only for exactly `true`", () => {
    for (const value of ["false", "TRUE", "1", "yes"]) {
      expect(parseServerEnv({ ...complete, DEMO_MODE: value }).demoMode).toBe(false);
    }
  });
});

describe("parsePublicEnv", () => {
  it("never includes the service role key", () => {
    expect(Object.values(parsePublicEnv(complete))).not.toContain(
      complete.SUPABASE_SERVICE_ROLE_KEY,
    );
  });

  it("does not require server-only variables", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _key, DEMO_MODE: _demo, ...publicOnly } = complete;
    void _key;
    void _demo;
    expect(findMissingEnvVars(PUBLIC_ENV_VARS, publicOnly)).toEqual([]);
  });
});
