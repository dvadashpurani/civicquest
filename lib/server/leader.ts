import "server-only";

// Server loaders for the Leader (grade 9–12) pages under /me. They run as the
// signed-in Leader under RLS: a Leader reads only their own student row,
// their own check-ins, and opportunities from partners linked to their school.
// The QR token column is never selectable.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export type LeaderOpportunity = {
  readonly id: string;
  readonly title: string;
  readonly locationName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly partnerName: string;
};

export type LeaderCheckin = {
  readonly id: string;
  readonly opportunityId: string;
  readonly checkInAt: string;
  readonly checkOutAt: string | null;
  readonly hours: number | null;
  readonly status: string;
  readonly approvedAt: string | null;
};

export type LeaderSummary = {
  readonly name: string;
  readonly grade: number;
  readonly schoolName: string;
  readonly verifiedHours: number;
  readonly pendingHours: number;
  readonly opportunities: readonly LeaderOpportunity[];
  readonly checkins: readonly LeaderCheckin[];
};

export async function getLeaderSummary(client?: SupabaseClient): Promise<LeaderSummary | null> {
  const supabase = client ?? (await createServerSupabase());

  const { data: student } = await supabase
    .from("students")
    .select("id, first_name, last_initial, grade, school_id")
    .maybeSingle();
  if (!student) return null;

  const [hours, school, opps, checkins] = await Promise.all([
    supabase.from("student_hours").select("verified_hours, pending_hours").eq("student_id", student.id).maybeSingle(),
    supabase.from("schools").select("name").eq("id", student.school_id).maybeSingle(),
    supabase
      .from("opportunities")
      .select("id, title, location_name, starts_at, ends_at, partner_orgs(name)")
      .order("starts_at", { ascending: true }),
    supabase
      .from("checkins")
      .select("id, opportunity_id, check_in_at, check_out_at, hours, status, approved_at")
      .eq("student_id", student.id)
      .order("check_in_at", { ascending: false }),
  ]);

  return {
    name: `${student.first_name} ${student.last_initial}.`,
    grade: student.grade,
    schoolName: (school.data?.name as string | undefined) ?? "Your school",
    verifiedHours: Number(hours.data?.verified_hours ?? 0),
    pendingHours: Number(hours.data?.pending_hours ?? 0),
    opportunities: (opps.data ?? []).map((o) => {
      const org = Array.isArray(o.partner_orgs) ? o.partner_orgs[0] : o.partner_orgs;
      return {
        id: o.id as string,
        title: o.title as string,
        locationName: o.location_name as string,
        startsAt: o.starts_at as string,
        endsAt: o.ends_at as string,
        partnerName: (org as { name?: string } | null)?.name ?? "Partner",
      };
    }),
    checkins: (checkins.data ?? []).map((c) => ({
      id: c.id as string,
      opportunityId: c.opportunity_id as string,
      checkInAt: c.check_in_at as string,
      checkOutAt: (c.check_out_at as string | null) ?? null,
      hours: c.hours === null || c.hours === undefined ? null : Number(c.hours),
      status: c.status as string,
      approvedAt: (c.approved_at as string | null) ?? null,
    })),
  };
}
