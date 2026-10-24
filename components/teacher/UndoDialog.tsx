"use client";

// The teacher Undo dialog for a recently-confirmed mission (Requirements 21.6,
// 21.7, 21.9). It opens a native `<dialog>` with a radio group of EXACTLY the
// three teacher reasons from `TEACHER_UNDO_REASONS` — "pressed by mistake",
// "the activity didn't happen", "wrong class" — and a danger "Undo mission"
// button that calls the `undoMission` server action with the chosen reason.
//
// The reason control is constrained to the three strings (Requirement 21.7):
// the radio group can only ever submit one of them, and the server action
// re-validates against the same `z.enum` schema, so a crafted value never
// reaches the RPC. The control is only rendered by the Today view while the
// confirmation is < 24h old (design.md layout 1); the RPC re-enforces the
// window, so a stale dialog left open past 24h fails safely with the generic
// save-failed message.
//
// This is a CALM teacher interaction. It matches docs/demo.html `openUndo()`:
// a `<dialog>` with a `<fieldset>`/`<legend>` "Why are you undoing it?", the
// three radios (first one preselected), a ghost "Keep it" cancel button and a
// solid-danger "Undo mission" button laid out in a right-aligned action row
// (the `.dlg` / `.dlg-acts` / `.cbtn.danger-solid` treatment).

import { useEffect, useRef, useState } from "react";
import { undoMission } from "@/app/(teacher)/teacher/actions";
import {
  TEACHER_UNDO_REASONS,
  type TeacherUndoReason,
} from "@/lib/validation/mission";

type UndoDialogProps = {
  /** Whether the dialog is open; the parent owns this so one card controls it. */
  open: boolean;
  /** Called when the dialog closes (cancel, backdrop, Escape, or a successful undo). */
  onClose: () => void;
  /** The class whose confirmed mission is being undone. */
  classId: string;
  /** The confirmed mission to undo. */
  missionId: string;
  /** How many students currently hold the mission's points/stickers, for the copy. */
  presentCount: number;
  /** Called after a successful undo so the parent can refresh its view. */
  onUndone?: () => void;
};

/** Human copy for a submit failure — mirrors the server action's generic message. */
const SAVE_FAILED_MESSAGE = "That didn't save. Wait a moment, then try again.";

/** The confirm-dialog lifecycle: editable, in flight, or failed (stays open). */
type UndoState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string };

export function UndoDialog({
  open,
  onClose,
  classId,
  missionId,
  presentCount,
  onUndone,
}: UndoDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Default to the first reason, exactly as the demo preselects "pressed by
  // mistake" (Requirement 21.7: a reason is always one of the three).
  const [reason, setReason] = useState<TeacherUndoReason>(TEACHER_UNDO_REASONS[0]);
  const [state, setState] = useState<UndoState>({ status: "idle" });

  // Drive the native dialog's open/closed state from the `open` prop. Using
  // showModal() gives us the backdrop, focus trapping, and Escape-to-close for
  // free. Reset the reason and any error each time it reopens.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason(TEACHER_UNDO_REASONS[0]);
      setState({ status: "idle" });
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function handleUndo() {
    if (state.status === "submitting") return;
    setState({ status: "submitting" });

    let result;
    try {
      result = await undoMission({ classId, missionId, reason });
    } catch {
      setState({ status: "error", message: SAVE_FAILED_MESSAGE });
      return;
    }

    if (!result.ok) {
      // Leave the dialog open so the teacher can retry; nothing changed.
      setState({ status: "error", message: result.error });
      return;
    }

    onUndone?.();
    onClose();
  }

  const submitting = state.status === "submitting";
  const errorMessage = state.status === "error" ? state.message : null;
  const ERROR_ID = "undo-error";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="undo-title"
      // `close` fires for Escape and backdrop dismissal as well as our own
      // close() call; keep the parent's `open` in sync without re-submitting.
      onClose={() => {
        if (open) onClose();
      }}
      // Dismiss on a backdrop click (clicks that land on the dialog element
      // itself, outside the inner form).
      onClick={(event) => {
        if (event.target === dialogRef.current && !submitting) onClose();
      }}
      className="w-[min(92vw,30rem)] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/55"
    >
      <div className="grid gap-4 p-6">
        <h2 id="undo-title" className="font-heading text-xl font-extrabold text-ink">
          Undo this mission?
        </h2>
        <p className="text-base text-subtle">
          This removes the points and stickers from {presentCount}{" "}
          {presentCount === 1 ? "student" : "students"} and takes the building out
          of the class town. The mission goes back to &ldquo;not done,&rdquo; so you
          can run it again.
        </p>

        <fieldset className="grid gap-1 rounded-xl border border-line px-3 py-2">
          <legend className="px-1 font-bold text-ink">Why are you undoing it?</legend>
          {TEACHER_UNDO_REASONS.map((value) => (
            <label
              key={value}
              className="flex min-h-[40px] items-center gap-2 text-base text-ink"
            >
              <input
                type="radio"
                name="undo-reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                disabled={submitting}
                className="h-4 w-4 accent-brand"
              />
              <span>{value}</span>
            </label>
          ))}
        </fieldset>

        <p className="text-sm text-subtle">
          The undo is saved in the proof log with your name and the time.
        </p>

        {errorMessage ? (
          <p
            id={ERROR_ID}
            role="alert"
            className="rounded-lg border border-danger bg-surface px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-[44px] rounded-lg border border-line bg-transparent px-4 py-2 font-bold text-ink disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={submitting}
            aria-describedby={errorMessage ? ERROR_ID : undefined}
            className="min-h-[44px] rounded-lg bg-danger px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Undoing…" : "Undo mission"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
