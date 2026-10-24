import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Placeholder values only; nothing here is a real credential.
const placeholderEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "service-placeholder",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DEMO_MODE: "true",
};

const dir = join(process.cwd(), "lib", "supabase");
const read = (name: string) => readFileSync(join(dir, name), "utf8");

/** The first statement, ignoring leading comments and blank lines. */
function firstStatement(src: string): string {
  const body = src.replace(/^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/, "");
  return body.slice(0, body.search(/;|\n/) + 1).trim();
}

describe("Supabase clients (Requirement 1.3)", () => {
  it("are exactly browser, server, and admin, each built with @supabase/ssr", () => {
    const clients = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(clients.sort()).toEqual(["admin.ts", "browser.ts", "server.ts"]);
    for (const name of clients) {
      expect(read(name)).toMatch(/from "@supabase\/ssr"/);
    }
  });
});

describe("service role key containment (Requirements 1.6, 35.3)", () => {
  it("admin.ts starts with import 'server-only'", () => {
    expect(firstStatement(read("admin.ts"))).toMatch(/^import ["']server-only["'];?$/);
  });

  it("only admin.ts reads the server env; browser.ts uses public env only", () => {
    expect(read("admin.ts")).toMatch(/from "@\/lib\/env"/);
    for (const name of ["browser.ts", "server.ts"]) {
      expect(read(name)).not.toMatch(/from "@\/lib\/env"/);
      expect(read(name)).not.toMatch(/serviceRoleKey|SERVICE_ROLE/);
    }
  });

  it("no NEXT_PUBLIC_ identifier refers to the service role key", () => {
    for (const name of ["admin.ts", "browser.ts", "server.ts"]) {
      expect(read(name)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/);
    }
  });
});

describe("createAdminSupabase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("builds a client from the server env without a user session", async () => {
    for (const [key, value] of Object.entries(placeholderEnv)) vi.stubEnv(key, value);
    const { createAdminSupabase } = await import("./admin");
    const client = createAdminSupabase();
    expect(typeof client.from).toBe("function");
    expect(typeof client.rpc).toBe("function");
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
  });
});
