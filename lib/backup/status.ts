import { prisma } from "@/lib/db/prisma";

export type BackupLogRow = {
  status: string;
  completed_at: Date | null;
  error_message: string | null;
  file_path: string | null;
  file_size_bytes: bigint | null;
};

export type BackupTone = "green" | "amber" | "red" | "blue";

export type BackupInfo = {
  value: string;
  detail: string;
  tone: BackupTone;
  completedAt: Date | null;
  fileSizeMb: number | null;
  filePath: string | null;
  errorMessage: string | null;
};

export function getBackupInfo(latest: BackupLogRow | null): BackupInfo {
  if (!latest) {
    return {
      value: "Not Configured",
      detail: "Configure a backup schedule before real users",
      tone: "amber",
      completedAt: null,
      fileSizeMb: null,
      filePath: null,
      errorMessage: null,
    };
  }

  if (latest.status === "running") {
    return {
      value: "Running",
      detail: "Database backup is in progress",
      tone: "blue",
      completedAt: null,
      fileSizeMb: null,
      filePath: null,
      errorMessage: null,
    };
  }

  const fileSizeMb =
    latest.file_size_bytes !== null ? Number(latest.file_size_bytes) / (1024 * 1024) : null;

  if (latest.status === "failed") {
    const msg = (latest.error_message ?? "Last backup failed — check backup script").slice(0, 80);
    return {
      value: "Failed",
      detail: msg,
      tone: "red",
      completedAt: latest.completed_at,
      fileSizeMb,
      filePath: latest.file_path,
      errorMessage: latest.error_message,
    };
  }

  if (latest.status === "success" && latest.completed_at) {
    const ageHours =
      (Date.now() - new Date(latest.completed_at).getTime()) / 3_600_000;
    if (ageHours <= 25) {
      return {
        value: "Healthy",
        detail: `Last backup ${Math.floor(ageHours)}h ago`,
        tone: "green",
        completedAt: latest.completed_at,
        fileSizeMb,
        filePath: latest.file_path,
        errorMessage: null,
      };
    }
    return {
      value: "Overdue",
      detail: `No backup in ${Math.floor(ageHours)}h — check Task Scheduler`,
      tone: "amber",
      completedAt: latest.completed_at,
      fileSizeMb,
      filePath: latest.file_path,
      errorMessage: null,
    };
  }

  return {
    value: "Unknown",
    detail: "Unexpected backup state",
    tone: "amber",
    completedAt: null,
    fileSizeMb: null,
    filePath: null,
    errorMessage: null,
  };
}

export async function getLatestBackup(): Promise<BackupLogRow | null> {
  try {
    const rows = await prisma.$queryRaw<BackupLogRow[]>`
      SELECT status, completed_at, file_size_bytes, file_path, error_message
      FROM public.backup_logs
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
