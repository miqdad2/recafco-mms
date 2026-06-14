import "server-only";

import type { PrivateFileBucket } from "@/lib/files/validation";

export async function createSignedFileUrl(bucket: PrivateFileBucket, path: string | null | undefined) {
  if (!path) return null;
  return `/api/files/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
