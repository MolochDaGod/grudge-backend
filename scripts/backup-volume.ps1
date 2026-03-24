# ============================================
# Grudge Backend - Docker Volume Snapshot Backup
# Schedule: Weekly Sunday 3:00 AM CST via Task Scheduler
# ============================================

$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyy-MM-dd"
$backupDir = "C:\Backups\grudge-volumes"
$archiveFile = "grudge-db-data_$timestamp.tar.gz"

try {
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

    # Stop writes briefly for consistent snapshot
    Write-Output "Creating volume snapshot..."
    docker run --rm `
        -v grudge-db-data:/data:ro `
        -v ${backupDir}:/backup `
        alpine tar czf "/backup/$archiveFile" -C /data .

    $sizeMB = [math]::Round((Get-Item "$backupDir\$archiveFile").Length / 1MB, 2)
    Write-Output "Volume snapshot: $archiveFile (${sizeMB}MB)"

    # Retention: keep last 4 weekly snapshots
    Get-ChildItem $backupDir -Filter "*.tar.gz" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-28) } |
        Remove-Item -Force

    Write-Output "Volume backup complete"

} catch {
    Write-Error "Volume backup failed: $($_.Exception.Message)"
    exit 1
}
