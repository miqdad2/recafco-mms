import "server-only";

import { savePrivateFile } from "@/lib/files/local-storage";
import { getFileSecuritySettings } from "@/lib/files/settings";
import {
  pickUploadedFile,
  validatePrivateFileWithOptions,
  type PrivateFileBucket,
} from "@/lib/files/validation";

export type PendingAttachment = {
  file: File;
  category: string;
  remarks: string | null;
};

export type SavedAttachment = PendingAttachment & { path: string };

/**
 * Reads indexed attachment rows submitted from a creation-flow wizard
 * (`${namePrefix}_file_${i}`, `${namePrefix}_category_${i}`, `${namePrefix}_remarks_${i}`).
 * Rows with no file selected are skipped — attachments are always optional.
 */
export function parsePendingAttachments(
  formData: FormData,
  namePrefix: string,
  maxRows: number
): PendingAttachment[] {
  const rows: PendingAttachment[] = [];
  for (let i = 0; i < maxRows; i++) {
    const file = pickUploadedFile(formData, `${namePrefix}_file_${i}`);
    if (!file) continue;
    const category = String(formData.get(`${namePrefix}_category_${i}`) ?? "").trim() || "Other Document";
    const remarks = String(formData.get(`${namePrefix}_remarks_${i}`) ?? "").trim() || null;
    rows.push({ file, category, remarks });
  }
  return rows;
}

/**
 * Validates and saves each pending attachment to disk, skipping any that fail
 * validation or I/O. Never throws — the caller compares `saved.length` against
 * the input length to detect partial failures without losing the parent record
 * that was already created.
 */
export async function saveAttachmentBatch(
  bucket: PrivateFileBucket,
  folder: string,
  pending: PendingAttachment[]
): Promise<SavedAttachment[]> {
  if (!pending.length) return [];

  const settings = await getFileSecuritySettings();

  const saved: SavedAttachment[] = [];
  for (const item of pending) {
    const validationError = validatePrivateFileWithOptions(item.file, {
      maxSizeBytes: settings.maxUploadSizeBytes,
      allowedTypes: settings.allowedFileTypes,
    });
    if (validationError) continue;

    try {
      const path = await savePrivateFile(bucket, folder, item.file);
      saved.push({ ...item, path });
    } catch {
      // Non-fatal — the parent record must not be lost over a file I/O failure.
    }
  }
  return saved;
}
