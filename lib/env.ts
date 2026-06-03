export function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co";
}

export function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "missing-anon-key";
}

export function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
