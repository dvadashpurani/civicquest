import { cn } from "@/lib/utils";
import { PRE_VILLAGE_MAX, VILLAGE_MAX, TOWN_MAX } from "@/lib/domain/town";

/**
 * The three teacher-set rewards for a class, one per unlocking stage
 * (glossary "Reward"). Mirrors the `class_rewards` row. A reward may be an
 * empty string when the teacher has not set one.
 */
export type ClassRewards = {
  /** Reward unlocked at the village stage. */
  readonly village: string;
  /** Reward unlocked at the town stage. */
  readonly town: string;
  /** Reward unlocked at the city stage. */
  readonly city: string;
};

type RewardStage = {
  readonly key: keyof ClassRewards;
  readonly label: string;
  /** Building count at which this stage's reward unlocks. */
  readonly unlocksAt: number;
};

/**
 * The three reward stages with the building count each unlocks at — village at
 * 10, town at 25, city at 36 — derived from the stage thresholds in
 * `lib/domain/town.ts` so they stay in step with {@link townStage}
 * (Requirements 12.3–12.5).
 */
const REWARD_STAGES: readonly RewardStage[] = [
  { key: "village", label: "Village", unlocksAt: PRE_VILLAGE_MAX + 1 },
  { key: "town", label: "Town", unlocksAt: VILLAGE_MAX + 1 },
  { key: "city", label: "City", unlocksAt: TOWN_MAX + 1 },
];

type RewardsListProps = {
  rewards: ClassRewards;
  className?: string;
};

/**
 * The class's village, town, and city rewards with their stages
 * (Requirement 22.5). Each reward is a sticker card showing the stage name, the
 * building count it unlocks at, and the reward text. Rendered inside the
 * sticker skin applied by a parent `SkinWrapper`.
 */
export function RewardsList({ rewards, className }: RewardsListProps) {
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {REWARD_STAGES.map(({ key, label, unlocksAt }) => {
        const reward = rewards[key].trim();
        return (
          <li
            key={key}
            className="flex flex-col gap-1 rounded-[18px] border-kid-ink bg-kid-surface p-4 shadow-sticker sticker-outline"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-heading text-lg font-extrabold text-kid-ink">
                {label}
              </span>
              <span className="text-base text-kid-muted">
                {unlocksAt} buildings
              </span>
            </div>
            <p
              className={cn(
                "text-base",
                reward ? "text-kid-ink" : "text-kid-muted italic",
              )}
            >
              {reward || "No reward set yet"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
