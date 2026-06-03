"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  next: z.string().optional()
});

export async function signInAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") || "/dashboard"
  });

  if (!parsed.success) {
    redirect("/login?error=invalid-input");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });

  if (error) {
    redirect("/login?error=invalid-credentials");
  }

  redirect(parsed.data.next || "/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function forgotPasswordAction(formData: FormData) {
  const email = z.string().email().safeParse(formData.get("email"));

  if (!email.success) {
    redirect("/forgot-password?error=invalid-email");
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${getAppUrl()}/reset-password`
  });

  redirect("/forgot-password?sent=1");
}

export async function resetPasswordAction(formData: FormData) {
  const password = z.string().min(8).safeParse(formData.get("password"));

  if (!password.success) {
    redirect("/reset-password?error=weak-password");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: password.data });

  if (error) {
    redirect("/reset-password?error=session-required");
  }

  redirect("/dashboard");
}
