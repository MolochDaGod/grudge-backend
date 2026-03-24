# Grudge Studio — Unified Backend

Single consolidated backend for all Grudge Studio services: authentication, characters, economy, crafting, missions, combat, crews, Crossmint wallets, cNFT minting, WebSocket game bridge, and more.

**Created by Racalvin The Pirate King**

## Architecture

- **Runtime:** Node.js 20 + Express + TypeScript
- **Database:** PostgreSQL 16 + Drizzle ORM (auto-migration on startup)
- **Auth:** JWT + bcrypt — 7 login methods (password, guest, Puter, Discord, Google, GitHub, Solana wallet)
- **Wallets:** Crossmint MPC wallets (server-side) + Phantom/Solflare/Backpack (Ed25519 nonce signing)
- **cNFTs:** Compressed NFTs on Solana via Crossmint — auto-minted on character/island creation
- **Realtime:** WebSocket game bridge (`/ws`) with zone rooms, position sync, chat
- **Storage:** Cloudflare R2 for avatars, assets, screenshots
- **Edge:** ALE Cloudflare Worker (`ale.grudge-studio.com`) for AI gateway + R2 CDN
- **Deploy:** Docker Compose + Cloudflare Tunnel (Zero Trust, no open ports) + GitHub Actions CI/CD

## Quick Start

```bash
cp .env.example .env   # Edit with your secrets
npm install
npx drizzle-kit push   # Create/migrate tables
npm run dev            # http://localhost:5000
```

## API Reference

### Authentication

```
POST /api/auth/register     — Create account (username + password)
POST /api/auth/login        — Login
POST /api/auth/guest        — Guest login (auto Grudge ID + Puter ID)
POST /api/auth/puter        — Puter cloud login
POST /api/auth/verify       — Verify JWT token
POST /api/auth/wallet       — Solana wallet login (Ed25519 signature verify)
GET  /api/auth/nonce?wallet=X — Get one-time nonce for wallet signing
GET  /api/auth/user         — Get profile from Bearer token (Grudge SDK)
POST /api/auth/logout       — Logout

GET  /auth/discord           — Discord OAuth redirect
GET  /auth/discord/callback  — Discord OAuth callback
GET  /auth/google            — Google OAuth redirect
GET  /auth/google/callback   — Google OAuth callback
GET  /auth/github            — GitHub OAuth redirect
GET  /auth/github/callback   — GitHub OAuth callback
```

### Characters

```
GET    /api/characters         — List user's characters
POST   /api/characters         — Create character (auto-mints cNFT)
PATCH  /api/characters/:id     — Update character (attributes, equipment, name, level, HP/MP/SP)
DELETE /api/characters/:id     — Delete character
POST   /api/characters/:id/mint — Mint/re-mint character cNFT
```

### Islands

```
GET    /api/islands            — List user's islands
POST   /api/islands            — Create island (auto-mints cNFT, 3 per user)
GET    /api/islands/:id        — Get island detail
DELETE /api/islands/:id        — Delete island
POST   /api/islands/:id/mint   — Mint/re-mint island cNFT
```

### Economy

```
GET  /api/economy/balance?char_id=X  — Gold balance + last 20 transactions
POST /api/economy/spend              — Deduct gold (purchase, craft)
POST /api/economy/transfer           — Player-to-player transfer (max 100k)
POST /api/economy/award    [INT]     — Award gold (missions, loot) — internal key required
```

### Crafting

```
GET    /api/crafting/recipes         — All recipes from ObjectStore (?tier=3)
GET    /api/crafting/queue?char_id=X — Active crafting queue (auto-marks completed)
POST   /api/crafting/start           — Start craft (validates gold, max 3 concurrent)
PATCH  /api/crafting/:id/complete [INT] — Complete craft, deliver item
DELETE /api/crafting/:id             — Cancel craft, 50% gold refund
```

### Missions

```
GET    /api/missions                 — List missions (?char_id=X)
POST   /api/missions                 — Create mission (11 active limit)
PATCH  /api/missions/:id/complete    — Complete mission (auto gold + XP + level up)
DELETE /api/missions/:id             — Abandon mission
```

### Combat

```
POST /api/combat/log                 — Record combat result (auto-updates PvP stats)
GET  /api/combat/history?char_id=X   — Combat history
GET  /api/combat/leaderboard         — Top 25 by kills
```

### Crews

```
GET  /api/crews                      — Get player's current crew + members
POST /api/crews/create               — Create crew (3-5 members)
POST /api/crews/:id/join             — Join crew
POST /api/crews/:id/leave            — Leave crew (leader disbands)
POST /api/crews/:id/claim-base       — Claim island as crew base (Pirate Claim)
```

### Wallets

```
POST /api/wallet/create              — Provision Crossmint MPC wallet
GET  /api/wallet                     — Get wallet info + balance
POST /api/wallet/link                — Link external wallet (Phantom, Solflare)
GET  /api/wallet/all                 — List all linked wallets
```

### Other

```
GET  /api/profile                    — User profile + Grudge ID
GET  /api/metadata                   — Game constants (classes, races, weapons, factions)
GET  /api/health                     — Health check + feature flags
POST /api/assets/upload              — Upload to R2 (presigned URL)
GET  /api/assets/:key                — Get asset URL
POST /api/studio/sync/push           — Push game state to backend
POST /api/studio/sync/pull           — Pull game state from backend
WS   /ws                             — WebSocket game bridge (auth → join_zone → position/chat)
```

`[INT]` = requires `x-internal-key` header (service-to-service calls).

## Environment Variables

See `.env.example` for full list. Key variables:

**Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — 64-char random string

**Auth Providers (optional, each enables a login method):**
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

**Crossmint & cNFTs:**
- `CROSSMINT_API_KEY` — server-side API key from Crossmint dashboard
- `CROSSMINT_COLLECTION_CHARACTERS` / `CROSSMINT_COLLECTION_ISLANDS`

**Infrastructure:**
- `CLOUDFLARE_TUNNEL_TOKEN` — Cloudflare Zero Trust tunnel
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — R2 storage
- `INTERNAL_API_KEY` — service-to-service auth for economy/combat/crafting internal endpoints

## Deploy

### Docker Compose (recommended)

```bash
git clone https://github.com/MolochDaGod/grudge-backend.git /opt/grudge-backend
cd /opt/grudge-backend
cp .env.example .env   # Edit with production values
docker compose up -d   # Starts: PostgreSQL + API + Cloudflare Tunnel
```

The Dockerfile auto-runs `drizzle-kit push` on startup — schema is always in sync.

### GitHub Actions (CI/CD)

Push to `main` → builds Docker image → pushes to GHCR → SSH deploys to VPS.
Also supports `workflow_dispatch` for manual triggers.

Set secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DB_PASSWORD`, `JWT_SECRET`, `CROSSMINT_API_KEY`, `CROSSMINT_COLLECTION_CHARACTERS`, `CROSSMINT_COLLECTION_ISLANDS`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GEMINI_API_KEY`.

### Cloudflare Tunnel

No open ports needed. The `cloudflared` container creates an outbound tunnel to Cloudflare edge.
Configure at https://one.dash.cloudflare.com → Networks → Tunnels:
- `api.grudge-studio.com` → `http://api:5000`
- `ws.grudge-studio.com` → `http://api:5000` (WebSocket enabled)

## Database Schema (21 tables)

**Core:** users, wallets, wallet_nonces, auth_tokens, auth_providers
**Characters:** characters, inventory_items, crafted_items, unlocked_skills, unlocked_recipes
**Game Systems:** gold_transactions, crafting_jobs, missions, crews, crew_members, combat_log, battle_arena_stats
**World:** islands, ai_agents, game_sessions, afk_jobs
**Audit:** uuid_ledger, resource_ledger, shop_transactions

## Scripts

```bash
npm run dev          # Dev server with hot reload (tsx watch)
npm run build        # Production build (esbuild)
npm run start        # Start production server
npm run check        # TypeScript type check
npm run db:push      # Push schema to database
npm run db:generate  # Generate migration files
npm run db:migrate   # Run migrations
```
