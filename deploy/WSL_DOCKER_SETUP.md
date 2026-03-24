# Grudge Studio — Production Deployment Guide
## WSL2 + Docker + Cloudflare Tunnel

---

## 1. WSL2 Setup (Windows Host)

Create or edit `C:\Users\david\.wslconfig`:

```ini
[wsl2]
memory=6GB          # leave headroom for Windows
processors=4
swap=2GB
localhostForwarding=true
```

Then restart WSL: `wsl --shutdown` in PowerShell.

---

## 2. Docker Desktop Settings

- Settings → Resources → WSL Integration → enable for your distro
- Settings → General → "Use the WSL 2 based engine" ✓
- Settings → Docker Engine — keep default
- Do **not** expose daemon on tcp without TLS

---

## 3. Required Secrets (`.env` file on VPS / WSL)

Copy `.env.example` → `.env` and fill in **all** required values:

```
DB_PASSWORD=<strong random password — minimum 32 chars>
JWT_SECRET=<64 char hex — openssl rand -hex 32>
CLOUDFLARE_TUNNEL_TOKEN=<from Cloudflare Zero Trust dashboard>

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
CROSSMINT_API_KEY=
GEMINI_API_KEY=
```

Generate secrets:
```bash
openssl rand -hex 32   # for JWT_SECRET
openssl rand -hex 24   # for DB_PASSWORD
```

---

## 4. Cloudflare Tunnel Setup

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → Networks → Tunnels → Create a tunnel
2. Name it `grudge-backend-prod`
3. Under **Public Hostnames**, add:
   - `api.grudge-studio.com`  → `http://api:5000`
   - `ws.grudge-studio.com`   → `http://api:5000` (enable WebSocket)
4. Copy the **Tunnel Token** → paste into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`

### DNS Records (Cloudflare Dashboard)

| Type  | Name             | Target                         | Proxy |
|-------|------------------|-------------------------------|-------|
| CNAME | api              | `<tunnel>.cfargotunnel.com`   | ✓     |
| CNAME | ws               | `<tunnel>.cfargotunnel.com`   | ✓     |
| CNAME | id               | `api.grudge-studio.com`       | ✓     |
| CNAME | dash             | Vercel deployment URL          | ✓     |

> **id.grudge-studio.com** CNAMEs to `api.grudge-studio.com`. The backend
> serves `/auth/*` aliases that redirect to `/api/auth/*` — no extra service needed.

---

## 5. First-Time Deploy (docker-compose)

```bash
# On VPS / WSL2
git clone https://github.com/MolochDaGod/grudge-backend
cd grudge-backend
cp .env.example .env
nano .env  # fill in secrets

docker compose up -d --build

# Verify
docker compose logs -f api
curl http://localhost:5000/api/health
```

---

## 6. GitHub Actions CI/CD

Add these **Repository Secrets** at `Settings → Secrets → Actions`:

| Secret                | Description                          |
|-----------------------|--------------------------------------|
| `VPS_HOST`            | VPS IP or hostname                   |
| `VPS_USER`            | SSH username (e.g. `grudge`)         |
| `VPS_SSH_KEY`         | Private SSH key (PEM format)         |
| `DB_PASSWORD`         | Postgres password                    |
| `JWT_SECRET`          | 64-char JWT signing key              |
| `CLOUDFLARE_TUNNEL_TOKEN` | Tunnel token from step 4        |
| `DISCORD_CLIENT_ID`   | Optional                             |
| `DISCORD_CLIENT_SECRET` | Optional                           |
| `CROSSMINT_API_KEY`   | Optional                             |
| `GEMINI_API_KEY`      | Optional                             |

Push to `main` triggers build → push to GHCR → SSH deploy on VPS.

---

## 7. Puter Account Integration

Every user auth call creates a Grudge ID via `generateGrudgeId(userId)`.

For Puter-based login, the frontend must:
1. Load `https://js.puter.com/v2/`
2. Call `puter.auth.signIn()`
3. Get `puter.auth.getUser()` → extract `uuid` and `username`
4. POST to `https://api.grudge-studio.com/api/auth/puter` with `{ puterId: uuid, displayName: username }`
5. Store the returned `token` in `sessionStorage` as `grudge_token`

The `grudge-sdk.js` and `grudge-auth.js` both handle this automatically.

---

## 8. R2 Object Storage (grudge-assets)
Bucket is live at `assets.grudge-studio.com`.
All player uploads go through the ALE Worker at `ai.grudge-studio.com/assets/upload`.
No S3 credentials needed in the Worker — it uses the native R2 binding.

**CORS policy** — needs to be updated manually in the dashboard once:
1. Cloudflare Dashboard → R2 → grudge-assets → Settings → CORS Policy
2. Replace the existing rule with the contents of `workers/ale/r2-cors.json`
3. This allows PUT/POST from all Grudge Studio domains

Current CORS is read-only (GET only) from `localhost:3000` and `grudge-studio.com` — needs expanding.

**Upload flow from any frontend:**
```js
// 1. Reserve key
const { uploadUrl, publicUrl, contentType } = await fetch(
  'https://ai.grudge-studio.com/assets/upload',
  { method: 'POST', body: JSON.stringify({ filename: 'avatar.png', category: 'avatars', grudgeId: 'GRUDGE_XXXX' }) }
).then(r => r.json());
// 2. PUT file directly to Worker -> R2
await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: fileBlob });
// publicUrl -> https://assets.grudge-studio.com/players/GRUDGE_XXXX/avatars/...
```

## 9. ALE Worker (Cloudflare Workers AI)

Worker is deployed as `grudge-ai-hub` at `grudge-ai-hub.grudge.workers.dev`.

Secrets already stored:
- `CF_AI_TOKEN` ✓

To activate `ai.grudge-studio.com`:
1. Add CNAME in Cloudflare: `ai` → `grudge-ai-hub.grudge.workers.dev` (proxied)
2. Uncomment `[[routes]]` section in `workers/ale/wrangler.toml`
3. Run `npx wrangler deploy` from `workers/ale/`

Endpoints available:
- `POST /ai/chat`     — Anthropic Claude
- `POST /ai/complete` — OpenAI GPT
- `POST /ai/cf`       — Cloudflare Workers AI (Llama-3, free tier)
- `ANY  /api/*`       — Proxy to api.grudge-studio.com
- `GET  /health`      — Health relay

---

## 9. Quick Reference

```bash
# Restart backend only
docker compose restart api

# View live logs
docker compose logs -f api

# Database shell
docker compose exec postgres psql -U grudge -d grudge_game

# Force rebuild + restart
docker compose up -d --build api

# Check tunnel
docker compose logs cloudflared
```
