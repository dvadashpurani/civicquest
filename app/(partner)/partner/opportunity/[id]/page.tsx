import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { z } from "zod";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, PARTNER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { isDemoMode } from "@/lib/env";
import { getCheckinRows, getOpportunity, getOpportunityToken } from "@/lib/server/partner";
import { CheckinTable, QrPanel } from "./PartnerPanels";

// One opportunity — `/partner/opportunity/[id]`: the big check-in QR code,
// "Make a new code", and the live "Who came today" table with hour approvals.
// RLS limits everything to the partner's own org; another org's id is a 404.

export const metadata: Metadata = {
  title: "Check-in code · CivicQuest",
};

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const from = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const to = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day}, ${from} to ${to}`;
}

async function OpportunityBody({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { profile } = await requireRole("partner");
  if (!z.uuid().safeParse(id).success) notFound();

  const opportunity = await getOpportunity(id);
  if (!opportunity || opportunity.partnerOrgId !== profile.partner_org_id) notFound();

  const [token, rows] = await Promise.all([getOpportunityToken(id), getCheckinRows(id)]);
  const now = new Date().getTime();
  const isOpen =
    now >= new Date(opportunity.startsAt).getTime() - 30 * 60 * 1000 &&
    now <= new Date(opportunity.endsAt).getTime();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/partner" className="inline-flex min-h-11 items-center text-sm text-subtle">
        &larr; All opportunities
      </Link>
      <h1 className="font-heading text-3xl font-extrabold text-ink">{opportunity.title}</h1>
      <p className="mt-1 text-base text-subtle">
        {formatRange(opportunity.startsAt, opportunity.endsAt)}, for grades {opportunity.minGrade} to 12.{" "}
        {isOpen ? <strong className="text-ink">Check-in is open.</strong> : "Check-in opens 30 minutes before the start."}
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 lg:items-start">
        <section className="rounded-xl border border-line bg-surface p-5">
          <QrPanel opportunityId={id} initialToken={token} demo={isDemoMode()} isOpen={isOpen} />
        </section>
        <section className="rounded-xl border border-line bg-surface p-5">
          <CheckinTable opportunityId={id} initialRows={rows} />
        </section>
      </div>
    </main>
  );
}

export default function OpportunityPage({ params }: PageProps<"/partner/opportunity/[id]">) {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={PARTNER_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading the check-in code…</p>
          </div>
        }
      >
        <OpportunityBody params={params} />
      </Suspense>
    </SkinWrapper>
  );
}
