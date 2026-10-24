import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { Icon, TOWN_ITEMS, BADGES, isTownItem } from "@/components/Icon";
import { TownGrid } from "@/components/town/TownGrid";
import { BuildLegend, ClassEarns, nextStageText, stageName } from "@/components/town/ClassEarns";
import { Leaderboard } from "@/components/Leaderboard";
import { AppHeader, TEACHER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { rankLeaderboard } from "@/lib/domain/leaderboard";
import { townStage } from "@/lib/domain/town";
import type { Quality, TownStage } from "@/lib/domain/types";
import {
  getClassModule,
  getClassRecentMissionRecords,
  getClassRewards,
  getClassRoster,
  getClassTown,
  getOwnedClass,
  getSchoolLeaderboardRows,
  type MissionRecord,
} from "@/lib/server/teacher";

// Teacher class view — `/teacher/class/[id]` (Requirement 22.1). The detail
// screen for one class the signed-in teacher owns, showing in a single calm
// layout (design.md "Class view"):
//
//   * the roster (child-safe columns only);
//   * the class town with its current stage and progress toward the next stage,
//     and the three village/town/city rewards (Requirements 22.2, 22.3, 22.5);
//   * the class's rank in the within-school leaderboard (Requirement 23);
//   * the assigned module and how far the class has progressed through it;
//   * the 10 most recent mission records, newest first (Requirement 22.1).
//
// Ownership: this is a teacher screen (`requireRole("teacher")`), and the body
// loads the class through `getOwnedClass`, whose `classes` read is RLS-scoped
// to `teacher_id = auth.uid()`. A non-owning teacher — or an unknown id — gets
// `null` and the page calls `notFound()`, so a non-owner sees no class data
// (Requirement 18.5). Every other loader is likewise RLS-scoped, so even the
// town/rewards/records reads disclose nothing cross-class.
//
// This is a teacher screen, so it uses the CALM skin and the demo's calm
// `.cpanel` / `.row` treatment (bg-surface, border-line, text-ink/subtle). The
// embedded class town reuses the sticker `TownGrid` / `TownStageProgress` /
// `RewardsList`, so those sit inside a small sticker-skinned region the way the
// Today view's MiniTown does.
//
// The 10-most-recent records are read-only here; Edit and Undo live on the
// Today view, where the 24-hour window applies.
//
// Under `cacheComponents`, the auth check and the Supabase reads are dynamic,
// so the static shell streams first and the dynamic `<ClassDetail>` fills in
// inside a <Suspense> boundary (the same pattern as `/teacher` and `/login`).

export const metadata: Metadata = {
  title: "Class · CivicQuest",
};

/** The small quality badge shown on a mission record (reuses the stamp icon). */
function QualityTag({ quality }: { quality: Quality }) {
  const badge = BADGES[quality as keyof typeof BADGES];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold text-brand">
      {badge ? <Icon name={badge.icon} alt="" size={16} /> : null}
      {quality}
    </span>
  );
}

/** Short local date-time label for a confirmation timestamp. */
function formatDateTime(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The class town panel (Requirements 22.2, 22.3, 22.5): the stage progress bar,
 * the 6×6 (or 8×8 at city) grid of buildings, and the three rewards — all the
 * sticker-skinned components, wrapped in a small sticker region inside the calm
 * panel the way the Today view's MiniTown does. Zero approved missions renders
 * as an empty town (Requirement 22.3).
 */
function ClassTownPanel({
  townItems,
  rewards,
}: {
  townItems: Awaited<ReturnType<typeof getClassTown>>;
  rewards: Awaited<ReturnType<typeof getClassRewards>>;
}) {
  const count = townItems.length;
  const result = townStage(count);
  const stage: TownStage =
    "rejected" in result
      ? { stage: "pre-village", gridSize: 6, capacity: 36 }
      : result;

  return (
    <SkinWrapper
      skin="sticker"
      className="flex flex-col gap-4 rounded-xl border border-line bg-kid-bg p-4"
    >
      <div className="rounded-[24px] border-[2.5px] border-kid-ink bg-kid-surface p-4 shadow-sticker">
        <p className="font-heading text-2xl font-extrabold text-kid-ink">{stageName(count)}</p>
        <p className="mb-3 text-base text-kid-muted">
          {count} of 36 buildings. {nextStageText(count)}.
        </p>
        <TownGrid missions={townItems} stage={stage} />
      </div>
      <ClassEarns count={count} rewards={rewards} />
      <BuildLegend />
    </SkinWrapper>
  );
}

/**
 * One recent mission record row (Requirement 22.1): title, day, quality, the
 * town building it placed, how many students took part, and when it was
 * confirmed, in the calm `.row` treatment.
 */
function MissionRecordRow({ record }: { record: MissionRecord }) {
  const townLabel = isTownItem(record.townItem)
    ? TOWN_ITEMS[record.townItem].label
    : record.townItem;

  return (
    <li className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-ink">{record.title}</span>
          <QualityTag quality={record.quality} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-subtle">
          <span>Day {record.dayNumber}</span>
          <span aria-hidden="true">·</span>
          <span>
            {record.participantCount}{" "}
            {record.participantCount === 1 ? "student" : "students"}
          </span>
          <span aria-hidden="true">·</span>
          <span>Built a {townLabel}</span>
          {record.confirmedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={record.confirmedAt}>
                {formatDateTime(record.confirmedAt)}
              </time>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * The dynamic class detail body. Isolated from the page shell so the cookie
 * reads (`requireRole`, the loaders) do not force the whole route dynamic under
 * `cacheComponents`; renders inside <Suspense> below. Calls `notFound()` for a
 * non-owner or unknown id (Requirement 18.5).
 */
async function ClassDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Request-time boundary before cookie/param reads, so this dynamic subtree
  // renders at request time inside <Suspense> rather than during prerender
  // (Blocking Route). Matches the /teacher Today view.
  await connection();
  const { id: classId } = await params;
  await requireRole("teacher");

  const klass = await getOwnedClass(classId);
  if (!klass) notFound();

  const [roster, townItems, rewards, module, leaderboardRows, records] =
    await Promise.all([
      getClassRoster(classId),
      getClassTown(classId),
      getClassRewards(classId),
      getClassModule(classId),
      getSchoolLeaderboardRows(),
      getClassRecentMissionRecords(classId),
    ]);

  // The class's rank comes from the same pure ranking the leaderboard draws, so
  // the number shown matches its row in the standing (Requirement 23).
  const standing = rankLeaderboard(leaderboardRows);
  const ownEntry = standing.find((entry) => entry.classId === classId) ?? null;

  // Module progress: how many of the module's missions have a recent record
  // against the module's total is not available here without the module's
  // mission list, so progress is shown as the count of distinct confirmed
  // missions (the town building count) within the assigned module.
  const confirmedCount = townItems.length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link
        href="/teacher"
        className="inline-flex items-center gap-1 text-sm text-subtle"
      >
        <span aria-hidden="true">&larr;</span> Back to today
      </Link>

      <h1 className="mt-2 font-heading text-3xl font-extrabold text-ink">
        {klass.name}
      </h1>
      <p className="mt-1 text-base text-subtle">
        Grade {klass.grade} · {roster.length}{" "}
        {roster.length === 1 ? "student" : "students"}
        {module ? ` · ${module.title}` : ""}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {klass.grade <= 8 ? (
          <Link
            href={`/teacher/class/${classId}/play`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-5 text-base font-bold text-on-brand"
          >
            Student dashboard
          </Link>
        ) : null}
        <Link
          href={`/teacher/class/${classId}/town`}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-surface px-5 text-base font-bold text-ink"
        >
          Show town on projector
        </Link>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* Class town, stage progress, and rewards. */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Class town
            </h2>
            <p className="mt-1 text-sm text-subtle">
              One building per confirmed mission. Grows from village to town to
              city.
            </p>
            <div className="mt-3">
              <ClassTownPanel townItems={townItems} rewards={rewards} />
            </div>
          </section>

          {/* The 10 most recent mission records, newest first. */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Recent missions
            </h2>
            {records.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">
                No confirmed missions yet. Once you confirm a mission for this
                class, it shows up here.
              </p>
            ) : (
              <ul className="mt-2">
                {records.map((record) => (
                  <MissionRecordRow key={record.missionId} record={record} />
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* Module progress. */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Module progress
            </h2>
            {module ? (
              <div className="mt-3 flex flex-col gap-1">
                <p className="text-base font-bold text-ink">
                  Week {module.weekOrder}: {module.title}
                </p>
                <p className="text-sm text-subtle">
                  {confirmedCount}{" "}
                  {confirmedCount === 1 ? "mission" : "missions"} confirmed ·{" "}
                  <span className="inline-flex align-middle">
                    <QualityTag quality={module.quality} />
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-subtle">
                No module assigned yet. A school admin assigns the week&rsquo;s
                module to this class.
              </p>
            )}
          </section>

          {/* Rank in the within-school leaderboard. */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              This class&rsquo;s rank
            </h2>
            {ownEntry ? (
              <p className="mt-3 text-base text-ink">
                <strong className="text-2xl font-extrabold tabular-nums">
                  #{ownEntry.rank}
                </strong>{" "}
                <span className="text-subtle">
                  of {standing.length} in your school
                </span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-subtle">
                This class isn&rsquo;t ranked yet.
              </p>
            )}
            <div className="mt-3">
              <Leaderboard
                rows={leaderboardRows}
                currentClassId={classId}
                title="School leaderboard"
                subtitle="Classes compete, not kids"
              />
            </div>
          </section>

          {/* The roster. */}
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Roster
            </h2>
            {roster.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">
                No students on this roster yet.
              </p>
            ) : (
              <ul className="mt-2">
                {roster.map((student) => (
                  <li
                    key={student.id}
                    className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
                  >
                    <Icon
                      name={student.avatar}
                      alt=""
                      size={32}
                      className="shrink-0"
                    />
                    <span className="text-base text-ink">
                      {student.firstName} {student.lastInitial}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export default function TeacherClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={TEACHER_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading class…</p>
          </div>
        }
      >
        <ClassDetail params={params} />
      </Suspense>
    </SkinWrapper>
  );
}
