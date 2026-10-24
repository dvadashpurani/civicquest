import "server-only";

// Server-only environment access. This is the only module that reads the
// service role key; the `server-only` import makes any client import a build
// error. Startup validation runs from `instrumentation.ts` via `assertEnv()`.

import {
  PUBLIC_ENV_VARS,
  assertEnvVars,
  parsePublicEnv,
  type PublicEnv,
} from "./env.public";

export { MissingEnvError } from "./env.public";

/** All five variables the app needs before it may start (Requirement 1.4). */
export const REQUIRED_ENV_VARS = [
  ...PUBLIC_ENV_VARS,
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEMO_MODE",
] as const;

export type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

export type ServerEnv = PublicEnv & {
  serviceRoleKey: string;
  /** True only when DEMO_MODE is exactly `true`. */
  demoMode: boolean;
};

type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates all five variables from a source and maps them. Throws a
 * MissingEnvError naming every absent or empty variable (Requirement 1.5).
 */
export function parseServerEnv(source: EnvSource): ServerEnv {
  assertEnvVars(REQUIRED_ENV_VARS, source);
  return {
    ...parsePublicEnv(source),
    serviceRoleKey: source.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    demoMode: source.DEMO_MODE!.trim() === "true",
  };
}

let cachedServerEnv: ServerEnv | undefined;

/** The validated server environment, read once from `process.env`. */
export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/** Startup check: throws a MissingEnvError if any required variable is unset. */
export function assertEnv(): void {
  getServerEnv();
}

/** Server-side Demo_Mode check; demo logins and resets must call this. */
export function isDemoMode(): boolean {
  return getServerEnv().demoMode;
}
