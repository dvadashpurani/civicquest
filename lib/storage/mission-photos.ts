// Pure rules for the private `mission-photos` bucket (Requirement 5). No I/O
// and no `server-only`, so Vitest can test it and a future upload action can
// reuse the path builder. Mirrors supabase/migrations/0005_storage.sql.

export const MISSION_PHOTOS_BUCKET = "mission-photos";

/** Signed URLs never outlive 10 minutes (Requirement 5.7). */
export const MAX_SIGNED_URL_SECONDS = 600;
export const MIN_SIGNED_URL_SECONDS = 1;
export const DEFAULT_SIGNED_URL_SECONDS = 300;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

/**
 * `<school_id>/<class_id>/<completion_id>.jpg`, lowercase uuids only. Same
 * pattern as `private.mission_photo_path_ids` in 0005_storage.sql.
 */
export const MISSION_PHOTO_PATH_RE = new RegExp(`^${UUID}/${UUID}/${UUID}\\.jpg$`);

export function isMissionPhotoPath(path: unknown): path is string {
  return typeof path === "string" && MISSION_PHOTO_PATH_RE.test(path);
}

/** Builds the canonical object path (Requirement 5.4), or null for a non-uuid id. */
export function missionPhotoPath(ids: {
  schoolId: string;
  classId: string;
  completionId: string;
}): string | null {
  const parts = [ids.schoolId, ids.classId, ids.completionId];
  if (!parts.every((id) => typeof id === "string" && UUID_RE.test(id))) return null;
  const [school, cls, completion] = parts.map((id) => id.toLowerCase());
  return `${school}/${cls}/${completion}.jpg`;
}

/**
 * Whole seconds in [1, 600]. Missing or NaN input gets the 300s default;
 * fractions round down; anything out of range is clamped.
 */
export function clampSignedUrlExpiry(seconds?: number): number {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return DEFAULT_SIGNED_URL_SECONDS;
  const whole = Math.floor(seconds);
  return Math.min(MAX_SIGNED_URL_SECONDS, Math.max(MIN_SIGNED_URL_SECONDS, whole));
}
