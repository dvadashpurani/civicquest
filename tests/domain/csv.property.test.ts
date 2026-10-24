import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sanitizeCsvCell } from "@/lib/domain/csv";

// Property 7: Sanitized CSV cells never begin with a dangerous character.
// **Validates: Requirements 13.2, 13.3, 13.4, 13.5**
//
// Requirement 13 forbids exported cells from starting with a character a
// spreadsheet reads as the start of a formula — `=`, `+`, `-`, `@`, tab, or
// carriage return. `sanitizeCsvCell` must prefix exactly one apostrophe to such
// values and leave every other character untouched (13.2), return any value not
// starting with a dangerous character unchanged (13.3), return the empty string
// unchanged (13.4), and guarantee the output never begins with a dangerous
// character (13.5). The number of fast-check runs is set above the minimum 100.

const RUNS = 1000;

/** Characters a spreadsheet would read as the start of a formula (Req 13.2). */
const DANGEROUS = ["=", "+", "-", "@", "\t", "\r"] as const;

function startsDangerous(value: string): boolean {
  return value.length > 0 && (DANGEROUS as readonly string[]).includes(value[0]);
}

describe("sanitizeCsvCell property: sanitized cells never begin with a dangerous character", () => {
  it("never returns a value starting with a dangerous character (Requirement 13.5)", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const result = sanitizeCsvCell(value);
        expect(startsDangerous(result)).toBe(false);
      }),
      { numRuns: RUNS },
    );
  });

  it("leaves safe values unchanged, including the empty string (Requirements 13.3, 13.4)", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => !startsDangerous(value)),
        (value) => {
          expect(sanitizeCsvCell(value)).toBe(value);
        },
      ),
      { numRuns: RUNS },
    );
    // Req 13.4: the empty string has no first character and is returned as-is.
    expect(sanitizeCsvCell("")).toBe("");
  });

  it("prefixes exactly one apostrophe to dangerous values and changes nothing else (Requirement 13.2)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DANGEROUS),
        fc.string(),
        (prefix, rest) => {
          const value = prefix + rest;
          const result = sanitizeCsvCell(value);
          // One apostrophe is added, exactly once, in front of the original text.
          expect(result).toBe(`'${value}`);
          // Every other character is unchanged: stripping the single leading
          // apostrophe recovers the input verbatim.
          expect(result.slice(1)).toBe(value);
          expect(result.length).toBe(value.length + 1);
          // And the sanitized result no longer begins with a dangerous character.
          expect(startsDangerous(result)).toBe(false);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("is idempotent once sanitized (a leading apostrophe is never added twice)", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const once = sanitizeCsvCell(value);
        expect(sanitizeCsvCell(once)).toBe(once);
      }),
      { numRuns: RUNS },
    );
  });
});
