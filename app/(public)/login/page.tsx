import type { Metadata } from "next";
import { SkinWrapper } from "@/components/skin/SkinWrapper";
import { LoginForm } from "./LoginForm";

// `/login` (Requirement 6.11). Static: it reads no cookies, so a signed-in
// user without a role still sees the form instead of bouncing between here
// and the proxy. The `?next=` parameter is not read until task 3.15.

export const metadata: Metadata = {
  title: "Sign in · CivicQuest",
};

export default function LoginPage() {
  return (
    <SkinWrapper skin="calm" className="flex flex-1 flex-col bg-page">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <h1 className="text-3xl text-ink">Sign in to CivicQuest</h1>
        <p className="mt-2 text-base text-subtle">
          Use the email and password your school or partner organization gave you.
        </p>
        <div className="mt-8 rounded-xl border border-line bg-surface p-6">
          <LoginForm />
        </div>
      </main>
    </SkinWrapper>
  );
}
