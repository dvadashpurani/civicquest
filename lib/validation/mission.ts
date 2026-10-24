// Validation schemas for the Step 4 teacher core-loop actions (Requirements
// 33.1, 33.3). Pure, so they run in the server actions (task 7.6) and in
// Vitest. Every schema is `.strict()`, so an unknown field makes the whole
// submission invalid rather than being silently ignored — the same convention
// as `lib/validation/login.ts`. UUIDs are validated before they ever reach a
// `.rpc()` call, the undo reason is constrained to exactly the three teacher
// reasons, and the admin reversal reason is bounded to 1–500 characters to
// match the database protection trigger (supabase/migrations/0004_triggers.sql;
// design.md "mission_completions protection", Requirements 4.7, 4.8, 21.6).
//
// These schemas never trust client-supplied `points_awarded`, `status`,
// `confirmed_by`, `school_id`, or `level`: those are computed server-side by
// the RPCs (Requirement 20.2), so they are not part of any input shape here.

import { z } from "zod";

/**
 * The three teacher undo reasons, exactly as Requirement 21.6 and the
 * `undo_mission` RPC enumerate them (design.md "undo_mission"). A teacher undo
 * with any other reason is rejected with no changes (Requirement 21.7). The
 * apostrophe in the second reason is literal, stored and compared verbatim.
 */
export const TEACHER_UNDO_REASONS = [
  "pressed by mistake",
  "the activity didn't happen",
  "wrong class",
] as const;

/** A teacher undo reason: one of the three permitted strings. */
export type TeacherUndoReason = (typeof TEACHER_UNDO_REASONS)[number];

/** The database protection trigger bounds a reversal reason to 1–500 chars. */
export const ADMIN_REASON_MIN_LENGTH = 1;
export const ADMIN_REASON_MAX_LENGTH = 500;

/** A UUID string, validated before it is passed to any `.rpc()` call. */
const uuid = z.uuid();

/**
 * Parameters for `confirm_class_mission` (task 7.1, Requirement 20): the class,
 * the mission being confirmed, and the ids checked at tap time. The server
 * de-duplicates and validates that every id is a student of the class; the
 * schema only guarantees well-formed UUIDs and rejects unknown fields. An empty
 * list is allowed here (the RPC treats a confirm with no present students as a
 * no-op); the UI keeps every student checked by default (Requirement 19.4).
 */
export const confirmMissionSchema = z
  .object({
    classId: uuid,
    missionId: uuid,
    presentStudentIds: z.array(uuid),
  })
  .strict();

export type ConfirmMissionInput = z.infer<typeof confirmMissionSchema>;

/**
 * Parameters for `edit_mission_participants` (task 7.2, Requirement 21.2–21.5):
 * the new set of present students for an already-confirmed mission. The RPC
 * adds completions for newly checked students and reverses removed ones within
 * the 24h window; the schema validates UUID shape and rejects unknown fields.
 */
export const editParticipantsSchema = z
  .object({
    classId: uuid,
    missionId: uuid,
    presentStudentIds: z.array(uuid),
  })
  .strict();

export type EditParticipantsInput = z.infer<typeof editParticipantsSchema>;

/**
 * Parameters for the teacher `undo_mission` call (task 7.3, Requirement 21.6):
 * the class, the mission, and exactly one of the three permitted reasons. The
 * `z.enum` rejects any other reason before it reaches the RPC (Requirement
 * 21.7); the 24h window is enforced in the RPC body, not here.
 */
export const undoMissionSchema = z
  .object({
    classId: uuid,
    missionId: uuid,
    reason: z.enum(TEACHER_UNDO_REASONS),
  })
  .strict();

export type UndoMissionInput = z.infer<typeof undoMissionSchema>;

/**
 * Parameters for an admin reversal from the proof log (Requirement 4.7, 4.8,
 * 21.9): any free-text reason of 1–500 characters. The reason is never trimmed
 * before length-checking so the stored text matches what the admin typed, and
 * the database trigger enforces the same bound as a second line of defense.
 */
export const adminReversalSchema = z
  .object({
    classId: uuid,
    missionId: uuid,
    reason: z
      .string()
      .min(ADMIN_REASON_MIN_LENGTH)
      .max(ADMIN_REASON_MAX_LENGTH),
  })
  .strict();

export type AdminReversalInput = z.infer<typeof adminReversalSchema>;
