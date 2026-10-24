"use client";

// The interactive Edit/Undo controls for a "Done today" card (Requirements
// 21.1, 21.3, 21.6, 21.7, 21.9). The Today view (a server component) renders
// the static card and hands this client component the already-loaded roster
// and saved selection; this component owns only which control is open:
//
//   - the two affordance buttons ("Edit who took part", "Undo"), shown by
//     default;
//   - the inline <EditParticipants> roster editor, shown while editing;
//   - the <UndoDialog> native dialog, shown while confirming an undo.
//
// Both controls are rendered ONLY by the Today view's layout-1 Done-today card,
// which the server only produces while the confirmation is < 24h old
// (design.md layout 1, Requirement 21.9). The RPCs re-enforce the window, so a
// control left open past 24h fails safely with the generic save-failed message.
//
// After a successful edit or undo, `router.refresh()` re-runs the server
// loaders so the card, the next-mission block, the proof log, and the class
// town all reflect the change — the server action already revalidated those
// paths, and the refresh pulls the new render in without a full reload.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditParticipants } from "./EditParticipants";
import { UndoDialog } from "./UndoDialog";
import type { RosterStudent } from "@/lib/server/teacher";

type DoneTodayControlsProps = {
  classId: string;
  missionId: string;
  /** The class roster, or `null` when it failed to load. */
  roster: readonly RosterStudent[] | null;
  /** The saved present selection (approved completion student ids) to preselect. */
  savedSelection: readonly string[];
};

type Mode = "idle" | "editing" | "undoing";

export function DoneTodayControls({
  classId,
  missionId,
  roster,
  savedSelection,
}: DoneTodayControlsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");

  // The number of students who currently hold the mission's points/stickers,
  // for the undo dialog's copy. The saved selection is that set.
  const presentCount = savedSelection.length;

  if (mode === "editing") {
    return (
      <EditParticipants
        classId={classId}
        missionId={missionId}
        roster={roster}
        savedSelection={savedSelection}
        onCancel={() => setMode("idle")}
        onSaved={() => router.refresh()}
      />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setMode("editing")}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-surface px-4 py-2 font-bold text-ink"
        >
          Edit who took part
        </button>
        <button
          type="button"
          onClick={() => setMode("undoing")}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-danger px-4 py-2 font-bold text-danger"
        >
          Undo
        </button>
      </div>

      <UndoDialog
        open={mode === "undoing"}
        onClose={() => setMode("idle")}
        classId={classId}
        missionId={missionId}
        presentCount={presentCount}
        onUndone={() => router.refresh()}
      />
    </>
  );
}
