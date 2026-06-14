import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { safeStorageName, type PrivateFileBucket } from "@/lib/files/validation";

export function getUploadRoot() {
  return path.join(process.cwd(), "uploads");
}

export function resolveUploadPath(bucket: PrivateFileBucket, storagePath: string) {
  const bucketRoot = path.join(getUploadRoot(), bucket);
  const pathParts = storagePath.split("/").filter(Boolean);
  const fullPath = path.join(bucketRoot, ...pathParts);

  if (!path.resolve(fullPath).startsWith(path.resolve(bucketRoot))) {
    throw new Error("Invalid upload path.");
  }

  return fullPath;
}

export async function savePrivateFile(bucket: PrivateFileBucket, folder: string, file: File) {
  const scopedFolder = safeStorageName(folder);
  const storagePath = `${scopedFolder}/${Date.now()}-${safeStorageName(file.name)}`;
  const fullPath = resolveUploadPath(bucket, storagePath);

  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, Buffer.from(await file.arrayBuffer()));

  return storagePath;
}

export async function readPrivateFile(bucket: PrivateFileBucket, storagePath: string) {
  return readFile(resolveUploadPath(bucket, storagePath));
}
