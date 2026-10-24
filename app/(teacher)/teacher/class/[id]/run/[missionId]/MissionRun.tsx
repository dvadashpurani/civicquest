"use client";

// The interactive heart of the three-step mission run screen (Requirement 19).
// The server component below (`page.tsx`) does the auth, ownership, and data
// loading, then hands this client component plain, already-validated data:
// the mission narrative, the roster (or a load failure flag), and whether the
// class is a Learners class (so the Pip comic shows). This component owns only
// the step the teacher is on and which students are checked.
//
// All text is rendered through React as plain children — never as raw HTML —
// so a crafted story, instruction, or student name is shown verbatim as text
// and can never execute (Requirement 19.7, 34.4).
//
// The three steps are projector-sized: steps 1–2 use the sticker skin, and the
// Who-took-part step switches to the calm selection treatment (matching
// docs/demo.html), because picking names is a teacher task, not a kid one.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Icon, BADGES, TOWN_ITEMS, isTownItem, type BadgeQuality } from "@/components/Icon";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { SafeStreetsDay1 } from "@/components/pip/SafeStreetsDay1";
import { confirmMission } from "@/app/(teacher)/teacher/actions";
import type { Quality } from "@/lib/domain/types";
import { Celebration } from "./Celebration";

/** The subset of a mission the run screen renders (shaped by the server page). */
export type RunMissionView = {
  readonly id: string;
  readonly classId: string;
  readonly className: string;
  readonly grade: number;
  readonly dayNumber: number;
  readonly title: string;
  readonly quality: Quality;
  /**
   * The building this mission drops into the town on confirmation (a
   * `missions.town_item` key such as `crosswalk`). Used only for the drop
   * animation in the celebration; the server is still the source of truth for
   * what is actually placed.
   */
  readonly townItem: string;
  readonly story: string;
  readonly ask: string;
  readonly instructions: string;
};

/** A roster entry, already reduced to the child-safe fields (no login code). */
export type RunRosterStudent = {
  readonly id: string;
  readonly firstName: string;
  readonly lastInitial: string;
  readonly avatar: string;
};

type MissionRunProps = {
  mission: RunMissionView;
  /**
   * The class roster, or `null` when it failed to load. A `null` roster shows
   * an error on the Who-took-part step and blocks confirmation until it loads
   * (Requirement 19.5).
   */
  roster: readonly RunRosterStudent[] | null;
  /** Whether this is a Learners class, which gets the Pip comic (Requirement 19.2). */
  showPip: boolean;
};

type Step = "story" | "mission" | "roster";

/**
 * Shown when the confirm action itself throws (as opposed to returning a
 * friendly `{ ok: false, error }`). Mirrors the server action's generic
 * save-failed copy so a thrown and a returned failure read the same.
 */
const SAVE_FAILED_MESSAGE = "That didn't save. Wait a moment, then try again.";

/**
 * The confirm lifecycle on the Who-took-part step. `idle` is the editable
 * roster; `submitting` disables Confirm while the action runs; `error` keeps
 * the roster unchanged and shows a retryable message (Requirement 20.6);
 * `done` carries the saved record shown after a successful confirm
 * (Requirements 20.3, 20.5), with `present`/`absent` snapshotted from the
 * roster at the moment of activation (Requirement 20.1).
 */
type ConfirmState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | {
      status: "done";
      present: readonly RunRosterStudent[];
      absent: readonly RunRosterStudent[];
    };

function badgeFor(quality: Quality) {
  // `quality` always matches a known badge (it mirrors the DB check
  // constraint), but guard anyway so an unexpected value renders a fallback
  // icon rather than throwing.
  return BADGES[quality as BadgeQuality] ?? null;
}

export function MissionRun({ mission, roster, showPip }: MissionRunProps) {
  const [step, setStep] = useState<Step>("story");

  // Selected student ids. Start with everyone checked (Requirement 19.4); when
  // the roster is missing the set is empty and confirmation is blocked anyway.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set((roster ?? []).map((student) => student.id)),
  );

  const [confirmState, setConfirmState] = useState<ConfirmState>({ status: "idle" });

  const rosterFailed = roster === null;
  const total = roster?.length ?? 0;
  const badge = badgeFor(mission.quality);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectEveryone() {
    setSelected(new Set((roster ?? []).map((student) => student.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function handleConfirm() {
    // Guard against a double tap or a confirm while the roster is unusable.
    if (confirmState.status === "submitting" || rosterFailed || selected.size === 0) return;

    // Snapshot the selection AT TAP TIME (Requirement 20.1): the ids we submit
    // and the present/absent split we show in the saved record are both frozen
    // here, so later toggles can't change what was recorded.
    const present = (roster ?? []).filter((student) => selected.has(student.id));
    const absent = (roster ?? []).filter((student) => !selected.has(student.id));
    const presentStudentIds = present.map((student) => student.id);

    setConfirmState({ status: "submitting" });

    let result;
    try {
      result = await confirmMission({
        classId: mission.classId,
        missionId: mission.id,
        presentStudentIds,
      });
    } catch {
      // A thrown action (network/runtime) is treated the same as a failed one:
      // the roster and its selection are left exactly as they were.
      setConfirmState({ status: "error", message: SAVE_FAILED_MESSAGE });
      return;
    }

    if (!result.ok) {
      // Leave stored state unchanged and stay on the roster (Requirement 20.6).
      setConfirmState({ status: "error", message: result.error });
      return;
    }

    setConfirmState({ status: "done", present, absent });
  }

  // Steps 1 and 2: sticker skin, projector-sized, one step at a time.
  if (step === "story" || step === "mission") {
    return (
      <SkinWrapper skin="sticker" className="min-h-dvh">
        <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-28">
          {step === "story" ? (
            <StoryStep
              mission={mission}
              showPip={showPip}
              onBack={() => history.back()}
              onNext={() => setStep("mission")}
            />
          ) : (
            <MissionStep
              mission={mission}
              badge={badge}
              onBack={() => setStep("story")}
              onNext={() => setStep("roster")}
            />
          )}
        </main>
      </SkinWrapper>
    );
  }

  // Step 3, after a successful confirm: the celebration and the saved record
  // replace the roster. It's a one-way move — there's no returning to editing
  // the selection from here (Edit/Undo live on the Today view, task 7.14).
  if (confirmState.status === "done") {
    return (
      <SkinWrapper skin="calm" className="min-h-dvh bg-page">
        <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-28">
          <ConfirmedRecord
            mission={mission}
            total={total}
            present={confirmState.present}
            absent={confirmState.absent}
          />
        </main>
      </SkinWrapper>
    );
  }

  // Step 3: calm selection treatment (pchips grid + sticky confirm bar).
  return (
    <SkinWrapper skin="calm" className="min-h-dvh bg-page">
      <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-28">
        <RosterStep
          mission={mission}
          roster={roster}
          rosterFailed={rosterFailed}
          total={total}
          selected={selected}
          submitting={confirmState.status === "submitting"}
          errorMessage={confirmState.status === "error" ? confirmState.message : null}
          onBack={() => setStep("mission")}
          onToggle={toggle}
          onSelectEveryone={selectEveryone}
          onClearAll={clearAll}
          onConfirm={handleConfirm}
        />
      </main>
    </SkinWrapper>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Story (sticker skin)
// ---------------------------------------------------------------------------

function StoryStep({
  mission,
  showPip,
  onBack,
  onNext,
}: {
  mission: RunMissionView;
  showPip: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <BackButton onClick={onBack}>Back</BackButton>

      <span className="inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-kid-ink bg-kid-surface px-3 py-1 text-base font-semibold">
        <Icon name="fox" alt="" size={24} />
        Pip&rsquo;s story
      </span>

      <h1 className="mt-2 mb-6 font-heading text-[clamp(2rem,7vw,3.2rem)] font-extrabold leading-none">
        {mission.title}
      </h1>

      {/* The mission story, in a sticker panel. Rendered as React text. */}
      <div className="grid gap-4">
        <div className="overflow-hidden rounded-[20px] border-[2.5px] border-kid-ink bg-kid-surface shadow-sticker-sm">
          <p className="px-4 py-4 text-[1.15rem] leading-relaxed">{mission.story}</p>
        </div>

        {showPip ? (
          <div className="overflow-hidden rounded-[20px] border-[2.5px] border-kid-ink bg-kid-surface p-4 shadow-sticker-sm">
            <SafeStreetsDay1 />
          </div>
        ) : null}
      </div>

      {/* The discussion question, in the yellow highlight block. */}
      <div className="mt-4 rounded-[20px] border-[2.5px] border-kid-ink bg-kid-highlight px-4 py-4 font-heading text-[1.4rem] font-extrabold text-kid-on-highlight shadow-sticker-sm">
        Talk about it: {mission.ask}
      </div>

      <StickyBar>
        <KidButton onClick={onNext}>Show today&rsquo;s mission</KidButton>
      </StickyBar>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Mission (sticker skin)
// ---------------------------------------------------------------------------

function MissionStep({
  mission,
  badge,
  onBack,
  onNext,
}: {
  mission: RunMissionView;
  badge: { icon: string; label: string } | null;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <BackButton onClick={onBack}>Back to the story</BackButton>

      <span className="inline-flex items-center gap-1.5 rounded-full border-[2.5px] border-kid-ink bg-kid-surface px-3 py-1 text-base font-semibold">
        {badge ? <Icon name={badge.icon} alt="" size={24} /> : null}
        {mission.className}, day {mission.dayNumber}
      </span>

      <h1 className="mt-2 mb-2 font-heading text-[clamp(2rem,7vw,3.2rem)] font-extrabold leading-none">
        {mission.title}
      </h1>

      {/* Quality is shown as its stamp badge plus the quality word. */}
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border-[2.5px] border-kid-ink bg-kid-soft px-3 py-1 text-lg font-bold">
        {badge ? <Icon name={badge.icon} alt="" size={28} /> : null}
        {mission.quality}
      </div>

      {/* Instructions, in the sticker step treatment. */}
      <ol className="m-0 grid list-none gap-3 p-0">
        <li className="flex items-center gap-3 rounded-[18px] border-[2.5px] border-kid-ink bg-kid-surface px-4 py-4 text-[1.15rem] shadow-sticker-sm">
          <Icon name="round-pushpin" alt="" size={44} className="shrink-0" />
          <span>{mission.instructions}</span>
        </li>
      </ol>

      <StickyBar>
        <KidButton onClick={onNext}>We finished the activity</KidButton>
      </StickyBar>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Who took part (calm selection treatment)
// ---------------------------------------------------------------------------

function RosterStep({
  mission,
  roster,
  rosterFailed,
  total,
  selected,
  submitting,
  errorMessage,
  onBack,
  onToggle,
  onSelectEveryone,
  onClearAll,
  onConfirm,
}: {
  mission: RunMissionView;
  roster: readonly RunRosterStudent[] | null;
  rosterFailed: boolean;
  total: number;
  selected: ReadonlySet<string>;
  /** True while the confirm action is in flight; disables Confirm. */
  submitting: boolean;
  /** A failed-confirm message to show, or null (Requirement 20.6). */
  errorMessage: string | null;
  onBack: () => void;
  onToggle: (id: string) => void;
  onSelectEveryone: () => void;
  onClearAll: () => void;
  onConfirm: () => void;
}) {
  const ERROR_ID = "roster-load-error";
  const SAVE_ERROR_ID = "confirm-save-error";
  // Confirmation is blocked when the roster failed to load, nobody is checked,
  // or a confirm is already in flight (Requirements 19.5, 20.1).
  const confirmDisabled = rosterFailed || selected.size === 0 || submitting;

  return (
    <div>
      <CalmBackButton onClick={onBack}>Back to the mission</CalmBackButton>

      <h1 className="mt-1 mb-1 font-heading text-[clamp(1.6rem,5vw,2.1rem)] font-extrabold">
        Who took part?
      </h1>
      <p className="mb-4 text-subtle">
        {mission.className}, {mission.title}. Tap a name to mark someone absent or present.
        Only checked students get points and a sticker.
      </p>

      {rosterFailed ? (
        <div
          id={ERROR_ID}
          role="alert"
          className="rounded-xl border border-danger bg-surface px-4 py-3 text-base text-danger"
        >
          We couldn&rsquo;t load the class roster. Check your connection and refresh the page.
          You can&rsquo;t confirm until the roster loads.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <GhostButton onClick={onSelectEveryone}>Select everyone</GhostButton>
            <GhostButton onClick={onClearAll}>Clear all</GhostButton>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
            {(roster ?? []).map((student) => {
              const pressed = selected.has(student.id);
              const name = `${student.firstName} ${student.lastInitial}.`;
              return (
                <button
                  key={student.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onToggle(student.id)}
                  className={cn(
                    "flex min-h-[52px] items-center gap-2 rounded-[10px] border-2 px-3 py-2 text-left font-bold",
                    pressed
                      ? "border-brand bg-brand-soft text-ink"
                      : "border-line bg-surface text-subtle line-through",
                  )}
                >
                  <Icon name={student.avatar} alt="" size={28} className="shrink-0" />
                  <span>
                    {pressed ? "✓ " : ""}
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* A failed confirm: the roster and its selection are left untouched, so
          the teacher can simply tap Confirm again (Requirement 20.6). */}
      {errorMessage ? (
        <div
          id={SAVE_ERROR_ID}
          role="alert"
          className="mt-4 rounded-xl border border-danger bg-surface px-4 py-3 text-base text-danger"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Sticky confirm bar: live count + the Confirm button. */}
      <div className="sticky bottom-[calc(0.8rem+env(safe-area-inset-bottom,0px))] mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <strong aria-live="polite">
          {selected.size} of {total} students
        </strong>
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmDisabled}
          aria-describedby={
            rosterFailed ? ERROR_ID : errorMessage ? SAVE_ERROR_ID : undefined
          }
          className="min-h-[52px] rounded-lg bg-brand px-5 py-2.5 text-[1.05rem] font-bold text-on-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Confirming…" : "Confirm for class"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3, confirmed — celebration + saved record
// ---------------------------------------------------------------------------

/** Formats one roster entry the way names appear everywhere else: "First L.". */
function studentName(student: RunRosterStudent): string {
  return `${student.firstName} ${student.lastInitial}.`;
}

/** Joins absent names into the saved-record sentence, in roster order. */
function absentNames(absent: readonly RunRosterStudent[]): string {
  return absent.map(studentName).join(", ");
}

/**
 * The post-confirm screen (Requirements 20.3, 20.5). It fires the balloon
 * celebration — one balloon per present student, capped at 28 — and drops the
 * mission's building into a small town preview, then shows the saved record:
 * "<n> of <total> took part" plus the absent names. Under
 * `prefers-reduced-motion` the `<Celebration>` renders a static success line
 * and no animation (Requirement 20.4).
 */
function ConfirmedRecord({
  mission,
  total,
  present,
  absent,
}: {
  mission: RunMissionView;
  total: number;
  present: readonly RunRosterStudent[];
  absent: readonly RunRosterStudent[];
}) {
  const townItem = isTownItem(mission.townItem) ? TOWN_ITEMS[mission.townItem] : undefined;

  return (
    <div>
      <Celebration
        balloonCount={present.length}
        buildingIcon={townItem?.icon ?? mission.townItem}
        buildingLabel={townItem?.label ?? "New building"}
      />

      <h1 className="mt-1 mb-1 font-heading text-[clamp(1.6rem,5vw,2.1rem)] font-extrabold">
        Mission confirmed
      </h1>
      <p className="mb-4 text-subtle">
        {mission.className}, {mission.title}.
      </p>

      {/* The saved mission record. Every value is rendered as React text. */}
      <div className="rounded-xl border border-line bg-surface px-4 py-4">
        <p className="text-lg font-bold text-ink">
          {present.length} of {total} took part.
        </p>
        {absent.length > 0 ? (
          <p className="mt-1 text-base text-subtle">Absent: {absentNames(absent)}.</p>
        ) : (
          <p className="mt-1 text-base text-subtle">Everyone took part.</p>
        )}
        <p className="mt-3 text-sm text-subtle">
          Only the {present.length} checked{" "}
          {present.length === 1 ? "student" : "students"} earned points and a sticker. The{" "}
          {townItem?.label ?? "new building"} was added to the class town.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sticker/calm button helpers
// ---------------------------------------------------------------------------

function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 min-h-[44px] py-1 font-semibold text-kid-muted"
    >
      {children}
    </button>
  );
}

function CalmBackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 min-h-[44px] py-1 font-semibold text-subtle"
    >
      {children}
    </button>
  );
}

function KidButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[64px] w-full items-center justify-center rounded-full border-[2.5px] border-kid-ink bg-kid-primary px-6 py-3 text-[1.1rem] font-semibold text-kid-on-primary shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 sm:w-auto"
    >
      {children}
    </button>
  );
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] rounded-lg border border-line bg-transparent px-4 py-2 font-bold text-ink"
    >
      {children}
    </button>
  );
}

function StickyBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(0.8rem+env(safe-area-inset-bottom,0px))] mt-5 flex justify-end sm:static">
      {children}
    </div>
  );
}
