"use client";

/** Opens the browser's print dialog for the certificate. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-12 items-center justify-center self-start rounded-lg bg-brand px-6 text-base text-on-brand print:hidden"
    >
      Print certificate
    </button>
  );
}
