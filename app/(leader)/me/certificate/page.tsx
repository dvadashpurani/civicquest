import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, LEADER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { getLeaderSummary } from "@/lib/server/leader";
import { LeaderTabs } from "../LeaderTabs";
import { PrintButton } from "./PrintButton";

// Printable certificate of approved service hours — `/me/certificate`. Only
// approved check-ins count; pending hours are left out.

export const metadata: Metadata = {
  title: "Certificate · CivicQuest",
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

async function CertificateBody() {
  await connection();
  await requireRole("student");
  const summary = await getLeaderSummary();
  if (!summary) {
    return <p className="text-base text-subtle">Your login isn&rsquo;t linked to a student yet.</p>;
  }
  const oppById = new Map(summary.opportunities.map((o) => [o.id, o]));
  const approved = summary.checkins.filter((c) => c.status === "approved");
  const issued = day(new Date().toISOString());

  return (
    <>
      <article className="rounded-xl border-4 border-double border-brand bg-surface p-6 text-center sm:p-10 print:border-black">
        <p className="text-sm text-subtle">{summary.schoolName}</p>
        <h1 className="mt-2 font-heading text-3xl font-extrabold text-ink sm:text-4xl">Certificate of service</h1>
        <p className="mt-4 text-base text-ink">This certifies that</p>
        <p className="mt-2 font-heading text-3xl font-extrabold text-ink">{summary.name}</p>
        <p className="mt-2 text-base text-ink">
          completed <strong>{summary.verifiedHours} verified hours</strong> of community service, each approved by
          a supervisor at the organization where it took place.
        </p>
        {approved.length > 0 ? (
          <table className="mx-auto mt-6 w-full max-w-lg border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-subtle">
                <th className="py-2 pr-2 font-bold">Date</th>
                <th className="py-2 pr-2 font-bold">Where</th>
                <th className="py-2 text-right font-bold">Hours</th>
              </tr>
            </thead>
            <tbody>
              {approved.map((c) => {
                const opp = oppById.get(c.opportunityId);
                return (
                  <tr key={c.id} className="border-b border-line">
                    <td className="py-2 pr-2">{day(c.checkInAt)}</td>
                    <td className="py-2 pr-2">
                      {opp?.title ?? "Volunteer shift"}
                      {opp ? <span className="block text-subtle">{opp.partnerName}</span> : null}
                    </td>
                    <td className="py-2 text-right tabular-nums">{c.hours ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="mt-6 text-sm text-subtle">No approved hours yet.</p>
        )}
        <p className="mt-6 text-sm text-subtle">Verified through CivicQuest QR check-in. Issued {issued}.</p>
      </article>
      <PrintButton />
    </>
  );
}

export default function CertificatePage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page print:bg-white">
      <AppHeader links={LEADER_LINKS} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-6 sm:pb-10">
        <Suspense fallback={<p className="text-base text-subtle">Loading your certificate…</p>}>
          <CertificateBody />
        </Suspense>
      </main>
      <LeaderTabs current="/me/certificate" />
    </SkinWrapper>
  );
}
