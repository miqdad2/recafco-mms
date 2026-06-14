#Requires -Version 5.1
<#
.SYNOPSIS
    RECAFCO PostgreSQL database backup script.

.DESCRIPTION
    Creates a timestamped pg_dump backup of the recafco_maintenance database.
    Reads the connection string from the DATABASE_URL environment variable or
    the project's .env file. Keeps the last N days of backups and prunes older ones.
    Records the backup result (success or failure) in the backup_logs table.

.PARAMETER BackupDir
    Directory where backups are stored. Default: C:\recafco-backups

.PARAMETER RetentionDays
    Number of days to keep backups. Older files are deleted. Default: 7

.PARAMETER PgVersion
    PostgreSQL major version number, used to locate pg_dump. Default: 17

.EXAMPLE
    .\scripts\backup-db.ps1
    .\scripts\backup-db.ps1 -BackupDir "D:\backups" -RetentionDays 14

.NOTES
    Schedule this script via Windows Task Scheduler to run daily.
    See docs\BACKUP_AND_RESTORE.md for scheduling instructions.
#>

[CmdletBinding()]
param(
    [string]$BackupDir    = "C:\recafco-backups",
    [int]   $RetentionDays = 7,
    [int]   $PgVersion    = 17
)

$ErrorActionPreference = "Stop"
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$EnvFile    = Join-Path $ProjectDir ".env"

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Header([string]$Title) {
    $line = "=" * 50
    Write-Host $line -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
    Write-Host $line -ForegroundColor Cyan
}

function Read-DotEnvValue([string]$Name) {
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Get-Content $EnvFile |
        Where-Object { $_ -match "^\s*${Name}\s*=" } |
        Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim('"').Trim("'")
}

function Parse-DatabaseUrl([string]$Url) {
    # Handles: postgresql://user:pass@host:port/dbname?options
    # Also handles URL-encoded characters in the password.
    if ($Url -notmatch "^postgresql://") {
        return $null
    }
    $withoutScheme = $Url -replace "^postgresql://", ""
    if ($withoutScheme -notmatch "^([^:]+):(.+)@([^:/]+):?(\d*)/([\w\-]+)") {
        return $null
    }
    $rawPassword = $Matches[2]
    # Decode common URL-encoded characters in passwords
    $password = [System.Uri]::UnescapeDataString($rawPassword)

    return @{
        User     = $Matches[1]
        Password = $password
        Host     = $Matches[3]
        Port     = if ($Matches[4]) { $Matches[4] } else { "5432" }
        Database = ($Matches[5] -split "\?")[0]
    }
}

# ── Main ──────────────────────────────────────────────────────────────────────

Write-Header "RECAFCO Database Backup"

# Locate pg_dump — check the standard PostgreSQL installation path first.
$pgDump = "C:\Program Files\PostgreSQL\${PgVersion}\bin\pg_dump.exe"
if (-not (Test-Path $pgDump)) {
    # Try a common alternative path
    $pgDump = "C:\Program Files\PostgreSQL\$PgVersion\bin\pg_dump.exe"
}
if (-not (Test-Path $pgDump)) {
    Write-Host ""
    Write-Host "ERROR: pg_dump not found." -ForegroundColor Red
    Write-Host "  Searched: $pgDump" -ForegroundColor Yellow
    Write-Host "  Ensure PostgreSQL $PgVersion is installed in the default location." -ForegroundColor Yellow
    Write-Host "  Or use -PgVersion to specify a different major version." -ForegroundColor Yellow
    exit 1
}
Write-Host "pg_dump  : $pgDump" -ForegroundColor Gray

# psql lives beside pg_dump — used to record backup result in backup_logs.
$psql = Join-Path (Split-Path $pgDump) "psql.exe"

# Resolve DATABASE_URL — environment variable takes priority over .env file.
$databaseUrl = $env:DATABASE_URL
if (-not $databaseUrl) {
    $databaseUrl = Read-DotEnvValue "DATABASE_URL"
}
if (-not $databaseUrl) {
    Write-Host ""
    Write-Host "ERROR: DATABASE_URL not found." -ForegroundColor Red
    Write-Host "  Set DATABASE_URL as a system environment variable, or ensure .env" -ForegroundColor Yellow
    Write-Host "  exists in the project root: $ProjectDir" -ForegroundColor Yellow
    exit 1
}

$conn = Parse-DatabaseUrl $databaseUrl
if (-not $conn) {
    Write-Host ""
    Write-Host "ERROR: Could not parse DATABASE_URL." -ForegroundColor Red
    Write-Host "  Expected: postgresql://user:password@host:port/database" -ForegroundColor Yellow
    exit 1
}

Write-Host "Database : $($conn.Database)" -ForegroundColor White
Write-Host "Host     : $($conn.Host):$($conn.Port)" -ForegroundColor White
Write-Host "User     : $($conn.User)" -ForegroundColor White
Write-Host "BackupDir: $BackupDir" -ForegroundColor White
Write-Host "Retention: $RetentionDays days" -ForegroundColor White

# Create the backup directory if it does not exist.
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# Generate a timestamped filename.
$timestamp  = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupFile = Join-Path $BackupDir "recafco_${timestamp}.dump"
$logFile    = Join-Path $BackupDir "recafco_${timestamp}.log"

Write-Host ""
Write-Host "Starting backup ..." -ForegroundColor White
Write-Host "  Output: $backupFile" -ForegroundColor Gray

# Record the UTC start time for backup_logs.
$startedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss+00")

# Tracking variables — set inside try/catch, read in finally.
$backupSucceeded = $false
$exitCode        = 0
$errorMessage    = $null
$fileSize        = 0L

# Set PGPASSWORD in the current process environment so pg_dump does not prompt.
# It is cleared in the finally block even if the script errors out.
$env:PGPASSWORD = $conn.Password

try {
    $pgArgs = @(
        "--host=$($conn.Host)",
        "--port=$($conn.Port)",
        "--username=$($conn.User)",
        "--dbname=$($conn.Database)",
        "--format=custom",
        "--compress=6",
        "--file=$backupFile"
    )

    # Capture stderr output (pg_dump writes progress there).
    $output = & $pgDump @pgArgs 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        $errorMessage = "pg_dump exited with code $exitCode"
        Write-Host ""
        Write-Host "ERROR: pg_dump exited with code $exitCode." -ForegroundColor Red
        $output | Out-File -FilePath $logFile -Encoding utf8
        Write-Host "  See log: $logFile" -ForegroundColor Yellow
    } else {
        $fileSize = (Get-Item $backupFile).Length
        $backupSucceeded = $true
        $fileSizeMB = [Math]::Round($fileSize / 1MB, 3)

        Write-Host ""
        Write-Host "SUCCESS: Backup completed." -ForegroundColor Green
        Write-Host "  File: $backupFile" -ForegroundColor Green
        Write-Host "  Size: ${fileSizeMB} MB" -ForegroundColor Green
    }

} catch {
    $exitCode     = 1
    $errorMessage = $_.Exception.Message
    Write-Host ""
    Write-Host "ERROR: $errorMessage" -ForegroundColor Red
} finally {
    # Record result to backup_logs BEFORE clearing the password.
    $completedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss+00")

    if (Test-Path $psql) {
        try {
            if ($backupSucceeded) {
                # Escape any single quotes in the file path for safe SQL interpolation.
                $escapedPath = $backupFile -replace "'", "''"
                $insertSql = "INSERT INTO public.backup_logs (backup_type, status, file_path, file_size_bytes, started_at, completed_at) VALUES ('database', 'success', '$escapedPath', $fileSize, '$startedAt'::timestamptz, '$completedAt'::timestamptz);"
            } else {
                $rawMsg = if ($errorMessage) { $errorMessage } else { "Backup failed" }
                # Truncate and escape for SQL safety.
                $truncMsg = if ($rawMsg.Length -gt 500) { $rawMsg.Substring(0, 500) } else { $rawMsg }
                $escapedMsg = $truncMsg -replace "'", "''"
                $insertSql = "INSERT INTO public.backup_logs (backup_type, status, started_at, completed_at, error_message) VALUES ('database', 'failed', '$startedAt'::timestamptz, '$completedAt'::timestamptz, '$escapedMsg');"
            }

            & $psql `
                "--host=$($conn.Host)" `
                "--port=$($conn.Port)" `
                "--username=$($conn.User)" `
                "--dbname=$($conn.Database)" `
                "--command=$insertSql" `
                "--quiet" `
                2>&1 | Out-Null

            if ($LASTEXITCODE -eq 0) {
                Write-Host "  Backup result recorded to backup_logs." -ForegroundColor Gray
            } else {
                Write-Host "  Warning: Could not record backup result to backup_logs (psql exit $LASTEXITCODE)." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "  Warning: Could not record backup result to backup_logs: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Note: psql not found at $psql - backup_logs not updated." -ForegroundColor Gray
    }

    # Always clear the database password from the process environment.
    $env:PGPASSWORD = $null
}

# Exit with non-zero if backup failed (prevents retention/summary code from running).
if (-not $backupSucceeded) {
    exit $exitCode
}

# ── Retention: remove backups older than $RetentionDays days ─────────────────

Write-Host ""
Write-Host "Pruning backups older than $RetentionDays days ..." -ForegroundColor White

$cutoff  = (Get-Date).AddDays(-$RetentionDays)
$oldDumps = Get-ChildItem -Path $BackupDir -Filter "recafco_*.dump" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff }
$oldLogs  = Get-ChildItem -Path $BackupDir -Filter "recafco_*.log"  -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff }

$removed = 0
foreach ($file in ($oldDumps + $oldLogs)) {
    Remove-Item $file.FullName -Force
    Write-Host "  Deleted: $($file.Name)" -ForegroundColor Yellow
    $removed++
}
if ($removed -eq 0) {
    Write-Host "  No old backups to remove." -ForegroundColor Gray
} else {
    Write-Host "  Removed $removed file(s)." -ForegroundColor Yellow
}

# ── Summary: list current backup files ───────────────────────────────────────

$current = Get-ChildItem -Path $BackupDir -Filter "recafco_*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime
Write-Host ""
Write-Host "Stored backups ($($current.Count) file(s)):" -ForegroundColor White
if ($current.Count -eq 0) {
    Write-Host "  (none)" -ForegroundColor Gray
} else {
    foreach ($f in $current) {
        $sz = [Math]::Round($f.Length / 1MB, 3)
        $age = [Math]::Round(((Get-Date) - $f.LastWriteTime).TotalHours, 1)
        Write-Host "  $($f.Name)  [${sz} MB, ${age}h ago]" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=" * 50 -ForegroundColor Cyan
Write-Host "  Backup completed successfully." -ForegroundColor Green
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "=" * 50 -ForegroundColor Cyan
exit 0
