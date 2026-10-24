import { describe, expect, it } from "vitest";
import {
  LOGIN_PATH,
  ROLE_HOME,
  ROUTE_GROUPS,
  USER_ROLES,
  decideRoute,
  parseRole,
  requiredRoleForPath,
  roleHome,
} from "./roles";

describe("role homes and route groups", () => {
  it("maps every role to a home", () => {
    expect(ROLE_HOME).toEqual({
      admin: "/admin",
      teacher: "/teacher",
      partner: "/partner",
      student: "/me",
      counselor: "/",
    });
  });

  it("gives each route group exactly one role, and the group is that role's home", () => {
    expect(ROUTE_GROUPS.map((g) => [g.prefix, g.role])).toEqual([
      ["/admin", "admin"],
      ["/teacher", "teacher"],
      ["/partner", "partner"],
      ["/me", "student"],
    ]);
    for (const { prefix, role } of ROUTE_GROUPS) expect(roleHome(role)).toBe(prefix);
  });

  it("parses only known roles", () => {
    for (const role of USER_ROLES) expect(parseRole(role)).toBe(role);
    for (const bad of [null, undefined, "", "Admin", "superuser", 1, {}]) {
      expect(parseRole(bad)).toBeNull();
    }
  });
});

describe("requiredRoleForPath", () => {
  it.each([
    ["/teacher", "teacher"],
    ["/teacher/", "teacher"],
    ["/teacher/today", "teacher"],
    ["/partner/opportunity/abc", "partner"],
    ["/me", "student"],
    ["/me/scan", "student"],
    ["/admin/proof-log", "admin"],
  ])("%s requires %s", (path, role) => {
    expect(requiredRoleForPath(path)).toBe(role);
  });

  it.each(["/", "/login", "/teachers", "/meetings", "/administrator", "/api/health"])(
    "%s is not role-protected",
    (path) => {
      expect(requiredRoleForPath(path)).toBeNull();
    },
  );

  it.each([
    ["//teacher", "teacher"],
    ["/%74eacher", "teacher"],
    ["/ADMIN", "admin"],
    ["/me//scan", "student"],
    ["\\admin", "admin"],
  ])("still protects the odd spelling %s", (path, role) => {
    expect(requiredRoleForPath(path)).toBe(role);
  });

  it("does not throw on malformed escapes", () => {
    expect(requiredRoleForPath("/teacher/%E0%A4%A")).toBe("teacher");
  });
});

describe("decideRoute", () => {
  it("allows public paths whether or not anyone is signed in", () => {
    for (const pathname of ["/", "/login"]) {
      expect(decideRoute({ pathname, signedIn: false, role: null })).toEqual({ action: "allow" });
      expect(decideRoute({ pathname, signedIn: true, role: "teacher" })).toEqual({ action: "allow" });
    }
  });

  it("sends signed-out users on a protected path to /login with next", () => {
    expect(decideRoute({ pathname: "/teacher/today", signedIn: false, role: null })).toEqual({
      action: "redirect",
      location: "/login?next=%2Fteacher%2Ftoday",
      reason: "signed-out",
    });
  });

  it("sends signed-in users without a profile role to /login (Requirement 6.9)", () => {
    for (const { prefix } of ROUTE_GROUPS) {
      expect(decideRoute({ pathname: prefix, signedIn: true, role: null })).toEqual({
        action: "redirect",
        location: LOGIN_PATH,
        reason: "no-role",
      });
    }
  });

  it("sends every role outside its group to its own home (Requirements 6.10, 31.5)", () => {
    for (const role of USER_ROLES) {
      for (const group of ROUTE_GROUPS) {
        const decision = decideRoute({ pathname: `${group.prefix}/x`, signedIn: true, role });
        if (group.role === role) {
          expect(decision).toEqual({ action: "allow" });
        } else {
          expect(decision).toEqual({ action: "redirect", location: roleHome(role), reason: "wrong-group" });
        }
      }
    }
  });

  it("sends a counselor away from every group to the public landing page", () => {
    for (const { prefix } of ROUTE_GROUPS) {
      const decision = decideRoute({ pathname: prefix, signedIn: true, role: "counselor" });
      expect(decision).toMatchObject({ action: "redirect", location: "/" });
    }
  });

  it("never redirects a role away from its own home (no redirect loops)", () => {
    for (const role of USER_ROLES) {
      expect(decideRoute({ pathname: roleHome(role), signedIn: true, role })).toEqual({ action: "allow" });
    }
  });
});
