// The demo-account step of the seed (Requirements 16.4, 17.4, 17.6, 37.3),
// wired into `lib/seed/run.ts` through the `seedAccounts` hook on
// {@link SeedHooks}. It runs after the core content exists and receives the
// {@link SeedResult}, so it can claim ownership of classes and attach the one
// Leader login to the student the core seed already created.
//
// Gating lives here, not in `run.ts`: that module is deliberately env-free and
// I/O-free so both the CLI and the demo-reset flow reuse it unchanged. This
// module reads `isDemoMode()` (the same server-side `DEMO_MODE === "true"`
// check the reset path uses) and seeds nothing unless demo mode is exactly on
// (Requirement 17.6, design.md "Demo accounts"). The seed runs under
// `tsx --conditions=react-server`, so the `server-only` import chain behind
// `lib/env.ts` resolves outside Next.
//
// Exactly seven accounts are created (admin, teacher3, teacher7, teacher11,
// counselor, partner, leader), each with password `demo1234` and a matching
// `profiles` row. Only the demo Leader Jordan M. (grade 11) gets a student
// login; no other student does (Requirements 16.4, 17.4, 37.3). The three
// teacher accounts claim ownership of their classes by setting
// `classes.teacher_id`: Grade 3 → Ms. Rivera, Grade 7 → Mr. Chen, Grade 11
// Advisory → Ms. Okafor.

import type { SupabaseClient } from "@supabase/supabase-js";

import { isDemoMode } from "@/lib/env";
import { DEMO_LEADER } from "./plan";
import type { SeedResult, SeededStudent } from "./run";

/** The shared password for every demo account (Requirement 17.4). */
const DEMO_PASSWORD = "demo1234";

/** The email domain the demo logins use (matches the "Try the demo" buttons). */
const DEMO_EMAIL_DOMAIN = "demo.civicquest.app";

/**
 * One demo account to create. `role` is the `profiles.role`; `email` is the
 * local part prepended to the demo domain. `ownsTeacherName`, when set, names
 * the teacher whose classes this account takes ownership of (teacher accounts
 * only). `isLeader` marks the single account linked to a seeded student.
 */
type DemoAccount = {
  readonly local: string;
  readonly role: "admin" | "teacher" | "counselor" | "partner" | "student";
  readonly fullName: string;
  /** Plan `teacherName` whose classes this account owns, or null. */
  readonly ownsTeacherName: string | null;
  /** True for the one Leader login, linked to Jordan M. (grade 11). */
  readonly isLeader: boolean;
};

/**
 * The exactly seven demo accounts (Requirements 17.4, 16.4). The three teacher
 * accounts map to the plan's teacher names so they claim the right classes
 * (Grade 3 → Ms. Rivera, Grade 7 → Mr. Chen, Grade 11 Advisory → Ms. Okafor).
 * The leader is linked to Jordan M.; the counselor and partner own no classes
 * and get no student link.
 */
const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { local: "admin", role: "admin", fullName: "Demo Admin", ownsTeacherName: null, isLeader: false },
  { local: "teacher3", role: "teacher", fullName: "Ms. Rivera", ownsTeacherName: "Ms. Rivera", isLeader: false },
  { local: "teacher7", role: "teacher", fullName: "Mr. Chen", ownsTeacherName: "Mr. Chen", isLeader: false },
  { local: "teacher11", role: "teacher", fullName: "Ms. Okafor", ownsTeacherName: "Ms. Okafor", isLeader: false },
  { local: "counselor", role: "counselor", fullName: "Demo Counselor", ownsTeacherName: null, isLeader: false },
  { local: "partner", role: "partner", fullName: "Dana K.", ownsTeacherName: null, isLeader: false },
  { local: "leader", role: "student", fullName: "Jordan M.", ownsTeacherName: null, isLeader: true },
];

/** Throws with a readable message when a Supabase write returns an error. */
function assertOk(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`Seed failed while ${context}: ${error.message}`);
  }
}

/**
 * Creates one Supabase auth user with the demo password and returns its id.
 * `email_confirm` is set so the account can sign in immediately without a
 * confirmation step.
 */
async function createAuthUser(
  supabase: SupabaseClient,
  account: DemoAccount,
): Promise<string> {
  const email = `${account.local}@${DEMO_EMAIL_DOMAIN}`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  assertOk(error, `creating the "${account.local}" demo login`);
  const userId = data?.user?.id;
  if (!userId) {
    throw new Error(`Seed failed while creating the "${account.local}" demo login: no user returned`);
  }
  return userId;
}

/**
 * Finds the demo Leader Jordan M. among the seeded students. The core seed
 * places her first in Grade 11 Advisory (see `buildStudentRows` in run.ts), so
 * only that one student is ever eligible for a login (Requirements 16.4, 37.3).
 */
function findDemoLeader(result: SeedResult): SeededStudent {
  for (const seededClass of result.classes) {
    if (seededClass.plan.key !== "grade11") continue;
    const leader = seededClass.students.find(
      (student) =>
        student.firstName === DEMO_LEADER.firstName &&
        student.lastInitial === DEMO_LEADER.lastInitial &&
        student.grade === DEMO_LEADER.grade,
    );
    if (leader) return leader;
  }
  throw new Error(
    `Seed failed: could not find the demo Leader ${DEMO_LEADER.firstName} ${DEMO_LEADER.lastInitial}. in Grade 11 Advisory`,
  );
}

/**
 * Seeds the seven demo accounts when `DEMO_MODE` is exactly `true`, and seeds
 * nothing otherwise (Requirement 17.6). Supplied to {@link runSeed} as the
 * `seedAccounts` hook; it receives the already-built admin client and the
 * {@link SeedResult} so it can attach to the rows the core seed created.
 *
 * For each account it creates an auth user (password `demo1234`) and a matching
 * `profiles` row. Teacher accounts then claim their classes by setting
 * `classes.teacher_id`, and the Leader account is linked to Jordan M. by
 * setting `students.auth_user_id` (Requirements 16.4, 17.4, 37.3).
 */
export async function seedAccounts(
  supabase: SupabaseClient,
  result: SeedResult,
): Promise<void> {
  // Requirement 17.6: no demo accounts unless DEMO_MODE is exactly "true".
  if (!isDemoMode()) return;

  const leaderStudent = findDemoLeader(result);

  for (const account of DEMO_ACCOUNTS) {
    const userId = await createAuthUser(supabase, account);

    // Partner accounts carry no school; teacher/admin/counselor/student do.
    // The partner demo login is scoped to its org, not a school.
    const isPartner = account.role === "partner";
    assertOk(
      (
        await supabase.from("profiles").insert({
          id: userId,
          role: account.role,
          full_name: account.fullName,
          school_id: isPartner ? null : result.schoolId,
          partner_org_id: null,
        })
      ).error,
      `creating the profile for "${account.local}"`,
    );

    // Teacher accounts take ownership of every class their plan teacher runs.
    if (account.ownsTeacherName !== null) {
      const ownedClassIds = result.classes
        .filter((seededClass) => seededClass.plan.teacherName === account.ownsTeacherName)
        .map((seededClass) => seededClass.id);

      for (const classId of ownedClassIds) {
        assertOk(
          (
            await supabase
              .from("classes")
              .update({ teacher_id: userId })
              .eq("id", classId)
          ).error,
          `assigning "${account.local}" to class ${classId}`,
        );
      }
    }

    // The one Leader login is attached to Jordan M.; no other student gets one.
    if (account.isLeader) {
      assertOk(
        (
          await supabase
            .from("students")
            .update({ auth_user_id: userId })
            .eq("id", leaderStudent.id)
        ).error,
        `linking the Leader login to ${DEMO_LEADER.firstName} ${DEMO_LEADER.lastInitial}.`,
      );
    }
  }
}
