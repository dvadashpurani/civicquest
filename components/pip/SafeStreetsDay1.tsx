import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Pip's "Safe Streets, day 1" comic.
 *
 * Pip is an ORIGINAL, friendly fox mascot for CivicQuest, drawn here entirely from basic
 * SVG shapes (ellipses, paths, circles) so there is no dependency on — and no resemblance
 * to — any existing or trademarked character (Requirement 37.5). The whole illustration is
 * authored in JSX: no raw-HTML injection, no raster asset, no remote URL.
 *
 * Three panels tell the day-1 road-safety story as a stop / look / listen sequence
 * (Requirement 19.6). Colours use `currentColor` and the kid design tokens
 * (`--p`, `--p-soft`, `--t`, `--kid-ink`, `--kid-surface`) so the art inherits whatever
 * sticker skin / kid theme is active around it.
 *
 * Accessibility: the root `<svg>` is a labelled `role="img"` group whose `<title>` and
 * `<desc>` give a screen reader the full three-beat story. Each panel's decorative scene is
 * marked `aria-hidden`, and the readable beat text sits in the `<desc>` and in the visible
 * caption below each panel, so the narrative is never locked inside the drawing.
 */

type Beat = {
  /** Short word shown on the scene badge: Stop, Look, Listen. */
  readonly cue: string;
  /** The sentence read aloud and shown under the panel. */
  readonly caption: string;
};

const BEATS: readonly Beat[] = [
  { cue: "Stop", caption: "Pip stops at the curb and waits. He does not step into the street yet." },
  { cue: "Look", caption: "Pip looks left, then right, then left again to check for cars." },
  { cue: "Listen", caption: "Pip listens for cars he cannot see yet before he crosses." },
];

const TITLE_ID = "pip-safe-streets-title";
const DESC_ID = "pip-safe-streets-desc";

/**
 * The original Pip fox, built from plain SVG shapes. `pose` nudges the face so each panel
 * reads as a distinct beat: facing forward (stop), glancing aside (look), ear perked up
 * (listen). Drawn in a 100×100 user space so it scales cleanly inside any panel.
 */
function PipFox({ pose }: { pose: "stop" | "look" | "listen" }) {
  // A gentle sideways glance for "look"; pupils shift right.
  const pupilDx = pose === "look" ? 4 : 0;
  // For "listen" the right ear leans in toward the sound.
  const rightEar = pose === "listen"
    ? "M66 34 C70 16 84 12 82 30 C80 40 72 40 66 34 Z"
    : "M62 30 C66 14 82 14 80 30 C78 40 68 40 62 30 Z";

  return (
    <g aria-hidden="true">
      {/* Ears — orange outer, soft inner */}
      <path d="M38 30 C34 14 18 14 20 30 C22 40 32 40 38 30 Z" fill="var(--t)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d={rightEar} fill="var(--t)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M33 28 C31 20 24 20 25 28 C26 33 31 33 33 28 Z" fill="var(--kid-surface)" />
      <path d="M67 28 C65 20 72 20 71 28 C70 33 65 33 67 28 Z" fill="var(--kid-surface)" />

      {/* Head */}
      <circle cx="50" cy="50" r="26" fill="var(--t)" stroke="currentColor" strokeWidth="2.5" />
      {/* Cheeks / muzzle in a lighter tone */}
      <path d="M50 44 C36 44 30 56 34 66 C40 74 60 74 66 66 C70 56 64 44 50 44 Z" fill="var(--kid-surface)" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />

      {/* Eyes */}
      <circle cx="42" cy="48" r="4.2" fill="var(--kid-surface)" stroke="currentColor" strokeWidth="2" />
      <circle cx="58" cy="48" r="4.2" fill="var(--kid-surface)" stroke="currentColor" strokeWidth="2" />
      <circle cx={42 + pupilDx} cy="48" r="2" fill="currentColor" />
      <circle cx={58 + pupilDx} cy="48" r="2" fill="currentColor" />

      {/* Nose + friendly smile */}
      <path d="M50 58 l-3.5 -3 h7 Z" fill="currentColor" />
      <path d="M50 61 C46 66 42 65 40 62 M50 61 C54 66 58 65 60 62" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

type Props = Omit<ComponentPropsWithoutRef<"svg">, "role" | "viewBox" | "children">;

export function SafeStreetsDay1({ className, ...props }: Props) {
  const panelWidth = 150;
  const panelHeight = 190;
  const gap = 14;
  const totalWidth = panelWidth * 3 + gap * 2;

  return (
    <svg
      {...props}
      role="img"
      aria-labelledby={`${TITLE_ID} ${DESC_ID}`}
      viewBox={`0 0 ${totalWidth} ${panelHeight}`}
      className={cn("h-auto w-full text-[color:var(--kid-ink)]", className)}
    >
      <title id={TITLE_ID}>Pip the fox learns to cross the street safely</title>
      <desc id={DESC_ID}>
        A three-panel comic. First, Pip stops at the curb and waits without stepping into the
        street. Next, Pip looks left, then right, then left again to check for cars. Last, Pip
        listens for cars he cannot see yet before crossing. Stop, look, listen.
      </desc>

      {BEATS.map((beat, index) => {
        const x = index * (panelWidth + gap);
        return (
          <g key={beat.cue} transform={`translate(${x}, 0)`}>
            {/* Panel card: white surface, 2.5px ink border, offset shadow, rounded corners */}
            <rect
              x={4}
              y={4}
              width={panelWidth - 4}
              height={panelHeight - 4}
              rx={16}
              fill="var(--kid-ink)"
              opacity={0.9}
            />
            <rect
              x={0}
              y={0}
              width={panelWidth - 4}
              height={panelHeight - 4}
              rx={16}
              fill="var(--kid-surface)"
              stroke="currentColor"
              strokeWidth={2.5}
            />

            {/* Scene area: soft green, divided from the caption by an ink rule */}
            <rect
              x={0}
              y={0}
              width={panelWidth - 4}
              height={118}
              rx={16}
              fill="var(--p-soft)"
            />
            <rect x={0} y={100} width={panelWidth - 4} height={18} fill="var(--p-soft)" />
            <line x1={0} y1={118} x2={panelWidth - 4} y2={118} stroke="currentColor" strokeWidth={2.5} />

            {/* Curb line Pip stands behind */}
            <line x1={14} y1={104} x2={panelWidth - 18} y2={104} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="6 7" />

            {/* Pip, centred in the scene */}
            <g transform={`translate(${(panelWidth - 4) / 2 - 36}, 16) scale(0.72)`}>
              <PipFox pose={beat.cue.toLowerCase() as "stop" | "look" | "listen"} />
            </g>

            {/* Cue badge: yellow sticker disc with the beat word */}
            <g transform={`translate(${(panelWidth - 4) / 2}, 148)`} aria-hidden="true">
              <rect x={-44} y={-16} width={88} height={32} rx={16} fill="var(--t)" stroke="currentColor" strokeWidth={2.5} />
              <text
                x={0}
                y={1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={17}
                fontWeight={800}
                fill="var(--kid-ink)"
                style={{ fontFamily: "var(--font-display, 'Baloo 2', sans-serif)" }}
              >
                {beat.cue}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export default SafeStreetsDay1;
