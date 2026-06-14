"use client";

export function createSupabaseBrowserClient(): never {
  throw new Error("Supabase browser client has been removed. Use server actions with local PostgreSQL polling.");
}
