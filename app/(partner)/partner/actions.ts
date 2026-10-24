"use server";

// Partner server actions: refresh the check-in list, make a new QR code, and
// approve hours. Each validates its input with a strict zod schema, verifies
// the user with getUser(), and requires the partner role. The RPCs re-check
// org ownership in their own bodies, so these checks are a friendly first gate.

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/require";
import { isDemoMode } from "@/lib/env";
import { getCheckinRows, getOpportunity, getOpportunityToken, type CheckinRow } from "@/lib/server/partner";
import { createServerSupabase } from "@/lib/supabase/server";
import { approveAllSchema, checkinIdSchema, opportunityIdSchema } from "@/lib/validation/checkins";

const NOT_PERMITTED = "You can only manage your own organization's events.";
const FAILED = "That didn't save. Wait a moment, then try again.";

async function partnerClient() {
  const { profile } = await requireRole("partner");
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !profile.partner_org_id) return null;
  return { supabase, orgId: profile.partner_org_id };
}

async function ownsOpportunity(opportunityId: string, orgId: string): Promise<boolean> {
  const opportunity = await getOpportunity(opportunityId);
  return opportunity !== null && opportunity.partnerOrgId === orgId;
}

export type CheckinsResult = { ok: true; rows: CheckinRow[] } | { ok: false; error: string };

export async function listCheckins(input: unknown): Promise<CheckinsResult> {
  const parsed = opportunityIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  const ctx = await partnerClient();
  if (!ctx || !(await ownsOpportunity(parsed.data.opportunityId, ctx.orgId))) {
    return { ok: false, error: NOT_PERMITTED };
  }
  return { ok: true, rows: await getCheckinRows(parsed.data.opportunityId, ctx.supabase) };
}

export type TokenResult = { ok: true; token: string } | { ok: false; error: string };

export async function makeNewCode(input: unknown): Promise<TokenResult> {
  const parsed = opportunityIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  const ctx = await partnerClient();
  if (!ctx || !(await ownsOpportunity(parsed.data.opportunityId, ctx.orgId))) {
    return { ok: false, error: NOT_PERMITTED };
  }
  const { error } = await ctx.supabase.rpc("regenerate_opportunity_token", {
    p_opportunity_id: parsed.data.opportunityId,
  });
  if (error) return { ok: false, error: FAILED };
  const token = await getOpportunityToken(parsed.data.opportunityId, ctx.supabase);
  return token ? { ok: true, token } : { ok: false, error: FAILED };
}

export type ApproveResult = { ok: true; approved: number } | { ok: false; error: string };

async function approveOne(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  checkinId: string,
): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.rpc("approve_checkin", { p_checkin_id: checkinId });
  if (error) return { ok: false };
  const result = data as { ok?: boolean; message?: string } | null;
  return { ok: result?.ok === true, message: result?.message };
}

export async function approveHours(input: unknown): Promise<ApproveResult> {
  const parsed = checkinIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  const ctx = await partnerClient();
  if (!ctx) return { ok: false, error: NOT_PERMITTED };
  const result = await approveOne(ctx.supabase, parsed.data.checkinId);
  return result.ok ? { ok: true, approved: 1 } : { ok: false, error: result.message ?? FAILED };
}

export async function approveAllHours(input: unknown): Promise<ApproveResult> {
  const parsed = approveAllSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  const ctx = await partnerClient();
  if (!ctx || !(await ownsOpportunity(parsed.data.opportunityId, ctx.orgId))) {
    return { ok: false, error: NOT_PERMITTED };
  }
  let approved = 0;
  for (const id of parsed.data.checkinIds) {
    const result = await approveOne(ctx.supabase, id);
    if (result.ok) approved += 1;
  }
  return { ok: true, approved };
}

/**
 * Demo only: open this event now (started 30 minutes ago, ends in 5 hours), so
 * the scan demo works on any day. Uses the partner's own update grant under
 * RLS; the QR token is untouched.
 */
export async function openEventNow(input: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!isDemoMode()) return { ok: false, error: NOT_PERMITTED };
  const parsed = opportunityIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: FAILED };
  const ctx = await partnerClient();
  if (!ctx || !(await ownsOpportunity(parsed.data.opportunityId, ctx.orgId))) {
    return { ok: false, error: NOT_PERMITTED };
  }
  const now = new Date();
  const { data, error } = await ctx.supabase
    .from("opportunities")
    .update({
      starts_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
      ends_at: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", parsed.data.opportunityId)
    .eq("partner_org_id", ctx.orgId)
    .select("id");
  if (error || !data || data.length !== 1) return { ok: false, error: FAILED };
  refresh();
  return { ok: true };
}
