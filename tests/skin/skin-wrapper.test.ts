import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { DEFAULT_KID_THEME, KID_THEMES, isKidTheme, resolveKidTheme } from "@/components/skin/kid-themes";

const render = (props: Parameters<typeof SkinWrapper>[0]) =>
  renderToStaticMarkup(createElement(SkinWrapper, props));

describe("resolveKidTheme", () => {
  it("keeps each of the four themes", () => {
    for (const theme of KID_THEMES) expect(resolveKidTheme(theme)).toBe(theme);
  });

  it("falls back to Classic for missing or unknown values", () => {
    expect(DEFAULT_KID_THEME).toBe("classic");
    for (const value of [undefined, null, "", "Hero", "neon", 3]) expect(resolveKidTheme(value)).toBe("classic");
  });

  it("returns the input when valid and Classic otherwise, for any string", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constantFrom(...KID_THEMES), fc.string()), (value) => {
        expect(resolveKidTheme(value)).toBe(isKidTheme(value) ? value : "classic");
      }),
    );
  });
});

describe("SkinWrapper", () => {
  it("sets data-skin and the student's kid theme on sticker screens", () => {
    const html = render({ skin: "sticker", kidTheme: "ocean", children: "Hi" });
    expect(html).toContain('data-skin="sticker"');
    expect(html).toContain('data-kid-theme="ocean"');
    expect(html).toContain(">Hi</div>");
  });

  it("defaults sticker screens to the Classic theme", () => {
    expect(render({ skin: "sticker" })).toContain('data-kid-theme="classic"');
    expect(render({ skin: "sticker", kidTheme: "not-a-theme" })).toContain('data-kid-theme="classic"');
  });

  it("omits data-kid-theme on calm screens unless one is given", () => {
    const html = render({ skin: "calm", className: "p-4" });
    expect(html).toContain('data-skin="calm"');
    expect(html).not.toContain("data-kid-theme");
    expect(html).toContain('class="p-4"');
    expect(render({ skin: "calm", kidTheme: "hero" })).toContain('data-kid-theme="hero"');
  });
});
