import "server-only";

// Admin Supabase client (service role key). Bypasses RLS, so it is used only
// by the seed, the demo reset, and future admin invites (after re-checking the
// caller is an admin of the right school). Never import this from client code.

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

/**
 * Creates a service-role client. It never reads or writes user cookies, so
 * requests always carry the service role key rather than a user's session.
 */
export function createAdminSupabase(): SupabaseClient {
  const { supabaseUrl, serviceRoleKey } = getServerEnv();

  return createServerClient(supabaseUrl, serviceRoleKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // No user session to persist for the service role.
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
