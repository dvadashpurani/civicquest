import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Self-hosted Microsoft Fluent Emoji 3D icons (MIT, github.com/microsoft/fluentui-emoji).
 * Every file lives in `public/icons/` and is served from the app origin only, because the
 * CSP allows images from `'self'` (plus Supabase Storage for mission photos). Never point
 * an icon at a remote URL.
 *
 * Each key is the kebab-case file name (without `.png`); `label` is the default alt text.
 */
export const ICONS = {
  // Town tiles
  "deciduous-tree": { file: "/icons/deciduous-tree.png", label: "Tree" },
  "national-park": { file: "/icons/national-park.png", label: "Park" },
  chair: { file: "/icons/chair.png", label: "Bench" },
  "person-walking": { file: "/icons/person-walking.png", label: "Person walking" },
  "classical-building": { file: "/icons/classical-building.png", label: "Classical building" },
  hospital: { file: "/icons/hospital.png", label: "Clinic" },
  "bus-stop": { file: "/icons/bus-stop.png", label: "Bus stop" },
  "recycling-symbol": { file: "/icons/recycling-symbol.png", label: "Recycling" },
  seedling: { file: "/icons/seedling.png", label: "Seedling" },
  "playground-slide": { file: "/icons/playground-slide.png", label: "Playground slide" },
  "canned-food": { file: "/icons/canned-food.png", label: "Canned food" },
  school: { file: "/icons/school.png", label: "School" },
  bicycle: { file: "/icons/bicycle.png", label: "Bicycle" },
  "fire-engine": { file: "/icons/fire-engine.png", label: "Fire engine" },

  // Badges (classical-building above doubles as Civic action)
  shield: { file: "/icons/shield.png", label: "Shield" },
  star: { file: "/icons/star.png", label: "Star" },
  handshake: { file: "/icons/handshake.png", label: "Handshake" },
  "light-bulb": { file: "/icons/light-bulb.png", label: "Light bulb" },
  "people-hugging": { file: "/icons/people-hugging.png", label: "People hugging" },

  // Day icons (Safe Streets). Unicode has no school bus emoji, so `bus` stands in for it.
  "vertical-traffic-light": { file: "/icons/vertical-traffic-light.png", label: "Traffic light" },
  "safety-vest": { file: "/icons/safety-vest.png", label: "Safety vest" },
  bus: { file: "/icons/bus.png", label: "School bus" },
  "world-map": { file: "/icons/world-map.png", label: "Map" },
  "round-pushpin": { file: "/icons/round-pushpin.png", label: "Map pin" },

  // Celebration
  balloon: { file: "/icons/balloon.png", label: "Balloon" },

  // Animals: Pip the fox and the student avatar set
  fox: { file: "/icons/fox.png", label: "Fox" },
  panda: { file: "/icons/panda.png", label: "Panda" },
  turtle: { file: "/icons/turtle.png", label: "Turtle" },
  owl: { file: "/icons/owl.png", label: "Owl" },
  frog: { file: "/icons/frog.png", label: "Frog" },
  tiger: { file: "/icons/tiger.png", label: "Tiger" },
  koala: { file: "/icons/koala.png", label: "Koala" },
  rabbit: { file: "/icons/rabbit.png", label: "Rabbit" },
  octopus: { file: "/icons/octopus.png", label: "Octopus" },
  lion: { file: "/icons/lion.png", label: "Lion" },
  penguin: { file: "/icons/penguin.png", label: "Penguin" },
  bear: { file: "/icons/bear.png", label: "Bear" },
  unicorn: { file: "/icons/unicorn.png", label: "Unicorn" },
  bee: { file: "/icons/bee.png", label: "Bee" },
  whale: { file: "/icons/whale.png", label: "Whale" },
  giraffe: { file: "/icons/giraffe.png", label: "Giraffe" },
  ladybug: { file: "/icons/ladybug.png", label: "Ladybug" },
  dog: { file: "/icons/dog.png", label: "Dog" },
  cat: { file: "/icons/cat.png", label: "Cat" },
  hamster: { file: "/icons/hamster.png", label: "Hamster" },
  hedgehog: { file: "/icons/hedgehog.png", label: "Hedgehog" },
  dolphin: { file: "/icons/dolphin.png", label: "Dolphin" },
  butterfly: { file: "/icons/butterfly.png", label: "Butterfly" },
  cow: { file: "/icons/cow.png", label: "Cow" },
} as const satisfies Record<string, { file: `/icons/${string}.png`; label: string }>;

export type IconName = keyof typeof ICONS;

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/**
 * `missions.town_item` values (the keys used in docs/missions.md) mapped to their tile icon
 * and the alt text for that building.
 */
export const TOWN_ITEMS = {
  tree: { icon: "deciduous-tree", label: "Tree" },
  park: { icon: "national-park", label: "Park" },
  bench: { icon: "chair", label: "Bench" },
  crosswalk: { icon: "person-walking", label: "Crosswalk" },
  library: { icon: "classical-building", label: "Library" },
  clinic: { icon: "hospital", label: "Clinic" },
  busstop: { icon: "bus-stop", label: "Bus stop" },
  recycling: { icon: "recycling-symbol", label: "Recycling center" },
  garden: { icon: "seedling", label: "Community garden" },
  playground: { icon: "playground-slide", label: "Playground" },
  foodbank: { icon: "canned-food", label: "Food bank" },
  school: { icon: "school", label: "School" },
  bikelane: { icon: "bicycle", label: "Bike lane" },
  firestation: { icon: "fire-engine", label: "Fire station" },
} as const satisfies Record<string, { icon: IconName; label: string }>;

export type TownItem = keyof typeof TOWN_ITEMS;

export function isTownItem(value: string): value is TownItem {
  return Object.prototype.hasOwnProperty.call(TOWN_ITEMS, value);
}

/** `modules.quality` values mapped to their badge (stamp) icon. */
export const BADGES = {
  Safety: { icon: "shield", label: "Safety" },
  Kindness: { icon: "star", label: "Kindness" },
  Helping: { icon: "handshake", label: "Helping" },
  Responsibility: { icon: "light-bulb", label: "Responsibility" },
  Respect: { icon: "people-hugging", label: "Respect" },
  "Civic action": { icon: "classical-building", label: "Civic action" },
} as const satisfies Record<string, { icon: IconName; label: string }>;

export type BadgeQuality = keyof typeof BADGES;

/** Animals a student can pick as an avatar (`students.avatar`, default `fox`). */
export const AVATARS = [
  "fox", "panda", "turtle", "owl", "frog", "tiger", "koala", "rabbit",
  "octopus", "lion", "penguin", "bear", "unicorn", "bee", "whale", "giraffe",
  "ladybug", "dog", "cat", "hamster", "hedgehog", "dolphin", "butterfly", "cow",
] as const satisfies readonly IconName[];

export type Avatar = (typeof AVATARS)[number];

/** Pip the fox, the guide character. */
export const PIP_ICON = "fox" satisfies IconName;

type IconProps = Omit<
  ComponentPropsWithoutRef<"img">,
  "src" | "alt" | "width" | "height" | "children"
> & {
  /**
   * Icon to show. Accepts any string so raw database values can be passed; names outside
   * `ICONS` render a placeholder instead of throwing.
   */
  name: IconName | (string & {});
  /**
   * Alt text. Defaults to the icon's label. Pass `""` when the icon is decorative (for
   * example, next to a visible text label) so screen readers skip it.
   */
  alt?: string;
  /** Rendered width and height in CSS pixels. The source PNGs are 256×256. */
  size?: number;
  /** Locked badge style: greyscale at 40% opacity. */
  locked?: boolean;
};

/**
 * Renders a self-hosted Fluent Emoji 3D icon.
 *
 * A plain `<img>` is used on purpose instead of `next/image`: the files are already small,
 * fixed-size 256px PNGs, so the image optimizer would only add a `/_next/image` round trip
 * and server-side re-encoding without a visible gain. Explicit width/height still reserve
 * layout space, and this stays a zero-JS server component.
 */
export function Icon({ name, alt, size = 48, locked = false, className, style, ...props }: IconProps) {
  const lockedClass = locked && "grayscale opacity-40";

  if (!isIconName(name)) {
    const label = alt ?? "Missing icon";
    return (
      <span
        role={label === "" ? undefined : "img"}
        aria-label={label === "" ? undefined : label}
        aria-hidden={label === "" ? true : undefined}
        data-icon-fallback={name}
        className={cn(
          "inline-flex shrink-0 select-none items-center justify-center rounded-full",
          "border-2 border-dashed border-current font-bold opacity-60",
          lockedClass,
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.45)), ...style }}
      >
        ?
      </span>
    );
  }

  const icon = ICONS[name];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the component comment
    <img
      loading="lazy"
      decoding="async"
      draggable={false}
      {...props}
      src={icon.file}
      alt={alt ?? icon.label}
      width={size}
      height={size}
      className={cn("inline-block shrink-0 select-none", lockedClass, className)}
      style={style}
    />
  );
}

/**
 * The day icon for each mission in docs/missions.md, keyed by title. A title
 * that is not listed falls back to the icon of the building it adds to the town.
 */
const MISSION_ICONS: Readonly<Record<string, IconName>> = {
  "Stop, look, listen": "person-walking",
  "Know your signals": "vertical-traffic-light",
  "Be seen": "safety-vest",
  "Bus safety": "bus",
  "My safe route": "round-pushpin",
  "Thank a helper": "handshake",
  "Kind words, hurtful words": "star",
  "Include someone": "playground-slide",
  "Say sorry and mean it": "people-hugging",
  "Ask for help": "handshake",
  "Sort it right": "recycling-symbol",
  "Litter detectives": "national-park",
  "Save water": "whale",
  "Lights off": "light-bulb",
  "Plant something": "seedling",
  "Spot the problem": "round-pushpin",
  "Who fixes what": "fire-engine",
  "Report it right": "classical-building",
  "Help a neighbor": "handshake",
  "Follow up": "star",
  "Public spaces are shared": "national-park",
  "Thank a community worker": "fire-engine",
  "Rules have reasons": "shield",
  "Disagree respectfully": "people-hugging",
  "Respect online": "owl",
  "Waste audit": "recycling-symbol",
  "Clean one spot": "deciduous-tree",
  "Fix the recycling sign": "recycling-symbol",
  "Energy detectives": "light-bulb",
  "Green pledge": "seedling",
  "Pick a problem": "round-pushpin",
  "Research it": "owl",
  "Make a plan and find who decides": "classical-building",
  "Take action": "star",
  "Share the results": "school",
  "Find your cause": "round-pushpin",
  "Volunteer shift": "canned-food",
  "Reflect on service": "owl",
  "Organize a drive": "canned-food",
  "Second shift": "handshake",
  "Who runs your city": "classical-building",
  "How a decision gets made": "light-bulb",
  "Watch a public meeting": "classical-building",
  "Write to an official": "school",
  "Read local news": "world-map",
  "Plan a lesson for younger kids": "school",
  "Teach the lesson": "star",
  "Plan a cleanup": "world-map",
  "Run the cleanup": "national-park",
};

/** The icon for a mission's day card: its own icon, else its town building's. */
export function missionIcon(title: string, townItem: string): IconName {
  const own = MISSION_ICONS[title];
  if (own) return own;
  return isTownItem(townItem) ? TOWN_ITEMS[townItem].icon : "star";
}

/** The town building each stamp quality typically adds, for the legend. */
export const QUALITY_BUILDINGS: readonly { quality: BadgeQuality; townItem: TownItem }[] = [
  { quality: "Safety", townItem: "crosswalk" },
  { quality: "Kindness", townItem: "bench" },
  { quality: "Responsibility", townItem: "recycling" },
  { quality: "Respect", townItem: "library" },
  { quality: "Helping", townItem: "clinic" },
  { quality: "Civic action", townItem: "school" },
];
