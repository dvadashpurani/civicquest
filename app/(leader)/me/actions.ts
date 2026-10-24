"use server";

// Leader QR scan. The scanned text is validated with a strict zod schema, the
// user is verified with getUser(), and the student role is required. Every
// real check (current code, school link, grade, capacity, time window, the 10
// scans per minute limit, check-in versus check-out, and server-computed
// hours) runs inside the `leader_scan` RPC, so direct .rpc() calls get the
// same rules. The RPC returns a rejection instead of raising.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require";
import { createServerSupabase } from "@/lib/supabase/server";
import { scanSchema } from "@/lib/validation/checkins";

export type ScanResult =
  | { ok: true; action: "checked_in" | "checked_out"; title: string; hours: number | null }
  | { ok: false; error: string };

const INVALID = "This code isn't valid. Ask the partner for the current code.";

export async function scanCode(input: unknown): Promise<ScanResult> {
  const parsed = scanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID };

  await requireRole("student");
  const supabase = await createServerSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: "Sign in again to check in." };

  const { data, error } = await supabase.rpc("leader_scan", { p_token: parsed.data.token });
  if (error) return { ok: false, error: "That scan didn't go through. Wait a moment, then try again." };

  const result = data as {
    ok?: boolean;
    message?: string;
    action?: "checked_in" | "checked_out";
    opportunity_title?: string;
    hours?: number | string | null;
  } | null;
  if (!result?.ok || !result.action) return { ok: false, error: result?.message ?? INVALID };

  revalidatePath("/me");
  return {
    ok: true,
    action: result.action,
    title: result.opportunity_title ?? "the event",
    hours: result.hours === null || result.hours === undefined ? null : Number(result.hours),
  };
}
