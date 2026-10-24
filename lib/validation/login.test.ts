import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  loginFormToObject,
  loginSchema,
  normalizeEmail,
  parseLoginForm,
} from "./login";

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("loginSchema (Requirements 6.8, 33.1, 33.2)", () => {
  it("accepts an email and password and normalizes the email", () => {
    expect(loginSchema.parse({ email: "  Teacher3@Example.ORG ", password: " pw " })).toEqual({
      email: "teacher3@example.org",
      password: " pw ",
    });
  });

  it.each([
    ["empty email", { email: "", password: "secret" }],
    ["whitespace email", { email: "   ", password: "secret" }],
    ["empty password", { email: "a@example.org", password: "" }],
    ["missing password", { email: "a@example.org" }],
    ["not an email", { email: "not-an-email", password: "secret" }],
    ["non-string email", { email: ["a@example.org"], password: "secret" }],
    ["unknown field", { email: "a@example.org", password: "secret", role: "admin" }],
    ["email too long", { email: `${"a".repeat(EMAIL_MAX_LENGTH)}@x.org`, password: "secret" }],
    ["password too long", { email: "a@example.org", password: "p".repeat(PASSWORD_MAX_LENGTH + 1) }],
  ])("rejects %s", (_name, input) => {
    expect(loginSchema.safeParse(input).success).toBe(false);
  });

  it("stores injection strings as inert text in the password", () => {
    const password = "' OR 1=1 --<script>alert(1)</script>";
    expect(loginSchema.parse({ email: "a@example.org", password }).password).toBe(password);
  });
});

describe("parseLoginForm", () => {
  it("ignores React's $ACTION_ fields", () => {
    const data = form([
      ["$ACTION_ID_abc", ""],
      ["email", "a@example.org"],
      ["password", "secret"],
    ]);
    expect(parseLoginForm(data)).toEqual({ email: "a@example.org", password: "secret" });
  });

  it("rejects a repeated field and a __proto__ field", () => {
    expect(
      parseLoginForm(form([["email", "a@example.org"], ["email", "b@example.org"], ["password", "x"]])),
    ).toBeNull();
    const proto = form([["email", "a@example.org"], ["password", "x"], ["__proto__", "y"]]);
    expect(Object.hasOwn(loginFormToObject(proto), "__proto__")).toBe(true);
    expect(parseLoginForm(proto)).toBeNull();
  });

  it("property: any extra field makes the submission invalid", () => {
    // **Validates: Requirements 33.1, 33.2**
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          (k) => k !== "email" && k !== "password" && !k.startsWith("$ACTION"),
        ),
        fc.string({ maxLength: 20 }),
        (key, value) => {
          const data = form([["email", "a@example.org"], ["password", "secret"], [key, value]]);
          expect(parseLoginForm(data)).toBeNull();
        },
      ),
    );
  });

  it("property: an empty or whitespace-only email is always rejected", () => {
    // **Validates: Requirements 6.8**
    fc.assert(
      fc.property(fc.stringMatching(/^[ \t\n\r]*$/), fc.string({ maxLength: 40 }), (email, password) => {
        expect(parseLoginForm(form([["email", email], ["password", password]]))).toBeNull();
      }),
    );
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  A@B.Org\t")).toBe("a@b.org");
  });
});
