// Browser Supabase client (anon key). For Client Components: reads under RLS
// and live check-in polling. Holds only public config, never the service role
// key, so it is safe to bundle for the browser.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env.public";

/**
 * Returns the browser client. `@supabase/ssr` keeps one instance per page in
 * the browser. Session cookies are `httpOnly` (lib/auth/cookies.ts), so this
 * client cannot see them and queries run as the anonymous role under RLS.
 * Signed-in reads, sign-in, and sign-out go through the server instead.
 */
export function createBrowserSupabase(): SupabaseClient {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
