"use server";

// Sign-out for every role. Clears the Supabase session cookies through the
// request-scoped server client, then sends the user to the landing page.

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/");
}
