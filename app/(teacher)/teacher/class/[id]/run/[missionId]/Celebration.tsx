"use client";

// The confirm celebration (Requirements 20.3, 20.4), matching docs/demo.html:
// balloons rise from the bottom of the screen — one per present student, capped
// at 28 — and the mission's building drops into a small town preview. The
// `motion` package (motion/react) drives both animations.
//
// Accessibility and reduced motion (Requirement 20.4): `useReducedMotion`
// reads the user's `prefers-reduced-motion` setting. When reduce is set, no
// balloons render and the building is placed without the drop; a single static
// success line stands in for the animation. The balloons are purely decorative
// (`aria-hidden`), so the celebration never adds noise for a screen reader —
// the saved record alongside carries the real result.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/Icon";

/** Requirement 20.3: at most 28 balloons, regardless of class size. */
const MAX_BALLOONS = 28;

type CelebrationProps = {
  /** Present (checked) student count; the balloon count before the cap. */
  balloonCount: number;
  /** Icon name for the building that drops into the town. */
  buildingIcon: string;
  /** Alt text / label for that building. */
  buildingLabel: string;
};

export function Celebration({ balloonCount, buildingIcon, buildingLabel }: CelebrationProps) {
  const reduceMotion = useReducedMotion();

  // One balloon per present student, never more than the cap (Requirement 20.3).
  const balloons = Math.max(0, Math.min(balloonCount, MAX_BALLOONS));

  if (reduceMotion) {
    // Static celebration message — no balloons, no drop (Requirement 20.4).
    return (
      <div
        role="status"
        className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-brand-soft px-4 py-3"
      >
        <Icon name={buildingIcon} alt="" size={40} className="shrink-0" />
        <p className="text-lg font-bold text-ink">
          Nice work! The {buildingLabel.toLowerCase()} joined the class town.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Full-screen balloon layer. Decorative, non-interactive, above content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-20 overflow-hidden"
      >
        <AnimatePresence>
          {Array.from({ length: balloons }, (_, index) => (
            <Balloon key={index} index={index} />
          ))}
        </AnimatePresence>
      </div>

      {/* The building dropping into a small town preview. */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-brand-soft px-4 py-3">
        <motion.span
          initial={{ y: -40, scale: 0.4, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.2, 1.6, 0.4, 1] }}
          className="grid aspect-square w-14 place-items-center rounded-xl border-2 border-kid-ink bg-kid-soft p-1.5"
        >
          <Icon name={buildingIcon} alt={buildingLabel} size={40} className="h-full w-full object-contain" />
        </motion.span>
        <p className="text-lg font-bold text-ink">
          The {buildingLabel.toLowerCase()} joined the class town.
        </p>
      </div>
    </>
  );
}

/**
 * One rising balloon. The horizontal start, rise duration, and start delay are
 * jittered per balloon so the burst reads as a crowd rather than a column —
 * matching the `rise` keyframes and random offsets in docs/demo.html.
 */
function Balloon({ index }: { index: number }) {
  // Deterministic-enough jitter from the index keeps render stable across
  // re-renders without pulling in a random source on the server path.
  const left = 3 + ((index * 37) % 90);
  const delay = ((index * 13) % 9) / 10;
  const duration = 2.4 + (((index * 7) % 6) / 10);

  return (
    <motion.span
      className="absolute bottom-0"
      style={{ left: `${left}%` }}
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: "-90vh", opacity: [0, 1, 1, 0] }}
      transition={{ duration, delay, ease: "easeIn", times: [0, 0.1, 0.82, 1] }}
    >
      <Icon name="balloon" alt="" size={48} />
    </motion.span>
  );
}
