import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, LEADER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { getLeaderSummary, type LeaderCheckin, type LeaderOpportunity } from "@/lib/server/leader";
import { LeaderTabs } from "./LeaderTabs";

// Leader home — `/me` (docs/simulation.html "Student (grade 11)"): verified
// and pending hours, today's opportunity, the proof timeline for each shift,
// and what's coming up. Calm skin, phone first.

export const metadata: Metadata = {
  title: "My hours · CivicQuest",
};

const WINDOW_BEFORE_MS = 30 * 60 * 1000;

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function hoursLabel(hours: number): string {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, "")} ${hours === 1 ? "hour" : "hours"}`;
}

function Timeline({ checkin, opp }: { checkin: LeaderCheckin; opp: LeaderOpportunity | undefined }) {
  const steps: { title: string; detail: string; done: boolean }[] = [
    {
      title: `Checked in${opp ? ` at ${opp.title}` : ""}`,
      detail: `${day(checkin.checkInAt)}, ${time(checkin.checkInAt)}, scanned the site's code`,
      done: true,
    },
  ];
  if (checkin.checkOutAt) {
    steps.push({
      title: "Checked out",
      detail: `${time(checkin.checkOutAt)}, ${hoursLabel(checkin.hours ?? 0)} calculated`,
      done: true,
    });
  }
  if (checkin.status === "approved") {
    steps.push({
      title: `Approved by ${opp?.partnerName ?? "the partner"}`,
      detail: checkin.approvedAt ? `Supervisor who was there, ${day(checkin.approvedAt)} ${time(checkin.approvedAt)}` : "Supervisor who was there",
      done: true,
    });
  } else if (checkin.checkOutAt) {
    steps.push({ title: `Waiting for ${opp?.partnerName ?? "the partner"}`, detail: "A supervisor must approve the hours", done: false });
  } else {
    steps.push({ title: "Still there", detail: "Scan the code again when you leave", done: false });
  }

  return (
    <ul className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.title} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={
              step.done
                ? "mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full bg-brand"
                : "mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-today bg-surface"
            }
          />
          <span>
            <strong className="text-ink">{step.title}</strong>
            <span className="block text-sm text-subtle">{step.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

async function LeaderBody() {
  await connection();
  await requireRole("student");
  const summary = await getLeaderSummary();
  const now = new Date().getTime();

  if (!summary) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <p className="text-base text-subtle">Your login isn&rsquo;t linked to a student yet. Ask your school admin.</p>
      </main>
    );
  }

  const oppById = new Map(summary.opportunities.map((o) => [o.id, o]));
  const openNow = summary.opportunities.find(
    (o) => now >= new Date(o.startsAt).getTime() - WINDOW_BEFORE_MS && now <= new Date(o.endsAt).getTime(),
  );
  const upcoming = summary.opportunities.filter((o) => new Date(o.startsAt).getTime() > now && o.id !== openNow?.id);
  const todayCheckin = openNow ? summary.checkins.find((c) => c.opportunityId === openNow.id) : undefined;
  const pastCheckins = summary.checkins.filter((c) => c.id !== todayCheckin?.id);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-6 sm:pb-10">
      <div>
        <p className="text-sm text-subtle">Signed in as</p>
        <h1 className="font-heading text-3xl font-extrabold text-ink">
          {summary.name}, grade {summary.grade}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="font-heading text-4xl font-extrabold tabular-nums text-ink">{summary.verifiedHours}</p>
          <p className="text-sm text-subtle">Verified hours</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="font-heading text-4xl font-extrabold tabular-nums text-ink">{summary.pendingHours}</p>
          <p className="text-sm text-subtle">Waiting for approval</p>
        </div>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-heading text-xl font-extrabold text-ink">Today</h2>
        {openNow ? (
          <>
            <p className="mt-2 text-lg font-bold text-ink">{openNow.title}</p>
            <p className="text-sm text-subtle">
              {openNow.partnerName}, {time(openNow.startsAt)} to {time(openNow.endsAt)}. {openNow.locationName}.
            </p>
            {todayCheckin ? (
              <div className="mt-4">
                <h3 className="mb-2 font-heading text-base font-extrabold text-ink">Proof of today&rsquo;s hours</h3>
                <Timeline checkin={todayCheckin} opp={openNow} />
              </div>
            ) : null}
            {!todayCheckin || !todayCheckin.checkOutAt ? (
              <Link
                href="/me/scan"
                className="mt-4 inline-flex min-h-14 w-full items-center justify-center rounded-lg bg-brand px-6 text-lg font-bold text-on-brand sm:w-auto"
              >
                {todayCheckin ? "Scan to check out" : "Scan check-in code"}
              </Link>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-base text-subtle">No event is open right now.</p>
        )}
      </section>

      {pastCheckins.length > 0 ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-heading text-xl font-extrabold text-ink">Proof of past hours</h2>
          <ul className="mt-3 flex flex-col gap-5">
            {pastCheckins.map((checkin) => (
              <li key={checkin.id}>
                <Timeline checkin={checkin} opp={oppById.get(checkin.opportunityId)} />
              </li>
            ))}
          </ul>
          <Link href="/me/certificate" className="mt-4 inline-flex min-h-12 items-center font-bold text-brand">
            View certificate
          </Link>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-heading text-xl font-extrabold text-ink">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-base text-subtle">Nothing scheduled yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {upcoming.slice(0, 5).map((o) => (
              <li key={o.id}>
                <p className="font-bold text-ink">{o.title}</p>
                <p className="text-sm text-subtle">
                  {o.partnerName}, {day(o.startsAt)} at {time(o.startsAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-subtle">
        Hours count only after the organization approves them. Counselors can export them for graduation and
        college applications.
      </p>
    </main>
  );
}

export default function LeaderPage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={LEADER_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-2xl px-4 py-8">
            <p className="text-base text-subtle">Loading your hours…</p>
          </div>
        }
      >
        <LeaderBody />
      </Suspense>
      <LeaderTabs current="/me" />
    </SkinWrapper>
  );
}
