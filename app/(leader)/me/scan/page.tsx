import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, LEADER_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { LeaderTabs } from "../LeaderTabs";
import { ScanClient } from "./ScanClient";

// Leader QR scanner — `/me/scan`. The first scan of an event's current code
// checks in; the second checks out. All checks run in the leader_scan RPC.

export const metadata: Metadata = {
  title: "Scan · CivicQuest",
};

async function ScanBody() {
  await connection();
  await requireRole("student");
  return <ScanClient />;
}

export default function ScanPage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={LEADER_LINKS} />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-28 pt-6 sm:pb-10">
        <h1 className="font-heading text-3xl font-extrabold text-ink">Scan the site&rsquo;s code</h1>
        <Suspense fallback={<p className="text-base text-subtle">Starting the scanner…</p>}>
          <ScanBody />
        </Suspense>
      </main>
      <LeaderTabs current="/me/scan" />
    </SkinWrapper>
  );
}
