---
inclusion: always
---

# Design: two skins, one system

CivicQuest has one set of components and layouts with two skins. See `docs/themes-sample.html`.

- **Calm skin** for teachers, admins, partners, counselors, and high schoolers by default.
- **Sticker book skin** for kid-facing screens: the student dashboard and stamp passport in class mode, and every screen shown to the class on the projector (story, mission, balloons, class town).

Set the skin with `data-skin="calm"` or `data-skin="sticker"` on a layout wrapper, and the kid theme with `data-kid-theme="hero|bubblegum|ocean|classic"`. All colors are CSS variables. Every skin has light and dark values, defined on `:root`, under `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]`.

## Calm skin
| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F6F7F8` | `#0F1115` |
| `--surface` | `#FFFFFF` | `#181B21` |
| `--ink` | `#111827` | `#F2F4F7` |
| `--muted` | `#5B6472` | `#A3AAB5` |
| `--line` | `#E3E6EA` | `#2A2F38` |
| `--accent` | `#00704A` | `#2FA176` |
| `--accent-soft` | `#E3F2EC` | `#16302A` |
| `--today` | `#FFD23F` | `#FFD23F` |
| `--danger` | `#C8102E` | `#E0445F` |

- Type: Overpass 700/800 for headings and buttons, Public Sans 400/700 for body. Body at least 16px.
- Shapes: 8–12px radius, 1px borders, no shadows. Left-aligned, clear tables, large tap targets.
- The roadmap is a transit line: each day is a station, and today is a dark dot with a yellow ring.

## Sticker book skin
- Type: Baloo 2 800 for headings and names, Lexend 400/600 for body. Kid text at least 18px, and buttons at least 64px tall on kid screens.
- Shapes: 2.5px ink outlines, solid offset shadows (4–6px, no blur), rounded corners 18–26px, pill buttons, and a subtle dot-grid background.
- Stamps are round die-cut stickers with a white border and a slight tilt. Locked stamps are dashed outlines.
- Kid screens always use a light background, even when the device is in dark mode: `--kid-bg` `#EEFAF8` (light turquoise) with a `#D3EFEA` dot grid, `--kid-surface` `#FFFFFF`, `--kid-soft` `#E0F5F2` for tiles, and `--kid-ink` `#22223B` for text and outlines. Never use a dark or navy background on kid screens.

## Illustration and icons (sticker book skin)
- Use Microsoft Fluent Emoji in the 3D style (MIT license, from the `microsoft/fluentui-emoji` repository on GitHub) for all icons and characters. Download only the PNGs needed into `public/icons/` and serve them from the app, since the CSP allows images only from the app itself. Credit Fluent Emoji in the README.
- Pip the fox uses the 3D fox. Student avatars use the 3D animal set (fox, panda, turtle, owl, frog, tiger, koala, rabbit, octopus, lion, penguin, bear, unicorn, bee, whale, giraffe, ladybug, dog, cat, hamster, hedgehog, dolphin, butterfly, cow).
- Day icons: person walking (stop, look, listen), vertical traffic light (signals), safety vest (be seen), school bus (bus safety), world map or round pushpin (safe route). Pick a fitting icon for every mission in `docs/missions.md`.
- Town tiles: deciduous tree, national park, chair (bench), person walking (crosswalk), classical building (library), hospital (clinic), bus stop, recycling symbol, seedling (community garden), playground slide, canned food (food bank), school, bicycle (bike lane), fire engine (fire station).
- Badges: shield (Safety), star (Kindness), handshake (Helping), light bulb (Responsibility), people hugging (Respect), classical building (Civic action). Locked badges are greyscale at 40% opacity.
- Balloons in the celebration use the balloon icon.

## Layout patterns (sticker book skin)
- **Hero mission card:** large card with the module name and grade at the top, a day chip, the mission title in Baloo 2 800 at 2–3.5rem, one line of encouragement, a pill "Start mission" button, and a large icon or Pip on the right (below the text on phones).
- **Stat pills** at the top of the student dashboard: streak, points, and stamps, each a pill with an icon and a bold number.
- **Week strip:** five day cards in a row, each with a number badge, an icon, the weekday, and a short title. Today has a thick primary outline. On phones the strip scrolls sideways with scroll snapping.
- **Town and badges** sit side by side on laptops and stack on phones.
- Cards may tilt by 1–2 degrees for a sticker feel, but never text-heavy cards or buttons.
- Bold, short headlines like “Welcome back, Maya!” and “This week’s missions.”

## Responsive rules (both skins)
- Mobile first. Breakpoints at 640px and 1024px.
- Phones: one column, a sticky bottom action button on mission screens, and a bottom tab bar on the Leader `/me` pages and the student dashboard.
- Laptops: two or three columns, max content width 1040px.
- Projector screens (story, mission, town): fill the viewport with text at least 2rem.
- Tap targets at least 48px everywhere and 64px on kid screens. No horizontal page scrolling except the week strip.

## Kid themes (each student picks one, saved on their student row)
| Theme | Primary | Secondary | Highlight |
|---|---|---|---|
| Hero | `#E63946` | `#1D3557` | `#FFD166` |
| Bubblegum | `#FF5FA2` | `#8B5CF6` | `#FFD6E8` |
| Ocean | `#0EA5E9` | `#14B8A6` | `#CFFAFE` |
| Classic (default) | `#2F8F5B` | `#1D2B4F` | `#F5B700` |

Text on primary and secondary is white, and text on highlight is `#22223B`. Themes are original. Never use copyrighted characters, brand names, or their signature motifs (such as web patterns or brand logos).

## Shared
- The class town is the memorable element: bold tiles, a satisfying placement animation, and a full-screen projector view.
- Motion only in answer to actions: balloons on confirm, a sticker landing in the passport, a building dropping into the town. Respect `prefers-reduced-motion`.
- Avoid all-caps labels, accenting one word in a headline, and gradient decoration.
