// Request proxy (Next.js 16 renamed the `middleware.ts` convention to
// `proxy.ts`; same behavior, Node.js runtime by default).
//
// On every matched request it refreshes the Supabase session cookie with the
// `@supabase/ssr` pattern, verifies identity with `supabase.auth.getUser()`
// (never `getSession()`), and routes by `profiles.role` (Requirements 6.5,
// 6.6, 6.9, 6.10, 32.1). This is a first gate only: every page, server
// action, and route handler re-checks with `lib/auth/require.ts`, and RLS
// stays the last line of defense.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthCookieOptions, hardenCookieOptions } from "@/lib/auth/cookies";
import { decideRoute, parseRole, requiredRoleForPath, type UserRole } from "@/lib/auth/roles";
import { getPublicEnv } from "@/lib/env.public";

export async function proxy(request: NextRequest) {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const cookieOptions = getAuthCookieOptions();

  let response = NextResponse.next({ request });
  const responseHeaders: Record<string, string> = {};

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Forward refreshed tokens to this request's render and to the browser.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, hardenCookieOptions(options, cookieOptions));
        }
        // No-store headers so a CDN never caches one user's Set-Cookie.
        Object.assign(responseHeaders, headers);
      },
    },
  });

  // Verifies the JWT with Supabase Auth (and refreshes it if needed). Any
  // error, including a network failure, is treated as signed out.
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    userId = error ? null : (data.user?.id ?? null);
  } catch {
    userId = null;
  }

  const { pathname } = request.nextUrl;
  let role: UserRole | null = null;
  if (userId && requiredRoleForPath(pathname) !== null) {
    // RLS lets a user read their own profile row. A missing row, null role,
    // or query error fails closed to `/login`.
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    role = error ? null : parseRole(data?.role);
  }

  const decision = decideRoute({ pathname, signedIn: userId !== null, role });

  let result: NextResponse = response;
  if (decision.action === "redirect") {
    result = NextResponse.redirect(new URL(decision.location, request.url));
    // Keep any refreshed session cookies on the redirect.
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
  }
  for (const [key, value] of Object.entries(responseHeaders)) result.headers.set(key, value);
  return result;
}

export const config = {
  matcher: [
    // Everything except Next build assets, the self-hosted icons, and static
    // image files. Server actions POST to their page route, so they pass here.
    "/((?!_next/static|_next/image|icons/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
