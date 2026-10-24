import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/domain/redirect";

// Property 8: Only relative single-slash redirect paths are accepted.
// **Validates: Requirements 14.2, 14.3, 14.4**
//
// Requirement 14 defines open-redirect prevention for the post-login `next`
// target. A path is accepted and returned unchanged only when it begins with
// exactly one `/` not immediately followed by `/` or `\`, contains no control
// characters, and has no leading or trailing whitespace (14.2). Every other
// input — empty, no leading `/`, protocol-relative `//…` or `/\…`, a URL
// scheme, control characters, or surrounding whitespace — is rejected and the
// safe default `/` is returned (14.3). The property test must confirm that any
// non-relative-single-slash path is rejected to the safe default and that the
// function never throws (14.4). The number of fast-check runs is set above the
// required minimum of 100.

const RUNS = 1000;
const SAFE_DEFAULT = "/";

/** The reference oracle: the acceptance rules of Requirement 14.2/14.3. */
function hasControlChar(path: string): boolean {
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    // C0 range plus DEL and the C1 range.
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** True only for paths Requirement 14.2 says must be accepted. */
function shouldAccept(path: string): boolean {
  if (path !== path.trim()) return false;
  if (path.length < 2) return false;
  if (path[0] !== "/") return false;
  if (path[1] === "/" || path[1] === "\\") return false;
  if (hasControlChar(path)) return false;
  return true;
}

describe("safeRedirectPath property: only relative single-slash paths are accepted", () => {
  it("accepts a relative single-slash path and returns it unchanged (Requirement 14.2)", () => {
    // Generate paths that start with one `/` followed by a non-`/`, non-`\`,
    // non-control, non-whitespace-bordered body, so the oracle accepts them.
    const bodyChar = fc
      .string({ minLength: 1, maxLength: 1 })
      .filter((c) => c !== "/" && c !== "\\" && !hasControlChar(c) && c.trim() === c);

    const acceptablePath = fc
      .tuple(bodyChar, fc.string())
      .map(([first, rest]) => `/${first}${rest}`)
      .filter(shouldAccept);

    fc.assert(
      fc.property(acceptablePath, (path) => {
        expect(safeRedirectPath(path)).toBe(path);
      }),
      { numRuns: RUNS },
    );
  });

  it("rejects any path that is not a relative single-slash path, returning `/` (Requirements 14.3, 14.4)", () => {
    // Full string space: whatever the oracle does not accept must come back as
    // the safe default, and the accepted ones must come back unchanged.
    fc.assert(
      fc.property(fc.string(), (path) => {
        const result = safeRedirectPath(path);
        if (shouldAccept(path)) {
          expect(result).toBe(path);
        } else {
          expect(result).toBe(SAFE_DEFAULT);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("always rejects protocol-relative targets `//…` and `/\\…` (Requirement 14.3)", () => {
    const protocolRelative = fc
      .tuple(fc.constantFrom("//", "/\\"), fc.string())
      .map(([prefix, rest]) => `${prefix}${rest}`);

    fc.assert(
      fc.property(protocolRelative, (path) => {
        expect(safeRedirectPath(path)).toBe(SAFE_DEFAULT);
      }),
      { numRuns: RUNS },
    );
  });

  it("always rejects URL schemes such as `javascript:` and `https://` (Requirement 14.3)", () => {
    const scheme = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9+.-]*$/).filter((s) => s.length > 0);
    const schemeUrl = fc.tuple(scheme, fc.string()).map(([s, r]) => `${s}:${r}`);

    fc.assert(
      fc.property(schemeUrl, (path) => {
        // A scheme never begins with `/`, so it is always rejected.
        expect(safeRedirectPath(path)).toBe(SAFE_DEFAULT);
      }),
      { numRuns: RUNS },
    );

    for (const path of ["javascript:alert(1)", "https://evil.com", "data:text/html,x"]) {
      expect(safeRedirectPath(path)).toBe(SAFE_DEFAULT);
    }
  });

  it("rejects surrounding whitespace, control characters, empty, and missing leading `/` (Requirement 14.3)", () => {
    expect(safeRedirectPath("")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("/")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("home")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath(" /home")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("/home ")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("/home\npath")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("/home\tpath")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("//evil.com")).toBe(SAFE_DEFAULT);
    expect(safeRedirectPath("/\\evil.com")).toBe(SAFE_DEFAULT);
    // A plain relative path is accepted and returned unchanged.
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
  });

  it("never throws for any string input (Requirement 14.4)", () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        expect(() => safeRedirectPath(path)).not.toThrow();
      }),
      { numRuns: RUNS },
    );
  });
});
