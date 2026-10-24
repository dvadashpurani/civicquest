// CSV cell sanitizing (Requirement 13). Pure, so it runs wherever an export is
// built and in Vitest. The goal is formula injection: a spreadsheet treats a
// cell starting with `=`, `+`, `-`, `@`, tab, or carriage return as a formula,
// so any such cell is forced back to literal text with one leading apostrophe.

/** First characters a spreadsheet would interpret as the start of a formula. */
const DANGEROUS_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Returns a CSV-safe version of `value` for export. If the first character is
 * `=`, `+`, `-`, `@`, tab, or carriage return, the value is prefixed with a
 * single apostrophe and every other character is left unchanged; otherwise the
 * value is returned as-is. The empty string has no first character, so it is
 * returned unchanged.
 */
export function sanitizeCsvCell(value: string): string {
  if (value.length > 0 && DANGEROUS_PREFIXES.has(value[0])) {
    return `'${value}`;
  }
  return value;
}
