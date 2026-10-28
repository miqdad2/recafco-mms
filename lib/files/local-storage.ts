import "server-only";

import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import { checkFileContent, safeStorageName, type PrivateFileBucket } from "@/lib/files/validation";

export function getUploadRoot() {
  return path.join(process.cwd(), "uploads");
}

export function resolveUploadPath(bucket: PrivateFileBucket, storagePath: string) {
  const bucketRoot = path.resolve(getUploadRoot(), bucket);
  const pathParts = storagePath.split("/").filter(Boolean);
  // Every segment is a plain name: no "." / "..", no Windows separators or
  // drive letters, no NUL — and the result must sit INSIDE the bucket folder
  // (a bare prefix test would also accept a sibling such as
  // "work-order-files-old").
  if (!pathParts.length || pathParts.some((part) => part === "." || part === ".." || /[\\:\u0000]/.test(part))) {
    throw new Error("Invalid upload path.");
  }
  const fullPath = path.resolve(bucketRoot, ...pathParts);
  if (!fullPath.startsWith(bucketRoot + path.sep)) {
    throw new Error("Invalid upload path.");
  }

  return fullPath;
}

export async function savePrivateFile(bucket: PrivateFileBucket, folder: string, file: File) {
  // Last line of defence for every upload path: never store a file whose
  // name / contents do not match its declared type.
  const contentProblem = await checkFileContent(file);
  if (contentProblem) throw new Error(contentProblem);
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

export async function deletePrivateFileIfExists(bucket: PrivateFileBucket, storagePath: string) {
  try {
    await unlink(resolveUploadPath(bucket, storagePath));
  } catch {
    // file may already be deleted or never written — safe to ignore
  }
}
