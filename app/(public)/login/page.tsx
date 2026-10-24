import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { safeRedirectPath } from "@/lib/domain/redirect";
import { LoginForm } from "./LoginForm";

// `/login` (Requirement 6.11). It reads no cookies, so a signed-in user
// without a role still sees the form instead of bouncing between here and the
// proxy. The `?next=` target the proxy attaches when it turns a signed-out
// user away is passed to the form through safeRedirectPath, so only a plain
// relative path survives to the hidden field; the server action re-validates
// it and falls back to the role home otherwise (Requirements 6.12, 6.13).

export const metadata: Metadata = {
  title: "Sign in · CivicQuest",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = params.next;
  const nextCandidate = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  const next = typeof nextCandidate === "string" ? safeRedirectPath(nextCandidate) : "/";

  return (
    <SkinWrapper skin="calm" className="flex flex-1 flex-col bg-page">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <h1 className="text-3xl text-ink">Sign in to CivicQuest</h1>
        <p className="mt-2 text-base text-subtle">
          Use the email and password your school or partner organization gave you.
        </p>
        <div className="mt-8 rounded-xl border border-line bg-surface p-6">
          <LoginForm next={next} />
        </div>
      </main>
    </SkinWrapper>
  );
}
