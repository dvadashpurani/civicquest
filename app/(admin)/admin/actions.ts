"use server";

// Admin reversal from the proof log. A school admin may reverse a mission
// confirmation at any age with a free-text reason (1–500 characters). The
// undo_mission RPC re-checks the admin's role and school in its own body and
// writes the audit entry in the same transaction; nothing is deleted.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require";
import { createServerSupabase } from "@/lib/supabase/server";
import { adminReversalSchema } from "@/lib/validation/mission";

export type ReverseResult = { ok: true } | { ok: false; error: string };

export async function reverseConfirmation(input: unknown): Promise<ReverseResult> {
  const parsed = adminReversalSchema.safeParse(input);
  if (!parsed.success || parsed.data.reason.trim() === "") {
    return { ok: false, error: "Write a reason of up to 500 characters." };
  }
  const { classId, missionId, reason } = parsed.data;

  const { profile } = await requireRole("admin");
  const supabase = await createServerSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: "Sign in again to reverse this." };

  // Convenience check; the RPC enforces the same rule.
  const { data: klass } = await supabase
    .from("classes")
    .select("id, school_id")
    .eq("id", classId)
    .maybeSingle();
  if (!klass || klass.school_id !== profile.school_id) {
    return { ok: false, error: "You can only reverse missions in your own school." };
  }

  const { error } = await supabase.rpc("undo_mission", {
    p_class_id: classId,
    p_mission_id: missionId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: "That didn't save. Wait a moment, then try again." };

  revalidatePath("/admin");
  revalidatePath("/admin/proof-log");
  return { ok: true };
}
