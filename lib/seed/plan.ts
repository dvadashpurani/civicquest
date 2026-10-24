// The demo content plan: the fixed shape of the seeded school, classes,
// teachers, rewards, partners, and opportunities (Requirements 16.3, 16.5,
// 16.6, 16.7). This module is pure data — no I/O, no Supabase, no Node APIs —
// so `lib/seed/run.ts` (core insert), `lib/seed/accounts.ts` (demo logins,
// task 5.4), and `lib/seed/history.ts` (two weeks of history, task 5.5) all
// read the same single source of truth. Keeping the plan declarative means the
// demo-reset flow can replay exactly what the seed created.
//
// The shapes mirror the writable columns of supabase/migrations/0001_schema.sql
// (`schools`, `classes`, `class_rewards`, `students`, `partner_orgs`,
// `school_partners`, `opportunities`). Per-student fields are limited to first
// name, last initial, grade, class, and avatar — no other PII ever
// (Requirements 16.5, 37.1).

import type { Level } from "../domain/types";

/** The one demo school (Requirement 16.3). */
export const SCHOOL_NAME = "Maple Street School";

/**
 * A stable key naming each demo class, used to join students, teachers, rewards
 * and (later) demo accounts and history to a class without hard-coding uuids.
 */
export type ClassKey = "grade3" | "grade4" | "grade7" | "grade10" | "grade11";

/**
 * One class in the plan. `name` is the stored `classes.name`; `teacherName`
 * is the display name of the teacher who will own it (the matching login is
 * created by task 5.4, which sets `classes.teacher_id`). `moduleTitle` names
 * the module this class is working through, and `startDay` is the mission day
 * the class sits on at seed time (Requirement 16.3; history, task 5.5).
 */
export type PlanClass = {
  readonly key: ClassKey;
  readonly name: string;
  readonly grade: number;
  readonly level: Level;
  readonly teacherName: string;
  readonly studentCount: number;
  /** The module title this class is assigned (matched against parsed modules). */
  readonly moduleTitle: string;
  /** The current mission day (1-based) the class is on at seed time. */
  readonly startDay: number;
};

/**
 * The five demo classes (Requirement 16.3): Grade 3 (Ms. Rivera, 24, Safe
 * Streets day 1), Grade 7 (Mr. Chen, 22, Respect Everywhere day 2), Grade 11
 * Advisory (Ms. Okafor, 20, Civics Project day 3), plus a Grade 4 and a Grade
 * 10 class for a fuller leaderboard.
 */
export const PLAN_CLASSES: readonly PlanClass[] = [
  {
    key: "grade3",
    name: "Grade 3",
    grade: 3,
    level: "learners",
    teacherName: "Ms. Rivera",
    studentCount: 24,
    moduleTitle: "Safe Streets",
    startDay: 1,
  },
  {
    key: "grade4",
    name: "Grade 4",
    grade: 4,
    level: "learners",
    teacherName: "Ms. Patel",
    studentCount: 23,
    moduleTitle: "Safe Streets",
    startDay: 1,
  },
  {
    key: "grade7",
    name: "Grade 7",
    grade: 7,
    level: "helpers",
    teacherName: "Mr. Chen",
    studentCount: 22,
    moduleTitle: "Respect Everywhere",
    startDay: 2,
  },
  {
    key: "grade10",
    name: "Grade 10",
    grade: 10,
    level: "leaders",
    teacherName: "Mr. Davis",
    studentCount: 21,
    moduleTitle: "Civics Project",
    startDay: 1,
  },
  {
    key: "grade11",
    name: "Grade 11 Advisory",
    grade: 11,
    level: "leaders",
    teacherName: "Ms. Okafor",
    studentCount: 20,
    moduleTitle: "Civics Project",
    startDay: 3,
  },
];

/**
 * The avatar rotation used for seeded students. Kept as a local literal rather
 * than imported from `components/Icon.tsx` so the seed (run under `tsx`, not
 * Next) never pulls a React client module into Node. Every value is a valid
 * `students.avatar` animal (the schema default is `fox`).
 */
export const SEED_AVATARS: readonly string[] = [
  "fox", "panda", "turtle", "owl", "frog", "tiger", "koala", "rabbit",
  "octopus", "lion", "penguin", "bear", "unicorn", "bee", "whale", "giraffe",
  "ladybug", "dog", "cat", "hamster", "hedgehog", "dolphin", "butterfly", "cow",
];

/**
 * A short, varied pool of first names used to generate roster rows. Each
 * student stores only a first name, a single last initial, grade, class, and
 * avatar (Requirements 16.5, 37.1); nothing here identifies a real child.
 */
export const SEED_FIRST_NAMES: readonly string[] = [
  "Ava", "Liam", "Mia", "Noah", "Zoe", "Ethan", "Lily", "Lucas",
  "Sofia", "Mason", "Emma", "Oliver", "Isla", "Leo", "Nora", "Kai",
  "Maya", "Eli", "Ruby", "Owen", "Ivy", "Jude", "Clara", "Finn",
  "Luna", "Theo", "Ella", "Max", "Aria", "Sam",
];

/** The last initials cycled through for seeded students (single character). */
export const SEED_LAST_INITIALS: readonly string[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "K", "L",
  "M", "N", "P", "R", "S", "T", "V", "W",
];

/**
 * The demo Leader who gets the one Grade 11 login (task 5.4). Kept here so the
 * core seed creates this student deterministically and the accounts step can
 * find her by name without guessing.
 */
export const DEMO_LEADER = { firstName: "Jordan", lastInitial: "M", grade: 11 } as const;

/** One default reward per class stage (Requirement 16.6). */
export type PlanReward = { readonly stage: "village" | "town" | "city"; readonly reward: string };

/**
 * The default rewards seeded for every class (Requirement 16.6). At least one
 * reward per class; we seed all three stages so the rewards list renders fully.
 */
export const PLAN_REWARDS: readonly PlanReward[] = [
  { stage: "village", reward: "Extra recess on Friday" },
  { stage: "town", reward: "Class movie afternoon" },
  { stage: "city", reward: "Pizza party" },
];

/** One opportunity in the plan, with a start offset in days from the seed date. */
export type PlanOpportunity = {
  readonly title: string;
  readonly description: string;
  readonly locationName: string;
  /** Days after the seed date the opportunity starts (0–14, Requirement 16.7). */
  readonly startInDays: number;
  /** Duration in hours from start to end. */
  readonly durationHours: number;
  readonly minGrade: number;
  readonly capacity: number | null;
};

/** One partner org in the plan, school-linked, with exactly two opportunities. */
export type PlanPartner = {
  readonly name: string;
  readonly kind: string;
  readonly city: string;
  /** Supervisor display name (used by the demo partner account, task 5.4). */
  readonly supervisorName: string;
  readonly opportunities: readonly [PlanOpportunity, PlanOpportunity];
};

/**
 * The two demo partners (Requirement 16.7): Greater Community Food Bank
 * (supervisor Dana K.) and Riverside Park Friends, each linked to Maple Street
 * School, each with exactly two opportunities starting within 14 days of the
 * seed date.
 */
export const PLAN_PARTNERS: readonly PlanPartner[] = [
  {
    name: "Greater Community Food Bank",
    kind: "food_bank",
    city: "Riverside",
    supervisorName: "Dana K.",
    opportunities: [
      {
        title: "Weekend food sorting",
        description: "Help sort and shelve donated food for neighborhood families.",
        locationName: "Greater Community Food Bank warehouse",
        startInDays: 3,
        durationHours: 2,
        minGrade: 9,
        capacity: 12,
      },
      {
        title: "Pantry restock drive",
        description: "Pack weekend meal bags and restock the community pantry.",
        locationName: "Greater Community Food Bank pantry",
        startInDays: 10,
        durationHours: 3,
        minGrade: 9,
        capacity: 16,
      },
    ],
  },
  {
    name: "Riverside Park Friends",
    kind: "parks",
    city: "Riverside",
    supervisorName: "Priya S.",
    opportunities: [
      {
        title: "Park clean-up morning",
        description: "Clear litter and tidy the trails along the riverside path.",
        locationName: "Riverside Park main entrance",
        startInDays: 5,
        durationHours: 2,
        minGrade: 9,
        capacity: 20,
      },
      {
        title: "Community garden planting",
        description: "Plant seasonal vegetables in the shared community garden beds.",
        locationName: "Riverside Park community garden",
        startInDays: 12,
        durationHours: 2,
        minGrade: 9,
        capacity: 15,
      },
    ],
  },
];
