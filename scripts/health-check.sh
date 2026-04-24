#!/bin/bash
# ============================================
# Grudge Backend — Health Check (Linux/VPS)
# Cron: */5 * * * * /opt/grudge-backend/scripts/health-check.sh
# ============================================

HEALTH_URL="http://localhost:5000/api/health"
STATE_FILE="/tmp/grudge-health-state.json"
ENV_FILE="/opt/grudge-backend/.env"
TIMEOUT=10

# Load Discord webhook from .env
WEBHOOK_URL=""
if [ -f "$ENV_FILE" ]; then
    WEBHOOK_URL=$(grep -m1 "^DISCORD_WEBHOOK_URL_UPDATES=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' || true)
fi

send_alert() {
    local message="$1"
    local color="$2"
    [ -z "$WEBHOOK_URL" ] && return

    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    curl -s -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"embeds\": [{
                \"title\": \"Grudge Backend Monitor\",
                \"description\": \"$message\",
                \"color\": $color,
                \"timestamp\": \"$timestamp\",
                \"footer\": {\"text\": \"VPS Health Check\"}
            }]
        }" > /dev/null 2>&1
}

# Load previous state
prev_healthy=true
prev_alert_at=""
down_since=""
if [ -f "$STATE_FILE" ]; then
    prev_healthy=$(jq -r '.healthy // true' "$STATE_FILE" 2>/dev/null || echo "true")
    prev_alert_at=$(jq -r '.lastAlertAt // ""' "$STATE_FILE" 2>/dev/null || echo "")
    down_since=$(jq -r '.downSince // ""' "$STATE_FILE" 2>/dev/null || echo "")
fi

# Check health
response=$(curl -s --max-time "$TIMEOUT" "$HEALTH_URL" 2>/dev/null || echo "")
status=$(echo "$response" | jq -r '.status // ""' 2>/dev/null || echo "")

now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
now_epoch=$(date +%s)

if [ "$status" = "healthy" ]; then
    # Recovery alert if previously down
    if [ "$prev_healthy" = "false" ]; then
        down_msg=""
        if [ -n "$down_since" ]; then
            down_epoch=$(date -d "$down_since" +%s 2>/dev/null || echo "$now_epoch")
            mins=$(( (now_epoch - down_epoch) / 60 ))
            down_msg=" (was down for ${mins} min)"
        fi
        send_alert "✅ **RECOVERED**${down_msg}" 3066993
    fi

    echo "{\"healthy\": true, \"lastAlertAt\": null, \"downSince\": null}" > "$STATE_FILE"
    echo "[$(date)] OK — healthy"
else
    [ -z "$down_since" ] && down_since="$now"

    # Alert at most every 15 minutes
    should_alert=true
    if [ -n "$prev_alert_at" ]; then
        alert_epoch=$(date -d "$prev_alert_at" +%s 2>/dev/null || echo "0")
        elapsed=$(( now_epoch - alert_epoch ))
        [ "$elapsed" -lt 900 ] && should_alert=false
    fi

    if [ "$should_alert" = true ]; then
        # Get container status for diagnostics
        api_status=$(docker inspect -f '{{.State.Status}}' grudge-backend 2>/dev/null || echo "unknown")
        pg_status=$(docker inspect -f '{{.State.Status}}' grudge-postgres 2>/dev/null || echo "unknown")
        cf_status=$(docker inspect -f '{{.State.Status}}' grudge-backend-cloudflared-1 2>/dev/null || echo "unknown")

        error_detail="No response"
        [ -n "$response" ] && error_detail="Status: $status"

        send_alert "🚨 **DOWN** — ${error_detail}\n\nContainers:\n- api: \`${api_status}\`\n- postgres: \`${pg_status}\`\n- cloudflared: \`${cf_status}\`\n\nDown since: ${down_since}" 15158332

        echo "{\"healthy\": false, \"lastAlertAt\": \"$now\", \"downSince\": \"$down_since\"}" > "$STATE_FILE"
    fi

    echo "[$(date)] FAIL — $status"
fi
