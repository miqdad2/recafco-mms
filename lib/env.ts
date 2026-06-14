export function getDatabaseUrl() {
  const value = process.env.DATABASE_URL;

  if (!value) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }

  return value;
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export function getUploadsDir() {
  return process.env.UPLOADS_DIR || "uploads";
}
