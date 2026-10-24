// Runs once when a Next.js server instance starts, before it handles requests.
// Halts startup if any required environment variable is missing (Requirement 1.5).
//
// Next compiles this file for both the Node.js and Edge runtimes. The startup
// check uses `process.exit`, which the Edge Runtime lacks, so the check lives
// in a separate module (`./lib/startup-env-check`) that is only dynamically
// imported in the Node.js runtime. Keeping `process.exit` out of this file
// means the Edge bundle never references it, so Next emits no "Node.js API
// used in the Edge Runtime" warning.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnvOrExit } = await import("./lib/startup-env-check");
  assertEnvOrExit();
}