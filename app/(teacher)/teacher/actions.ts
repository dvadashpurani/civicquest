"use server";

// Teacher core-loop server actions for the Today view and the three-step run
// screen (Requirements 20.1, 20.2, 20.6, 21.2, 21.7, 32.1, 32.2, 32.3, 33.2,
// 34.1, 36.1, 36.2). These are the entry points (Requirement 34.1) for the
// confirm / edit / undo mutations; each one:
//   1. zod-parses its input with a `.strict()` schema from
//      `lib/validation/mission.ts`, so an unknown or malformed field is
//      rejected before anything else runs (Requirements 33.2, 20.2);
//   2. calls `requireRole('teacher')`, which verifies the JWT with Supabase
//      Auth and redirects a signed-out user to `/login` or a wrong-role user
//      to their own home (Requirements 32.1, 32.3);
//   3. re-checks class ownership with `getOwnedClass` — a convenience early
//      rejection, since the RPC re-checks under RLS inside its own body
//      (design.md "In-body ownership checks", Requirement 32.2);
//   4. calls the matching `security invoker` RPC with NAMED params via
//      `supabase.rpc(...)`, where the data change and the `audit_log` insert
//      commit or roll back as one transaction (Requirements 20.1, 20.6, 36.4);
//   5. returns a friendly, generic result. A failure NEVER surfaces raw SQL,
//      a stack trace, a secret, or a student's name, and nothing sensitive is
//      logged (Requirements 36.1, 36.2) — the same convention as the login
//      action (app/(public)/login/actions.ts).
//
// The server never trusts client-sent `points_awarded`, `status`,
// `confirmed_by`, `school_id`, or `level`; those are computed inside the RPCs
// (Requirement 20.2), so they are not part of any input shape here.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require";
import { getOwnedClass } from "@/lib/server/teacher";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  confirmMissionSchema,
  editParticipantsSchema,
  undoMissionSchema,
  type ConfirmMissionInput,
  type EditParticipantsInput,
  type UndoMissionInput,
} from "@/lib/validation/mission";

/**
 * The result every teacher action returns. On success `ok` is true; on any
 * failure it is false with a short, human-readable `error` that is safe to show
 * a teacher — never raw SQL, a stack trace, a secret, or a student name
 * (Requirements 36.1, 36.2).
 */
export type TeacherActionResult = { ok: true } | { ok: false; error: string };

// Generic friendly messages. They deliberately reveal nothing about why a call
// failed (a bad id, a closed window, an RLS denial, or an outage all look the
// same to the client), so the response can never be used to probe for another
// teacher's classes or students.
const INVALID_REQUEST = "Something looks off with that request. Refresh the page and try again.";
const NOT_PERMITTED = "You can only manage missions for your own classes.";
const SAVE_FAILED = "That didn't save. Wait a moment, then try again.";

const ok: TeacherActionResult = { ok: true };

function failed(error: string): TeacherActionResult {
  return { ok: false, error };
}

/**
 * Revalidates the teacher views a confirm / edit / undo changes: the Today
 * view (the next-mission and recent-confirmation panels and the proof log) and
 * the class's own view and town (the buildings, stamps, and points the
 * confirmed roster drives). Paths only; no data or ids are logged.
 */
function revalidateTeacherViews(classId: string): void {
  revalidatePath("/teacher");
  revalidatePath(`/teacher/class/${classId}`);
  revalidatePath(`/teacher/class/${classId}/town`);
}

/**
 * Confirms the present students for a mission (Requirements 20.1, 20.2, 20.6).
 * The RPC de-duplicates the ids, requires each to be a student of the class,
 * and computes points, stamps, and timestamps server-side; this action only
 * validates shape, role, and ownership for a friendly early error.
 */
export async function confirmMission(input: ConfirmMissionInput): Promise<TeacherActionResult> {
  const parsed = confirmMissionSchema.safeParse(input);
  if (!parsed.success) return failed(INVALID_REQUEST);
  const { classId, missionId, presentStudentIds } = parsed.data;

  await requireRole("teacher");

  const supabase = await createServerSupabase();
  const owned = await getOwnedClass(classId, supabase);
  if (!owned) return failed(NOT_PERMITTED);

  try {
    const { error } = await supabase.rpc("confirm_class_mission", {
      p_class_id: classId,
      p_mission_id: missionId,
      p_present_student_ids: presentStudentIds,
    });
    // The RPC's own error text can carry SQL detail, so it is never surfaced or
    // logged; the teacher sees one generic message instead (Requirements 36.1,
    // 36.2).
    if (error) return failed(SAVE_FAILED);
  } catch {
    // Network or database outage: the same generic failure, nothing logged.
    return failed(SAVE_FAILED);
  }

  revalidateTeacherViews(classId);
  return ok;
}

/**
 * Edits the present roster for an already-confirmed mission within the 24h
 * window (Requirements 21.2–21.5). The RPC adds newly checked students and
 * reverses removed ones in one transaction, enforcing the window itself; this
 * action validates shape, role, and ownership for a friendly early error.
 */
export async function editParticipants(
  input: EditParticipantsInput,
): Promise<TeacherActionResult> {
  const parsed = editParticipantsSchema.safeParse(input);
  if (!parsed.success) return failed(INVALID_REQUEST);
  const { classId, missionId, presentStudentIds } = parsed.data;

  await requireRole("teacher");

  const supabase = await createServerSupabase();
  const owned = await getOwnedClass(classId, supabase);
  if (!owned) return failed(NOT_PERMITTED);

  try {
    const { error } = await supabase.rpc("edit_mission_participants", {
      p_class_id: classId,
      p_mission_id: missionId,
      p_present_student_ids: presentStudentIds,
    });
    if (error) return failed(SAVE_FAILED);
  } catch {
    return failed(SAVE_FAILED);
  }

  revalidateTeacherViews(classId);
  return ok;
}

/**
 * Undoes a mission a teacher confirmed within the 24h window (Requirements
 * 21.6, 21.7). The reason must be exactly one of the three permitted strings;
 * the schema's `z.enum` rejects any other value before the RPC is called
 * (Requirement 21.7), and the RPC re-enforces both the reason and the window.
 */
export async function undoMission(input: UndoMissionInput): Promise<TeacherActionResult> {
  const parsed = undoMissionSchema.safeParse(input);
  if (!parsed.success) return failed(INVALID_REQUEST);
  const { classId, missionId, reason } = parsed.data;

  await requireRole("teacher");

  const supabase = await createServerSupabase();
  const owned = await getOwnedClass(classId, supabase);
  if (!owned) return failed(NOT_PERMITTED);

  try {
    const { error } = await supabase.rpc("undo_mission", {
      p_class_id: classId,
      p_mission_id: missionId,
      p_reason: reason,
    });
    if (error) return failed(SAVE_FAILED);
  } catch {
    return failed(SAVE_FAILED);
  }

  revalidateTeacherViews(classId);
  return ok;
}
