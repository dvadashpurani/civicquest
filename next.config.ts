import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./lib/security/headers";

// Next loads .env* before evaluating this file. headers() is resolved at build
// time, so the Supabase origin in the CSP is fixed per build, the same way
// NEXT_PUBLIC_ values are inlined. See lib/security/headers.ts for the CSP
// tradeoffs ('unsafe-inline' vs nonces under cacheComponents).
const securityHeaders = buildSecurityHeaders({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  isDev: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  /* config options here */
  // Lets a device on the LAN (e.g. a phone) reach the dev server without a
  // cross-origin warning. Dev-only: Next ignores this in production builds.
  allowedDevOrigins: ["10.110.1.133"],
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
