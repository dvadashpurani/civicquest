import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KID_THEMES } from "@/components/skin/kid-themes";

// Parity between .kiro/steering/design.md and app/globals.css (Requirement 7.1): every token
// value in the steering doc must appear, unchanged, in the matching CSS block.

const root = process.cwd();
const steering = readFileSync(join(root, ".kiro/steering/design.md"), "utf8");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

/** Custom properties declared in the first block whose selector line is exactly `selector {`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const indented = css.indexOf(`\n  ${selector} {`);
  const at = start >= 0 ? start : indented;
  if (at < 0) throw new Error(`No CSS block for ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}

const norm = (v: string | undefined) => v?.toUpperCase();

const calmRows = [...steering.matchAll(/^\| `(--[a-z-]+)` \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \|$/gim)].map(
  (m) => ({ token: m[1], light: m[2], dark: m[3] }),
);

const kidTokens = [...steering.matchAll(/`(--kid-[a-z]+)` `(#[0-9A-F]{6})`/gi)].map((m) => ({
  token: m[1],
  value: m[2],
}));

const themeRows = [
  ...steering.matchAll(/^\| (Hero|Bubblegum|Ocean|Classic)[^|]* \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \| `(#[0-9A-F]{6})` \|$/gim),
].map((m) => ({ theme: m[1].toLowerCase(), primary: m[2], secondary: m[3], highlight: m[4] }));

describe("design tokens match the steering doc", () => {
  it("parses the steering tables", () => {
    expect(calmRows).toHaveLength(9);
    expect(kidTokens.map((t) => t.token).sort()).toEqual(["--kid-bg", "--kid-ink", "--kid-soft", "--kid-surface"]);
    expect(themeRows.map((t) => t.theme).sort()).toEqual([...KID_THEMES].sort());
  });

  it("defines calm light values on :root", () => {
    const light = declarations(":root");
    for (const { token, light: value } of calmRows) expect(norm(light[token]), token).toBe(value);
  });

  it("defines calm dark values for both the OS preference and the forced dark theme", () => {
    const osDark = declarations(':root:not([data-theme="light"])');
    const forcedDark = declarations(':root[data-theme="dark"]');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
    for (const { token, dark } of calmRows) {
      expect(norm(osDark[token]), token).toBe(dark);
      expect(norm(forcedDark[token]), token).toBe(dark);
    }
  });

  it("keeps kid tokens light in every mode", () => {
    const light = declarations(":root");
    const dark = { ...declarations(':root:not([data-theme="light"])'), ...declarations(':root[data-theme="dark"]') };
    for (const { token, value } of kidTokens) {
      expect(norm(light[token]), token).toBe(value);
      expect(dark[token], `${token} must not change in dark mode`).toBeUndefined();
    }
    // The dot grid colour is given in prose rather than as a token pair.
    expect(norm(light["--kid-dot"])).toBe("#D3EFEA");
  });

  it("defines the four kid themes under data-kid-theme, Classic by default", () => {
    const light = declarations(":root");
    for (const { theme, primary, secondary, highlight } of themeRows) {
      const block = declarations(`[data-kid-theme="${theme}"]`);
      expect(norm(block["--kid-primary"]), theme).toBe(primary);
      expect(norm(block["--kid-secondary"]), theme).toBe(secondary);
      expect(norm(block["--kid-highlight"]), theme).toBe(highlight);
      if (theme === "classic") {
        expect(norm(light["--kid-primary"])).toBe(primary);
        expect(norm(light["--kid-secondary"])).toBe(secondary);
        expect(norm(light["--kid-highlight"])).toBe(highlight);
      }
    }
    expect(norm(light["--kid-on-primary"])).toBe("#FFFFFF");
    expect(norm(light["--kid-on-secondary"])).toBe("#FFFFFF");
    expect(norm(light["--kid-on-highlight"])).toBe("#22223B");
  });

  it("has no self-referential font variables", () => {
    expect(css).not.toMatch(/--font-sans:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/--font-heading:\s*var\(--font-heading\)/);
  });
});
