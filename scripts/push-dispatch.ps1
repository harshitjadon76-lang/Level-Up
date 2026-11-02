$ErrorActionPreference = "Stop"

# Locate the project and environment file.
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"

if (-not (Test-Path $envPath)) {
    throw ".env.local was not found in the project folder."
}

# Read the cron secret without displaying it.
$line = Get-Content $envPath |
    Where-Object { $_ -match '^CRON_SECRET=' } |
    Select-Object -First 1

if (-not $line) {
    throw "CRON_SECRET is missing from .env.local."
}

$secret = ($line -replace '^CRON_SECRET=', '').Trim().Trim('"').Trim("'")

if (-not $secret) {
    throw "CRON_SECRET is empty."
}

try {
    $response = Invoke-RestMethod `
        -Method Get `
        -Uri "http://localhost:3000/api/push/dispatch" `
        -Headers @{ Authorization = "Bearer $secret" } `
        -TimeoutSec 20

    $response | ConvertTo-Json -Compress
}
catch {
    Write-Error "Dispatcher failed. Check that npm run dev is running and the configuration is correct."
    exit 1
}
finally {
    $secret = $null
}
