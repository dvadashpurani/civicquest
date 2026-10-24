"use server";

// Sign-in server action for `/login` (Requirements 6.7, 6.8, 33.1, 33.2,
// 35.1, 35.2, 36.1, 36.2). There is deliberately no sign-up action anywhere
// in the app: accounts come only from invites, the seed, or admin-created
// Leader logins, and Supabase's own sign-up endpoint is switched off in the
// dashboard (README, "Supabase setup").
//
// Never log the email, password, or any token. Every credential problem
// returns the same message, so the response never reveals which field was
// wrong or whether an account exists.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { consumeLoginRateLimit } from "@/lib/auth/login-rate-limit-store";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import { parseRole, roleHome } from "@/lib/auth/roles";
import { createServerSupabase } from "@/lib/supabase/server";
import { EMAIL_MAX_LENGTH, parseLoginForm } from "@/lib/validation/login";

export type LoginState = {
  error: string | null;
  /** Echoed back so the email field keeps its value after a failure. */
  email: string;
  /** Increments per failed submission so the alert is announced each time. */
  attempt: number;
};

const SIGN_IN_FAILED = "Sign-in failed. Check your email and password, then try again.";
const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Wait a minute, then try again.";
const UNAVAILABLE = "Sign-in failed. Wait a minute, then try again.";

function failed(prev: LoginState, error: string, email: string): LoginState {
  return { error, email: email.slice(0, EMAIL_MAX_LENGTH), attempt: prev.attempt + 1 };
}

export async function signIn(prev: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const typedEmail = typeof rawEmail === "string" ? rawEmail : "";

  const input = parseLoginForm(formData);
  if (!input) return failed(prev, SIGN_IN_FAILED, typedEmail);

  const ip = clientIpFromHeaders(await headers());
  const limit = await consumeLoginRateLimit(input.email, ip);
  if (limit === "limited") return failed(prev, TOO_MANY_ATTEMPTS, typedEmail);
  if (limit === "unavailable") return failed(prev, UNAVAILABLE, typedEmail);

  const supabase = await createServerSupabase();
  let signedIn = false;
  let home: string | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (!error && data.user) {
      signedIn = true;
      // RLS lets the new session read its own profile row.
      const profile = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      const role = profile.error ? null : parseRole(profile.data?.role);
      if (role) home = roleHome(role);
    }
  } catch {
    // Network or Auth outage: the same generic failure, nothing logged.
    home = null;
  }

  if (!home) {
    if (signedIn) {
      // No profile, no role, or a failed lookup: never leave a session
      // behind for a user who has nowhere to go (Requirement 6.9).
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
    return failed(prev, SIGN_IN_FAILED, typedEmail);
  }

  // TODO(task 3.15): honor `?next=` through safeRedirectPath. Until then the
  // role home is the only destination (Requirements 6.7, 6.12, 6.13).
  redirect(home);
}
