import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { Icon, TOWN_ITEMS, BADGES, isTownItem } from "@/components/Icon";
import { TownGrid } from "@/components/town/TownGrid";
import { DoneTodayControls } from "@/components/teacher/DoneTodayControls";
import { WeekLine } from "@/components/teacher/WeekLine";
import { Leaderboard } from "@/components/Leaderboard";
import { AppHeader, TEACHER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { townStage } from "@/lib/domain/town";
import type { Quality, TownStage } from "@/lib/domain/types";
import {
  getClassModule,
  getClassNextMissionState,
  getClassRecentConfirmation,
  getClassRoster,
  getClassStudentCount,
  getClassTown,
  getConfirmedParticipantIds,
  getModuleWeek,
  getOwnedClasses,
  getSchoolLeaderboardRows,
  getTodaysProofLog,
  type ClassModule,
  type NextMission,
  type NextMissionState,
  type OwnedClass,
  type ProofLogEntry,
  type RecentConfirmation,
  type RosterStudent,
  type WeekDay,
} from "@/lib/server/teacher";

// Teacher Today view — `/teacher` (Requirement 18). Lists each class the
// signed-in teacher owns, each with a mini town preview and one of three
// layouts built from the two Today-view lookups (design.md "Teacher Today
// view"):
//
//   1. Done today (confirmed < 24h) — the done mission with Edit/Undo and NO
//      Start, plus the next mission below with its own "Start mission"
//      (Requirements 18.3, 21.1, 18.2).
//   2. Next mission only — when nothing was confirmed in the last 24h; Edit/Undo
//      hidden (Requirements 18.2, 21.9).
//   3. Module complete — every mission confirmed (`class_next_mission` null); no
//      Start. If the last mission was confirmed < 24h ago its Done-today card
//      with Edit/Undo still appears above it (design.md layout 3).
//
// No owned classes → empty state (Requirement 18.4). A non-owning requester
// gets no class data because every loader runs under RLS (Requirement 18.5).
// The view also shows a "Today's proof log" panel, newest first with
// timestamps (Requirement 21.10).
//
// This is a teacher screen, so it uses the CALM skin and matches the
// docs/demo.html `teacher()` layout (`.cgrid` two columns, `.cpanel` panels,
// `.row` class rows, `.cbtn` Start, `.log` proof log). Confirm/celebration
// (7.13) and the Edit/Undo dialogs (7.14) are not wired here: Start links to
// the run screen and Edit/Undo are rendered as affordances for 7.14.
//
// Under `cacheComponents`, the auth check and the Supabase reads are dynamic,
// so the static shell streams first and the dynamic `<TodayPanels>` fills in
// inside a <Suspense> boundary (the same pattern as `/login` and the projector
// town page).

export const metadata: Metadata = {
  title: "Today · CivicQuest",
};

/** Proof-type labels for the `verification_type` enum (design.md "Enums"). */
const PROOF_TYPE_LABEL: Record<string, string> = {
  class_activity: "Teacher watched",
  quiz: "Short quiz",
  photo_review: "Photo proof",
  qr_checkin: "QR check-in",
};

function proofTypeLabel(verification: string): string {
  return PROOF_TYPE_LABEL[verification] ?? verification;
}

/** The small quality badge shown in a mission's row (reuses the stamp icon). */
function QualityTag({ quality }: { quality: Quality }) {
  const badge = BADGES[quality as keyof typeof BADGES];
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold text-brand">
      {badge ? <Icon name={badge.icon} alt="" size={16} /> : null}
      {quality}
    </span>
  );
}

/**
 * A compact calm town preview for a class row (Requirement 18.1). Reuses the
 * sticker `TownGrid` at a small, fixed size inside a sticker-skinned wrapper so
 * it stays readable in the calm panel — a small nod to the class's progress
 * without taking over the row.
 */
function MiniTown({ townItems }: { townItems: Awaited<ReturnType<typeof getClassTown>> }) {
  const count = townItems.length;
  const result = townStage(count);
  const stage: TownStage =
    "rejected" in result ? { stage: "pre-village", gridSize: 6, capacity: 36 } : result;

  return (
    <SkinWrapper
      skin="sticker"
      className="shrink-0 rounded-xl border border-line bg-surface p-2"
      aria-hidden={count === 0 ? true : undefined}
    >
      <TownGrid
        missions={townItems}
        stage={stage}
        className="h-24 w-24 gap-0.5"
      />
    </SkinWrapper>
  );
}

/**
 * The next not-yet-confirmed mission block with its large "Start mission"
 * button (Requirement 18.2). Shows module, day, quality, estimated minutes, and
 * proof type, and links to the run screen `/teacher/class/[id]/run/[missionId]`.
 */
function NextMissionBlock({
  klass,
  module,
  mission,
}: {
  klass: OwnedClass;
  module: ClassModule | null;
  mission: NextMission;
}) {
  const townLabel = isTownItem(mission.townItem)
    ? TOWN_ITEMS[mission.townItem].label
    : mission.townItem;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-subtle">
          Next mission{module ? ` · ${module.title}` : ""} · Day {mission.dayNumber}
        </p>
        <p className="text-lg font-bold text-ink">{mission.title}</p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-subtle">
          <QualityTag quality={mission.quality} />
          <span>{mission.estMinutes} min</span>
          <span aria-hidden="true">·</span>
          <span>{proofTypeLabel(mission.verification)}</span>
          <span aria-hidden="true">·</span>
          <span>Builds a {townLabel}</span>
        </div>
      </div>
      <Link
        href={`/teacher/class/${klass.id}/run/${mission.id}`}
        className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-brand px-6 py-3 text-lg font-bold text-on-brand"
      >
        Start mission
      </Link>
    </div>
  );
}

/**
 * The "Done today" card for a mission confirmed < 24h ago (Requirements 18.3,
 * 21.1): module/day/quality with NO Start button, plus the interactive
 * Edit/Undo controls (task 7.14). The affordances and their roster-edit /
 * undo-dialog interactions live in the client `<DoneTodayControls>`; this card
 * passes it the confirmed mission, the class roster, and the saved selection so
 * Edit can preselect exactly who was last confirmed (Requirement 21.1, 21.3).
 * The card is only produced while the confirmation is < 24h old, so the
 * controls are naturally hidden otherwise (Requirement 21.9).
 */
function DoneTodayCard({
  klass,
  module,
  confirmation,
  roster,
  savedSelection,
}: {
  klass: OwnedClass;
  module: ClassModule | null;
  confirmation: RecentConfirmation;
  roster: readonly RosterStudent[] | null;
  savedSelection: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-brand bg-brand-soft p-4">
      <div className="flex flex-col gap-1">
        <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand">
          <Icon name="star" alt="" size={16} />
          Done today
        </p>
        <p className="text-lg font-bold text-ink">
          {module ? module.title : "Mission"} confirmed
        </p>
        <p className="text-sm text-subtle">
          {module ? <QualityTag quality={module.quality} /> : null}
          <time className="ml-2 align-middle" dateTime={confirmation.confirmedAt}>
            Confirmed {formatTime(confirmation.confirmedAt)}
          </time>
        </p>
      </div>
      <DoneTodayControls
        classId={klass.id}
        missionId={confirmation.missionId}
        roster={roster}
        savedSelection={savedSelection}
      />
    </div>
  );
}

/** Shown when the class's missions could not be loaded, never as "complete". */
function LoadErrorCard() {
  return (
    <div className="rounded-xl border border-danger bg-surface p-4">
      <p className="text-base font-bold text-ink">
        We couldn&rsquo;t load this class&rsquo;s next mission.
      </p>
      <p className="text-sm text-subtle">Reload the page to try again.</p>
    </div>
  );
}

/** The module-complete state when every mission in the module is confirmed. */
function ModuleCompleteCard({ module }: { module: ClassModule | null }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <Icon name="star" alt="" size={32} />
      <div>
        <p className="text-lg font-bold text-ink">
          {module ? `${module.title} complete` : "Module complete"}
        </p>
        <p className="text-sm text-subtle">
          Every mission in this module is confirmed. Nice work!
        </p>
      </div>
    </div>
  );
}

/**
 * One class row (Requirement 18.1): class name, student count, the mini town
 * preview, and the right layout from the two lookups. A single class can show a
 * Done-today card and a next mission (or module-complete) stacked.
 */
function ClassRow({
  klass,
  studentCount,
  module,
  nextState,
  confirmation,
  townItems,
  roster,
  savedSelection,
  week,
}: {
  klass: OwnedClass;
  studentCount: number;
  module: ClassModule | null;
  week: readonly WeekDay[];
  nextState: NextMissionState;
  confirmation: RecentConfirmation | null;
  townItems: Awaited<ReturnType<typeof getClassTown>>;
  roster: readonly RosterStudent[] | null;
  savedSelection: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line py-5 last:border-b-0 sm:flex-row sm:items-start">
      <MiniTown townItems={townItems} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-xl font-bold text-ink">{klass.name}</h3>
          <span className="text-sm text-subtle">
            {studentCount} {studentCount === 1 ? "student" : "students"}
            {module ? ` · Week ${module.weekOrder}: ${module.title}` : ""}
          </span>
        </div>

        {week.length > 0 ? (
          <WeekLine
            days={week}
            todayId={nextState.status === "next" ? nextState.mission.id : null}
          />
        ) : null}

        {confirmation ? (
          <DoneTodayCard
            klass={klass}
            module={module}
            confirmation={confirmation}
            roster={roster}
            savedSelection={savedSelection}
          />
        ) : null}

        {nextState.status === "next" ? (
          <NextMissionBlock klass={klass} module={module} mission={nextState.mission} />
        ) : nextState.status === "complete" ? (
          <ModuleCompleteCard module={module} />
        ) : nextState.status === "error" ? (
          <LoadErrorCard />
        ) : (
          <p className="text-sm text-subtle">No module is assigned to this class yet.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {klass.grade <= 8 ? (
            <Link
              href={`/teacher/class/${klass.id}/play`}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-brand px-4 text-base font-bold text-brand"
            >
              Student dashboard
            </Link>
          ) : null}
          <Link
            href={`/teacher/class/${klass.id}`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line px-4 text-base font-bold text-ink"
          >
            Class page
          </Link>
          <Link
            href={`/teacher/class/${klass.id}/town`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line px-4 text-base font-bold text-ink"
          >
            Show town on projector
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Short local-time label for a proof-log / confirmation timestamp. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Human labels and dot styles for the proof-log actions (Requirement 21.10). */
const PROOF_LOG_META: Record<string, { label: string; dot: string }> = {
  confirm: { label: "Confirmed a mission", dot: "bg-brand" },
  re_approve: { label: "Re-confirmed a mission", dot: "bg-brand" },
  edit: { label: "Edited who took part", dot: "bg-[#1F4E9C]" },
  undo: { label: "Undid a mission", dot: "bg-danger" },
};

/**
 * The "Today's proof log" panel (Requirement 21.10): the teacher's confirm,
 * edit, and undo entries for today, newest first, each with its timestamp. RLS
 * on `audit_log` already scopes these to the teacher's own actions. These rows
 * can never be deleted, which the empty-state copy explains.
 */
function ProofLogPanel({ entries }: { entries: ProofLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-subtle">
        No changes today yet. Confirmations, edits, and undos appear here, and
        they can&rsquo;t be deleted.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => {
        const meta = PROOF_LOG_META[entry.action] ?? {
          label: entry.action,
          dot: "bg-subtle",
        };
        return (
          <li key={entry.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${meta.dot}`}
            />
            <span className="text-sm text-ink">
              <strong className="font-bold">{meta.label}</strong>
              <br />
              <time className="text-subtle" dateTime={entry.createdAt}>
                {formatTime(entry.createdAt)}
              </time>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The dynamic Today panels. Isolated from the page body so the cookie reads
 * (`requireRole`, the loaders) do not force the whole route to render
 * dynamically under `cacheComponents`; renders inside <Suspense> below.
 */
async function TodayPanels() {
  // Opt this render into request time before any Date.now()/new Date() below, so
  // under cacheComponents the dynamic clock + cookie reads happen at request time
  // inside the existing <Suspense> rather than tripping a prerender (Blocking
  // Route) error.
  await connection();
  const { profile } = await requireRole("teacher");

  const now = new Date();
  const [classes, proofLog, leaderboardRows] = await Promise.all([
    getOwnedClasses(),
    getTodaysProofLog(now),
    getSchoolLeaderboardRows(),
  ]);

  // Load each class's row data in parallel; all loaders are RLS-scoped.
  const rows = await Promise.all(
    classes.map(async (klass) => {
      const [studentCount, nextState, confirmation, townItems] =
        await Promise.all([
          getClassStudentCount(klass.id),
          getClassNextMissionState(klass.id),
          getClassRecentConfirmation(klass.id, now),
          getClassTown(klass.id),
        ]);

      // Show the CURRENT module — the one the next mission belongs to, or the
      // recently-confirmed mission's module when the class is module-complete —
      // not just the first of several assigned modules. Falls back to the
      // earliest assigned module when neither is available.
      const nextMission: NextMission | null =
        nextState.status === "next" ? nextState.mission : null;
      const currentModuleId = nextMission?.moduleId;
      const currentModule = await getClassModule(klass.id, currentModuleId);
      const week = currentModule ? await getModuleWeek(klass.id, currentModule.id) : [];

      // Only a class with a < 24h confirmation shows the Done-today card and
      // its Edit/Undo controls, so the roster and the saved selection (the
      // approved completion student ids) are loaded only then (Requirements
      // 21.1, 21.3, 21.9). Edit preselects exactly this set.
      const [roster, savedSelection] = confirmation
        ? await Promise.all([
            getClassRoster(klass.id),
            getConfirmedParticipantIds(klass.id, confirmation.missionId),
          ])
        : [null as RosterStudent[] | null, [] as string[]];

      return {
        klass,
        studentCount,
        module: currentModule,
        week,
        nextState,
        confirmation,
        townItems,
        roster,
        savedSelection,
      };
    }),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold text-ink">
        Today&rsquo;s missions
      </h1>
      <p className="mt-1 text-base text-subtle">
        Signed in as {profile.full_name}.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Your classes
            </h2>
            {classes.length === 0 ? (
              <p className="mt-3 text-base text-subtle">
                You don&rsquo;t own any classes yet. When a school admin assigns
                you a class, its missions show up here.
              </p>
            ) : (
              <div className="mt-2">
                {rows.map((row) => (
                  <ClassRow key={row.klass.id} {...row} />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Today&rsquo;s proof log
            </h2>
            <div className="mt-3">
              <ProofLogPanel entries={proofLog} />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <Leaderboard
            rows={leaderboardRows}
            currentClassId={classes[0]?.id ?? null}
            title="School leaderboard"
            subtitle="Classes compete, not kids"
          />
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">
              Fixing a mistake
            </h2>
            <p className="mt-3 text-sm text-subtle">
              You can edit or undo a confirmation for 24 hours. After that, only a
              school admin can reverse it. Every change stays in the proof log.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function TeacherTodayPage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={TEACHER_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading today&rsquo;s missions…</p>
          </div>
        }
      >
        <TodayPanels />
      </Suspense>
    </SkinWrapper>
  );
}
