import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServiceRoleKey, getSupabaseUrl } from "@/lib/env";

export function createSupabaseAdminClient() {
  const serviceRoleKey = getServiceRoleKey();

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server admin operations.");
  }

  return createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
}
