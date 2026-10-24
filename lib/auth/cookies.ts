// Session cookie attributes for every server-side `@supabase/ssr` client
// (Requirement 6.6). Pure apart from `getAuthCookieOptions()`, which reads
// NODE_ENV and the public app URL.
//
// Tradeoff of `httpOnly`: page scripts cannot read the session, so the
// browser client (`lib/supabase/browser.ts`) runs as the anonymous role.
// Anything that needs the signed-in user (including live polling) goes
// through a server action, route handler, or `router.refresh()` instead.

import type { CookieOptions } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env.public";

export type AuthCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `secure` is dropped only for local development over plain http, where a
 * Secure cookie would not round-trip in every browser. Everywhere else,
 * including any non-development build, it is always on.
 */
export function authCookieOptions(input: { nodeEnv: string | undefined; appUrl: string }): AuthCookieOptions {
  let insecureLocalDev = false;
  if (input.nodeEnv === "development") {
    try {
      const url = new URL(input.appUrl);
      insecureLocalDev = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    } catch {
      insecureLocalDev = false;
    }
  }
  return { httpOnly: true, secure: !insecureLocalDev, sameSite: "lax", path: "/" };
}

export function getAuthCookieOptions(): AuthCookieOptions {
  return authCookieOptions({ nodeEnv: process.env.NODE_ENV, appUrl: getPublicEnv().appUrl });
}

/** Library-supplied options (maxAge, expiry) with our attributes forced on top. */
export function hardenCookieOptions(options: CookieOptions | undefined, enforced: AuthCookieOptions): CookieOptions {
  return { ...options, ...enforced };
}
