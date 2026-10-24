import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require";
import {
  getOwnedClass,
  getClassMission,
  getClassRoster,
} from "@/lib/server/teacher";
import { gradeToLevel } from "@/lib/domain/levels";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { MissionRun, type RunRosterStudent } from "./MissionRun";

// The three-step mission run screen — `/teacher/class/[id]/run/[missionId]`
// (Requirement 19). A projector-sized, one-step-at-a-time flow: Story, Mission,
// then Who-took-part. This server component does the security and loading; the
// `<MissionRun>` client component owns the step state and the roster selection.
//
// Access control (Requirements 18.5, 19.1, 32.1):
//   * `requireRole('teacher')` — any non-teacher is redirected to their own
//     role home before any data loads.
//   * Ownership — the class and mission are read through the request-scoped
//     server client under RLS, which limits `classes`/`class_modules` to the
//     owning teacher. A non-owner (or an unknown id) gets `null`, which we turn
//     into a 404 (`notFound`), so one teacher can never open another's class.
//
// Under `cacheComponents`, auth reads cookies and the route reads params, both
// dynamic. They live in a <Suspense>-wrapped async child so the shell can
// stream while identity and data resolve (matching app/(public)/login/page.tsx).

export const metadata: Metadata = {
  title: "Run mission · CivicQuest",
};

/**
 * Loads the signed-in teacher, verifies they own the class, loads the mission
 * (constrained to the class's assigned module) and the roster, then renders the
 * interactive run screen. A missing class or mission is a 404; a roster that
 * fails to load is passed as `null` so the Who-took-part step shows an error
 * and blocks confirmation (Requirement 19.5).
 */
async function MissionRunLoader({
  params,
}: {
  params: Promise<{ id: string; missionId: string }>;
}) {
  await requireRole("teacher");
  const { id: classId, missionId } = await params;

  // Ownership and mission membership both run under RLS; a non-owner sees
  // neither and we 404 rather than leak that the class exists.
  const [owned, mission] = await Promise.all([
    getOwnedClass(classId),
    getClassMission(classId, missionId),
  ]);
  if (!owned || !mission) notFound();

  // The roster load can fail independently (Requirement 19.5). `getClassRoster`
  // returns [] on error, so we distinguish a true load failure by catching a
  // thrown error and passing `null`; an empty class simply has an empty roster.
  let roster: readonly RunRosterStudent[] | null;
  try {
    const rows = await getClassRoster(classId);
    roster = rows.map((student) => ({
      id: student.id,
      firstName: student.firstName,
      lastInitial: student.lastInitial,
      avatar: student.avatar,
    }));
  } catch {
    roster = null;
  }

  // Learners (grades 2–5) get Pip's comic on the Story step (Requirement 19.2).
  const level = gradeToLevel(owned.grade);
  const showPip = level === "learners";

  return (
    <MissionRun
      mission={{
        id: mission.id,
        classId: owned.id,
        className: owned.name,
        grade: owned.grade,
        dayNumber: mission.dayNumber,
        title: mission.title,
        quality: mission.quality,
        townItem: mission.townItem,
        story: mission.story,
        ask: mission.ask,
        instructions: mission.instructions,
      }}
      roster={roster}
      showPip={showPip}
    />
  );
}

export default function MissionRunPage({
  params,
}: {
  params: Promise<{ id: string; missionId: string }>;
}) {
  return (
    <Suspense
      fallback={
        <SkinWrapper skin="sticker" className="min-h-dvh">
          <main className="mx-auto w-full max-w-5xl px-4 py-12">
            <p className="text-lg text-kid-muted">Loading today&rsquo;s mission…</p>
          </main>
        </SkinWrapper>
      }
    >
      <MissionRunLoader params={params} />
    </Suspense>
  );
}
