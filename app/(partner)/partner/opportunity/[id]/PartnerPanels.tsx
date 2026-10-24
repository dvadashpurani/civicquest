"use client";

import { useEffect, useState, useTransition } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { CheckinRow } from "@/lib/server/partner";
import { approveAllHours, approveHours, listCheckins, makeNewCode, openEventNow } from "../../actions";

const POLL_MS = 10_000;

function time(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The big check-in QR code and "Make a new code". */
export function QrPanel({
  opportunityId,
  initialToken,
  demo,
  isOpen,
}: {
  opportunityId: string;
  initialToken: string | null;
  demo: boolean;
  isOpen: boolean;
}) {
  const [token, setToken] = useState(initialToken);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {token ? (
        <div className="rounded-xl border border-line bg-white p-4">
          <QRCodeSVG
            value={token}
            size={256}
            level="M"
            marginSize={2}
            title="Check-in code"
            className="h-auto w-full max-w-[18rem]"
          />
        </div>
      ) : (
        <p className="text-base text-subtle">The check-in code isn&rsquo;t available right now.</p>
      )}
      <p className="text-sm text-ink">
        Show this at the site. Students scan it when they arrive and again when they leave.
      </p>
      {demo && token ? (
        <details className="w-full text-left text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-bold text-ink">Show the code as text (demo)</summary>
          <p className="break-all rounded-lg border border-line bg-page p-2 font-mono text-ink">{token}</p>
        </details>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await makeNewCode({ opportunityId });
            if (result.ok) {
              setToken(result.token);
              setMessage("New code ready. The old code no longer works.");
            } else setMessage(result.error);
          })
        }
        className="inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-5 text-base text-ink"
      >
        Make a new code
      </button>
      <p className="text-sm text-subtle">Use this if a photo of the code gets shared. The old code stops working.</p>
      {demo && !isOpen ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await openEventNow({ opportunityId });
              setMessage(result.ok ? "The event is open now." : (result.error ?? "That didn't work."));
            })
          }
          className="inline-flex min-h-12 items-center rounded-lg border border-brand px-5 text-base text-brand"
        >
          Open this event now (demo)
        </button>
      ) : null}
      {message ? (
        <p role="status" className="text-sm font-bold text-ink">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** "Who came today": refreshes every 10 seconds, with per-row and bulk approval. */
export function CheckinTable({
  opportunityId,
  initialRows,
}: {
  opportunityId: string;
  initialRows: CheckinRow[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    const id = setInterval(async () => {
      const result = await listCheckins({ opportunityId });
      if (active && result.ok) setRows(result.rows);
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [opportunityId]);

  async function reload() {
    const result = await listCheckins({ opportunityId });
    if (result.ok) setRows(result.rows);
  }

  const ready = rows.filter((row) => row.status === "pending" && row.checkOutAt !== null);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-extrabold text-ink">Who came today</h2>
        {ready.length > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await approveAllHours({ opportunityId, checkinIds: ready.map((r) => r.id) });
                setMessage(result.ok ? `Approved hours for ${result.approved}.` : result.error);
                await reload();
              })
            }
            className="inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-4 text-base text-ink"
          >
            Approve all
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-base text-subtle">Nobody has checked in yet. This list updates every 10 seconds.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            <thead>
              <tr className="border-b border-line text-sm text-subtle">
                <th className="py-2 pr-3 font-bold">Student</th>
                <th className="py-2 pr-3 font-bold">Time</th>
                <th className="py-2 pr-3 font-bold">Hours</th>
                <th className="py-2 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-b-0">
                  <td className="py-3 pr-3">
                    <strong>{row.name}</strong>
                    {row.grade !== null ? <span className="block text-sm text-subtle">Grade {row.grade}</span> : null}
                  </td>
                  <td className="py-3 pr-3 text-sm text-subtle">
                    In {time(row.checkInAt)}
                    {row.checkOutAt ? <span className="block">Out {time(row.checkOutAt)}</span> : null}
                  </td>
                  <td className="py-3 pr-3">{row.checkOutAt ? `${row.hours ?? 0} h` : "Still here"}</td>
                  <td className="py-3">
                    {row.status === "approved" ? (
                      <span className="inline-block rounded-full bg-brand-soft px-2 py-0.5 text-sm font-bold text-brand">
                        Approved
                      </span>
                    ) : row.checkOutAt ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await approveHours({ checkinId: row.id });
                            setMessage(result.ok ? `Approved ${row.name}'s hours.` : result.error);
                            await reload();
                          })
                        }
                        className="inline-flex min-h-11 items-center rounded-lg bg-brand px-3 text-sm text-on-brand"
                      >
                        Approve hours
                      </button>
                    ) : (
                      <span className="inline-block rounded-full bg-today/40 px-2 py-0.5 text-sm font-bold text-ink">
                        Checked in
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message ? (
        <p role="status" className="mt-2 text-sm font-bold text-ink">
          {message}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-subtle">
        You see only first name, last initial, and grade. Only someone who was there approves hours.
      </p>
    </div>
  );
}
