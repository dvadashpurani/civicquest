// Client-safe environment access. Holds only NEXT_PUBLIC_ values, so it may be
// imported from Client Components. Server-only values live in `lib/env.ts`.

/** The public variables, inlined into client bundles by Next at build time. */
export const PUBLIC_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type PublicEnvVar = (typeof PUBLIC_ENV_VARS)[number];

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
};

type EnvSource = Readonly<Record<string, string | undefined>>;

/** Thrown when required variables are absent or empty; names every one. */
export class MissingEnvError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Missing required environment variable${missing.length === 1 ? "" : "s"}: ` +
        `${missing.join(", ")}. Copy .env.example to .env.local and set ` +
        `${missing.length === 1 ? "it" : "each one"}.`,
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/** Returns, in the given order, each name whose value is absent or blank. */
export function findMissingEnvVars(
  names: readonly string[],
  source: EnvSource,
): string[] {
  return names.filter((name) => {
    const value = source[name];
    return value === undefined || value.trim() === "";
  });
}

/** Throws a MissingEnvError naming every missing variable, if any. */
export function assertEnvVars(names: readonly string[], source: EnvSource): void {
  const missing = findMissingEnvVars(names, source);
  if (missing.length > 0) throw new MissingEnvError(missing);
}

/**
 * Next only inlines NEXT_PUBLIC_ values for literal `process.env.NAME`
 * references, so each one is spelled out here rather than looked up by key.
 */
function readPublicEnvSource(): Record<PublicEnvVar, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

/** Validates and maps the public variables from a source (pure, for tests). */
export function parsePublicEnv(source: EnvSource): PublicEnv {
  assertEnvVars(PUBLIC_ENV_VARS, source);
  return {
    supabaseUrl: source.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    supabaseAnonKey: source.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    appUrl: source.NEXT_PUBLIC_APP_URL!.trim(),
  };
}

let cachedPublicEnv: PublicEnv | undefined;

/** The validated public environment; throws MissingEnvError if incomplete. */
export function getPublicEnv(): PublicEnv {
  cachedPublicEnv ??= parsePublicEnv(readPublicEnvSource());
  return cachedPublicEnv;
}
