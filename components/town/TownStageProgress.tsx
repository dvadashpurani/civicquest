import { cn } from "@/lib/utils";
import type { TownStage } from "@/lib/domain/types";

/** Human labels for each stage, in ascending rank order. */
const STAGE_LABEL: Record<TownStage["stage"], string> = {
  "pre-village": "Getting started",
  village: "Village",
  town: "Town",
  city: "City",
};

type TownStageProgressProps = {
  /** The stage from {@link townStage}; its `capacity` is the bar's full width. */
  stage: TownStage;
  /**
   * Current building count (distinct approved missions). Clamped to the stage
   * capacity when it is drawn, so the bar never overflows.
   */
  count: number;
  className?: string;
};

/**
 * The class-town stage progress bar (Requirement 22.2): the current stage name
 * with the building count and capacity, and a pill bar filled to
 * `count / capacity`. Matches the sticker `.bar` treatment in docs/demo.html —
 * a 2.5px ink outline, pill radius, kid-surface track.
 *
 * A server component rendered inside the sticker skin.
 */
export function TownStageProgress({ stage, count, className }: TownStageProgressProps) {
  const filled = Math.max(0, Math.min(count, stage.capacity));
  const percent = stage.capacity > 0 ? (filled / stage.capacity) * 100 : 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-heading text-lg font-extrabold text-kid-ink">
          {STAGE_LABEL[stage.stage]}
        </span>
        <span className="text-base text-kid-muted">
          {filled} of {stage.capacity}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={stage.capacity}
        aria-valuenow={filled}
        aria-label={`${STAGE_LABEL[stage.stage]} stage, ${filled} of ${stage.capacity} buildings`}
        className="h-4 overflow-hidden rounded-full border-[2.5px] border-kid-ink bg-kid-surface"
      >
        <div
          className="h-full bg-kid-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
