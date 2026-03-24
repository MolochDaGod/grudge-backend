# Grudge Studio — Production Operations Runbook

## Current Deployment Status

| Service | URL | Status |
|---|---|---|
| Backend API | https://api.grudge-studio.com | VPS + Cloudflare Tunnel |
| Edge AI + Storage | https://ai.grudge-studio.com | Cloudflare Worker (ALE) |
| Assets CDN | https://assets.grudge-studio.com | Cloudflare R2 |
| Auth Identity | https://id.grudge-studio.com | CNAME → api.grudge-studio.com |
| Dashboard | https://dash.grudge-studio.com | Vercel |

---

## Required GitHub Actions Secrets

Set at: https://github.com/MolochDaGod/grudge-backend/settings/secrets/actions

| Secret | Required | Description |
|---|---|---|
| `VPS_HOST` | ✅ | VPS IP or hostname |
| `VPS_USER` | ✅ | SSH user (e.g. `grudge` or `root`) |
| `VPS_SSH_KEY` | ✅ | Private SSH key (PEM, no passphrase) |
| `DB_PASSWORD` | ✅ | PostgreSQL password (32+ chars) |
| `JWT_SECRET` | ✅ | JWT signing key (64 char hex) |
| `CLOUDFLARE_TUNNEL_TOKEN` | ✅ | From Zero Trust dashboard |
| `CROSSMINT_API_KEY` | ⚠️ optional | For cNFT minting |
| `CROSSMINT_COLLECTION_CHARACTERS` | ⚠️ optional | Default: `grudge-characters` |
| `CROSSMINT_COLLECTION_ISLANDS` | ⚠️ optional | Default: `grudge-islands` |
| `DISCORD_CLIENT_ID` | ⚠️ optional | For Discord OAuth |
| `DISCORD_CLIENT_SECRET` | ⚠️ optional | For Discord OAuth |
| `GEMINI_API_KEY` | ⚠️ optional | Enables `/api/health` ai=true |

Generate secrets:
```bash
openssl rand -hex 32   # DB_PASSWORD
openssl rand -hex 32   # JWT_SECRET
```

---

## Manual Deploy (if CI is not configured)

SSH into your VPS and run:

```bash
# Pull and redeploy
cd /opt/grudge-backend
git pull origin main
docker compose pull
docker compose up -d --build api

# Watch logs
docker compose logs -f api

# Verify new endpoints are live
curl http://localhost:5000/api/health
curl "http://localhost:5000/api/auth/nonce?wallet=test"
```

---

## Database Migrations

Migrations run automatically at startup via:
```
CMD sh -c "npx drizzle-kit push && node dist/index.js"
```

New tables added in latest deploy:
- `wallets` — multi-wallet per user (Phantom, Web3Auth, Solflare, Crossmint)
- `wallet_nonces` — one-time challenge nonces for wallet signature auth
- `users.grudge_id` — stored Grudge ID column
- Indexes on `puterId`, `email`, `walletAddress`, `wallets.userId`

If the auto-migration fails, run manually:
```bash
docker compose exec api npx drizzle-kit push
```

---

## New Endpoints (post-latest-deploy)

```
GET  /api/auth/nonce?wallet=<solana_addr>  — wallet challenge
POST /api/auth/wallet                       — verify sig + login
GET  /api/auth/user                         — current user from token
POST /api/auth/logout                       — logout
POST /api/wallet/link                       — link extra wallet
GET  /api/wallet/all                        — all wallets for user
POST /api/studio/sync/push                  — save game state
GET  /api/studio/sync/pull                  — load game state
GET  /api/studio/sync/status               — sync availability
POST /api/assets/upload                     — R2 presign (backend)
GET  /api/assets/list                       — list user assets
```

ALE Worker (ai.grudge-studio.com) handles upload directly:
```
POST /assets/upload    — reserve key, get PUT url
PUT  /assets/upload?key=<key>  — stream file into R2
GET  /assets/list?prefix=players/<grudgeId>
```

---

## Health Monitoring

The `scripts/health-check.ps1` script polls `/api/health` and sends Discord alerts.

**Schedule it on Windows (Task Scheduler):**
```powershell
$action = New-ScheduledTaskAction -Execute "pwsh" -Argument "-File C:\Path\To\grudge-backend\scripts\health-check.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At (Get-Date)
Register-ScheduledTask -TaskName "GrudgeHealthCheck" -Action $action -Trigger $trigger -RunLevel Highest
```

**On VPS (cron):**
```bash
*/5 * * * * /opt/grudge-backend/scripts/health-check.sh >> /var/log/grudge-health.log 2>&1
```

---

## Database Backups

`scripts/backup-db.ps1` runs daily at 4AM, copies to OneDrive.

**Retention:** 14 days local, 30 days OneDrive
**VPS equivalent:**
```bash
# Add to crontab (crontab -e)
0 4 * * * docker exec grudge-postgres pg_dump -U grudge -d grudge_game -Fc > /backups/grudge_$(date +\%Y\%m\%d).dump
# Keep 14 days
find /backups -name "*.dump" -mtime +14 -delete
```

---

## Cloudflare Worker (ALE) Secrets

Stored via `npx wrangler secret put`:
- `CF_AI_TOKEN` ✅ — Cloudflare AI REST fallback
- `CF_R2_TOKEN` ✅ — R2 bucket management

Update a secret:
```bash
npx wrangler secret put CF_AI_TOKEN --cwd workers/ale
npx wrangler secret put CF_R2_TOKEN --cwd workers/ale
```

Redeploy worker:
```bash
npx wrangler deploy --cwd workers/ale
```

---

## CORS Origins

Backend (set via `CORS_ORIGINS` env):
```
https://grudgewarlords.com, https://www.grudgewarlords.com,
https://grudge-studio.com, https://grudgestudio.com,
https://dash.grudge-studio.com, https://grudge-platform.vercel.app,
https://warlord-crafting-suite.vercel.app, https://gdevelop-assistant.vercel.app,
https://grudachain-rho.vercel.app, https://gruda-wars.vercel.app,
https://molochdagod.github.io, http://localhost:5173
```

R2 CORS (live via API): all above + `https://ai.grudge-studio.com`, `localhost:3000/5000`

Update R2 CORS programmatically:
```powershell
# See workers/ale/r2-cors.json for the correct nested CF format
# Use: $env:CF_R2_TOKEN = "<token>"
# Then PUT to /v4/accounts/ee475864.../r2/buckets/grudge-assets/cors
```

---

## Puter Cloud Sync

Game saves are dual-written: PostgreSQL checkpoint + Puter KV.

KV key format:
```
grudge:save:<grudgeId>        — active save
grudge:prefs:<grudgeId>       — user preferences
grudge:archive:<grudgeId>:<ts> — versioned snapshot
```

Frontend sends `X-Puter-Token: <puter_auth_token>` header with sync requests.
Backend proxies to Puter API at `https://api.puter.com/drivers/call`.

Set server-side Puter token in `.env`:
```
PUTER_API_TOKEN=<token from puter whoami>
```

---

## Vercel Frontend Environment Variables

Set in Vercel dashboard for each project:
```
VITE_API_URL=https://api.grudge-studio.com
VITE_AUTH_URL=https://id.grudge-studio.com
VITE_WS_URL=wss://api.grudge-studio.com
VITE_AI_URL=https://ai.grudge-studio.com
VITE_ASSETS_URL=https://assets.grudge-studio.com
VITE_SYNC_URL=https://api.grudge-studio.com
VITE_OBJECTSTORE_URL=https://molochdagod.github.io/ObjectStore/api/v1
VITE_WEB3AUTH_CLIENT_ID=<from web3auth dashboard>
VITE_WEB3AUTH_NETWORK=sapphire_mainnet
```

---

## Quick Ops Reference

```bash
# Container status
docker compose ps

# Live logs
docker compose logs -f api
docker compose logs -f cloudflared

# Restart api only (zero-downtime if behind tunnel)
docker compose restart api

# Force rebuild
docker compose up -d --build api

# DB shell
docker compose exec postgres psql -U grudge -d grudge_game

# Run migration manually
docker compose exec api npx drizzle-kit push

# Check tunnel health
docker compose logs cloudflared --tail=20
```
