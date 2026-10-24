// Pure role routing rules shared by `proxy.ts` and the server auth helpers in
// `lib/auth/require.ts`. No I/O and no `server-only`, so the proxy can import
// it and Vitest can test it directly (Requirements 6.9, 6.10, 31.5).

import { safeRedirectPath } from "@/lib/domain/redirect";

/** Mirrors the `public.user_role` enum in supabase/migrations/0001_schema.sql. */
export const USER_ROLES = ["admin", "teacher", "counselor", "partner", "student"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const LOGIN_PATH = "/login";

/**
 * Where each role lands after sign-in and after being turned away from a
 * route group it does not own.
 *
 * Counselor: the role has accounts but no page in this scope (design.md
 * "Route groups", tasks.md "Out of scope"). Its home is the public landing
 * page `/`, which always renders (no 404) and is outside every protected
 * group, so a counselor can never be caught in a redirect loop. When a
 * counselor page is built, point this entry at it and add a route group.
 */
export const ROLE_HOME: Readonly<Record<UserRole, string>> = {
  admin: "/admin",
  teacher: "/teacher",
  partner: "/partner",
  student: "/me",
  counselor: "/",
};

/** Each protected URL prefix and the one role allowed inside it. */
export const ROUTE_GROUPS: readonly { readonly prefix: string; readonly role: UserRole }[] = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/teacher", role: "teacher" },
  { prefix: "/partner", role: "partner" },
  { prefix: "/me", role: "student" },
];

/** Narrows an untrusted value (e.g. a DB column) to a known role, else null. */
export function parseRole(value: unknown): UserRole | null {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value)
    ? (value as UserRole)
    : null;
}

export function roleHome(role: UserRole): string {
  return ROLE_HOME[role];
}

/**
 * Canonical form used only for matching: percent-decoded, repeated slashes
 * collapsed, lowercased. Erring toward a match is safe here, since a false
 * match only costs a redirect, while a missed match would skip the check.
 */
export function normalizePathname(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes: match on the raw string.
  }
  path = path.replace(/[/\\]+/g, "/").toLowerCase();
  return path.startsWith("/") ? path : `/${path}`;
}

/** The role a path requires, or null when the path is not role-protected. */
export function requiredRoleForPath(pathname: string): UserRole | null {
  const path = normalizePathname(pathname);
  for (const { prefix, role } of ROUTE_GROUPS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return role;
  }
  return null;
}

export type RouteDecision =
  | { action: "allow" }
  | {
      action: "redirect";
      location: string;
      reason: "signed-out" | "no-role" | "wrong-group";
    };

export type RouteInput = {
  pathname: string;
  /** True only when `supabase.auth.getUser()` returned a user. */
  signedIn: boolean;
  /** `profiles.role` for that user; null if there is no row or no valid role. */
  role: UserRole | null;
};

/**
 * Routing rule for the proxy:
 * - unprotected path → allow
 * - signed out → `/login` (with `next`, honored only after task 3.15)
 * - signed in without a profile role → `/login` (Requirement 6.9)
 * - role outside the path's group → that role's home (6.10, 31.5)
 */
export function decideRoute({ pathname, signedIn, role }: RouteInput): RouteDecision {
  const required = requiredRoleForPath(pathname);
  if (required === null) return { action: "allow" };

  if (!signedIn) {
    // Only attach `next` when the original path is a safe relative target.
    // safeRedirectPath collapses anything else to `/`, which the login action
    // treats as "no target" and replaces with the role home (6.12, 6.13), so
    // a crafted request URL can never steer the post-login redirect.
    const safeNext = safeRedirectPath(pathname);
    const location =
      safeNext === "/"
        ? LOGIN_PATH
        : `${LOGIN_PATH}?next=${encodeURIComponent(safeNext)}`;
    return { action: "redirect", location, reason: "signed-out" };
  }
  if (role === null) {
    return { action: "redirect", location: LOGIN_PATH, reason: "no-role" };
  }
  if (role !== required) {
    return { action: "redirect", location: roleHome(role), reason: "wrong-group" };
  }
  return { action: "allow" };
}
