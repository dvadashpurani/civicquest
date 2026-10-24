import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Mirror the "@/*" path alias from tsconfig.json.
      { find: "@", replacement: fileURLToPath(new URL("./", import.meta.url)) },
      // Tests run outside Next's server layer; stub `server-only` the way
      // Next's own Jest preset does so server modules can be unit tested.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    // Step 1 has no tests yet; later steps add the domain property tests.
    passWithNoTests: true,
  },
});
