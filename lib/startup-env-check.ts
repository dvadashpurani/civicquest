// Node.js-only startup helper. Isolated from instrumentation.ts so that
// `process.exit` never appears in the module graph Next compiles for the Edge
// Runtime (which has no `process.exit`). instrumentation.ts imports this only
// when `process.env.NEXT_RUNTIME === "nodejs"`.

import { assertEnv, MissingEnvError } from "./env";

/**
 * Validates the environment and halts the Node.js server if a required
 * variable is missing. Logs variable names only, never their values.
 */
export function assertEnvOrExit(): void {
  try {
    assertEnv();
  } catch (err) {
    if (err instanceof MissingEnvError) {
      console.error(`\n[civicquest] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}