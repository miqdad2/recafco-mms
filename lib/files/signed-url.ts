import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PrivateFileBucket } from "@/lib/files/validation";

export async function createSignedFileUrl(bucket: PrivateFileBucket, path: string | null | undefined) {
  if (!path) return null;

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10);
    if (error) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
