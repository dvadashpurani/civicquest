"use server";

// Class-mode student theme picker. Learners and Helpers have no accounts, so
// the signed-in teacher saves the theme on the student's row. Validated with a
// strict zod schema; the teacher must own the class and the student must be
// on its roster. RLS (students_update) enforces the same rule in the database.

import { refresh } from "next/cache";
import { requireRole } from "@/lib/auth/require";
import { getOwnedClass } from "@/lib/server/teacher";
import { createServerSupabase } from "@/lib/supabase/server";
import { setStudentThemeSchema } from "@/lib/validation/student";

export type ThemeResult = { ok: true } | { ok: false; error: string };

export async function setStudentTheme(input: unknown): Promise<ThemeResult> {
  const parsed = setStudentThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That theme didn't save. Try again." };
  const { classId, studentId, theme } = parsed.data;

  await requireRole("teacher");
  const supabase = await createServerSupabase();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: "Sign in again to save the theme." };

  const klass = await getOwnedClass(classId, supabase);
  if (!klass || klass.teacherId !== userData.user.id) {
    return { ok: false, error: "You can only change themes for your own class." };
  }

  const { data, error } = await supabase
    .from("students")
    .update({ kid_theme: theme })
    .eq("id", studentId)
    .eq("class_id", classId)
    .select("id");
  if (error || !data || data.length !== 1) {
    return { ok: false, error: "That theme didn't save. Try again." };
  }

  refresh();
  return { ok: true };
}
