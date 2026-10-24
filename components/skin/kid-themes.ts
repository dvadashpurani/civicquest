/**
 * Skins and kid themes from .kiro/steering/design.md (Requirements 7.2, 39).
 * Shared by SkinWrapper and, later, the kid theme picker's zod enum.
 */

export const SKINS = ["calm", "sticker"] as const;
export type Skin = (typeof SKINS)[number];

export const KID_THEMES = ["hero", "bubblegum", "ocean", "classic"] as const;
export type KidTheme = (typeof KID_THEMES)[number];

export const DEFAULT_KID_THEME: KidTheme = "classic";

/** Display labels for the theme picker. */
export const KID_THEME_LABELS: Record<KidTheme, string> = {
  hero: "Hero",
  bubblegum: "Bubblegum",
  ocean: "Ocean",
  classic: "Classic",
};

export function isKidTheme(value: unknown): value is KidTheme {
  return typeof value === "string" && (KID_THEMES as readonly string[]).includes(value);
}

/** A saved theme if it is one of the four, otherwise Classic (Requirement 39.4). */
export function resolveKidTheme(value: unknown): KidTheme {
  return isKidTheme(value) ? value : DEFAULT_KID_THEME;
}
