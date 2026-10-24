import "server-only";

// Server loaders for the partner screens. Everything runs as the signed-in
// partner under RLS, which limits opportunities and check-ins to the partner's
// own org. The QR token is never selected from the table (the column is not
// granted); it comes only from `partner_opportunity_token`, which checks
// ownership. Student detail comes only from `partner_checkin_students`
// (first name, last initial, grade).

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

const OPPORTUNITY_COLUMNS =
  "id, partner_org_id, title, description, location_name, starts_at, ends_at, min_grade, capacity";

export type Opportunity = {
  readonly id: string;
  readonly partnerOrgId: string;
  readonly title: string;
  readonly description: string;
  readonly locationName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly minGrade: number;
  readonly capacity: number | null;
};

type OpportunityRow = {
  id: string;
  partner_org_id: string;
  title: string;
  description: string;
  location_name: string;
  starts_at: string;
  ends_at: string;
  min_grade: number;
  capacity: number | null;
};

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    partnerOrgId: row.partner_org_id,
    title: row.title,
    description: row.description,
    locationName: row.location_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    minGrade: row.min_grade,
    capacity: row.capacity,
  };
}

/** Opportunities the caller can see, ordered by start time. */
export async function getOpportunities(client?: SupabaseClient): Promise<Opportunity[]> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .order("starts_at", { ascending: true });
  if (error || !data) return [];
  return (data as OpportunityRow[]).map(toOpportunity);
}

export async function getOpportunity(id: string, client?: SupabaseClient): Promise<Opportunity | null> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase
    .from("opportunities")
    .select(OPPORTUNITY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return toOpportunity(data as OpportunityRow);
}

/** The partner org's display name, or null. */
export async function getPartnerOrgName(orgId: string, client?: SupabaseClient): Promise<string | null> {
  const supabase = client ?? (await createServerSupabase());
  const { data } = await supabase.from("partner_orgs").select("name").eq("id", orgId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

/** The current QR token, only for the caller's own org's opportunity. */
export async function getOpportunityToken(id: string, client?: SupabaseClient): Promise<string | null> {
  const supabase = client ?? (await createServerSupabase());
  const { data, error } = await supabase.rpc("partner_opportunity_token", { p_opportunity_id: id });
  if (error || typeof data !== "string") return null;
  return data;
}

export type CheckinRow = {
  readonly id: string;
  readonly name: string;
  readonly grade: number | null;
  readonly checkInAt: string;
  readonly checkOutAt: string | null;
  readonly hours: number | null;
  readonly status: string;
};

/** Who checked in to an opportunity, earliest first. */
export async function getCheckinRows(opportunityId: string, client?: SupabaseClient): Promise<CheckinRow[]> {
  const supabase = client ?? (await createServerSupabase());
  const [checkins, people] = await Promise.all([
    supabase
      .from("checkins")
      .select("id, check_in_at, check_out_at, hours, status")
      .eq("opportunity_id", opportunityId)
      .order("check_in_at", { ascending: true }),
    supabase.rpc("partner_checkin_students", { p_opportunity_id: opportunityId }),
  ]);
  if (checkins.error || !checkins.data) return [];
  const byCheckin = new Map(
    ((people.data ?? []) as { checkin_id: string; first_name: string; last_initial: string; grade: number }[]).map(
      (p) => [p.checkin_id, p],
    ),
  );
  return checkins.data.map((row) => {
    const person = byCheckin.get(row.id as string);
    return {
      id: row.id as string,
      name: person ? `${person.first_name} ${person.last_initial}.` : "Student",
      grade: person?.grade ?? null,
      checkInAt: row.check_in_at as string,
      checkOutAt: (row.check_out_at as string | null) ?? null,
      hours: row.hours === null || row.hours === undefined ? null : Number(row.hours),
      status: row.status as string,
    };
  });
}
