$ErrorActionPreference = "Stop"

function Read-DotEnvValue {
  param([string] $Name)

  if (-not (Test-Path ".env")) {
    return $null
  }

  $line = Get-Content ".env" | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  $value = ($line -split "=", 2)[1].Trim()
  return $value.Trim('"').Trim("'")
}

function Test-TcpPort {
  param(
    [string] $HostName,
    [int] $Port
  )

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(1000, $false)
    if ($connected) {
      $client.EndConnect($async)
    }
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

$databaseUrl = Read-DotEnvValue "DATABASE_URL"
if (-not $databaseUrl) {
  Write-Host "[postgres] DATABASE_URL is missing in .env; skipping database startup check."
  exit 0
}

try {
  $uri = [Uri] $databaseUrl
} catch {
  Write-Error "[postgres] DATABASE_URL is not a valid PostgreSQL URL."
  exit 1
}

$hostName = $uri.Host
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

if (Test-TcpPort -HostName $hostName -Port $port) {
  Write-Host "[postgres] PostgreSQL is already reachable at ${hostName}:${port}."
  exit 0
}

$serviceName = Read-DotEnvValue "POSTGRES_SERVICE_NAME"
if (-not $serviceName) {
  $service = Get-Service | Where-Object {
    $_.Name -like "*postgres*" -or $_.DisplayName -like "*postgres*"
  } | Select-Object -First 1
} else {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
}

if (-not $service) {
  Write-Error "[postgres] PostgreSQL is not reachable at ${hostName}:${port}, and no Windows PostgreSQL service was found. Set POSTGRES_SERVICE_NAME in .env if needed."
  exit 1
}

if ($service.Status -ne "Running") {
  Write-Host "[postgres] Starting Windows service '$($service.Name)'."
  try {
    Start-Service -Name $service.Name
  } catch {
    Write-Error "[postgres] Could not start '$($service.Name)'. Start PowerShell as Administrator or start PostgreSQL manually."
    exit 1
  }
}

for ($attempt = 1; $attempt -le 30; $attempt++) {
  if (Test-TcpPort -HostName $hostName -Port $port) {
    Write-Host "[postgres] PostgreSQL is reachable at ${hostName}:${port}."
    exit 0
  }
  Start-Sleep -Seconds 1
}

Write-Error "[postgres] PostgreSQL service '$($service.Name)' started, but ${hostName}:${port} did not become reachable."
exit 1
