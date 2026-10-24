"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type LoginState } from "./actions";

const initialState: LoginState = { error: null, email: "", attempt: 0 };
const ERROR_ID = "login-error";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const describedBy = state.error ? ERROR_ID : undefined;

  return (
    // noValidate: empty or malformed fields go to the server and get the same
    // generic message as wrong credentials (Requirement 6.8). `required`
    // stays for assistive technology.
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {/* Always mounted so screen readers pick up each new message. The key
          remounts the text so a repeated message is announced again. */}
      <div id={ERROR_ID} role="alert" aria-live="assertive" aria-atomic="true">
        {state.error ? (
          <p
            key={state.attempt}
            className="rounded-lg border border-danger bg-surface px-3 py-2 text-base text-danger"
          >
            {state.error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="login-email">Email</Label>
        <Input
          // Remount after each failure so the field shows the echoed email.
          key={`email-${state.attempt}`}
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          defaultValue={state.email}
          aria-describedby={describedBy}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          aria-describedby={describedBy}
        />
      </div>

      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
