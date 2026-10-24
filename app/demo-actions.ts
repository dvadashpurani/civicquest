"use server";

// One-click demo sign-in for the landing page. Exists only when DEMO_MODE is
// exactly "true", checked here on the server for every call (security.md
// "Demo mode"). The persona is validated against a fixed list; the client
// never supplies an email or password.

import { redirect } from "next/navigation";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { parseRole, roleHome } from "@/lib/auth/roles";
import { createServerSupabase } from "@/lib/supabase/server";

const DEMO_PASSWORD = "demo1234";
const DEMO_DOMAIN = "demo.civicquest.app";

const PERSONAS = {
  teacher3: { login: "teacher3" },
  teacher7: { login: "teacher7" },
  teacher11: { login: "teacher11" },
  admin: { login: "admin" },
  partner: { login: "partner" },
  leader: { login: "leader" },
  student: { login: "teacher3" },
} as const;

const demoSchema = z
  .object({ persona: z.enum(Object.keys(PERSONAS) as [keyof typeof PERSONAS, ...(keyof typeof PERSONAS)[]]) })
  .strict();

export async function demoSignIn(formData: FormData): Promise<void> {
  if (!isDemoMode()) redirect("/login");

  const parsed = demoSchema.safeParse({ persona: formData.get("persona") });
  if (!parsed.success) redirect("/");
  const persona = parsed.data.persona;

  const supabase = await createServerSupabase();
  let destination = "/login";
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${PERSONAS[persona].login}@${DEMO_DOMAIN}`,
      password: DEMO_PASSWORD,
    });
    if (!error && data.user) {
      const profile = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      const role = profile.error ? null : parseRole(profile.data?.role);
      if (role) destination = roleHome(role);

      // "View student dashboard": class mode for the Grade 3 class, through
      // the Grade 3 teacher. RLS returns only that teacher's classes.
      if (persona === "student" && role === "teacher") {
        const { data: classes } = await supabase
          .from("classes")
          .select("id, grade")
          .order("grade", { ascending: true })
          .limit(1);
        const grade3 = classes?.[0];
        if (grade3) destination = `/teacher/class/${grade3.id}/play`;
      }
    }
  } catch {
    destination = "/login";
  }
  redirect(destination);
}
