import { cn } from "@/lib/utils";
import { Icon, TOWN_ITEMS, isTownItem } from "@/components/Icon";
import { placeTown } from "@/lib/domain/town";
import type { MissionRef, TownStage } from "@/lib/domain/types";

type TownGridProps = {
  /**
   * Rows from the `class_town` view — one per distinct approved mission
   * (Requirement 22.2). They are passed through {@link placeTown} here so a
   * mission always lands in the same cell regardless of input order.
   */
  missions: MissionRef[];
  /**
   * The stage from {@link townStage}, which sets the grid size and capacity.
   * Buildings never exceed `stage.capacity`.
   */
  stage: TownStage;
  className?: string;
};

/**
 * The class town grid (Requirements 22.2, 22.3): a CSS grid sized by the stage
 * (6×6 before the city stage, 8×8 at it), one {@link Icon} per placed building.
 * With zero missions every cell is a dashed placeholder, so an empty class
 * shows an empty town rather than nothing (Requirement 22.3).
 *
 * A server component: it only reads props and renders static markup inside the
 * sticker skin applied by a parent `SkinWrapper`.
 */
export function TownGrid({ missions, stage, className }: TownGridProps) {
  const cells = placeTown(missions, stage.capacity);
  // A row-major array of exactly `capacity` slots; a filled slot holds its cell.
  const slots = Array.from({ length: stage.capacity }, (_, index) =>
    cells.find((cell) => cell.cellIndex === index),
  );

  return (
    <div
      role="img"
      aria-label={`Class town with ${cells.length} ${cells.length === 1 ? "building" : "buildings"}`}
      className={cn("grid gap-1.5", className)}
      style={{ gridTemplateColumns: `repeat(${stage.gridSize}, minmax(0, 1fr))` }}
    >
      {slots.map((cell, index) => {
        if (cell === undefined) {
          return (
            <div
              key={index}
              aria-hidden="true"
              className="aspect-square rounded-xl border-2 border-dashed border-kid-muted opacity-50"
            />
          );
        }

        const item = isTownItem(cell.townItem) ? TOWN_ITEMS[cell.townItem] : undefined;
        return (
          <div
            key={cell.missionId}
            className="grid aspect-square place-items-center rounded-xl border-2 border-kid-ink bg-kid-soft p-1.5"
          >
            <Icon
              name={item?.icon ?? cell.townItem}
              alt={item?.label ?? cell.townItem}
              size={40}
              className="h-full w-full object-contain"
            />
          </div>
        );
      })}
    </div>
  );
}
