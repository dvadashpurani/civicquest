import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, ADMIN_LINKS } from "@/components/layout/AppHeader";
import { Leaderboard } from "@/components/Leaderboard";
import { requireRole } from "@/lib/auth/require";
import { getAdminOverview, getSchoolProofLog } from "@/lib/server/admin";
import { getSchoolLeaderboardRows } from "@/lib/server/teacher";

// School admin overview — `/admin` (docs/simulation.html "School admin").
// Calm skin. All reads run as the admin under RLS, scoped to their school.

export const metadata: Metadata = {
  title: "School admin · CivicQuest",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

async function AdminBody() {
  await connection();
  const { profile } = await requireRole("admin");
  const now = new Date();

  const [overview, leaderboardRows, log] = await Promise.all([
    getAdminOverview(profile.school_id ?? "", now),
    getSchoolLeaderboardRows(),
    getSchoolProofLog(6),
  ]);

  const stats = [
    { n: String(overview.students), label: "Students" },
    { n: String(overview.completionsThisWeek), label: "Student missions confirmed this week" },
    { n: formatHours(overview.verifiedHours), label: "Verified volunteer hours" },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold text-ink">{overview.schoolName}</h1>
      <p className="mt-1 text-base text-subtle">School admin, signed in as {profile.full_name}.</p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <li key={stat.label} className="rounded-xl border border-line bg-surface p-5">
            <p className="font-heading text-4xl font-extrabold tabular-nums text-ink">{stat.n}</p>
            <p className="mt-1 text-base text-subtle">{stat.label}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          <Leaderboard rows={leaderboardRows} title="School leaderboard" subtitle="Classes compete, not kids" />

          <section className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-heading text-xl font-extrabold text-ink">Proof log</h2>
              <Link href="/admin/proof-log" className="inline-flex min-h-11 items-center font-bold text-brand">
                See the full proof log
              </Link>
            </div>
            <p className="mt-1 text-sm text-subtle">
              Every confirmation is saved with who confirmed it and when. It can&rsquo;t be edited afterward.
            </p>
            {log.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">Nothing in the proof log yet.</p>
            ) : (
              <ul className="mt-3">
                {log.map((row) => (
                  <li key={row.id} className="border-b border-line py-3 last:border-b-0">
                    <p className="font-bold text-ink">
                      {row.what || row.action}
                      {row.where ? <span className="font-normal text-subtle">, {row.where}</span> : null}
                    </p>
                    <p className="text-sm text-subtle">
                      {row.action} by {row.who}, {formatWhen(row.createdAt)}
                      {row.students.length > 0
                        ? `. ${row.students.length} ${row.students.length === 1 ? "student" : "students"}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border-2 border-brand bg-brand-soft p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">Civics Project module</h2>
            <p className="mt-2 text-base text-ink">
              Massachusetts requires every public school serving 8th grade, and every high school, to provide
              at least one student-led, non-partisan civics project for each student. This module walks a
              class through one in five steps.
            </p>
            {overview.civics.length === 0 ? (
              <p className="mt-3 text-sm text-subtle">No class is on the Civics Project yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {overview.civics.map((c) => (
                  <li key={c.classId}>
                    <p className="text-sm text-subtle">
                      <strong className="text-ink">{c.className}</strong>:{" "}
                      {c.done >= c.total ? "all steps done" : `on step ${c.done + 1} of ${c.total}`}
                    </p>
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={c.total}
                      aria-valuenow={c.done}
                      aria-label={`${c.className}: ${c.done} of ${c.total} steps done`}
                      className="mt-1 h-3 overflow-hidden rounded-full border border-line bg-surface"
                    >
                      <div className="h-full bg-brand" style={{ width: `${(c.done / c.total) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-heading text-xl font-extrabold text-ink">Fixing mistakes</h2>
            <p className="mt-2 text-sm text-subtle">
              Teachers can edit or undo a confirmation for 24 hours. After that, you can reverse it from the
              proof log with a reason. Nothing is ever deleted.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={ADMIN_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading your school…</p>
          </div>
        }
      >
        <AdminBody />
      </Suspense>
    </SkinWrapper>
  );
}
