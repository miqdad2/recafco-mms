import "server-only";

import { createLocalQueryClient } from "@/lib/db/local-query-client";

export function createSupabaseAdminClient() {
  return createLocalQueryClient();
}
