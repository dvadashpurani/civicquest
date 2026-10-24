"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { setStudentTheme } from "./actions";

const THEMES = [
  { key: "classic", label: "Classic", swatch: "#2F8F5B" },
  { key: "hero", label: "Hero", swatch: "#E63946" },
  { key: "bubblegum", label: "Bubblegum", swatch: "#FF5FA2" },
  { key: "ocean", label: "Ocean", swatch: "#0EA5E9" },
] as const;

type ThemePickerProps = {
  classId: string;
  studentId: string;
  current: string;
};

/** "My theme": four pill buttons that save the student's theme. */
export function ThemePicker({ classId, studentId, current }: ThemePickerProps) {
  const [selected, setSelected] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(theme: (typeof THEMES)[number]["key"]) {
    const previous = selected;
    setSelected(theme);
    setError(null);
    startTransition(async () => {
      const result = await setStudentTheme({ classId, studentId, theme });
      if (!result.ok) {
        setSelected(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-6">
      <div
        role="group"
        aria-label="Pick your theme"
        className="flex flex-wrap items-center gap-2 text-kid-muted"
      >
        <span className="mr-1">My theme:</span>
        {THEMES.map((theme) => (
          <button
            key={theme.key}
            type="button"
            aria-pressed={selected === theme.key}
            disabled={pending}
            onClick={() => choose(theme.key)}
            className={cn(
              "inline-flex min-h-12 items-center gap-2 rounded-full border-[2.5px] border-kid-ink px-4 text-base",
              selected === theme.key ? "bg-kid-ink text-kid-bg" : "bg-kid-surface text-kid-ink",
            )}
          >
            <i
              aria-hidden="true"
              className="inline-block h-4 w-4 rounded-full border-2 border-kid-ink"
              style={{ background: theme.swatch }}
            />
            {theme.label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-base text-kid-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
