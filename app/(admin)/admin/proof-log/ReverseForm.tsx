"use client";

import { useState, useTransition } from "react";
import { reverseConfirmation } from "../actions";

/** "Reverse" on a proof-log confirm: opens a reason box, then calls the action. */
export function ReverseForm({ classId, missionId }: { classId: string; missionId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-lg border border-danger px-3 text-sm text-danger"
      >
        Reverse
      </button>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await reverseConfirmation({ classId, missionId, reason });
          if (!result.ok) setError(result.error);
          else setOpen(false);
        });
      }}
    >
      <label className="text-sm font-bold text-ink" htmlFor={`reason-${classId}-${missionId}`}>
        Why are you reversing this?
      </label>
      <textarea
        id={`reason-${classId}-${missionId}`}
        required
        maxLength={500}
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="w-full rounded-lg border border-line bg-surface p-2 text-base text-ink"
      />
      <p className="text-sm text-subtle">
        This removes the points, stickers, and building. It stays in the proof log with your name.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-sm text-ink"
        >
          Keep it
        </button>
        <button
          type="submit"
          disabled={pending || reason.trim() === ""}
          className="inline-flex min-h-11 items-center rounded-lg bg-danger px-3 text-sm text-white disabled:opacity-50"
        >
          {pending ? "Reversing…" : "Reverse mission"}
        </button>
      </div>
    </form>
  );
}
