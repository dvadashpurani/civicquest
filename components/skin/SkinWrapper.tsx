import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { resolveKidTheme, type KidTheme, type Skin } from "./kid-themes";

type SkinWrapperProps = Omit<ComponentPropsWithoutRef<"div">, "data-skin" | "data-kid-theme"> & {
  /** "calm" for adult screens, "sticker" for kid-facing and projector screens. */
  skin: Skin;
  /**
   * The student's saved theme (may be raw from the database). Sticker screens always get a
   * theme, defaulting to Classic; calm screens only get one when it is set and valid.
   */
  kidTheme?: KidTheme | string | null;
};

/**
 * Layout wrapper that selects the skin with `data-skin` and the kid theme with
 * `data-kid-theme`. All colours, fonts, and shapes come from CSS variables in
 * app/globals.css, so this is a plain server component.
 */
export function SkinWrapper({ skin, kidTheme, className, children, ...props }: SkinWrapperProps) {
  const theme =
    skin === "sticker" || kidTheme != null ? resolveKidTheme(kidTheme) : undefined;

  return (
    <div
      {...props}
      data-skin={skin}
      data-kid-theme={theme}
      className={cn(skin === "sticker" && "min-h-full", className)}
    >
      {children}
    </div>
  );
}
