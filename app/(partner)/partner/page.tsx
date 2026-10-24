import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, PARTNER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { getOpportunities, getPartnerOrgName } from "@/lib/server/partner";

// Partner home — `/partner`: the partner org's volunteer opportunities. RLS
// limits the list to the caller's own org. Calm skin.

export const metadata: Metadata = {
  title: "Opportunities · CivicQuest",
};

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const from = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const to = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day}, ${from} to ${to}`;
}

async function PartnerBody() {
  await connection();
  const { profile } = await requireRole("partner");
  const now = new Date().getTime();

  if (!profile.partner_org_id) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="font-heading text-3xl font-extrabold text-ink">Opportunities</h1>
        <p className="mt-3 text-base text-subtle">
          Your account isn&rsquo;t linked to a partner organization yet. Ask CivicQuest support to link it.
        </p>
      </main>
    );
  }

  const [orgName, opportunities] = await Promise.all([
    getPartnerOrgName(profile.partner_org_id),
    getOpportunities(),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold text-ink">{orgName ?? "Your organization"}</h1>
      <p className="mt-1 text-base text-subtle">Partner view, signed in as {profile.full_name}.</p>

      <h2 className="mt-6 font-heading text-xl font-extrabold text-ink">Your volunteer opportunities</h2>
      {opportunities.length === 0 ? (
        <p className="mt-3 text-base text-subtle">No opportunities yet.</p>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {opportunities.map((opp) => {
            const open =
              now >= new Date(opp.startsAt).getTime() - 30 * 60 * 1000 && now <= new Date(opp.endsAt).getTime();
            const past = now > new Date(opp.endsAt).getTime();
            return (
              <li key={opp.id}>
                <Link
                  href={`/partner/opportunity/${opp.id}`}
                  className="flex h-full flex-col gap-1 rounded-xl border border-line bg-surface p-5 hover:border-brand"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-lg text-ink">{opp.title}</strong>
                    {open ? (
                      <span className="rounded-full bg-today px-2 py-0.5 text-sm font-bold text-ink">Open now</span>
                    ) : past ? (
                      <span className="rounded-full bg-line px-2 py-0.5 text-sm font-bold text-subtle">Done</span>
                    ) : null}
                  </span>
                  <span className="text-sm text-subtle">{formatRange(opp.startsAt, opp.endsAt)}</span>
                  <span className="text-sm text-subtle">
                    {opp.locationName}, grades {opp.minGrade} to 12
                    {opp.capacity ? `, up to ${opp.capacity} students` : ""}
                  </span>
                  <span className="mt-2 font-bold text-brand">Show check-in code</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function PartnerPage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={PARTNER_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading your opportunities…</p>
          </div>
        }
      >
        <PartnerBody />
      </Suspense>
    </SkinWrapper>
  );
}
