// Safe redirect path validation (Requirement 14). Pure, so it runs in server
// actions, middleware, and Vitest alike. The goal is open-redirect prevention:
// a post-login `next` target must be a local, relative path, never an external
// origin or a crafted destination. Anything that is not a plain relative
// single-slash path falls back to the safe default `/` (design.md "Domain
// Layer", Requirements 6.12, 6.13, 14).

/** The safe default returned whenever a candidate path is rejected. */
const SAFE_DEFAULT = "/";

/**
 * Validates a post-login redirect target and returns a safe path.
 *
 * The path is accepted and returned unchanged only when it begins with exactly
 * one `/` that is not immediately followed by `/` or `\` (so `//evil.com` and
 * `/\evil.com`, which browsers treat as protocol-relative external origins, are
 * rejected), contains no URL scheme, contains no control characters, and has no
 * leading or trailing whitespace. Every other input — the empty string, a path
 * with no leading `/`, `//…`, `/\…`, a scheme such as `javascript:` or
 * `https:`, control characters, or surrounding whitespace — is rejected and the
 * safe default `/` is returned instead (Requirements 14.2, 14.3).
 *
 * A URL scheme is covered by the leading-`/` requirement: `javascript:…` and
 * `https://…` do not begin with `/`, so they are rejected before any
 * scheme-specific check is needed.
 */
export function safeRedirectPath(path: string): string {
  // Reject surrounding whitespace outright rather than trimming it: the caller
  // asked to redirect to this exact string, and a trimmed result could hide a
  // crafted target. (A path with no leading `/` after trimming would fail the
  // prefix check anyway, but leading whitespace before a `/` must still fail.)
  if (path !== path.trim()) {
    return SAFE_DEFAULT;
  }

  // Must start with exactly one `/` not followed by `/` or `\`. This rejects
  // the empty string, any path lacking a leading `/`, and the protocol-relative
  // forms `//` and `/\` in a single check.
  if (path.length < 2 || path[0] !== "/" || path[1] === "/" || path[1] === "\\") {
    return SAFE_DEFAULT;
  }

  // Reject any control character (C0 range plus DEL and the C1 range). These
  // can smuggle line breaks or terminators past naive checks, and a legitimate
  // relative path never contains them.
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return SAFE_DEFAULT;
    }
  }

  return path;
}
