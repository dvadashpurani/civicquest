import { cn } from "@/lib/utils";
import { Icon, QUALITY_BUILDINGS, TOWN_ITEMS } from "@/components/Icon";
import type { ClassRewards } from "@/components/town/RewardsList";

/** The three shared rewards and the building count each unlocks at. */
export const REWARD_STAGES: readonly {
  readonly key: keyof ClassRewards;
  readonly name: string;
  readonly at: number;
  readonly reward: string;
}[] = [
  { key: "village", name: "Village", at: 10, reward: "The class picks a game for Friday afternoon." },
  { key: "town", name: "Town", at: 25, reward: "The class goes on the school's Good Citizens board." },
  { key: "city", name: "City", at: 36, reward: "The principal visits for a class celebration." },
];

const FULL_TOWN = 36;

/** The stage name for a building count, matching lib/domain/town.ts thresholds. */
export function stageName(count: number): string {
  if (count >= 36) return "City";
  if (count >= 25) return "Town";
  if (count >= 10) return "Village";
  return "Getting started";
}

/** "7 more buildings to become a town", or the finished message. */
export function nextStageText(count: number): string {
  const next = REWARD_STAGES.find((stage) => count < stage.at);
  if (!next) return "Your class built a whole city";
  const left = next.at - count;
  return `${left} more ${left === 1 ? "building" : "buildings"} to become a ${next.name.toLowerCase()}`;
}

type CrosswalkBarProps = { count: number; className?: string };

/**
 * The town progress bar: crosswalk stripes on an ink outline, with a marker at
 * each reward (10, 25, 36). A reached marker turns solid with a check.
 */
export function CrosswalkBar({ count, className }: CrosswalkBarProps) {
  const filled = Math.max(0, Math.min(count, FULL_TOWN));
  return (
    <div className={cn("relative pt-3 pb-1", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={FULL_TOWN}
        aria-valuenow={filled}
        aria-label={`${filled} of ${FULL_TOWN} buildings`}
        className="h-4 overflow-hidden rounded-full border-[2.5px] border-kid-ink bg-kid-surface"
      >
        <div
          className="h-full transition-[width] duration-700 motion-reduce:transition-none"
          style={{
            width: `${(filled / FULL_TOWN) * 100}%`,
            background:
              "repeating-linear-gradient(90deg, var(--kid-primary) 0 14px, var(--kid-highlight) 14px 22px)",
          }}
        />
      </div>
      {REWARD_STAGES.map((stage) => {
        const hit = count >= stage.at;
        return (
          <span
            key={stage.key}
            aria-hidden="true"
            className={cn(
              "absolute top-1 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full border-[2.5px] border-kid-ink text-xs font-bold",
              hit ? "bg-kid-primary text-kid-on-primary" : "bg-kid-surface text-kid-ink",
            )}
            style={{ left: `min(calc(100% - 14px), ${(stage.at / FULL_TOWN) * 100}%)` }}
          >
            {hit ? "✓" : stage.at}
          </span>
        );
      })}
    </div>
  );
}

type ClassEarnsProps = {
  count: number;
  /** Teacher-set rewards from class_rewards; shown under the shared reward. */
  rewards?: ClassRewards;
  /** Larger type for the projector. */
  size?: "default" | "projector";
  className?: string;
};

/**
 * "What the class earns" (docs/simulation.html "Class town"): the crosswalk
 * progress bar and one card per reward stage, marked Unlocked once reached.
 * Rewards are shared by the whole class, so nobody is left behind.
 */
export function ClassEarns({ count, rewards, size = "default", className }: ClassEarnsProps) {
  const big = size === "projector";
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[24px] border-[2.5px] border-kid-ink bg-kid-surface p-5 shadow-sticker",
        className,
      )}
    >
      <h2 className={cn("font-heading font-extrabold text-kid-ink", big ? "text-3xl" : "text-2xl")}>
        What the class earns
      </h2>
      <p className={cn("text-kid-muted", big ? "text-xl" : "text-base")}>
        Everyone shares these rewards, so nobody is left behind.
      </p>
      <CrosswalkBar count={count} />
      <ul className="flex flex-col gap-2">
        {REWARD_STAGES.map((stage) => {
          const hit = count >= stage.at;
          const teacherReward = rewards?.[stage.key]?.trim();
          return (
            <li
              key={stage.key}
              className={cn(
                "flex items-start gap-3 rounded-[18px] border-2 p-3",
                hit ? "border-kid-ink bg-kid-soft" : "border-dashed border-kid-muted bg-kid-surface",
              )}
            >
              <span
                className={cn(
                  "shrink-0 rounded-full border-2 border-kid-ink px-2.5 py-0.5 font-heading font-extrabold",
                  hit ? "bg-kid-highlight text-kid-on-highlight" : "bg-kid-surface text-kid-ink",
                  big ? "text-lg" : "text-sm",
                )}
              >
                {stage.name}
              </span>
              <span className={cn("text-kid-ink", big ? "text-xl" : "text-base")}>
                {stage.at} buildings. {stage.reward}
                {teacherReward ? (
                  <span className="block text-kid-muted">Plus from your teacher: {teacherReward}</span>
                ) : null}
                {hit ? <strong className="block font-bold text-kid-primary">Unlocked</strong> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "Which mission builds what": one building per stamp quality. */
export function BuildLegend({ className, size = "default" }: { className?: string; size?: "default" | "projector" }) {
  const big = size === "projector";
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-[24px] border-[2.5px] border-kid-ink bg-kid-surface p-5 shadow-sticker",
        className,
      )}
    >
      <h2 className={cn("font-heading font-extrabold text-kid-ink", big ? "text-3xl" : "text-2xl")}>
        Which mission builds what
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {QUALITY_BUILDINGS.map(({ quality, townItem }) => (
          <li key={quality} className={cn("flex items-center gap-2 text-kid-ink", big ? "text-xl" : "text-base")}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border-2 border-kid-ink bg-kid-soft p-1">
              <Icon name={TOWN_ITEMS[townItem].icon} alt="" size={32} />
            </span>
            <span>
              <strong className="font-bold">{quality}</strong>
              <span className="block text-sm text-kid-muted">{TOWN_ITEMS[townItem].label}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
