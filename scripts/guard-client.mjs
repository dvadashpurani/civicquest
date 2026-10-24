import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const roots = ["app", "components", "lib"];
const clientRules = [
  [/lib\/supabase\/admin/, "imports the admin Supabase client"],
  [/SUPABASE_SERVICE_ROLE_KEY/, "references the service role key"],
  [/import\s+["']server-only["']/, "imports server-only code"],
];
const anyRules = [
  [/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/, "exposes the service role key with NEXT_PUBLIC_"],
  [/dangerouslySetInnerHTML/, "uses dangerouslySetInnerHTML"],
];

const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    if (![".ts", ".tsx"].includes(extname(path))) continue;
    const src = readFileSync(path, "utf8");
    const isClient = /^\s*["']use client["']/m.test(src.slice(0, 300));
    for (const [re, msg] of anyRules) if (re.test(src)) problems.push(`${path}: ${msg}`);
    if (isClient) for (const [re, msg] of clientRules) if (re.test(src)) problems.push(`${path}: client file ${msg}`);
  }
}
for (const r of roots) if (existsSync(r)) walk(r);

if (problems.length) {
  console.error("Security guard found problems:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("Security guard: no problems found.");