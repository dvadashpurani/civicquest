import Link from "next/link";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { Icon, type IconName } from "@/components/Icon";
import { isDemoMode } from "@/lib/env";
import { demoSignIn } from "./demo-actions";

// Public landing page — `/`. Calm skin, with a small sticker-book preview of a
// class town. When DEMO_MODE=true (checked on the server) it shows one-click
// demo sign-ins; the action re-checks DEMO_MODE before signing anyone in.

export const metadata: Metadata = {
  title: "CivicQuest · One real-world civic mission every school day",
  description:
    "CivicQuest helps classes in grades 2 to 12 practice civic sense with one short, real-world mission each school day.",
};

const LEVELS: readonly { name: string; grades: string; icon: IconName; text: string }[] = [
  {
    name: "Learners",
    grades: "Grades 2 to 5",
    icon: "fox",
    text: "Short stories with Pip the fox, then a class activity the teacher watches and confirms in one tap.",
  },
  {
    name: "Helpers",
    grades: "Grades 6 to 8",
    icon: "handshake",
    text: "Realistic case studies and missions in the school and neighborhood, with photo proof of the place, never of faces.",
  },
  {
    name: "Leaders",
    grades: "Grades 9 to 12",
    icon: "classical-building",
    text: "Their own login, QR check-in at partner sites, and service hours approved by the supervisor who was there.",
  },
];

const STEPS: readonly { icon: IconName; title: string; text: string }[] = [
  { icon: "fox", title: "Story", text: "The teacher shows a short story and asks one question." },
  { icon: "person-walking", title: "Mission", text: "The class does a real-world mission together." },
  { icon: "star", title: "Confirm", text: "The teacher confirms who took part. That is the proof." },
  { icon: "balloon", title: "Celebrate", text: "Balloons, a sticker for each student, and a new building in the class town." },
];

const DEMOS: readonly { persona: string; label: string; detail: string; icon: IconName }[] = [
  { persona: "teacher3", label: "Grade 3 teacher", detail: "Ms. Rivera, Safe Streets", icon: "person-walking" },
  { persona: "teacher7", label: "Grade 7 teacher", detail: "Mr. Chen, Respect Everywhere", icon: "people-hugging" },
  { persona: "teacher11", label: "Grade 11 teacher", detail: "Ms. Okafor, Civics Project", icon: "classical-building" },
  { persona: "admin", label: "School admin", detail: "Proof log and leaderboard", icon: "school" },
  { persona: "partner", label: "Food bank partner", detail: "QR code and hour approvals", icon: "canned-food" },
  { persona: "leader", label: "High schooler", detail: "Jordan M., grade 11", icon: "safety-vest" },
];

const PREVIEW_TOWN: readonly IconName[] = [
  "deciduous-tree", "person-walking", "chair", "recycling-symbol", "school", "bus-stop",
  "seedling", "national-park", "classical-building", "playground-slide", "hospital", "bicycle",
];

function DemoButton({ persona, label, detail, icon }: (typeof DEMOS)[number]) {
  return (
    <form action={demoSignIn}>
      <input type="hidden" name="persona" value={persona} />
      <button
        type="submit"
        className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:border-brand"
      >
        <Icon name={icon} alt="" size={36} />
        <span className="flex flex-col">
          <span className="text-base font-extrabold text-ink">{label}</span>
          <span className="font-sans text-sm font-normal text-subtle">{detail}</span>
        </span>
      </button>
    </form>
  );
}

export default function Home() {
  const demo = isDemoMode();

  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <span className="inline-flex min-h-12 items-center gap-2 font-heading text-xl font-extrabold text-ink">
            <Icon name="classical-building" alt="" size={28} />
            CivicQuest
          </span>
          <Link
            href="/login"
            className="inline-flex min-h-12 items-center rounded-lg border border-line px-4 font-heading font-bold text-ink"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-10">
        <section className="grid items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <h1 className="font-heading text-4xl font-extrabold leading-tight text-ink sm:text-5xl">
              One real-world civic mission every school day.
            </h1>
            <p className="text-lg text-subtle">
              CivicQuest helps schools and after-school programs teach civic sense in grades 2 to 12.
              Each day the class does one short mission, like crossing the street safely or thanking a
              community worker. The teacher confirms who took part, and the whole class builds a town
              together.
            </p>
            <div className="flex flex-wrap gap-3">
              {demo ? (
                <a
                  href="#demo"
                  className="inline-flex min-h-12 items-center rounded-lg bg-brand px-6 font-heading text-lg font-bold text-on-brand"
                >
                  Try the demo
                </a>
              ) : null}
              <Link
                href="/login"
                className="inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-6 font-heading text-lg font-bold text-ink"
              >
                Sign in
              </Link>
            </div>
          </div>

          <SkinWrapper
            skin="sticker"
            className="rounded-[24px] border-[2.5px] border-kid-ink p-5 shadow-sticker"
            aria-label="A class town with 12 buildings"
            role="img"
          >
            <p className="font-heading text-2xl font-extrabold text-kid-ink">Grade 3&rsquo;s town</p>
            <p className="mb-3 text-base text-kid-muted">Village, 12 of 36 buildings</p>
            <div className="grid grid-cols-6 gap-1.5">
              {Array.from({ length: 18 }, (_, i) => {
                const icon = PREVIEW_TOWN[i];
                return icon ? (
                  <span
                    key={i}
                    className="grid aspect-square place-items-center rounded-xl border-2 border-kid-ink bg-kid-soft p-1"
                  >
                    <Icon name={icon} alt="" size={40} className="h-full w-full object-contain" />
                  </span>
                ) : (
                  <span
                    key={i}
                    className="aspect-square rounded-xl border-2 border-dashed border-kid-muted opacity-50"
                  />
                );
              })}
            </div>
          </SkinWrapper>
        </section>

        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="font-heading text-2xl font-extrabold text-ink">Built for the Massachusetts civics project</h2>
          <p className="mt-3 text-base text-ink">
            Massachusetts law requires every public school serving 8th grade, and every high school, to
            provide at least one student-led, non-partisan civics project for each student. The Civics
            Project module walks a class through one in five days: pick a problem, research it, find who
            decides, take action, and share the results.
          </p>
        </section>

        <section>
          <h2 className="font-heading text-2xl font-extrabold text-ink">How a day works</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <Icon name={step.icon} alt="" size={44} />
                <span className="font-heading text-lg font-extrabold text-ink">
                  {i + 1}. {step.title}
                </span>
                <span className="text-base text-subtle">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="font-heading text-2xl font-extrabold text-ink">Three levels, set from grade</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {LEVELS.map((level) => (
              <li key={level.name} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-5">
                <Icon name={level.icon} alt="" size={48} />
                <span className="font-heading text-xl font-extrabold text-ink">{level.name}</span>
                <span className="text-sm font-bold text-brand">{level.grades}</span>
                <span className="text-base text-subtle">{level.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface p-5">
            <h3 className="font-heading text-lg font-extrabold text-ink">Classes compete, not kids</h3>
            <p className="mt-2 text-base text-subtle">
              A school leaderboard ranks classes by points per student. Students never see individual rankings.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <h3 className="font-heading text-lg font-extrabold text-ink">Proof that can&rsquo;t be edited</h3>
            <p className="mt-2 text-base text-subtle">
              Every confirmation is saved with who, what, and when. Mistakes can be fixed for 24 hours, and
              every fix is logged.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <h3 className="font-heading text-lg font-extrabold text-ink">Child privacy first</h3>
            <p className="mt-2 text-base text-subtle">
              First name and last initial only. Younger students have no accounts and use class mode on the
              teacher&rsquo;s device.
            </p>
          </div>
        </section>

        {demo ? (
          <section id="demo" className="scroll-mt-4 rounded-xl border-2 border-brand bg-brand-soft p-6">
            <h2 className="font-heading text-2xl font-extrabold text-ink">Try the demo</h2>
            <p className="mt-1 text-base text-ink">One click signs you in as a demo account. All data is made up.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {DEMOS.map((d) => (
                <DemoButton key={d.persona} {...d} />
              ))}
            </div>
            <form action={demoSignIn} className="mt-4 flex flex-wrap items-center gap-3">
              <input type="hidden" name="persona" value="student" />
              <button
                type="submit"
                className="inline-flex min-h-14 items-center gap-3 rounded-xl bg-brand px-6 text-lg text-on-brand"
              >
                <Icon name="unicorn" alt="" size={32} />
                View student dashboard
              </button>
              <span className="text-sm text-subtle">Grade 3 class mode, on the teacher&rsquo;s tablet</span>
            </form>
          </section>
        ) : null}

        <p className="text-base text-subtle">
          Google Classroom and Clever are coming next, so rosters sync on their own.
        </p>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-subtle">
          CivicQuest, a Hackachusetts entry. Icons: Microsoft Fluent Emoji (MIT).
        </div>
      </footer>
    </SkinWrapper>
  );
}
