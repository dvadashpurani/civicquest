import "server-only";

// Signed URLs for mission photos (Requirements 5.5–5.7). Uses the caller's
// session client, so the `mission_photos_select` storage policy decides
// access: only the owning class's teacher or the owning school's admin gets a
// URL. Never use the admin client here; it would bypass that policy.

import { createServerSupabase } from "@/lib/supabase/server";
import {
  MISSION_PHOTOS_BUCKET,
  clampSignedUrlExpiry,
  isMissionPhotoPath,
} from "@/lib/storage/mission-photos";

export type SignedPhotoUrlResult =
  | { ok: true; url: string; expiresIn: number }
  | { ok: false; error: string };

const INVALID_PATH = "This photo link isn't valid.";
// Also used when the object does not exist, so callers cannot probe which
// photos exist in other classes or schools.
const NO_ACCESS = "You don't have permission to view this photo.";
const UNAVAILABLE = "We couldn't load this photo. Please try again.";

/**
 * Issues a signed URL for `path` that expires in `expiresIn` seconds, clamped
 * to 1..600 (default 300). Returns a friendly error instead of throwing.
 */
export async function createMissionPhotoSignedUrl(
  path: string,
  expiresIn?: number,
): Promise<SignedPhotoUrlResult> {
  if (!isMissionPhotoPath(path)) return { ok: false, error: INVALID_PATH };
  const seconds = clampSignedUrlExpiry(expiresIn);

  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: NO_ACCESS };

    const { data, error } = await supabase.storage
      .from(MISSION_PHOTOS_BUCKET)
      .createSignedUrl(path, seconds);

    if (error || !data?.signedUrl) {
      // Storage reports a policy denial as "not found"; both mean no access.
      console.error("[storage] signed URL refused", { reason: error?.message ?? "no url" });
      return { ok: false, error: NO_ACCESS };
    }
    return { ok: true, url: data.signedUrl, expiresIn: seconds };
  } catch (err) {
    console.error("[storage] signed URL failed", {
      reason: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: UNAVAILABLE };
  }
}
