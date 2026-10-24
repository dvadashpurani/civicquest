import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { AppHeader, ADMIN_LINKS } from "@/components/layout/AppHeader";
import { requireRole } from "@/lib/auth/require";
import { getSchoolProofLog } from "@/lib/server/admin";
import { ReverseForm } from "./ReverseForm";

// The school proof log — `/admin/proof-log`. Newest first: who, what, when,
// the reason for any reversal, and which students. Append-only; an admin can
// reverse a confirmation at any age, which adds a new entry.

export const metadata: Metadata = {
  title: "Proof log · CivicQuest",
};

const RECENT_MS = 24 * 60 * 60 * 1000;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function ProofLogBody() {
  await connection();
  await requireRole("admin");
  const now = new Date().getTime();
  const rows = await getSchoolProofLog(150);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="font-heading text-3xl font-extrabold text-ink">Proof log</h1>
      <p className="mt-1 text-base text-subtle">
        Every confirmation, edit, undo, check-in, and approval, newest first. Entries can&rsquo;t be edited or
        deleted.
      </p>

      {rows.length === 0 ? (
        <p className="mt-6 text-base text-subtle">Nothing in the proof log yet.</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-3">
          {rows.map((row) => {
            const recent = now - new Date(row.createdAt).getTime() < RECENT_MS;
            return (
              <li key={row.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-subtle">{row.action}</p>
                    <p className="text-lg font-bold text-ink">
                      {row.what || "Change"}
                      {row.where ? <span className="font-normal text-subtle">, {row.where}</span> : null}
                    </p>
                    <p className="text-sm text-subtle">
                      By {row.who}, <time dateTime={row.createdAt}>{formatWhen(row.createdAt)}</time>
                    </p>
                    {row.reason ? (
                      <p className="mt-1 text-sm text-ink">
                        <strong>Reason:</strong> {row.reason}
                      </p>
                    ) : null}
                    {row.students.length > 0 ? (
                      <details className="mt-1 text-sm text-ink">
                        <summary className="min-h-11 cursor-pointer py-2 font-bold">
                          {row.students.length} {row.students.length === 1 ? "student" : "students"}
                        </summary>
                        <p className="text-subtle">{row.students.join(", ")}</p>
                      </details>
                    ) : null}
                  </div>
                  {row.reversible ? (
                    <div className="shrink-0 sm:w-72">
                      {recent ? (
                        <p className="mb-1 text-sm text-subtle">The teacher can still undo this today.</p>
                      ) : null}
                      <ReverseForm classId={row.reversible.classId} missionId={row.reversible.missionId} />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

export default function ProofLogPage() {
  return (
    <SkinWrapper skin="calm" className="flex min-h-dvh flex-col bg-page">
      <AppHeader links={ADMIN_LINKS} />
      <Suspense
        fallback={
          <div className="mx-auto w-full max-w-5xl px-4 py-8">
            <p className="text-base text-subtle">Loading the proof log…</p>
          </div>
        }
      >
        <ProofLogBody />
      </Suspense>
    </SkinWrapper>
  );
}
