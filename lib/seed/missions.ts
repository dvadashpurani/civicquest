// Parses docs/missions.md into the typed module and mission content the seed
// script writes to `modules` and `missions` (Requirement 17.1). The markdown is
// the single source of truth for the roadmap, so this parser reads it at seed
// time rather than duplicating 50 missions as a literal. It runs under `tsx`
// (via `npm run seed`), not inside Next, so it reads the file directly from
// disk with Node's `fs`. No `server-only` and no network: it is a pure
// transform of the committed markdown, and `parseMissions` is deterministic.
//
// The shapes mirror the `modules` and `missions` columns in
// supabase/migrations/0001_schema.sql: a module carries `title`, `level`,
// `quality`, and `week_order`; a mission carries `day_number`, `title`,
// `story`, `ask`, `instructions`, `points`, `verification`, `est_minutes`, and
// `town_item`. Proof phrases map to the `verification_type` enum
// (Requirements 17.2, 17.3), and any unmapped phrase or missing field halts
// with an error naming the offending value (design.md "Proof-type mapping").

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LEADER_POINTS, LEARNER_HELPER_POINTS } from "../domain/points";
import type { Level, Quality } from "../domain/types";

/**
 * The `verification_type` enum values in
 * supabase/migrations/0001_schema.sql. Only `class_activity` and `qr_checkin`
 * have built flows in this scope; `quiz` and `photo_review` exist for the
 * schema and future steps (design.md "Enums").
 */
export type Verification = "class_activity" | "quiz" | "photo_review" | "qr_checkin";

/**
 * One parsed mission, mirroring the writable columns of the `missions` table.
 * `dayNumber` is 1–5 within its module; `points` is the per-student award for
 * the module's level; `estMinutes` is the estimated class time.
 */
export type SeedMission = {
  /** Day within the module, 1–5 (`missions.day_number`). */
  readonly dayNumber: number;
  /** Mission title (`missions.title`). */
  readonly title: string;
  /** The opening story or case study (`missions.story`). */
  readonly story: string;
  /** The discussion question (`missions.ask`). */
  readonly ask: string;
  /** What the class does (`missions.instructions`). */
  readonly instructions: string;
  /** The proof type this mission accepts (`missions.verification`). */
  readonly verification: Verification;
  /** Per-student points for the module's level (`missions.points`). */
  readonly points: number;
  /** Estimated minutes for the activity (`missions.est_minutes`). */
  readonly estMinutes: number;
  /** The town building this mission places (`missions.town_item`). */
  readonly townItem: string;
};

/**
 * One parsed module (a week of five missions), mirroring the writable columns
 * of the `modules` table.
 */
export type SeedModule = {
  /** Module title, e.g. "Safe Streets" (`modules.title`). */
  readonly title: string;
  /** The level band this module belongs to (`modules.level`). */
  readonly level: Level;
  /** The civic value the module teaches (`modules.quality`). */
  readonly quality: Quality;
  /** 1-based order within the level (`modules.week_order`). */
  readonly weekOrder: number;
  /** The module's five missions, in `dayNumber` order. */
  readonly missions: readonly SeedMission[];
};

/** Expected module and mission counts (Requirement 17.1). */
export const EXPECTED_MODULE_COUNT = 10;
export const EXPECTED_MISSION_COUNT = 50;

/** Default estimated minutes when a mission does not state its own. */
const DEFAULT_EST_MINUTES = 10;

/** Path to the roadmap source, resolved from this module's location. */
const MISSIONS_MD_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/missions.md");

/**
 * Maps a level section heading to its {@link Level}. The headings in
 * docs/missions.md are "Learners, grades 2–5", "Helpers, grades 6–8", and
 * "Leaders, grades 9–12".
 */
const LEVEL_BY_HEADING: ReadonlyArray<readonly [RegExp, Level]> = [
  [/^Learners\b/i, "learners"],
  [/^Helpers\b/i, "helpers"],
  [/^Leaders\b/i, "leaders"],
];

/**
 * The six module qualities, keyed by the lowercase stamp label used in the
 * module heading `(stamp: ...)`. Mirrors the `Quality` union and the
 * `modules.quality` check constraint.
 */
const QUALITY_BY_STAMP: ReadonlyMap<string, Quality> = new Map([
  ["safety", "Safety"],
  ["kindness", "Kindness"],
  ["responsibility", "Responsibility"],
  ["respect", "Respect"],
  ["helping", "Helping"],
  ["civic action", "Civic action"],
]);

/**
 * Proof-phrase prefixes mapped to `verification_type` values (Requirements
 * 17.2, 17.3). A proof line is matched by the first prefix it starts with, so
 * the full sentences in docs/missions.md ("Teacher watched the class
 * activity", "Short quiz, checked by the app", "Photo of the place…",
 * "QR check-in and check-out…") resolve to the four enum values. "The other
 * class's teacher confirms" is a teacher-watched activity, so it maps to
 * `class_activity` as well (docs/missions.md "Verification mapping").
 */
const PROOF_PREFIXES: ReadonlyArray<readonly [string, Verification]> = [
  ["Teacher watched", "class_activity"],
  ["Short quiz", "quiz"],
  ["Photo", "photo_review"],
  ["QR check-in", "qr_checkin"],
  ["The other class", "class_activity"],
];

/**
 * Resolves a proof phrase to its {@link Verification}, or throws naming the
 * phrase when it matches none of the known prefixes (Requirement 17.3).
 */
function mapProof(phrase: string, context: string): Verification {
  for (const [prefix, verification] of PROOF_PREFIXES) {
    if (phrase.startsWith(prefix)) return verification;
  }
  throw new Error(`Unmapped proof phrase in ${context}: "${phrase}"`);
}

/** Per-student points for a module's level (10 for learners/helpers, 15 for leaders). */
function pointsForLevel(level: Level): number {
  return level === "leaders" ? LEADER_POINTS : LEARNER_HELPER_POINTS;
}

/** Returns the value of a `- Label: value` bullet, trimmed, or null if absent/empty. */
function fieldValue(lines: readonly string[], label: string): string | null {
  const prefix = `- ${label}:`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** Throws naming a missing or empty field, otherwise returns the value. */
function requireField(lines: readonly string[], label: string, context: string): string {
  const value = fieldValue(lines, label);
  if (value === null) {
    throw new Error(`Missing field "${label}" in ${context}`);
  }
  return value;
}

/**
 * Parses docs/missions.md into the 10 modules and 50 missions the seed writes
 * (Requirement 17.1). Reads the committed markdown from disk and returns the
 * typed content. Throws, naming the offending value, when a proof phrase is
 * unmapped (Requirement 17.3), a mission field is missing or empty
 * (Requirement 17.1), a quality stamp is unknown, or the parsed totals are not
 * exactly 10 modules and 50 missions.
 */
export function parseMissions(markdown: string = readMissionsMarkdown()): SeedModule[] {
  const lines = markdown.split(/\r?\n/);

  const modules: SeedModule[] = [];
  let currentLevel: Level | null = null;
  // Per-level week counter so `week_order` restarts at 1 for each level.
  let weekOrder = 0;

  // The lines of the module currently being accumulated, if any.
  let moduleTitle: string | null = null;
  let moduleQuality: Quality | null = null;
  let moduleWeekOrder = 0;
  let moduleLevel: Level | null = null;
  let missionBlocks: string[][] = [];
  let currentMission: string[] | null = null;

  const flushModule = () => {
    if (moduleTitle === null) return;
    if (moduleLevel === null || moduleQuality === null) {
      throw new Error(`Module "${moduleTitle}" is missing its level or quality`);
    }
    const missions = missionBlocks.map((block) =>
      parseMission(block, moduleLevel as Level, moduleTitle as string),
    );
    modules.push({
      title: moduleTitle,
      level: moduleLevel,
      quality: moduleQuality,
      weekOrder: moduleWeekOrder,
      missions,
    });
    moduleTitle = null;
    moduleQuality = null;
    moduleWeekOrder = 0;
    moduleLevel = null;
    missionBlocks = [];
    currentMission = null;
  };

  for (const line of lines) {
    const levelMatch = /^##\s+(.+)$/.exec(line);
    const moduleMatch = /^###\s+Week\s+(\d+):\s*(.+?)\s*\(stamp:\s*(.+?)\)\s*$/i.exec(line);
    const missionMatch = /^\*\*Day\s+(\d+)\b.*\*\*\s*$/.exec(line.trim());

    if (levelMatch) {
      flushModule();
      currentMission = null;
      const heading = levelMatch[1].trim();
      currentLevel = LEVEL_BY_HEADING.find(([re]) => re.test(heading))?.[1] ?? currentLevel;
      // A new level section resets the per-level week counter. Only the three
      // level headings reset it; any other `##` heading leaves it untouched.
      if (LEVEL_BY_HEADING.some(([re]) => re.test(heading))) {
        weekOrder = 0;
      }
      continue;
    }

    if (moduleMatch) {
      flushModule();
      const [, , rawTitle, rawStamp] = moduleMatch;
      const stampKey = rawStamp.trim().toLowerCase();
      const quality = QUALITY_BY_STAMP.get(stampKey);
      if (quality === undefined) {
        throw new Error(`Unknown stamp quality "${rawStamp.trim()}" for module "${rawTitle.trim()}"`);
      }
      if (currentLevel === null) {
        throw new Error(`Module "${rawTitle.trim()}" appears before any level heading`);
      }
      weekOrder += 1;
      moduleTitle = rawTitle.trim();
      moduleQuality = quality;
      moduleLevel = currentLevel;
      moduleWeekOrder = weekOrder;
      missionBlocks = [];
      currentMission = null;
      continue;
    }

    if (moduleTitle !== null && missionMatch) {
      currentMission = [line.trim()];
      missionBlocks.push(currentMission);
      continue;
    }

    if (currentMission !== null) {
      currentMission.push(line);
    }
  }

  flushModule();

  if (modules.length !== EXPECTED_MODULE_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_MODULE_COUNT} modules in docs/missions.md but parsed ${modules.length}`,
    );
  }
  const missionCount = modules.reduce((sum, module) => sum + module.missions.length, 0);
  if (missionCount !== EXPECTED_MISSION_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_MISSION_COUNT} missions in docs/missions.md but parsed ${missionCount}`,
    );
  }

  return modules;
}

/**
 * Parses one `**Day N (...)** ...` mission block into a {@link SeedMission}.
 * `block[0]` is the heading line; the rest are the `- Label: value` bullets.
 */
function parseMission(block: readonly string[], level: Level, moduleTitle: string): SeedMission {
  const heading = block[0];
  const headingMatch = /^\*\*Day\s+(\d+)\b[^:]*:\s*(.+?)\s*\*\*$/.exec(heading);
  if (headingMatch === null) {
    throw new Error(`Malformed mission heading in module "${moduleTitle}": ${heading}`);
  }
  const dayNumber = Number(headingMatch[1]);
  const title = headingMatch[2].trim();
  const context = `module "${moduleTitle}", day ${dayNumber} ("${title}")`;

  if (title.length === 0) {
    throw new Error(`Missing field "title" in ${context}`);
  }

  const body = block.slice(1);
  const story = requireField(body, "Story", context);
  const ask = requireField(body, "Discussion question", context);
  const instructions = requireField(body, "Students do", context);
  const proof = requireField(body, "Proof", context);
  const townItem = requireField(body, "Town building", context);

  return {
    dayNumber,
    title,
    story,
    ask,
    instructions,
    verification: mapProof(proof, context),
    points: pointsForLevel(level),
    estMinutes: DEFAULT_EST_MINUTES,
    townItem,
  };
}

/** Reads the committed docs/missions.md from disk as UTF-8. */
export function readMissionsMarkdown(): string {
  return readFileSync(MISSIONS_MD_PATH, "utf8");
}
