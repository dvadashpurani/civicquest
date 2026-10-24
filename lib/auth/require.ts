import "server-only";

// Server auth helpers for Server Components, server actions, and route
// handlers (Requirements 6.5, 6.9, 6.10, 32.1, 32.3). Identity always comes
// from `supabase.auth.getUser()`, which verifies the JWT with Supabase Auth;
// `getSession()` alone is never trusted. On failure these call `redirect()`,
// which throws, so the caller stops before any data change.
//
// With cacheComponents on, these read cookies, so call them inside a
// <Suspense> boundary (not at the top level of a layout).

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { LOGIN_PATH, parseRole, roleHome, type UserRole } from "./roles";

export type Profile = {
  id: string;
  role: UserRole;
  full_name: string;
  school_id: string | null;
  partner_org_id: string | null;
};

export type AuthContext = {
  user: User;
  role: UserRole;
  profile: Profile;
};

const PROFILE_COLUMNS = "id, role, full_name, school_id, partner_org_id";

/**
 * The verified user and their profile, or null when there is no verified
 * user, no profile row, or no valid role. Deduplicated per request.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createServerSupabase();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userError ? null : userData.user;
  if (!user) return null;

  // RLS lets a user read their own row (`id = auth.uid()`).
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  const role = parseRole(data.role);
  if (role === null) return null;

  const profile: Profile = {
    id: data.id,
    role,
    full_name: data.full_name,
    school_id: data.school_id ?? null,
    partner_org_id: data.partner_org_id ?? null,
  };
  return { user, role, profile };
});

/** Any signed-in user with a profile role; otherwise redirects to `/login`. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) redirect(LOGIN_PATH);
  return auth;
}

/**
 * A signed-in user whose role is one of `roles`. Users without a profile role
 * go to `/login`; users with another role go to their own role home.
 */
export async function requireRole(...roles: [UserRole, ...UserRole[]]): Promise<AuthContext> {
  const auth = await requireUser();
  if (!roles.includes(auth.role)) redirect(roleHome(auth.role));
  return auth;
}
