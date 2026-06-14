import "server-only";

import { prisma } from "@/lib/db/prisma";
import { ALLOWED_PRIVATE_FILE_TYPES, MAX_PRIVATE_FILE_SIZE } from "@/lib/files/validation";

export type FileSecuritySettings = {
  maxUploadSizeBytes: number;
  signedUrlExpirySeconds: number;
  allowedFileTypes: string[];
};

export async function getFileSecuritySettings(): Promise<FileSecuritySettings> {
  try {
    const data = await prisma.app_settings.findUnique({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      select: { max_upload_size_mb: true, signed_url_expiry_seconds: true }
    });

    if (!data) throw new Error("app_settings row not found");

    const maxMb = Number(data.max_upload_size_mb ?? 10);
    const expiry = Number(data.signed_url_expiry_seconds ?? 300);

    return {
      maxUploadSizeBytes: Math.max(1, maxMb) * 1024 * 1024,
      signedUrlExpirySeconds: Math.min(3600, Math.max(60, expiry)),
      allowedFileTypes: [...ALLOWED_PRIVATE_FILE_TYPES]
    };
  } catch {
    return {
      maxUploadSizeBytes: MAX_PRIVATE_FILE_SIZE,
      signedUrlExpirySeconds: 300,
      allowedFileTypes: [...ALLOWED_PRIVATE_FILE_TYPES]
    };
  }
}
