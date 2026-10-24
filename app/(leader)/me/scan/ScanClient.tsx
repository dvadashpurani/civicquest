"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Scanner, setZXingModuleOverrides, type IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { scanCode, type ScanResult } from "../actions";

// Browsers without a native BarcodeDetector fall back to the zxing WASM
// decoder. The CSP allows connections only to the app itself, so the decoder
// is served from /public instead of the package's default CDN.
setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path),
});

/** Camera scanner: the first scan checks in, the second checks out. */
export function ScanClient() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [paused, setPaused] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  useEffect(() => {
    if (!paused) busy.current = false;
  }, [paused]);

  function submit(token: string) {
    if (busy.current) return;
    busy.current = true;
    setPaused(true);
    startTransition(async () => {
      setResult(await scanCode({ token: token.trim() }));
    });
  }

  function onScan(codes: IDetectedBarcode[]) {
    const value = codes[0]?.rawValue;
    if (value) submit(value);
  }

  return (
    <div className="flex flex-col gap-4">
      {!result ? (
        <>
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-line bg-ink">
            {cameraError ? (
              <p className="p-6 text-center text-base text-white">
                The camera isn&rsquo;t available. Allow camera access, or type the code below.
              </p>
            ) : (
              <Scanner
                onScan={onScan}
                onError={() => setCameraError(true)}
                formats={["qr_code"]}
                paused={paused}
                sound={false}
                constraints={{ facingMode: "environment" }}
              />
            )}
          </div>
          <p className="text-center text-base text-subtle">
            {pending ? "Checking the code…" : "Point your camera at the code at the site."}
          </p>
          <details className="rounded-xl border border-line bg-surface p-4">
            <summary className="min-h-11 cursor-pointer py-2 font-bold text-ink">Can&rsquo;t use the camera?</summary>
            <form
              className="mt-2 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (typed.trim()) submit(typed);
              }}
            >
              <label htmlFor="code" className="text-sm text-subtle">
                Ask the partner for the code shown under their QR code.
              </label>
              <input
                id="code"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                maxLength={256}
                className="min-h-12 rounded-lg border border-line bg-surface px-3 font-mono text-base text-ink"
              />
              <button
                type="submit"
                disabled={pending || !typed.trim()}
                className="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand px-5 text-base text-on-brand disabled:opacity-50"
              >
                Check this code
              </button>
            </form>
          </details>
        </>
      ) : (
        <section
          role="status"
          className={
            result.ok
              ? "rounded-xl border-2 border-brand bg-brand-soft p-5"
              : "rounded-xl border-2 border-danger bg-surface p-5"
          }
        >
          {result.ok ? (
            <>
              <h2 className="font-heading text-2xl font-extrabold text-ink">
                {result.action === "checked_in" ? `Checked in to ${result.title}` : `Checked out of ${result.title}`}
              </h2>
              <p className="mt-1 text-base text-ink">
                {result.action === "checked_in"
                  ? "Scan the code again when you leave."
                  : `${result.hours ?? 0} hours, waiting for the partner to approve.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="font-heading text-2xl font-extrabold text-ink">That didn&rsquo;t work</h2>
              <p className="mt-1 text-base text-ink">{result.error}</p>
            </>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/me"
              className="inline-flex min-h-12 items-center rounded-lg bg-brand px-5 font-bold text-on-brand"
            >
              See my hours
            </Link>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setTyped("");
                setPaused(false);
              }}
              className="inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-5 text-ink"
            >
              Scan again
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
