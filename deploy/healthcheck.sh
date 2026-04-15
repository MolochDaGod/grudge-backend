#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Grudge Studio — VPS Health-Check & Auto-Restart
# ──────────────────────────────────────────────────────────
# Usage:
#   chmod +x /opt/grudge-backend/deploy/healthcheck.sh
#   crontab -e  →  */5 * * * * /opt/grudge-backend/deploy/healthcheck.sh
#
# Or run manually:  ./deploy/healthcheck.sh
# ──────────────────────────────────────────────────────────

set -euo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:5000/api/health}"
MAX_RETRIES=3
RETRY_DELAY=5
LOG_TAG="grudge-healthcheck"

# Which orchestrator is in use?
if command -v docker &>/dev/null && docker compose ps --quiet api 2>/dev/null | grep -q .; then
  MODE="docker"
elif systemctl is-active --quiet grudge-backend 2>/dev/null; then
  MODE="systemd"
else
  MODE="docker"  # default
fi

log() { logger -t "$LOG_TAG" "$*"; echo "[$(date -Is)] $*"; }

check_health() {
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
  echo "$status"
}

restart_service() {
  log "RESTARTING via $MODE"
  if [ "$MODE" = "docker" ]; then
    docker compose -f /opt/grudge-backend/docker-compose.yml restart api
  else
    sudo systemctl restart grudge-backend
  fi
}

# ── Main loop: retry before declaring failure ──
healthy=false
for attempt in $(seq 1 "$MAX_RETRIES"); do
  code=$(check_health)
  if [ "$code" = "200" ]; then
    healthy=true
    break
  fi
  log "Attempt $attempt/$MAX_RETRIES — HTTP $code"
  sleep "$RETRY_DELAY"
done

if $healthy; then
  log "OK — API healthy"
  exit 0
fi

log "UNHEALTHY after $MAX_RETRIES attempts — triggering restart"
restart_service

# Wait for restart, then verify
sleep 20
final=$(check_health)
if [ "$final" = "200" ]; then
  log "RECOVERED — API healthy after restart"
else
  log "CRITICAL — API still unhealthy (HTTP $final) after restart — manual intervention needed"
  exit 1
fi
