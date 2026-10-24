// Validation for class-mode student actions. `.strict()` rejects unknown
// fields, matching lib/validation/mission.ts.

import { z } from "zod";

export const KID_THEMES = ["classic", "hero", "bubblegum", "ocean"] as const;

export const setStudentThemeSchema = z
  .object({
    classId: z.uuid(),
    studentId: z.uuid(),
    theme: z.enum(KID_THEMES),
  })
  .strict();

export type SetStudentThemeInput = z.infer<typeof setStudentThemeSchema>;
