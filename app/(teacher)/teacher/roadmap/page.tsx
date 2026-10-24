import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { z } from "zod";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, TEACHER_LINKS } from "@/components/layout/AppHeader";
import { BADGES, Icon, TOWN_ITEMS, isTownItem, missionIcon } from "@/components/Icon";
import { requireRole } from "@/lib/auth/require";
import { gradeToLevel } from "@/lib/domain/levels";
import { getClassNextMission, getOwnedClasses } from "@/lib/server/teacher";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Quality } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

// Mission roadmap — `/teacher/roadmap` (docs/simulation.html "Roadmap").
// Level tabs; each module is one week drawn as a transit line with five day
// stations. Today's station (a class's next mission) is a dark dot with a
// yellow ring. Choosing a day shows its story, question, activity, proof,
// stamp, and building. Calm skin; content is shared and readable by any
// signed-in user.

export const metadata: Metadata = {
  title: "Roadmap · CivicQuest",
};

const LEVELS = [
  { key: "learners", label: "Learners, grades 2–5" },
  { key: "helpers", label: "Helpers, grades 6–8" },
  { key: "leaders", label: "Leaders, grades 9–12" },
] as const;
type LevelKey = (typeof LEVELS)[number]["key"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

const PROOF_LABEL: Record<string, string> = {
  class_activity: "Teacher watched the class activity",
  quiz: "Short quiz, checked by the app",
  photo_review: "Photo of the place or work, approved by the teacher",
  qr_checkin: "QR check-in and partner approval",
};

const querySchema = z.object({
  level: z.enum(["learners", "helpers", "leaders"]).optional(),
  day: z.uuid().optional(),
});

type ModuleRow = { id: string; title: string; level: string; quality: string; week_order: number; note: string | null };
type MissionRow = {
  id: string;
  module_id: string;
  day_number: number;
  title: string;
  story: string;
  ask: string;
  instructions: string;
  verification: string;
  town_item: string;
};

async function RoadmapBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const raw = await searchParams;
  await requireRole("teacher");
  const parsed = querySchema.safeParse({
    level: typeof raw.level === "string" ? raw.level : undefined,
    day: typeof raw.day === "string" ? raw.day : undefined,
  });
  const query = parsed.success ? parsed.data : {};

  const supabase = await createServerSupabase();
  const classes = await getOwnedClasses(supabase);
  const nextByClass = await Promise.all(
    classes.map(async (klass) => ({ klass, next: await getClassNextMission(klass.id, supabase) })),
  );
  const todayNames = new Map<string, string[]>();
  for (const { klass, next } of nextByClass) {
    if (!next) continue;
    todayNames.set(next.id, [...(todayNames.get(next.id) ?? []), klass.name]);
  }

  const firstLevel = classes[0] ? gradeToLevel(classes[0].grade) : null;
  const level: LevelKey = query.level ?? (typeof firstLevel === "string" ? firstLevel : "learners");

  const { data: modules } = await supabase
    .from("modules")
    .select("id, title, level, quality, week_order, note")
    .eq("level", level)
    .order("week_order", { ascending: true });
  const moduleRows = (modules ?? []) as ModuleRow[];
  const { data: missions } = await supabase
    .from("missions")
    .select("id, module_id, day_number, title, story, ask, instructions, verification, town_item")
    .in(
      "module_id",
      moduleRows.map((m) => m.id),
    )
    .order("day_number", { ascending: true });
  const missionRows = (missions ?? []) as MissionRow[];

  // Default selection: today's mission at this level, else the first day.
  const selectedId =
    query.day ?? missionRows.find((m) => todayNames.has(m.id))?.id ?? missionRows[0]?.id ?? null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold text-ink">Mission roadmap</h1>
      <p className="mt-1 text-base text-subtle">
        One mission each school day. Each week is one module, Monday to Friday, and every mission starts with a
        short story.
      </p>

      <nav aria-label="Level" className="mt-5 flex flex-wrap gap-2">
        {LEVELS.map((l) => (
          <Link
            key={l.key}
            href={`/teacher/roadmap?level=${l.key}`}
            aria-current={l.key === level ? "page" : undefined}
            className={cn(
              "inline-flex min-h-12 items-center rounded-lg border px-4 text-base font-bold",
              l.key === level ? "border-ink bg-ink text-surface" : "border-line bg-surface text-ink",
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5 flex flex-col gap-4">
        {moduleRows.map((mod) => {
          const days = missionRows.filter((m) => m.module_id === mod.id);
          const selected = days.find((d) => d.id === selectedId);
          const badge = BADGES[mod.quality as Quality];
          return (
            <section key={mod.id} className="rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-heading text-xl font-extrabold text-ink">
                  Week {mod.week_order}: {mod.title}
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold text-brand">
                  {badge ? <Icon name={badge.icon} alt="" size={16} /> : null}
                  {mod.quality}
                </span>
              </div>
              {mod.note ? <p className="mt-1 text-sm text-subtle">{mod.note}</p> : null}

              <ol className="relative mt-4 grid grid-cols-5 gap-1">
                <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-[10px] h-1 rounded bg-line" />
                {days.map((day) => {
                  const today = todayNames.get(day.id);
                  const isSelected = day.id === selectedId;
                  return (
                    <li key={day.id} className="relative">
                      <Link
                        href={`/teacher/roadmap?level=${level}&day=${day.id}`}
                        aria-current={isSelected ? "true" : undefined}
                        className={cn(
                          "flex min-h-24 flex-col items-center gap-1 rounded-lg px-1 pb-2 text-center text-sm leading-tight text-subtle",
                          isSelected && "bg-brand-soft",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-6 w-6 rounded-full border-4",
                            today ? "border-today bg-ink" : "border-line bg-surface",
                          )}
                        />
                        <b className="font-heading text-ink">{WEEKDAYS[day.day_number - 1]}</b>
                        <span className="break-words">{day.title}</span>
                        {today ? (
                          <span className="mt-1 rounded-full bg-today px-1.5 text-xs font-bold text-ink">
                            Today: {today.join(", ")}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ol>

              {selected ? (
                <div className="mt-4 grid gap-4 rounded-xl border border-line bg-page p-4 md:grid-cols-[1.2fr_1fr]">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <Icon name={missionIcon(selected.title, selected.town_item)} alt="" size={48} />
                      <h3 className="font-heading text-lg font-extrabold text-ink">
                        Day {selected.day_number}: {selected.title}
                      </h3>
                    </div>
                    <p className="text-base text-ink">{selected.story}</p>
                    <p className="rounded-lg bg-today/40 p-3 text-base font-bold text-ink">
                      Talk about it: {selected.ask}
                    </p>
                  </div>
                  <dl className="grid gap-3 text-base">
                    <div>
                      <dt className="text-sm font-bold text-subtle">Students do</dt>
                      <dd className="text-ink">{selected.instructions}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-bold text-subtle">Proof</dt>
                      <dd className="text-ink">{PROOF_LABEL[selected.verification] ?? selected.verification}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-bold text-subtle">Stamp</dt>
                      <dd className="text-ink">{mod.quality}</dd>
                    </div>
                    <div>
                      <dt className="text-sm font-bold text-subtle">Builds</dt>
                      <dd className="flex items-center gap-2 text-ink">
                        {isTownItem(selected.town_item) ? (
                          <>
                            <Icon name={TOWN_ITEMS[selected.town_item].icon} alt="" size={28} />A{" "}
                            {TOWN_ITEMS[selected.town_item].label.toLowerCase()} in the class town
                          </>
                        ) : (
                          selected.town_item
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}

export default function RoadmapPage({ searchParams }: PageProps<"/teacher/roadmap">) {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={TEACHER_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading the roadmap…</p>
          </div>
        }
      >
        <RoadmapBody searchParams={searchParams} />
      </Suspense>
    </SkinWrapper>
  );
}
