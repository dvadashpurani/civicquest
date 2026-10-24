// Security response headers for every route (Requirements 6.1, 6.2).
//
// Pure and dependency-free so `next.config.ts` can import it at config time
// and unit tests can check it directly.
//
// CSP tradeoff on `script-src` (read before tightening or loosening):
// The App Router streams its RSC payload through inline `<script>` tags
// (`self.__next_f.push(...)`), so a bare `script-src 'self'` blocks hydration
// in production. The two ways around that are:
//   1. A per-request nonce set in proxy/middleware. Next only applies nonces to
//      dynamically rendered pages, and its docs state Partial Prerendering is
//      incompatible with nonces. This app enables `cacheComponents` (PPR), so
//      nonces would break the static shells.
//   2. `'unsafe-inline'` in a static header from `next.config`.
// We use option 2: script *files* load only from the app origin (no third-party
// script host is allowed), and inline scripts are permitted. The XSS backstop is
// React's output escaping plus the security.md rule that raw HTML injection is
// never used with user data. `'unsafe-eval'` is added only in
// development, where React uses eval to rebuild server error stacks; production
// never gets it. Experimental SRI hashes only cover script files, not the inline
// RSC scripts, so it does not remove the need for `'unsafe-inline'`.
//
// `'wasm-unsafe-eval'` permits compiling WebAssembly only (not JS eval). The QR
// scanner falls back to a zxing WASM decoder on browsers without a native
// BarcodeDetector; that WASM file must be served from the app origin, because
// `connect-src` does not allow its default CDN.

export type SecurityHeader = { key: string; value: string };

export type SecurityHeaderOptions = {
  /** `NEXT_PUBLIC_SUPABASE_URL`; may be missing or malformed. */
  supabaseUrl: string | undefined;
  /** True only for `next dev`. */
  isDev: boolean;
};

/** Google Fonts hosts. `next/font/google` self-hosts at build, so these are a fallback. */
export const GOOGLE_FONTS_STYLESHEET_ORIGIN = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_FILE_ORIGIN = "https://fonts.gstatic.com";

/**
 * The bare origin (scheme://host[:port]) of the Supabase URL, or null when the
 * value is missing, unparsable, or not http(s). Returning null fails closed: the
 * CSP then allows no Supabase host at all rather than a wildcard. The server's
 * startup check (instrumentation.ts) halts when the variable is missing.
 */
export function supabaseOriginFrom(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Builds the Content-Security-Policy value. */
export function buildContentSecurityPolicy({
  supabaseUrl,
  isDev,
}: SecurityHeaderOptions): string {
  const supabase = supabaseOriginFrom(supabaseUrl);
  const supabaseSources = supabase ? [supabase] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Inline styles come from Next, React style props, and the motion library.
    "style-src": ["'self'", "'unsafe-inline'", GOOGLE_FONTS_STYLESHEET_ORIGIN],
    "font-src": ["'self'", GOOGLE_FONTS_FILE_ORIGIN],
    // Supabase Storage is served from the project origin (`/storage/v1/...`),
    // so signed photo URLs match it. blob:/data: are browser-local images
    // (EXIF-stripped canvas previews, inline SVG/placeholder data), not hosts.
    "img-src": ["'self'", "blob:", "data:", ...supabaseSources],
    // 'self' is required for the app's own RSC navigation fetches, server
    // actions, and (in dev) the HMR websocket. The only other host is the
    // Supabase https origin. No wss:// for Supabase Realtime: the app polls
    // and opens no Realtime channels, so the socket stays blocked.
    "connect-src": ["'self'", ...supabaseSources],
    // The QR scanner plays its scan beep from a data: audio URL.
    "media-src": ["'self'", "data:"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([name, sources]) => `${name} ${sources.join(" ")}`,
  );
  // Local Supabase runs on plain http; upgrading would break dev connections.
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Every security header the app sends, in a stable order. */
export function buildSecurityHeaders(options: SecurityHeaderOptions): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(self), microphone=(), geolocation=()",
    },
  ];
}
