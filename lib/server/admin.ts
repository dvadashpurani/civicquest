import "server-only";

// Server loaders for the school admin overview and proof log. Every query runs
// as the signed-in admin under RLS, which scopes classes, students,
// completions, check-ins, and audit_log to the admin's own school. Explicit
// column lists only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export type CivicsProgress = {
  readonly classId: string;
  readonly className: string;
  readonly done: number;
  readonly total: number;
};

export type AdminOverview = {
  readonly schoolName: string;
  readonly students: number;
  readonly completionsThisWeek: number;
  readonly verifiedHours: number;
  readonly civics: readonly CivicsProgress[];
};

/** Monday 00:00 of the week containing `now`, in server local time. */
export function startOfWeek(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay(); // 0 = Sunday
  start.setDate(start.getDate() - ((day + 6) % 7));
  return start;
}

export async function getAdminOverview(
  schoolId: string,
  now: Date,
  client?: SupabaseClient,
): Promise<AdminOverview> {
  const supabase = client ?? (await createServerSupabase());
  const weekStart = startOfWeek(now).toISOString();

  const [school, students, week, hours, civicsModule] = await Promise.all([
    supabase.from("schools").select("name").eq("id", schoolId).maybeSingle(),
    supabase.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    supabase
      .from("mission_completions")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .gte("confirmed_at", weekStart),
    supabase.from("student_hours").select("verified_hours").eq("school_id", schoolId),
    supabase.from("modules").select("id").eq("title", "Civics Project").limit(1).maybeSingle(),
  ]);

  const civics: CivicsProgress[] = [];
  const moduleId = civicsModule.data?.id as string | undefined;
  if (moduleId) {
    const [{ data: assigned }, { data: missions }] = await Promise.all([
      supabase.from("class_modules").select("class_id, classes(name)").eq("module_id", moduleId),
      supabase.from("missions").select("id").eq("module_id", moduleId),
    ]);
    const missionIds = (missions ?? []).map((m) => m.id as string);
    for (const row of assigned ?? []) {
      const klass = Array.isArray(row.classes) ? row.classes[0] : row.classes;
      const { data: approved } = await supabase
        .from("mission_completions")
        .select("mission_id")
        .eq("class_id", row.class_id)
        .eq("status", "approved")
        .in("mission_id", missionIds);
      civics.push({
        classId: row.class_id,
        className: (klass as { name?: string } | null)?.name ?? "Class",
        done: new Set((approved ?? []).map((a) => a.mission_id)).size,
        total: missionIds.length || 5,
      });
    }
  }

  return {
    schoolName: (school.data?.name as string | undefined) ?? "Your school",
    students: students.count ?? 0,
    completionsThisWeek: week.count ?? 0,
    verifiedHours: (hours.data ?? []).reduce((sum, row) => sum + Number(row.verified_hours ?? 0), 0),
    civics,
  };
}

/** One readable proof-log row. */
export type ProofRow = {
  readonly id: number;
  readonly createdAt: string;
  readonly action: string;
  readonly who: string;
  readonly what: string;
  readonly where: string;
  readonly reason: string | null;
  readonly students: readonly string[];
  /** Set on a confirm whose mission is still approved, so it can be reversed. */
  readonly reversible: { readonly classId: string; readonly missionId: string } | null;
};

const ACTION_LABELS: Record<string, string> = {
  confirm: "Confirmed a mission",
  re_approve: "Re-confirmed a student",
  edit: "Edited who took part",
  edit_remove: "Removed a student",
  undo: "Reversed a mission",
  check_in: "Checked in",
  check_out: "Checked out",
  approve: "Approved volunteer hours",
  regenerate_token: "Made a new QR code",
};

type Details = Record<string, unknown> | null;

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * The school's proof log, newest first, with names resolved for people,
 * classes, missions, students, and opportunities. Reads are all RLS-scoped to
 * the admin's school.
 */
export async function getSchoolProofLog(
  limit = 100,
  client?: SupabaseClient,
): Promise<ProofRow[]> {
  const supabase = client ?? (await createServerSupabase());

  const { data: entries, error } = await supabase
    .from("audit_log")
    .select("id, actor_id, action, target_table, target_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !entries) return [];

  const [profiles, classes, missions, students, approved, checkins, opportunities] = await Promise.all([
    supabase.from("profiles").select("id, full_name, role"),
    supabase.from("classes").select("id, name, teacher_id"),
    supabase.from("missions").select("id, title"),
    supabase.from("students").select("id, first_name, last_initial"),
    supabase.from("mission_completions").select("class_id, mission_id, student_id").eq("status", "approved"),
    supabase.from("checkins").select("id, student_id, opportunity_id"),
    supabase.from("opportunities").select("id, title"),
  ]);

  const nameOf = new Map((profiles.data ?? []).map((p) => [p.id as string, p.full_name as string]));
  const classOf = new Map((classes.data ?? []).map((c) => [c.id as string, c.name as string]));
  const teacherOf = new Map((classes.data ?? []).map((c) => [c.id as string, c.teacher_id as string | null]));
  const missionOf = new Map((missions.data ?? []).map((m) => [m.id as string, m.title as string]));
  const studentOf = new Map(
    (students.data ?? []).map((s) => [s.id as string, `${s.first_name} ${s.last_initial}.`]),
  );
  const stillApproved = new Set(
    (approved.data ?? []).map((row) => `${row.class_id}:${row.mission_id}`),
  );
  const checkinOf = new Map(
    (checkins.data ?? []).map((c) => [c.id as string, { student: c.student_id as string, opp: c.opportunity_id as string }]),
  );
  const oppOf = new Map((opportunities.data ?? []).map((o) => [o.id as string, o.title as string]));

  // Reversed completion ids → student, for undo entries.
  const completionIds = entries.flatMap((e) => idList((e.details as Details)?.reversed_completion_ids));
  const completionStudent = new Map<string, string>();
  if (completionIds.length > 0) {
    const { data } = await supabase
      .from("mission_completions")
      .select("id, student_id")
      .in("id", completionIds.slice(0, 500));
    for (const row of data ?? []) completionStudent.set(row.id as string, row.student_id as string);
  }

  // Offer "Reverse" only on the newest confirm of each class mission.
  const offered = new Set<string>();

  return entries.map((entry) => {
    const details = (entry.details ?? null) as Details;
    const classId = typeof details?.class_id === "string" ? details.class_id : null;
    const missionId = typeof details?.mission_id === "string" ? details.mission_id : null;

    let studentIds: string[] = [];
    if (Array.isArray(details?.present_student_ids)) studentIds = idList(details.present_student_ids);
    else if (typeof details?.student_id === "string") studentIds = [details.student_id];
    else if (details?.reversed_completion_ids) {
      studentIds = idList(details.reversed_completion_ids)
        .map((id) => completionStudent.get(id))
        .filter((id): id is string => Boolean(id));
    }

    let what = missionId ? (missionOf.get(missionId) ?? "Mission") : "";
    let where = classId ? (classOf.get(classId) ?? "") : "";
    if (entry.target_table === "checkins" && entry.target_id) {
      const checkin = checkinOf.get(entry.target_id as string);
      const oppId =
        typeof details?.opportunity_id === "string" ? details.opportunity_id : checkin?.opp;
      what = oppId ? (oppOf.get(oppId) ?? "Volunteer opportunity") : "Volunteer opportunity";
      if (typeof details?.hours === "number" || typeof details?.hours === "string") {
        where = `${Number(details.hours)} hours`;
      }
      if (checkin) studentIds = [checkin.student];
    }

    const who = entry.actor_id
      ? (nameOf.get(entry.actor_id as string) ??
        (entry.target_table === "checkins" ? "Partner supervisor" : "Staff member"))
      : // Seeded history has no actor; it was confirmed by the class's teacher.
        ((classId ? nameOf.get(teacherOf.get(classId) ?? "") : undefined) ?? "System");

    const key = `${classId}:${missionId}`;
    const reversible =
      entry.action === "confirm" && classId && missionId && stillApproved.has(key) && !offered.has(key)
        ? { classId, missionId }
        : null;
    if (reversible) offered.add(key);

    return {
      id: entry.id as number,
      createdAt: entry.created_at as string,
      action: ACTION_LABELS[entry.action as string] ?? (entry.action as string),
      who,
      what,
      where,
      reason: typeof details?.reason === "string" ? details.reason : null,
      students: studentIds.map((id) => studentOf.get(id) ?? "A student"),
      reversible,
    };
  });
}
