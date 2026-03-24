# ============================================
# Grudge Backend - Health Check Monitor
# Schedule: Every 5 minutes via Task Scheduler
# ============================================

$healthUrl = "http://localhost:5000/api/health"
$stateFile = "C:\Backups\grudge-db\health-state.json"

# Load Discord webhook from master env
$masterEnv = "$env:USERPROFILE\OneDrive\Documents\My Games\grudge-studio\.env"
$webhookUrl = $null
if (Test-Path $masterEnv) {
    $match = (Get-Content $masterEnv) -match "^DISCORD_WEBHOOK_URL_UPDATES="
    if ($match) { $webhookUrl = ($match -split '=', 2)[1].Trim('"') }
}

function Send-Alert($message, $color) {
    if (-not $webhookUrl) { return }
    $body = @{
        embeds = @(@{
            title       = "Grudge Backend Monitor"
            description = $message
            color       = $color
            timestamp   = (Get-Date -Format "o")
            footer      = @{ text = "Health Check System" }
        })
    } | ConvertTo-Json -Depth 4
    try { Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $body -ContentType "application/json" } catch {}
}

# Load previous state (avoid spamming alerts)
$prevState = @{ healthy = $true; lastAlertAt = $null; downSince = $null }
if (Test-Path $stateFile) {
    try { $prevState = Get-Content $stateFile | ConvertFrom-Json } catch {}
}

try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 10

    if ($response.status -eq "healthy") {
        # Was it previously down? Send recovery alert
        if (-not $prevState.healthy) {
            $downDuration = if ($prevState.downSince) {
                $mins = [math]::Round(((Get-Date) - [DateTime]$prevState.downSince).TotalMinutes, 1)
                " (was down for ${mins} min)"
            } else { "" }

            Send-Alert "? **RECOVERED**$downDuration`n`nAll features: API=$(${response}.features.api), WS=$(${response}.features.websocket), Crossmint=$(${response}.features.crossmint), Discord=$(${response}.features.discord)" 3066993
        }

        $newState = @{ healthy = $true; lastAlertAt = $null; downSince = $null }
        $newState | ConvertTo-Json | Set-Content $stateFile
    }
    else {
        throw "Status: $($response.status)"
    }

} catch {
    $now = Get-Date
    $downSince = if ($prevState.downSince) { $prevState.downSince } else { $now.ToString("o") }

    # Alert at most every 15 minutes to avoid spam
    $shouldAlert = $true
    if ($prevState.lastAlertAt) {
        $lastAlert = [DateTime]$prevState.lastAlertAt
        if (($now - $lastAlert).TotalMinutes -lt 15) { $shouldAlert = $false }
    }

    if ($shouldAlert) {
        $errorMsg = $_.Exception.Message
        # Check container status for more context
        $containerStatus = docker inspect -f '{{.State.Status}}' grudge-backend 2>$null
        $pgStatus = docker inspect -f '{{.State.Status}}' grudge-postgres 2>$null

        Send-Alert "?? **DOWN** - $errorMsg`n`nContainers:`n- grudge-backend: ``$containerStatus```n- grudge-postgres: ``$pgStatus```n`nDown since: $downSince" 15158332

        $newState = @{
            healthy     = $false
            lastAlertAt = $now.ToString("o")
            downSince   = $downSince
        }
        $newState | ConvertTo-Json | Set-Content $stateFile
    }
}
