import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { BADGES, Icon, missionIcon, TOWN_ITEMS, isTownItem } from "@/components/Icon";
import { TownGrid } from "@/components/town/TownGrid";
import { CrosswalkBar, nextStageText, stageName } from "@/components/town/ClassEarns";
import { requireRole } from "@/lib/auth/require";
import { townStage } from "@/lib/domain/town";
import type { Quality, TownStage } from "@/lib/domain/types";
import {
  getClassModule,
  getClassNextMissionState,
  getClassRoster,
  getClassTown,
  getModuleWeek,
  getOwnedClass,
  type RosterStudent,
} from "@/lib/server/teacher";
import { getStudentDashboard, PASSPORT_QUALITIES } from "@/lib/server/student";
import { cn } from "@/lib/utils";
import { ThemePicker } from "./ThemePicker";

// Class-mode student dashboard — `/teacher/class/[id]/play` (docs/demo.html).
// Learners and Helpers have no accounts: the teacher signs in, hands over the
// tablet, and each student taps their picture. Sticker skin, always light.
// Everything is read as the teacher under RLS, so only the teacher's own class
// is visible; another class id is a 404.

export const metadata: Metadata = {
  title: "Class mode · CivicQuest",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Badge names, one per stamp quality. */
const BADGE_NAMES: Record<Quality, string> = {
  Safety: "Safety Star",
  Kindness: "Kindness Champion",
  Responsibility: "Responsibility Pro",
  Respect: "Respect Hero",
  Helping: "Helping Hand",
  "Civic action": "Civic Leader",
};

const studentParam = z.uuid();

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function KidTopBar({ classId, className }: { classId: string; className: string }) {
  return (
    <header className="sticky top-0 z-30 border-b-[2.5px] border-kid-ink bg-kid-bg">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-2">
        <span className="inline-flex min-h-12 items-center gap-2 font-heading text-xl font-extrabold text-kid-ink">
          <Icon name="classical-building" alt="" size={28} />
          {className}
        </span>
        <Link
          href={`/teacher/class/${classId}`}
          className="inline-flex min-h-12 items-center rounded-full border-[2.5px] border-kid-ink bg-kid-surface px-4 text-base font-semibold text-kid-ink"
        >
          Teacher view
        </Link>
      </div>
    </header>
  );
}

function AvatarGrid({ classId, roster }: { classId: string; roster: readonly RosterStudent[] }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
      <h1 className="font-heading text-4xl font-extrabold leading-tight text-kid-ink sm:text-5xl">
        Who&rsquo;s using the tablet?
      </h1>
      <p className="mt-2 text-lg text-kid-muted">Tap your picture to see your missions and stickers.</p>
      {roster.length === 0 ? (
        <p className="mt-6 text-lg text-kid-muted">No students on this roster yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {roster.map((student) => (
            <li key={student.id}>
              <Link
                href={`/teacher/class/${classId}/play?student=${student.id}`}
                className="flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-[22px] border-[2.5px] border-kid-ink bg-kid-surface p-3 text-center text-lg font-semibold text-kid-ink shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                <Icon name={student.avatar} alt="" size={64} />
                {student.firstName} {student.lastInitial}.
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

async function StudentView({
  classId,
  student,
  teacher,
}: {
  classId: string;
  student: RosterStudent;
  teacher: { id: string; name: string };
}) {
  const klass = await getOwnedClass(classId);
  if (!klass) notFound();

  const [nextState, townItems, dash] = await Promise.all([
    getClassNextMissionState(classId),
    getClassTown(classId),
    getStudentDashboard(classId, student.id, teacher),
  ]);
  const next = nextState.status === "next" ? nextState.mission : null;
  const currentModule = await getClassModule(classId, next?.moduleId);
  const week = currentModule ? await getModuleWeek(classId, currentModule.id) : [];

  const count = townItems.length;
  const stageResult = townStage(count);
  const stage: TownStage =
    "rejected" in stageResult ? { stage: "pre-village", gridSize: 6, capacity: 36 } : stageResult;

  const collected = PASSPORT_QUALITIES.filter((q) => dash.stamps[q] > 0).length;
  const moduleDone = currentModule
    ? dash.missions.filter((m) => m.moduleId === currentModule.id).length
    : 0;
  const missedTown =
    dash.missedLatest && isTownItem(dash.missedLatest.townItem)
      ? TOWN_ITEMS[dash.missedLatest.townItem].label.toLowerCase()
      : "new building";

  const heroIcon = next ? missionIcon(next.title, next.townItem) : "star";

  return (
    <SkinWrapper skin="sticker" kidTheme={student.kidTheme} className="min-h-dvh">
      <KidTopBar classId={classId} className={klass.name} />
      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 sm:pb-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/teacher/class/${classId}/play`}
            className="inline-flex min-h-16 items-center gap-2 rounded-full border-[2.5px] border-kid-ink bg-kid-surface px-5 text-lg font-semibold text-kid-ink shadow-sticker-sm"
          >
            Next student
          </Link>
        </div>

        <div id="home" className="flex scroll-mt-20 flex-wrap items-center justify-between gap-4">
          <h1 className="font-heading text-[clamp(1.9rem,6vw,2.8rem)] font-extrabold leading-none text-kid-ink">
            {`Welcome back, ${student.firstName}!`}
          </h1>
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-[2.5px] border-kid-ink bg-kid-highlight shadow-sticker-sm">
            <Icon name={student.avatar} alt="" size={44} />
          </span>
        </div>

        <ul className="mt-4 flex flex-wrap gap-2" aria-label="My stats">
          {[
            { icon: "seedling", value: dash.streak, label: "mission streak" },
            { icon: "star", value: dash.points, label: "points" },
            { icon: "shield", value: dash.stickers, label: dash.stickers === 1 ? "sticker" : "stickers" },
          ].map((pill) => (
            <li
              key={pill.label}
              className="flex items-center gap-2 rounded-full border-[2.5px] border-kid-ink bg-kid-surface px-3 py-1 font-semibold shadow-sticker-sm"
            >
              <Icon name={pill.icon} alt="" size={24} />
              <b className="font-heading text-xl font-extrabold">{pill.value}</b> {pill.label}
            </li>
          ))}
        </ul>

        {/* Hero mission card */}
        <section className="relative mt-5 grid gap-3 overflow-hidden rounded-[24px] border-[2.5px] border-kid-ink bg-kid-soft p-5 shadow-sticker sm:grid-cols-[1.4fr_1fr] sm:items-center">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border-2 border-kid-ink bg-kid-surface px-3 py-0.5 text-base font-semibold">
                {currentModule ? `${currentModule.title}, grade ${klass.grade}` : `Grade ${klass.grade}`}
              </span>
              {next ? (
                <span className="inline-flex items-center rounded-full border-2 border-kid-ink bg-kid-surface px-3 py-0.5 text-base font-semibold">
                  Day {next.dayNumber}
                </span>
              ) : null}
            </div>
            <h2 className="font-heading text-[clamp(2.2rem,8vw,3.4rem)] font-extrabold leading-[0.95] text-kid-ink">
              {next ? next.title : "Every mission is done!"}
            </h2>
            <p className="text-lg">
              {dash.missedLatest
                ? `You missed the last mission, but your class still built a ${missedTown}. You can join the next one!`
                : next
                  ? "Your class does this one together today."
                  : "Your class finished this module. Amazing work!"}
            </p>
            {next ? (
              <Link
                href={`/teacher/class/${classId}/run/${next.id}`}
                className="inline-flex min-h-16 items-center justify-center justify-self-start rounded-full border-[2.5px] border-kid-ink bg-kid-primary px-7 text-lg font-semibold text-kid-on-primary shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none sm:self-start"
              >
                Start mission
              </Link>
            ) : (
              <a
                href="#town"
                className="inline-flex min-h-16 items-center justify-center self-start rounded-full border-[2.5px] border-kid-ink bg-kid-surface px-7 text-lg font-semibold text-kid-ink shadow-sticker-sm"
              >
                See our town
              </a>
            )}
          </div>
          <div className="flex justify-center sm:row-span-4">
            <Icon
              name={heroIcon}
              alt=""
              size={160}
              className="h-32 w-32 drop-shadow-[4px_5px_0_rgba(34,34,59,0.25)] sm:h-40 sm:w-40"
            />
          </div>
        </section>

        {/* Week strip */}
        <h2
          id="week"
          className="mt-7 flex scroll-mt-20 flex-wrap items-baseline justify-between gap-2 font-heading text-2xl font-extrabold"
        >
          This week&rsquo;s missions
          {currentModule ? (
            <small className="font-sans text-base font-normal text-kid-muted">Week {currentModule.weekOrder}</small>
          ) : null}
        </h2>
        <ol
          aria-label="This week"
          className="mt-3 grid snap-x snap-mandatory auto-cols-[minmax(132px,1fr)] grid-flow-col gap-3 overflow-x-auto px-1 pb-3 lg:grid-flow-row lg:grid-cols-5 lg:overflow-visible"
        >
          {week.map((day) => {
            const isToday = next?.id === day.id;
            const tookPart = dash.missionIds.has(day.id);
            return (
              <li
                key={day.id}
                className={cn(
                  "flex min-h-[156px] snap-start flex-col items-center gap-1 rounded-[18px] border-[2.5px] border-kid-ink bg-kid-surface px-2 py-3 text-center shadow-sticker-sm",
                  isToday && "border-4 border-kid-primary bg-kid-soft",
                  day.confirmed && "opacity-90",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-sm font-semibold text-white",
                    day.confirmed ? "bg-kid-primary" : "bg-kid-secondary",
                  )}
                >
                  {day.confirmed ? "✓" : day.dayNumber}
                </span>
                <Icon name={missionIcon(day.title, day.townItem)} alt="" size={44} />
                <span className="text-sm font-semibold text-kid-muted">
                  {WEEKDAYS[day.dayNumber - 1]}
                  {isToday ? ", today" : ""}
                </span>
                <span className="font-semibold leading-tight">{day.title}</span>
                {day.confirmed && !tookPart ? (
                  <span className="text-sm text-kid-muted">Absent</span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {/* Class town */}
          <section
            id="town"
            className="scroll-mt-20 rounded-[24px] border-[2.5px] border-kid-ink bg-kid-surface p-4 shadow-sticker"
          >
            <h2 className="flex flex-wrap items-baseline justify-between gap-2 font-heading text-2xl font-extrabold">
              Class town
              <small className="font-sans text-base font-normal text-kid-muted">
                {stageName(count)}, {count} of 36
              </small>
            </h2>
            <CrosswalkBar count={count} className="mb-3" />
            <TownGrid missions={townItems} stage={stage} className="gap-1.5" />
            <p className="mt-3 text-base text-kid-muted">{nextStageText(count)}.</p>
          </section>

          {/* Sticker passport */}
          <section
            id="stickers"
            className="scroll-mt-20 rounded-[24px] border-[2.5px] border-kid-ink bg-kid-surface p-4 shadow-sticker"
          >
            <h2 className="flex flex-wrap items-baseline justify-between gap-2 font-heading text-2xl font-extrabold">
              My stickers
              <small className="font-sans text-base font-normal text-kid-muted">
                {collected} of 6 collected
              </small>
            </h2>
            <ul className="mt-3 grid grid-cols-3 gap-3">
              {PASSPORT_QUALITIES.map((quality, index) => {
                const n = dash.stamps[quality];
                const locked = n === 0;
                const tilt = ["-rotate-6", "rotate-3", "-rotate-2", "rotate-6", "-rotate-3", "rotate-2"][index];
                return (
                  <li key={quality} className="flex flex-col items-center gap-1 text-center text-base font-semibold">
                    <span
                      className={cn(
                        "grid h-16 w-16 place-items-center rounded-full",
                        locked
                          ? "border-[2.5px] border-dashed border-kid-muted"
                          : cn(
                              "border-4 border-white bg-kid-highlight shadow-[0_0_0_2.5px_var(--kid-ink),2px_3px_0_2.5px_var(--kid-ink)]",
                              tilt,
                            ),
                      )}
                    >
                      <Icon name={BADGES[quality].icon} alt="" size={36} locked={locked} />
                    </span>
                    {quality}
                    <span className="text-sm font-normal text-kid-muted">{locked ? "Locked" : `×${n}`}</span>
                  </li>
                );
              })}
            </ul>
            {currentModule ? (
              <p className="mt-4 text-base">
                <strong>Next badge:</strong> {BADGE_NAMES[currentModule.quality]}. Finish all five {currentModule.title} days.{" "}
                <span className="text-kid-muted">({Math.min(moduleDone, 5)} of 5 done)</span>
              </p>
            ) : null}
          </section>
        </div>

        {/* Missions I did */}
        <section className="mt-4 rounded-[24px] border-[2.5px] border-kid-ink bg-kid-surface p-4 shadow-sticker">
          <h2 className="font-heading text-2xl font-extrabold">Missions I did</h2>
          {dash.missions.length === 0 ? (
            <p className="mt-2 text-base text-kid-muted">Your first mission sticker is coming soon.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {dash.missions.slice(0, 6).map((m) => (
                <li key={m.missionId} className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-kid-ink bg-kid-soft">
                    <Icon name={BADGES[m.quality].icon} alt="" size={28} />
                  </span>
                  <span>
                    <strong className="font-semibold">{m.title}</strong>
                    <span className="block text-base text-kid-muted">
                      {m.moduleTitle}. Confirmed by {m.confirmedBy}, {formatWhen(m.confirmedAt)}.
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ThemePicker classId={classId} studentId={student.id} current={student.kidTheme} />
        <p className="mt-4 text-base text-kid-muted">
          Points fill your sticker passport and unlock badges. There&rsquo;s no ranking against classmates.
        </p>
      </main>

      {/* Bottom tab bar on phones */}
      <nav
        aria-label="Student navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t-[2.5px] border-kid-ink bg-kid-surface px-2 pb-[calc(0.3rem+env(safe-area-inset-bottom))] pt-1 sm:hidden"
      >
        {[
          { href: "#home", label: "Home", icon: "school" },
          { href: "#week", label: "Missions", icon: "round-pushpin" },
          { href: "#town", label: "Town", icon: "classical-building" },
          { href: "#stickers", label: "Stickers", icon: "shield" },
        ].map((tab) => (
          <a
            key={tab.href}
            href={tab.href}
            className="flex min-h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl text-sm font-semibold text-kid-ink"
          >
            <Icon name={tab.icon} alt="" size={28} />
            {tab.label}
          </a>
        ))}
      </nav>
    </SkinWrapper>
  );
}

async function PlayBody({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ id: classId }, query] = await Promise.all([params, searchParams]);
  const { profile } = await requireRole("teacher");

  const klass = await getOwnedClass(classId);
  if (!klass) notFound();
  const roster = await getClassRoster(classId);

  const raw = Array.isArray(query.student) ? query.student[0] : query.student;
  const parsed = studentParam.safeParse(raw);
  const student = parsed.success ? roster.find((s) => s.id === parsed.data) : undefined;

  if (!student) {
    return (
      <SkinWrapper skin="sticker" className="min-h-dvh">
        <KidTopBar classId={classId} className={klass.name} />
        <AvatarGrid classId={classId} roster={roster} />
      </SkinWrapper>
    );
  }

  return (
    <StudentView
      classId={classId}
      student={student}
      teacher={{ id: profile.id, name: profile.full_name }}
    />
  );
}

export default function ClassModePage({ params, searchParams }: PageProps<"/teacher/class/[id]/play">) {
  return (
    <Suspense
      fallback={
        <SkinWrapper skin="sticker" className="flex min-h-dvh items-center justify-center">
          <p className="font-heading text-3xl font-extrabold text-kid-muted">Opening class mode…</p>
        </SkinWrapper>
      }
    >
      <PlayBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
