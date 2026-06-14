# RECAFCO Database Backup and Restore

## Overview

The RECAFCO system stores all data in a local PostgreSQL 17 database
(`recafco_maintenance`). This document covers:

- How to run a manual backup
- How to schedule automatic daily backups via Windows Task Scheduler
- How to restore from a backup
- How to safely test a restore without affecting production
- Critical warnings

---

## Prerequisites

- PostgreSQL 17 installed on Windows (default path: `C:\Program Files\PostgreSQL\17\`)
- The `DATABASE_URL` environment variable set in your `.env` file or as a
  Windows system environment variable
- PowerShell 5.1 or later

---

## 1. Manual Backup

### Run from the project root

```powershell
.\scripts\backup-db.ps1
```

This will:

1. Read `DATABASE_URL` from the `.env` file (or system environment)
2. Connect to PostgreSQL using `pg_dump`
3. Save a compressed custom-format dump to `C:\recafco-backups\`
4. Name the file `recafco_YYYY-MM-DD_HH-mm-ss.dump`
5. Delete backups older than 7 days

### Custom options

```powershell
# Change backup directory
.\scripts\backup-db.ps1 -BackupDir "D:\company-backups"

# Change retention to 14 days
.\scripts\backup-db.ps1 -RetentionDays 14

# Use a different PostgreSQL major version (e.g. 16)
.\scripts\backup-db.ps1 -PgVersion 16
```

### Example output

```
==================================================
  RECAFCO Database Backup
  2026-06-08 09:00:00
==================================================
pg_dump  : C:\Program Files\PostgreSQL\17\bin\pg_dump.exe
Database : recafco_maintenance
Host     : localhost:5432
User     : postgres
BackupDir: C:\recafco-backups
Retention: 7 days

Starting backup ...
  Output: C:\recafco-backups\recafco_2026-06-08_09-00-01.dump

SUCCESS: Backup completed.
  File: C:\recafco-backups\recafco_2026-06-08_09-00-01.dump
  Size: 2.847 MB
```

---

## 2. Scheduled Daily Backups via Windows Task Scheduler

Automate backups so they run every day at 2:00 AM without manual intervention.

### Step 1 — Open Task Scheduler

```
Start → Search → "Task Scheduler" → Open
```

### Step 2 — Create a basic task

1. Click **"Create Basic Task…"** in the right panel
2. Name: `RECAFCO Daily Database Backup`
3. Description: `Backs up the recafco_maintenance PostgreSQL database`
4. Trigger: **Daily** at **2:00 AM**
5. Action: **Start a program**

### Step 3 — Configure the action

- **Program/script:**
  ```
  powershell.exe
  ```
- **Add arguments:**
  ```
  -ExecutionPolicy Bypass -NonInteractive -File "C:\Users\5857\Desktop\recafco-maintenance-management-system\scripts\backup-db.ps1"
  ```
  *(Adjust the path to match where the project is installed)*
- **Start in (optional):**
  ```
  C:\Users\5857\Desktop\recafco-maintenance-management-system
  ```

### Step 4 — Configure security options

- Select **"Run whether user is logged on or not"**
- Check **"Run with highest privileges"**
- Click **OK**, enter your Windows password to save the task

### Step 5 — Test the scheduled task

Right-click the task → **"Run"** — verify a new `.dump` file appears in
`C:\recafco-backups\`.

### Step 6 — Confirm DATABASE_URL is accessible

The task runs as your Windows user. Ensure `DATABASE_URL` is set as a
**system environment variable** (not just in `.env`), or pass it explicitly:

```
-ExecutionPolicy Bypass -NonInteractive -Command "
  $env:DATABASE_URL='postgresql://postgres:yourpassword@localhost:5432/recafco_maintenance';
  & '.\scripts\backup-db.ps1'
"
```

> **Security note:** Avoid embedding passwords in Task Scheduler arguments if
> the server is shared. Instead, set `DATABASE_URL` as a Windows system
> environment variable via System Properties → Advanced → Environment Variables.

---

## 3. Restore from a Backup

### Using `pg_restore`

`pg_restore` is bundled with PostgreSQL at the same path as `pg_dump`.

```powershell
# Set the password temporarily
$env:PGPASSWORD = "YOUR_DB_PASSWORD"

# Restore to the existing database (replaces all data)
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
    --host=localhost `
    --port=5432 `
    --username=postgres `
    --dbname=recafco_maintenance `
    --clean `
    --if-exists `
    --no-owner `
    "C:\recafco-backups\recafco_2026-06-08_09-00-01.dump"

# Clear the password
$env:PGPASSWORD = $null
```

**`--clean`** drops existing objects before restoring — this is what you want
when restoring over the current database.

**`--if-exists`** prevents errors if an object has already been dropped.

**`--no-owner`** skips ownership assignments that might fail if role names differ.

### Restore to a fresh database (safer for testing)

```powershell
$env:PGPASSWORD = "YOUR_DB_PASSWORD"

# Create a new empty database to restore into
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" `
    --host=localhost --port=5432 --username=postgres `
    recafco_restore_test

# Restore into the new database
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
    --host=localhost --port=5432 `
    --username=postgres `
    --dbname=recafco_restore_test `
    --no-owner `
    "C:\recafco-backups\recafco_2026-06-08_09-00-01.dump"

$env:PGPASSWORD = $null
```

Then temporarily point the app at the test database to verify it starts
correctly:

```powershell
# In .env (temporarily):
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/recafco_restore_test
```

Start the app with `npm run dev` and confirm the dashboard loads. When done,
restore `.env` to the production database name.

---

## 4. Safe Restore Testing Workflow

Run this test **monthly** — before you need a restore in an emergency:

```
1. Run the backup script: .\scripts\backup-db.ps1
2. Note the dump file name (e.g. recafco_2026-06-08_09-00-01.dump)
3. Create a test database: createdb recafco_restore_test
4. Restore into it: pg_restore ... --dbname=recafco_restore_test ...
5. Point .env at the test database temporarily
6. Start the app: npm run dev
7. Log in — verify dashboard, work orders, and assets load
8. Drop the test database: dropdb recafco_restore_test
9. Restore .env to the production database name
```

This confirms that backups are readable and the restore procedure works
before a crisis forces you to use it.

---

## 5. Verify a Dump File Without Restoring

To check that a dump file is not corrupt:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
    --list `
    "C:\recafco-backups\recafco_2026-06-08_09-00-01.dump" | Select-Object -First 30
```

A healthy dump will list table of contents entries. A corrupt file will show
an error immediately.

---

## 6. What the Backup Includes

The `pg_dump --format=custom` backup includes:

- ✅ All table data (work orders, assets, users, approvals, audit logs, notifications, etc.)
- ✅ Schema (tables, indexes, constraints, triggers, sequences)
- ✅ Stored procedures and functions
- ✅ App settings (numbering formats, thresholds, company name)

**Not included:**

- ❌ File uploads (stored in the `uploads/` directory on disk)
- ❌ The `uploads/` directory must be backed up separately

### Backup the uploads directory too

```powershell
# Add to the backup script or run separately
Compress-Archive -Path ".\uploads" -DestinationPath "C:\recafco-backups\uploads_$(Get-Date -Format 'yyyy-MM-dd').zip" -Force
```

---

## 7. Critical Warnings

> ⚠️ **NEVER restore over the production database without a confirmation
> checkpoint.** A restore with `--clean` permanently destroys all current data.
> Always restore to a test database first, verify, then decide.

> ⚠️ **Test your restore procedure before you need it.** A backup that has
> never been restored is an untested backup.

> ⚠️ **Keep backups off the same disk as the database.** If the disk fails,
> both are lost. Copy backups to a network drive, external drive, or USB
> regularly (weekly minimum).

> ⚠️ **Do not store the database password in the Task Scheduler action
> arguments on a shared machine.** Use a Windows system environment variable.

---

## 8. Backup Status in the Super Admin Dashboard

> **Scope reminder:** `backup-db.ps1` backs up the **database only**.
> The `uploads/` directory (private file attachments) is **not included** and
> must be backed up separately — see Section 6 for the command.
> The dashboard card below reflects database backup health only.

Every time `backup-db.ps1` runs it inserts a row into the `backup_logs` table.
The Super Admin dashboard reads the latest row and shows one of these states:

| Dashboard label | Condition |
|-----------------|-----------|
| **Healthy** (green) | Last successful backup completed within the past 25 hours |
| **Overdue** (amber) | Last successful backup is older than 25 hours |
| **Failed** (red) | Most recent backup run exited with an error |
| **Running** (blue) | A backup is currently in progress |
| **Not Configured** (amber) | No rows in `backup_logs` — schedule not set up yet |

The card links to `/admin/system-health`. Hover over the detail text to see
the error message when status is Failed, or the age of the last successful backup.

### View backup history directly

```sql
SELECT
    id,
    status,
    file_size_bytes / 1024 / 1024 AS size_mb,
    started_at,
    completed_at,
    error_message
FROM public.backup_logs
ORDER BY created_at DESC
LIMIT 20;
```

### Manual verification after scheduling

After setting up the Task Scheduler task (Section 2), trigger it manually:

1. Open Task Scheduler → find **RECAFCO Daily Database Backup**
2. Right-click → **Run**
3. Wait ~30 seconds
4. Check `C:\recafco-backups\` for a new `.dump` file
5. Log in to the RECAFCO app as Super Admin
6. On the dashboard, confirm the **Backup** status card shows **Healthy**

If the card still shows **Not Configured**, the psql INSERT failed. Run the
script from PowerShell directly and read the warning lines at the bottom.

---

## 9. Future Improvements

When the system moves to the private cloud:

- **pgBackRest** — Automated incremental backups, point-in-time recovery (PITR),
  remote storage (MinIO/S3)
- **Off-site copy** — Sync `C:\recafco-backups\` to a network drive or approved
  cloud storage nightly
- **Retention policies** — Keep daily backups for 7 days, weekly for 4 weeks,
  monthly for 6 months

---

## Quick Reference

| Task | Command |
|------|---------|
| Manual backup | `.\scripts\backup-db.ps1` |
| List backup files | `Get-ChildItem C:\recafco-backups\*.dump` |
| Check dump integrity | `pg_restore --list <file>.dump \| head` |
| Restore to production | `pg_restore --clean --dbname=recafco_maintenance <file>.dump` |
| Restore to test DB | `pg_restore --dbname=recafco_restore_test <file>.dump` |
| Drop test DB | `dropdb recafco_restore_test` |
