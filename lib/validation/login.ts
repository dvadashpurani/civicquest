// Login form validation (Requirements 6.8, 33.1, 33.2). Pure, so it runs in
// the server action and in Vitest. Any failure maps to the same generic
// "Sign-in failed" message in the action; the schema never tells the user
// which field was wrong.

import { z } from "zod";

/** RFC 5321 caps a forward path at 254 characters. */
export const EMAIL_MAX_LENGTH = 254;
/** Generous cap; Supabase Auth itself only hashes the first 72 bytes. */
export const PASSWORD_MAX_LENGTH = 128;

/** Lowercased and trimmed; the form used for sign-in and rate-limit keys. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1)
      .max(EMAIL_MAX_LENGTH)
      .pipe(z.email())
      .transform(normalizeEmail),
    // Never trimmed: whitespace can be part of a password.
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Turns submitted form data into a plain object for `loginSchema`. React adds
 * `$ACTION_*` bookkeeping fields to server action submissions; those are
 * dropped, and every other field is kept so the strict schema rejects unknown
 * ones. A field sent twice becomes an array, which the schema also rejects.
 */
export function loginFormToObject(formData: FormData): Record<string, unknown> {
  // A Map plus Object.fromEntries defines own properties, so a field named
  // `__proto__` stays an ordinary (rejected) key instead of a prototype.
  const fields = new Map<string, FormDataEntryValue[]>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    fields.set(key, [...(fields.get(key) ?? []), value]);
  }
  return Object.fromEntries(
    [...fields].map(([key, values]) => [key, values.length === 1 ? values[0] : values]),
  );
}

/** The validated credentials, or null for any invalid submission. */
export function parseLoginForm(formData: FormData): LoginInput | null {
  const result = loginSchema.safeParse(loginFormToObject(formData));
  return result.success ? result.data : null;
}
