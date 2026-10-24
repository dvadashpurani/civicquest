import "server-only";

// Server loaders for the class-mode student dashboard
// (/teacher/class/[id]/play). Learners and Helpers have no accounts, so these
// run as the signed-in TEACHER under RLS: a teacher sees only students and
// completions of classes they own, and anyone else gets empty results.
// Explicit column lists only, never `select *`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Quality } from "@/lib/domain/types";

/** The six stamp qualities, in passport order. */
export const PASSPORT_QUALITIES: readonly Quality[] = [
  "Safety",
  "Kindness",
  "Responsibility",
  "Respect",
  "Helping",
  "Civic action",
];

/** One mission a student took part in, for "Missions I did". */
export type StudentMission = {
  readonly missionId: string;
  readonly title: string;
  readonly moduleId: string;
  readonly moduleTitle: string;
  readonly quality: Quality;
  readonly confirmedAt: string | null;
  readonly confirmedBy: string;
  readonly points: number;
};

export type StudentDashboard = {
  readonly points: number;
  readonly stickers: number;
  /** Consecutive most recent class missions this student took part in. */
  readonly streak: number;
  readonly stamps: Readonly<Record<Quality, number>>;
  /** Newest first. */
  readonly missions: readonly StudentMission[];
  /** Mission ids this student took part in. */
  readonly missionIds: ReadonlySet<string>;
  /** The class's most recently confirmed mission, if the student missed it. */
  readonly missedLatest: { readonly title: string; readonly townItem: string } | null;
};

type EmbeddedModule = { title?: string; quality?: string } | null;
type EmbeddedMission = {
  title?: string;
  town_item?: string;
  module_id?: string;
  modules?: EmbeddedModule | EmbeddedModule[];
} | null;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Everything the dashboard shows for one student of a class the teacher owns:
 * points, stickers, streak, per-quality stamps, and their mission history.
 * `teacherId`/`teacherName` label "confirmed by"; teachers can read only their
 * own profile, so another confirmer shows as "a teacher".
 */
export async function getStudentDashboard(
  classId: string,
  studentId: string,
  teacher: { id: string; name: string },
  client?: SupabaseClient,
): Promise<StudentDashboard> {
  const supabase = client ?? (await createServerSupabase());

  const [own, classWide] = await Promise.all([
    supabase
      .from("mission_completions")
      .select(
        "mission_id, confirmed_at, confirmed_by, points_awarded, missions(title, town_item, module_id, modules(title, quality))",
      )
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("status", "approved"),
    supabase
      .from("mission_completions")
      .select("mission_id, confirmed_at, missions(title, town_item)")
      .eq("class_id", classId)
      .eq("status", "approved"),
  ]);

  const stamps = Object.fromEntries(PASSPORT_QUALITIES.map((q) => [q, 0])) as Record<Quality, number>;
  const missions: StudentMission[] = [];
  let points = 0;

  for (const row of own.data ?? []) {
    const mission = one(row.missions as EmbeddedMission | EmbeddedMission[]);
    const parent = one(mission?.modules);
    const quality = (parent?.quality ?? "Safety") as Quality;
    stamps[quality] = (stamps[quality] ?? 0) + 1;
    points += row.points_awarded ?? 0;
    missions.push({
      missionId: row.mission_id,
      title: mission?.title ?? "Mission",
      moduleId: mission?.module_id ?? "",
      moduleTitle: parent?.title ?? "",
      quality,
      confirmedAt: row.confirmed_at,
      confirmedBy: row.confirmed_by === teacher.id ? teacher.name : "a teacher",
      points: row.points_awarded ?? 0,
    });
  }
  missions.sort((a, b) => (b.confirmedAt ?? "").localeCompare(a.confirmedAt ?? ""));
  const missionIds = new Set(missions.map((m) => m.missionId));

  // The class's confirmed missions, newest first (earliest confirmed_at per
  // mission, the same rule the class town uses).
  const classMissions = new Map<string, { at: string; title: string; townItem: string }>();
  for (const row of classWide.data ?? []) {
    if (!row.confirmed_at) continue;
    const mission = one(row.missions as EmbeddedMission | EmbeddedMission[]);
    const existing = classMissions.get(row.mission_id);
    if (!existing || row.confirmed_at < existing.at) {
      classMissions.set(row.mission_id, {
        at: row.confirmed_at,
        title: mission?.title ?? "Mission",
        townItem: mission?.town_item ?? "",
      });
    }
  }
  const ordered = [...classMissions.entries()].sort((a, b) => b[1].at.localeCompare(a[1].at));

  let streak = 0;
  for (const [missionId] of ordered) {
    if (!missionIds.has(missionId)) break;
    streak += 1;
  }

  const latest = ordered[0];
  const missedLatest =
    latest && !missionIds.has(latest[0])
      ? { title: latest[1].title, townItem: latest[1].townItem }
      : null;

  return {
    points,
    stickers: missions.length,
    streak,
    stamps,
    missions,
    missionIds,
    missedLatest,
  };
}
