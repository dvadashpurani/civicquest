import "server-only";

// Server Supabase client (anon key + the user's auth cookies). For Server
// Components, server actions, and route handlers; every query and `.rpc()`
// runs as the signed-in user under RLS. Check identity with
// `supabase.auth.getUser()`, never `getSession()`.

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getAuthCookieOptions, hardenCookieOptions } from "@/lib/auth/cookies";
import { getPublicEnv } from "@/lib/env.public";

/** Creates a fresh client for the current request. Never share across requests. */
export async function createServerSupabase(): Promise<SupabaseClient> {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const cookieOptions = getAuthCookieOptions();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    // httpOnly, secure, sameSite=lax on every session cookie (Requirement 6.6).
    cookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, hardenCookieOptions(options, cookieOptions));
          }
        } catch {
          // Server Components cannot set cookies. `proxy.ts` refreshes the
          // session on every request, so a write skipped here is not lost.
        }
      },
    },
  });
}
