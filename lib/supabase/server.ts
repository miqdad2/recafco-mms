import "server-only";

import { createLocalQueryClient } from "@/lib/db/local-query-client";

export async function createSupabaseServerClient() {
  return createLocalQueryClient();
}
