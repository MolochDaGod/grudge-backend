# Grudge Studio — Unified Backend

Single consolidated backend for all Grudge Studio services: authentication, characters, Crossmint wallets, WebSocket game bridge, and more.

**Created by Racalvin The Pirate King**

## Architecture

- **Runtime:** Node.js 20 + Express + TypeScript
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Auth:** JWT + bcrypt, multi-method (email, guest, puter, Discord OAuth, wallet)
- **Wallets:** Crossmint server-side wallets (Solana MPC)
- **Realtime:** WebSocket game bridge with zone/position/chat
- **Deploy:** Docker + nginx + GitHub Actions CI/CD

## Quick Start (Local Dev)

```bash
# 1. Copy env and configure
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, etc.

# 2. Install
npm install

# 3. Push schema to database
npx drizzle-kit push

# 4. Run dev server
npm run dev
```

Server starts at `http://localhost:5000`

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account (username/password) |
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/guest` | No | Guest login (auto Grudge ID) |
| POST | `/api/auth/puter` | No | Puter login |
| POST | `/api/auth/verify` | No | Verify JWT token |
| GET | `/auth/discord` | No | Discord OAuth redirect |
| GET | `/api/characters` | Yes | List user's characters |
| POST | `/api/characters` | Yes | Create character |
| DELETE | `/api/characters/:id` | Yes | Delete character |
| POST | `/api/wallet/create` | Yes | Provision Crossmint wallet |
| GET | `/api/wallet` | Yes | Get wallet info/balance |
| GET | `/api/profile` | Yes | Get user profile + Grudge ID |
| GET | `/api/metadata` | No | Game data (classes, races, weapons) |
| GET | `/api/health` | No | Health check |
| WS | `/ws` | Token | Game bridge (zones, positions, chat) |

## Environment Variables

See `.env.example` for all variables. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — 64-char random secret for JWT signing
- `PORT` — Server port (default: 5000)

Optional:
- `CROSSMINT_API_KEY` — Crossmint server-side API key
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` — Discord OAuth
- `GEMINI_API_KEY` — AI agents
- `CORS_ORIGINS` — Comma-separated allowed origins
- `FRONTEND_URL` — Frontend URL for OAuth redirects

## Deploy to VPS (GRUDA 26.228.21.150)

### Option A: Docker Compose

```bash
# On VPS
git clone <repo> /opt/grudge-backend
cd /opt/grudge-backend
cp .env.example .env
# Edit .env with production values

# Place Cloudflare origin cert in deploy/certs/
# origin.pem and origin-key.pem

docker compose up -d
```

### Option B: Manual

```bash
git clone <repo> /opt/grudge-backend
cd /opt/grudge-backend
chmod +x deploy-linux.sh
./deploy-linux.sh

# Start with systemd
sudo cp deploy/grudge-backend.service /etc/systemd/system/
sudo systemctl enable --now grudge-backend
```

### Option C: GitHub Actions (Automatic)

Set these GitHub Secrets:
- `VPS_HOST` — `26.228.21.150`
- `VPS_USER` — `grudge`
- `VPS_SSH_KEY` — SSH private key
- `DB_PASSWORD` — PostgreSQL password
- `JWT_SECRET` — JWT signing secret
- `CROSSMINT_API_KEY` — Crossmint key
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `GEMINI_API_KEY`

Push to `main` branch to auto-deploy.

### Cloudflare DNS

Add CNAME record in Cloudflare:
- `api.grudge-studio.com` → `26.228.21.150` (or A record)
- Proxy status: Proxied (orange cloud)

## Database Schema

16 tables covering:
- **users** — accounts with Grudge ID, wallet, faction
- **auth_tokens** — JWT session management
- **auth_providers** — Discord/Puter/Google OAuth linking
- **characters** — RPG characters with attributes, equipment
- **inventory_items** — character inventory
- **crafted_items** — crafted gear
- **unlocked_skills** / **unlocked_recipes** — progression
- **crafting_jobs** — active crafting
- **shop_transactions** — purchase history
- **islands** — player islands
- **ai_agents** — NPC/companion AI
- **game_sessions** / **afk_jobs** — session tracking
- **uuid_ledger** / **resource_ledger** — audit trails
- **battle_arena_stats** — PvP stats

## Scripts

```bash
npm run dev        # Dev server with hot reload
npm run build      # Production build (esbuild)
npm run start      # Start production server
npm run check      # TypeScript type check
npm run db:push    # Push schema to database
npm run db:generate # Generate migration files
```
