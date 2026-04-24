#!/bin/bash
# ============================================
# Grudge Studio — VPS First-Time Setup
# Run as root on a fresh Ubuntu 22.04+ VPS
# Usage: curl -sL <raw-url> | sudo bash
# ============================================
set -euo pipefail

echo "╔══════════════════════════════════════════════╗"
echo "║  Grudge Studio — VPS Bootstrap               ║"
echo "╚══════════════════════════════════════════════╝"

DEPLOY_DIR="/opt/grudge-backend"
BACKUP_DIR="/backups"
SERVICE_USER="grudge"

# ── 1. System updates ────────────────────────
echo "[1/7] Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw fail2ban unattended-upgrades

# ── 2. Create service user ───────────────────
echo "[2/7] Creating service user '$SERVICE_USER'..."
if ! id "$SERVICE_USER" &>/dev/null; then
    adduser --disabled-password --gecos "Grudge Backend" "$SERVICE_USER"
    usermod -aG sudo "$SERVICE_USER"
fi

# ── 3. Install Docker ────────────────────────
echo "[3/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi
usermod -aG docker "$SERVICE_USER"

# Ensure docker compose plugin is available
if ! docker compose version &>/dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi

# ── 4. Firewall ──────────────────────────────
echo "[4/7] Configuring UFW firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
# No need to open 80/443 — Cloudflare Tunnel uses outbound-only connections
ufw --force enable

# ── 5. Fail2ban ──────────────────────────────
echo "[5/7] Enabling fail2ban..."
systemctl enable --now fail2ban

# ── 6. Clone repo & prepare ──────────────────
echo "[6/7] Setting up project at $DEPLOY_DIR..."
mkdir -p "$DEPLOY_DIR" "$BACKUP_DIR"

if [ ! -d "$DEPLOY_DIR/.git" ]; then
    git clone https://github.com/MolochDaGod/grudge-backend.git "$DEPLOY_DIR"
else
    echo "  Repo already exists, pulling latest..."
    git -C "$DEPLOY_DIR" pull origin main
fi

# Copy env template
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    cp "$DEPLOY_DIR/.env.example" "$DEPLOY_DIR/.env"
    echo ""
    echo "⚠️  IMPORTANT: Edit $DEPLOY_DIR/.env with production values!"
    echo "   Required: DB_PASSWORD, JWT_SECRET, CLOUDFLARE_TUNNEL_TOKEN"
    echo "   Generate secrets with: openssl rand -hex 32"
    echo ""
fi

chown -R "$SERVICE_USER:$SERVICE_USER" "$DEPLOY_DIR" "$BACKUP_DIR"

# ── 7. Install cron jobs ─────────────────────
echo "[7/7] Installing cron jobs..."
CRON_FILE="/etc/cron.d/grudge-backend"
cat > "$CRON_FILE" << 'CRON'
# Grudge Studio — Scheduled Tasks
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# Health check every 5 minutes
*/5 * * * * grudge /opt/grudge-backend/scripts/health-check.sh >> /var/log/grudge-health.log 2>&1

# Database backup daily at 4 AM UTC
0 4 * * * grudge /opt/grudge-backend/scripts/backup-db.sh >> /var/log/grudge-backup.log 2>&1

# Prune old Docker images weekly (Sunday 3 AM)
0 3 * * 0 root docker system prune -af --filter "until=168h" >> /var/log/grudge-docker-prune.log 2>&1
CRON
chmod 644 "$CRON_FILE"

# Create log files
touch /var/log/grudge-health.log /var/log/grudge-backup.log /var/log/grudge-docker-prune.log
chown "$SERVICE_USER:$SERVICE_USER" /var/log/grudge-health.log /var/log/grudge-backup.log

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ VPS Bootstrap Complete                    ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Next steps:                                  ║"
echo "║  1. Edit /opt/grudge-backend/.env              ║"
echo "║  2. su - grudge                                ║"
echo "║  3. cd /opt/grudge-backend                     ║"
echo "║  4. docker compose up -d --build               ║"
echo "║  5. docker compose logs -f                     ║"
echo "╚══════════════════════════════════════════════╝"
