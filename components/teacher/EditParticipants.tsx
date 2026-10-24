"use client";

// "Edit who took part" for a recently-confirmed mission (Requirements 21.1,
// 21.3, 21.9). Tapping Edit reopens the class roster with the SAVED selection
// preselected — the set of students who currently hold an `approved`
// completion for the mission — and a "Save changes" button that calls the
// `editParticipants` server action with the new set. The RPC adds newly
// checked students and reverses removed ones within the 24h window; this
// component only drives the selection and submission (design.md
// "edit_mission_participants").
//
// This mirrors the run screen's Who-took-part step and docs/demo.html's
// `roster()` edit mode (`S.editing`): the same calm `.pchips` grid, the same
// "Select everyone" / "Clear all" controls, and the same sticky count bar — but
// the primary button reads "Save changes" instead of "Confirm for class", and
// a Cancel link steps back without changing anything. The control is only
// rendered by the Today view while the confirmation is < 24h old; the RPC
// re-enforces the window, so a stale edit left open fails safely.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import { editParticipants } from "@/app/(teacher)/teacher/actions";
import type { RosterStudent } from "@/lib/server/teacher";

type EditParticipantsProps = {
  /** The class whose confirmed mission is being edited. */
  classId: string;
  /** The confirmed mission to edit. */
  missionId: string;
  /** The class roster, or `null` when it failed to load. */
  roster: readonly RosterStudent[] | null;
  /** The saved present selection to preselect (approved completion student ids). */
  savedSelection: readonly string[];
  /** Called when the teacher cancels out of edit mode. */
  onCancel: () => void;
  /** Called after a successful save so the parent can refresh its view. */
  onSaved?: () => void;
};

/** Human copy for a submit failure — mirrors the server action's generic message. */
const SAVE_FAILED_MESSAGE = "That didn't save. Wait a moment, then try again.";

/** The save lifecycle: editable roster, in flight, or failed (roster unchanged). */
type SaveState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

export function EditParticipants({
  classId,
  missionId,
  roster,
  savedSelection,
  onCancel,
  onSaved,
}: EditParticipantsProps) {
  const rosterFailed = roster === null;

  // Start from the SAVED selection (Requirement 21.1), intersected with the
  // current roster so a stale id can never end up checked.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => {
    const rosterIds = new Set((roster ?? []).map((student) => student.id));
    return new Set(savedSelection.filter((id) => rosterIds.has(id)));
  });
  const [state, setState] = useState<SaveState>({ status: "idle" });

  const total = roster?.length ?? 0;
  const submitting = state.status === "submitting";
  const errorMessage = state.status === "error" ? state.message : null;
  const ERROR_ID = "edit-roster-error";
  const SAVE_ERROR_ID = "edit-save-error";

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

  async function handleSave() {
    if (submitting || rosterFailed) return;

    const presentStudentIds = (roster ?? [])
      .filter((student) => selected.has(student.id))
      .map((student) => student.id);

    setState({ status: "submitting" });

    let result;
    try {
      result = await editParticipants({ classId, missionId, presentStudentIds });
    } catch {
      setState({ status: "error", message: SAVE_FAILED_MESSAGE });
      return;
    }

    if (!result.ok) {
      // Leave the selection exactly as it is so the teacher can retry.
      setState({ status: "error", message: result.error });
      return;
    }

    onSaved?.();
    onCancel();
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="font-heading text-lg font-extrabold text-ink">
          Edit who took part
        </h4>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="min-h-[40px] py-1 font-semibold text-subtle disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p className="mb-3 text-sm text-subtle">
        Tap a name to mark someone absent or present. Only checked students keep
        points and a sticker.
      </p>

      {rosterFailed ? (
        <div
          id={ERROR_ID}
          role="alert"
          className="rounded-xl border border-danger bg-surface px-4 py-3 text-base text-danger"
        >
          We couldn&rsquo;t load the class roster. Check your connection and
          refresh the page. You can&rsquo;t save changes until the roster loads.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={selectEveryone}
              disabled={submitting}
              className="min-h-[44px] rounded-lg border border-line bg-transparent px-4 py-2 font-bold text-ink disabled:opacity-50"
            >
              Select everyone
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={submitting}
              className="min-h-[44px] rounded-lg border border-line bg-transparent px-4 py-2 font-bold text-ink disabled:opacity-50"
            >
              Clear all
            </button>
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
                  onClick={() => toggle(student.id)}
                  disabled={submitting}
                  className={cn(
                    "flex min-h-[52px] items-center gap-2 rounded-[10px] border-2 px-3 py-2 text-left font-bold disabled:opacity-60",
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

      {errorMessage ? (
        <div
          id={SAVE_ERROR_ID}
          role="alert"
          className="mt-4 rounded-xl border border-danger bg-surface px-4 py-3 text-base text-danger"
        >
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-page px-4 py-3">
        <strong aria-live="polite">
          {selected.size} of {total} students
        </strong>
        <button
          type="button"
          onClick={handleSave}
          disabled={rosterFailed || submitting}
          aria-describedby={
            rosterFailed ? ERROR_ID : errorMessage ? SAVE_ERROR_ID : undefined
          }
          className="min-h-[52px] rounded-lg bg-brand px-5 py-2.5 text-[1.05rem] font-bold text-on-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
