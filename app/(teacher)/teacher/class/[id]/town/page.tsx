import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { TownGrid } from "@/components/town/TownGrid";
import { BuildLegend, ClassEarns, nextStageText, stageName } from "@/components/town/ClassEarns";
import { requireRole } from "@/lib/auth/require";
import { townStage } from "@/lib/domain/town";
import type { TownStage } from "@/lib/domain/types";
import {
  getClassRewards,
  getClassTown,
  getOwnedClasses,
} from "@/lib/server/teacher";

// Full-screen projector town — `/teacher/class/[id]/town` (Requirement 22.4).
// A viewport-filling, projector-sized view of one class's town, its current
// stage, and the next reward it is working toward. Only the owning teacher may
// see it: the page requires the teacher role and then confirms the class is one
// the signed-in teacher owns (RLS already scopes `getOwnedClasses`); a
// non-owner, or a class with no data, gets a denied/empty screen rather than
// another teacher's town (Requirement 22.4).
//
// Under `cacheComponents`, the auth check, the route `params`, and the Supabase
// reads are all dynamic, so the static shell streams first and the dynamic
// `<ProjectorTown>` fills in inside a <Suspense> boundary (the same pattern as
// `/login`). This is the projector screen, so it uses the sticker skin and
// fills the viewport with large type (design.md "Projector screens").

export const metadata: Metadata = {
  title: "Class town · CivicQuest",
};

/**
 * The dynamic projector town. Isolated from the page body so the cookie reads
 * (`requireRole`, the loaders) and the `params` access do not force the whole
 * route to render dynamically under `cacheComponents`; it renders inside
 * <Suspense> below.
 */
async function ProjectorTown({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  await requireRole("teacher");
  const { id: classId } = await params;

  // Ownership check: only a class the signed-in teacher owns is shown. RLS
  // already limits `getOwnedClasses` to `teacher_id = auth.uid()`, so a
  // non-owner finds no match and gets the denied/empty screen (Requirement
  // 22.4). The loaders below are RLS-scoped too, so this is defence in depth.
  const owned = await getOwnedClasses();
  const klass = owned.find((c) => c.id === classId);
  if (!klass) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-8 text-center">
        <h1 className="font-heading text-4xl font-extrabold text-kid-ink">
          Class town not available
        </h1>
        <p className="mt-4 text-2xl text-kid-muted">
          This class town can only be shown by its own teacher.
        </p>
      </div>
    );
  }

  const [missions, rewards] = await Promise.all([
    getClassTown(classId),
    getClassRewards(classId),
  ]);

  const count = missions.length;
  const stageResult = townStage(count);
  // townStage only rejects a negative/non-integer count; a building count is
  // always a non-negative integer, so this fallback never triggers in practice.
  const stage: TownStage =
    "rejected" in stageResult
      ? { stage: "pre-village", gridSize: 6, capacity: 36 }
      : stageResult;


  return (
    <main className="flex min-h-dvh flex-col gap-6 p-4 sm:p-8 lg:gap-8 lg:p-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={`/teacher/class/${classId}`}
            className="inline-flex min-h-12 items-center text-lg font-semibold text-kid-muted"
          >
            &larr; Close projector view
          </Link>
          <h1 className="font-heading text-4xl font-extrabold leading-none text-kid-ink sm:text-6xl">
            {klass.name}&rsquo;s town
          </h1>
        </div>
        <div className="text-right">
          <p className="font-heading text-3xl font-extrabold text-kid-ink sm:text-4xl">
            {stageName(count)}
          </p>
          <p className="text-xl text-kid-muted sm:text-2xl">
            {count} of 36 buildings. {nextStageText(count)}.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <section className="flex min-h-0 flex-1 items-center justify-center">
          <TownGrid
            missions={missions}
            stage={stage}
            className="aspect-square w-full max-w-[min(100%,78vh)] gap-2.5"
          />
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-[26rem]">
          <ClassEarns count={count} rewards={rewards} size="projector" />
          <BuildLegend size="projector" />
        </aside>
      </div>
    </main>
  );
}

export default function ProjectorTownPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <SkinWrapper skin="sticker" className="min-h-dvh">
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center">
            <p className="font-heading text-3xl font-extrabold text-kid-muted">
              Loading the class town…
            </p>
          </div>
        }
      >
        <ProjectorTown params={params} />
      </Suspense>
    </SkinWrapper>
  );
}
