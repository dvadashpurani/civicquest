import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export type WeekStation = {
  readonly id: string;
  readonly dayNumber: number;
  readonly title: string;
  readonly confirmed: boolean;
};

type WeekLineProps = {
  days: readonly WeekStation[];
  /** The mission the class does next (today's station), if any. */
  todayId?: string | null;
  className?: string;
};

/**
 * The calm transit line for one module (design.md "The roadmap is a transit
 * line"): Monday to Friday stations, done stations filled green, and today a
 * dark dot with a yellow ring.
 */
export function WeekLine({ days, todayId, className }: WeekLineProps) {
  return (
    <ol
      className={cn("relative grid grid-cols-5 gap-1", className)}
      aria-label="This week's missions"
    >
      <span
        aria-hidden="true"
        className="absolute left-[10%] right-[10%] top-[10px] h-1 rounded bg-line"
      />
      {days.map((day) => {
        const isToday = day.id === todayId;
        const state = day.confirmed ? "done" : isToday ? "today" : "upcoming";
        return (
          <li
            key={day.id}
            className="relative flex flex-col items-center gap-1 text-center text-sm leading-tight text-subtle"
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-6 w-6 rounded-full border-4",
                state === "done" && "border-brand bg-brand",
                state === "today" && "border-today bg-ink",
                state === "upcoming" && "border-line bg-surface",
              )}
            />
            <b className="font-heading text-ink">{WEEKDAYS[day.dayNumber - 1] ?? `Day ${day.dayNumber}`}</b>
            <span className="break-words">{day.title}</span>
            <span className="sr-only">
              {state === "done" ? "Done" : state === "today" ? "Today" : "Coming up"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
