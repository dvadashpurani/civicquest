import { Suspense } from "react";
import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { safeRedirectPath } from "@/lib/domain/redirect";
import { LoginForm } from "./LoginForm";

// `/login` (Requirement 6.11). It reads no cookies, so a signed-in user
// without a role still sees the form instead of bouncing between here and the
// proxy.
//
// Under `cacheComponents`, reading `searchParams` in the page body would make
// the whole route a blocking dynamic render. Instead the page shell is static
// and only the small `<NextRedirectForm>` child awaits `searchParams`, wrapped
// in <Suspense> so the shell streams immediately and the form fills in when the
// request params resolve. The `?next=` target the proxy attaches is passed to
// the form through safeRedirectPath, so only a plain relative path survives to
// the hidden field; the server action re-validates it and falls back to the
// role home otherwise (Requirements 6.12, 6.13).

export const metadata: Metadata = {
  title: "Sign in · CivicQuest",
};

/**
 * Reads `?next=` and renders the sign-in form. Isolated from the page body so
 * the dynamic `searchParams` access does not force the whole route to render
 * dynamically under `cacheComponents`; it renders inside <Suspense> below.
 */
async function NextRedirectForm({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = params.next;
  const nextCandidate = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const next = typeof nextCandidate === "string" ? safeRedirectPath(nextCandidate) : "/";

  return <LoginForm next={next} />;
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <SkinWrapper skin="calm" className="flex flex-1 flex-col bg-page">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <h1 className="text-3xl text-ink">Sign in to CivicQuest</h1>
        <p className="mt-2 text-base text-subtle">
          Use the email and password your school or partner organization gave you.
        </p>
        <div className="mt-8 rounded-xl border border-line bg-surface p-6">
          <Suspense fallback={<p className="text-base text-subtle">Loading the sign-in form…</p>}>
            <NextRedirectForm searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
    </SkinWrapper>
  );
}
