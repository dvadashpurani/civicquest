import { cn } from "@/lib/utils";
import {
  rankLeaderboard,
  type ClassPointsRow,
  type LeaderboardEntry,
} from "@/lib/domain/leaderboard";

type LeaderboardProps = {
  /**
   * `class_points` rows the viewer can see. These already come scoped to the
   * viewer's school by row-level security, so the leaderboard is inherently
   * within-school (Requirement 23.4); this component adds no cross-school data.
   */
  rows: readonly ClassPointsRow[];
  /**
   * The id of the viewer's own class, when there is one, so it can be
   * highlighted in the standing. The leaderboard ranks classes, never
   * individual students, so no child is ever singled out (Requirement 23.5).
   */
  currentClassId?: string | null;
  /** Optional extra classes for the outer panel. */
  className?: string;
  /** Panel heading; defaults to "Class leaderboard". */
  title?: string;
  /** Short line beside the heading, e.g. "Classes compete, not kids". */
  subtitle?: string;
};

/** Formats points per student for display: whole numbers stay whole, otherwise one decimal. */
function formatScore(pointsPerStudent: number): string {
  return Number.isInteger(pointsPerStudent)
    ? String(pointsPerStudent)
    : pointsPerStudent.toFixed(1);
}

/**
 * The within-school class leaderboard (Requirement 23), rendered in the calm
 * skin for teacher and admin screens. Classes are ranked by points per student
 * (total approved points ÷ enrolled students; zero students → 0) descending,
 * with ties sharing a rank and ordered by class name — all computed by the pure
 * {@link rankLeaderboard}. The rows arrive already scoped to the viewer's
 * school by RLS, so visibility stays within the school (Requirement 23.4).
 *
 * Per Requirement 23.5 this is a leaderboard **by class, never by student**: it
 * renders no individual student rankings, so a Learners class viewing it never
 * sees a child singled out. Styling mirrors the demo's calm `.cpanel` / `.row`
 * treatment using the calm tokens (bg-surface, text-ink, border-line,
 * text-subtle).
 */
export function Leaderboard({
  rows,
  currentClassId,
  className,
  title = "Class leaderboard",
  subtitle,
}: LeaderboardProps) {
  const entries: LeaderboardEntry[] = rankLeaderboard(rows);

  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface p-4 text-ink",
        className,
      )}
      aria-labelledby="leaderboard-heading"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="leaderboard-heading" className="font-heading text-lg font-extrabold">
          {title}
        </h2>
        {subtitle ? <span className="text-sm text-subtle">{subtitle}</span> : null}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-subtle">
          No classes to rank yet. Rankings appear once classes are set up.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {entries.map((entry) => {
            const isCurrent = currentClassId != null && entry.classId === currentClassId;
            return (
              <li
                key={entry.classId}
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 border-b border-line py-3 last:border-b-0",
                  isCurrent && "font-bold",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="min-w-8 text-center text-base font-extrabold tabular-nums text-subtle"
                    aria-hidden="true"
                  >
                    #{entry.rank}
                  </span>
                  <div>
                    <strong>{entry.name}</strong>
                    <br />
                    <small className="text-subtle">
                      {entry.studentCount}{" "}
                      {entry.studentCount === 1 ? "student" : "students"}
                    </small>
                  </div>
                </div>
                <div className="text-right">
                  <strong className="tabular-nums">
                    {formatScore(entry.pointsPerStudent)}
                  </strong>
                  <br />
                  <small className="text-subtle">points per student</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
