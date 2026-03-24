# ============================================
# Grudge Backend - Automated Database Backup
# Schedule: Daily at 4:00 AM CST via Task Scheduler
# ============================================

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmm"
$localDir  = "C:\Backups\grudge-db"
$cloudDir  = "$env:USERPROFILE\OneDrive\Backups\grudge-db"
$dumpFile  = "grudge_game_$timestamp.dump"
$logFile   = "$localDir\backup.log"

# Load Discord webhook from master env
$masterEnv = "$env:USERPROFILE\OneDrive\Documents\My Games\grudge-studio\.env"
$webhookUrl = $null
if (Test-Path $masterEnv) {
    $match = (Get-Content $masterEnv) -match "^DISCORD_WEBHOOK_URL_UPDATES="
    if ($match) { $webhookUrl = ($match -split '=', 2)[1].Trim('"') }
}

function Send-Notification($message, $color) {
    if (-not $webhookUrl) { return }
    $body = @{
        embeds = @(@{
            title       = "Grudge Backup"
            description = $message
            color       = $color
            timestamp   = (Get-Date -Format "o")
        })
    } | ConvertTo-Json -Depth 4
    try { Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType "application/json" -ErrorAction SilentlyContinue } catch {}
}

# Ensure directories
New-Item -ItemType Directory -Force -Path $localDir, $cloudDir 2>$null | Out-Null

# Check container is running
$pgRunning = (docker ps --filter name=grudge-postgres -q 2>$null)
if (-not $pgRunning) {
    $msg = "[$timestamp] FAIL - grudge-postgres is not running"
    Add-Content -Path $logFile -Value $msg
    Send-Notification "BACKUP FAILED - grudge-postgres not running" 15158332
    exit 1
}

# Dump database inside container, then copy out
$startTime = Get-Date
docker exec grudge-postgres pg_dump -U grudge -d grudge_game -Fc -f /tmp/backup.dump 2>$null
docker cp grudge-postgres:/tmp/backup.dump "$localDir\$dumpFile" 2>$null
docker exec grudge-postgres rm -f /tmp/backup.dump 2>$null

# Validate
if (-not (Test-Path "$localDir\$dumpFile")) {
    $msg = "[$timestamp] FAIL - dump file was not created"
    Add-Content -Path $logFile -Value $msg
    Send-Notification "BACKUP FAILED - dump file not created" 15158332
    exit 1
}

$fileSize = (Get-Item "$localDir\$dumpFile").Length
if ($fileSize -lt 1024) {
    $msg = "[$timestamp] FAIL - dump file too small ($fileSize bytes)"
    Add-Content -Path $logFile -Value $msg
    Send-Notification "BACKUP FAILED - dump file too small ($fileSize bytes)" 15158332
    exit 1
}

$duration = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
$sizeMB   = [math]::Round($fileSize / 1MB, 2)

# Copy to OneDrive
Copy-Item "$localDir\$dumpFile" "$cloudDir\$dumpFile" -Force 2>$null

# Retention: 14 days local, 30 days cloud
Get-ChildItem $localDir -Filter "*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force 2>$null
Get-ChildItem $cloudDir -Filter "*.dump" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force 2>$null

# Count records
$userCount = (docker exec grudge-postgres psql -U grudge -d grudge_game -tAc "SELECT COUNT(*) FROM users;" 2>$null).Trim()
$charCount = (docker exec grudge-postgres psql -U grudge -d grudge_game -tAc "SELECT COUNT(*) FROM characters;" 2>$null).Trim()

$logMsg = "[$timestamp] OK - ${sizeMB}MB in ${duration}s - $userCount users, $charCount characters"
Add-Content -Path $logFile -Value $logMsg
Write-Output $logMsg

Send-Notification "Backup OK - $dumpFile (${sizeMB}MB in ${duration}s) - $userCount users, $charCount characters" 3066993
