# Grudge-WCS Cloudflare Cutover — Operator Handoff

Everything Oz could do from the codebase is done. This file is the
remaining list of **dashboard actions** you have to perform yourself
plus commands to run when you're logged in.

## What's already in the repos (committed but not yet deployed)

- `F:\GitHub\grudge-backend\workers\badge-reader\` — new edge Worker
  (JWT pre-check). Source, wrangler.toml, README included.
- `F:\GitHub\grudge-backend\.github\workflows\deploy.yml` — legacy
  `*.vercel.app` origins dropped from `CORS_ORIGINS`; new Cloudflare
  Pages domains added.
- `F:\GitHub\grudge-backend\deploy\PRODUCTION_OPS.md` — CORS list
  documentation updated.
- `C:\Users\nugye\Documents\1111111\GrudgeBuilder\`
  - `src/utils/grudge-auth.js` + `client/public/grudge-auth-modal.js`
    — stale `grudge-platform.vercel.app` /
    `auth-gateway-otb8qmmyd-grudgenexus.vercel.app` references
    removed.
  - `client/src/lib/grudgeConfig.ts` — **single source of truth** for
    every service URL. Import from here everywhere; env overrides via
    `VITE_*`.
  - `client/public/_redirects` + `client/public/_headers` — Pages-style
    rewrites and headers (identical intent to the old `vercel.json`).
  - `client/public/logout-hard.html` — user-facing purge page that
    clears localStorage/sessionStorage/cookies and bounces to
    `id.grudge-studio.com`.
  - `.github/workflows/pages-deploy.yml` — Cloudflare Pages deploy
    action (uses `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
    GitHub secrets).
- `F:\GitHub\GDevelopAssistant-full-latest\` (legacy local folder name for the
  grudgeDot launcher — the GitHub repo is `MolochDaGod/grudgedot-launcher`;
  rename the local folder when convenient):
  - `public/_redirects`, `public/_headers`
  - `client/src/lib/grudgeConfig.ts`
  - `.github/workflows/pages-deploy.yml` (projectName
    `grudgedot-launcher`).

> Naming rule: every user-visible surface calls this app **grudgeDot**, never
> "GDevelop" or "GDevelopAssistant". Those names survive only as legacy disk
> paths and MUST NOT appear in UI, docs, Pages project names, or domain names.

## What still needs to happen (in order)

### Step 1 — Warlord-Crafting-Suite file copy (2 min)
`C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\` is on a
different Windows user profile that Oz can't write to. Copy these from
GrudgeBuilder into the WCS tree:

```powershell
Copy-Item `
  "C:\Users\nugye\Documents\1111111\GrudgeBuilder\client\src\lib\grudgeConfig.ts" `
  "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\client\src\lib\grudgeConfig.ts"

Copy-Item `
  "C:\Users\nugye\Documents\1111111\GrudgeBuilder\client\public\_redirects" `
  "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\client\public\_redirects"

Copy-Item `
  "C:\Users\nugye\Documents\1111111\GrudgeBuilder\client\public\_headers" `
  "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\client\public\_headers"

Copy-Item `
  "C:\Users\nugye\Documents\1111111\GrudgeBuilder\client\public\logout-hard.html" `
  "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\client\public\logout-hard.html"
```

Also copy the `pages-deploy.yml` into WCS's `.github/workflows/` and
change `projectName` to `grudge-wcs`, directory to `dist/public` (per
its `vercel.json` output).

### Step 2 — GitHub secrets on each repo (5 min)
On each of: `MolochDaGod/Grudge-Builder`,
`MolochDaGod/Warlord-Crafting-Suite`,
`MolochDaGod/grudgedot-launcher`, set repo secrets:

- `CLOUDFLARE_API_TOKEN` — create at
  https://dash.cloudflare.com/profile/api-tokens with scopes:
  Account · Cloudflare Pages · Edit; Account · Workers Scripts · Edit;
  Zone · DNS · Edit; Zone · Zone · Read. Name it `oz-full-cf-access`.
- `CLOUDFLARE_ACCOUNT_ID` — copy from the right sidebar of the CF
  dashboard.

### Step 3 — Cloudflare Tunnel health check (2 min)
On the VPS:

```bash
cd /opt/grudge-backend
docker compose ps
docker compose logs --tail=30 cloudflared
```

Confirm hostnames in Zero Trust → Networks → Tunnels:

- `api.grudge-studio.com` → `http://api:5000`
- `ws.grudge-studio.com` → `http://api:5000`
- Add **new** route: `id.grudge-studio.com` → `http://api:5000`
  (auth flows live on the same Express app at `/auth/*`).

### Step 4 — DNS: remove stale records (15 min)
Open CF DNS dashboard for `grudge-studio.com` and verify / clean:

- `api` + `ws` — **CNAME** to `<tunnel-id>.cfargotunnel.com`, orange
  cloud **ON**. Delete any old `A` record to the VPS public IP.
- `id` — add **CNAME** to the same `<tunnel-id>.cfargotunnel.com`
  until Phase 5 of the plan completes.
- `assets` — already R2 public bucket alias; leave.
- `ale` — already points at the ALE Worker; leave.
- `edge` — **add** CNAME to
  `grudge-badge-reader.<your-subdomain>.workers.dev` once Step 6
  is done.
- For Pages custom domains (`client`, `wcs`, `grudgedot`,
  `grudgewarlords.com`, `www.grudgewarlords.com`): these are added
  automatically when you attach the domain to the Pages project
  (Step 7).

Grab a snapshot of the zone before editing:

```powershell
# From any machine with your CF API token
$env:CF_API_TOKEN = "<token>"
curl -H "Authorization: Bearer $env:CF_API_TOKEN" `
  "https://api.cloudflare.com/client/v4/zones/<zone-id>/dns_records?per_page=200" `
  | Out-File -Encoding utf8 `
    "F:\GitHub\grudge-backend\deploy\dns-snapshot-$(Get-Date -Format yyyyMMdd).json"
```

### Step 5 — Deploy the badge-reader Worker (5 min)

```powershell
cd F:\GitHub\grudge-backend\workers\badge-reader
npm install
npx wrangler login
npx wrangler secret put JWT_SECRET
# Paste the same JWT_SECRET that the backend uses.
npx wrangler deploy
```

Then in the dashboard: Workers & Pages → `grudge-badge-reader` →
Triggers → Add Route → `edge.grudge-studio.com/*`, zone
`grudge-studio.com`. Add the DNS CNAME from Step 4.

Smoke test:

```powershell
curl https://edge.grudge-studio.com/__edge/health
# → {"ok":true,"worker":"grudge-badge-reader","time":"..."}
```

### Step 6 — Create the four Pages projects (10 min)
Dashboard → Workers & Pages → **Create** → **Pages** → Connect to Git.
For each repo, set the build settings below. After first deploy,
attach the custom domain under **Custom domains**.

| Project | Repo | Build command | Output dir | Custom domain(s) |
| --- | --- | --- | --- | --- |
| `grudge-auth-gateway` | `MolochDaGod/Warlord-Crafting-Suite` (subdir `auth-gateway`) | `npm ci && npm run build` | `auth-gateway/dist` | `id.grudge-studio.com` |
| `grudge-client` | `MolochDaGod/Grudge-Builder` | `npm run build:client` | `client/dist` | `grudgewarlords.com`, `www.grudgewarlords.com`, `client.grudge-studio.com` |
| `grudge-wcs` | `MolochDaGod/Warlord-Crafting-Suite` | `npm run build` | `dist/public` | `wcs.grudge-studio.com` |
| `grudgedot-launcher` | `MolochDaGod/grudgedot-launcher` | `npm run build` | `dist/public` | `grudgedot.grudge-studio.com` |

Pages env vars on each project (paste in UI):

```
VITE_AUTH_GATEWAY_URL=https://id.grudge-studio.com
VITE_API_URL=https://api.grudge-studio.com
VITE_WS_URL=wss://api.grudge-studio.com
VITE_ASSETS_URL=https://assets.grudge-studio.com
VITE_AI_URL=https://ale.grudge-studio.com
VITE_BADGE_READER_URL=https://edge.grudge-studio.com
```

### Step 7 — DNS cutover, one domain at a time
Order matters — start with the lowest-traffic domain so breakage is
contained:

1. `wcs.grudge-studio.com` — attach to `grudge-wcs` Pages project.
   Validate `https://wcs.grudge-studio.com/` loads.
2. `grudgedot.grudge-studio.com` — attach to `grudgedot-launcher`.
3. `id.grudge-studio.com` — **most important**. Attach to
   `grudge-auth-gateway` Pages project (not the tunnel anymore).
   Before flipping, deploy the gateway so `sso-check` etc. resolve.
   If the gateway is still a server-rendered app, keep the tunnel
   CNAME instead and skip this step.
4. `grudgewarlords.com` + `www.grudgewarlords.com` +
   `client.grudge-studio.com` — last. Attach to `grudge-client`.

After each cutover, validate:

- Log out + log back in via Discord / Puter / password.
- Character list loads (`/api/characters` must 200).
- Editor renders (requires COEP/COOP headers — confirmed in
  `_headers`).

### Step 8 — Remove custom domains from Vercel (5 min)
For **every** Vercel project, open Settings → Domains and remove any
of: `grudgewarlords.com`, `www.grudgewarlords.com`,
`client.grudge-studio.com`, `wcs.grudge-studio.com`,
`grudgedot.grudge-studio.com`, `id.grudge-studio.com`,
`grudge-studio.com`. The project stays for PR previews; only the
production alias goes away.

Suggested: rename the Vercel projects to `*-previews` so no one
assumes they're live (e.g. `grudgedot-launcher` →
`grudgedot-launcher-previews`).

### Step 9 — Client-side purge comms (1 min)
Point anyone with stuck logins at
`https://grudgewarlords.com/logout-hard.html` (after the
`grudge-client` Pages project goes live). Add this URL to the support
auto-response message.

### Step 10 — Puter dashboard cleanup (5 min)
https://puter.com/app/developer → revoke every "ghost" app instance
that isn't the single canonical `grudge-studio` app. Regenerate
credentials if any are suspect, then update the worker secret
`PUTER_AUTH_TOKEN` in `auth-puter-bridge` via
`npx wrangler secret put PUTER_AUTH_TOKEN --cwd workers/auth-puter-bridge`.

### Step 11 — JWT_SECRET rotation (LAST)
**Only after** every client has been migrated and `grudge-badge-reader`
is live. This will log everyone out, so pick an off-peak hour and
post in Discord first.

```bash
# On VPS
cd /opt/grudge-backend
export NEW=$(openssl rand -hex 32)
# Set it in CI/CD secrets first (GitHub Actions `JWT_SECRET`)
# Then:
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW|" .env
docker compose up -d --build api
# Push same value to the Worker
cd workers/badge-reader
echo $NEW | npx wrangler secret put JWT_SECRET
```

Follow the rest of `F:\GitHub\grudge-launch\LAUNCH_CHECKLIST.md`
Phase 0 for the other secrets (Supabase, Crossmint, Discord, Google,
Twilio, Solana RPC).

---

## Crafting UI + Weapon Trees (added 2026-04-24)

Two files landed in the launcher repo:

- `F:\GitHub\GDevelopAssistant-full-latest\client\src\pages\warlord-suite\CraftingPage.unified.tsx` — merges the WCS `/crafting` shell (per-profession backgrounds, amber HSL tokens, 3-column layout, T0–T8 tier rail, Mystic enchant sockets) with the per-profession content UI (category tabs, Grudge Infusion panel with Blood/Void/Iron essences and 3-stack intensity). Wires up the launcher's `useCraftingRecipes`/`useCraftingQueue`/`useStartCraft`/`useCompleteCraft` hooks.
- `F:\GitHub\GDevelopAssistant-full-latest\shared\wcs\definitions\weaponSkills.ts` — expanded from 5 unique + 5 aliased weapon trees to **18 unique trees** covering every entry in `WEAPON_TYPES`: SWORD, TWO_H_SWORD, AXE, TWO_H_AXE, BOW, CROSSBOW, GUN, STAFF, DAGGER, MACE, HAMMER, SPEAR, LANCE, WAND, TOME, SCYTHE, SHIELD, OFF_HAND_RELIC. **11 skills per weapon** mapped to **5 hotkey slots** (2/2/3/2/2):
  - Slot 1 (hotkey 1) — **Standard Attack**: 2 choices per weapon, marked `isStandardAttack: true`. Player picks 1 in the build screen.
  - Slot 2 (hotkey 2) — Basic: 2 skills
  - Slot 3 (hotkey 3) — Power: 3 skills
  - Slot 4 (hotkey 4) — Utility: 2 skills
  - Slot 5 (hotkey 5) — Ultimate: 2 skills, max 3 upgrades each
  New helpers: `getStandardAttackOptions(weaponType)`, `isValidStandardAttack(weaponType, skillId)`. `getSkillsForSlot` and `getMaxUpgradesForSlot` accept `1 | 2 | 3 | 4 | 5`. `CharacterSkillLoadout.slots` and `StoredSkillLoadout.slots` include slot 5.
- `F:\GitHub\GDevelopAssistant-full-latest\client\src\pages\warlord-suite\WeaponSkillsPage.tsx` — slot header now shows a `[N]` hotkey badge beside each slot name, iterates slots 1–5, and displays the “Pick one of two auto-attacks” hint under the Standard row. `WEAPON_ICONS` map includes all 18 weapon types.

### Next steps
1. Swap the current `CraftingPage.tsx` export for `CraftingPage.unified.tsx` in the warlord-suite router once the backgrounds are uploaded (see item 2). Either rename the files or update the route:
   ```powershell
   Rename-Item F:\GitHub\GDevelopAssistant-full-latest\client\src\pages\warlord-suite\CraftingPage.tsx CraftingPage.legacy.tsx
   Rename-Item F:\GitHub\GDevelopAssistant-full-latest\client\src\pages\warlord-suite\CraftingPage.unified.tsx CraftingPage.tsx
   ```
2. Create `public/assets/professions/` and drop 7 background PNGs: `bg-universal.png`, `bg-miner.png`, `bg-forester.png`, `bg-mystic.png`, `bg-chef.png`, `bg-engineer.png`, `bg-refinery.png`. The page uses a gradient fallback, so it renders without them, but the full aesthetic requires the images.
3. Mirror both files into the WCS tree when you're on the `jonbe` profile:
   ```powershell
   $src = "F:\GitHub\GDevelopAssistant-full-latest"
   $wcs = "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite"
   Copy-Item "$src\client\src\pages\warlord-suite\CraftingPage.unified.tsx" `
             "$wcs\client\src\pages\warlord-suite\CraftingPage.unified.tsx"
   Copy-Item "$src\shared\wcs\definitions\weaponSkills.ts" `
             "$wcs\shared\wcs\definitions\weaponSkills.ts"
   ```
4. Gruda Wars heroes (`grudaWarsHeroes.ts`) don't currently reference `weaponSkills.ts` by weapon type. Next pass: have each hero's loadout resolve its 4 active skills through `getSkillsForSlot(weaponType, slot)` so that swapping a hero's weapon automatically swaps their kit.
5. The `render.yaml` and `railway.toml` deletions for WCS (confirmed "yes" on Q4) are also a `jonbe`-profile step:
   ```powershell
   Remove-Item "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\render.yaml"
   Remove-Item "C:\Users\jonbe\OneDrive\GRUDGE-webgl\Warlord-Crafting-Suite\railway.toml"
   ```
6. JWT_SECRET rotation (confirmed "yes" on Q3) proceeds as documented in Step 11 above. Post a Discord notice first — this force-logs every active session.

## Canonical WCS frontends (added 2026-04-24)
Policy: **character creation, Arsenal, and /home** all live canonically on `warlord-crafting-suite.vercel.app`. Other apps redirect users there instead of maintaining their own copies.
### Shipped (writable repos)
- `GrudgeBuilder/client/src/components/WcsRedirect.tsx` — reusable redirect shim. Reads `VITE_WCS_URL` (defaults to `https://warlord-crafting-suite.vercel.app`), builds `?return=<this-origin>/<returnPath>`, auto-redirects after 600ms with a branded "Opening WCS" splash + manual fallback button.
- `GrudgeBuilder/client/src/pages/home.tsx` — 5-line shim → WCS `/home`. Original preserved as `home.legacy.tsx`.
- `GrudgeBuilder/client/src/pages/ArsenalPage.tsx` — shim → WCS `/arsenal`. Original preserved as `ArsenalPage.legacy.tsx`.
- `grudgedot-launcher/client/src/components/WcsRedirect.tsx` — mirror.
- `grudgedot-launcher/client/src/pages/warlord-suite/ArsenalPage.tsx` — shim → WCS `/arsenal`. Original preserved as `ArsenalPage.legacy.tsx`.
No `App.tsx` router edits needed — the shims preserve the same default-export names (`HomePage`, `ArsenalPage`). To revert: swap the `.tsx` and `.legacy.tsx` filenames.
### One-way by design (for now)
The redirect is one-way: caller apps send users to WCS with `?return=<origin>`, but WCS does NOT currently honor the param. After finishing at WCS the user stays there or uses the browser back button.
An attempt to land a round-trip PR on `MolochDaGod/Warlord-Crafting-Suite` (branch `feat/return-param-handoff`) was abandoned — the `GITHUB_TOKEN` in `secret.txt` is 401 on writes. The empty branch was left on the remote; it can be deleted from the GitHub UI if unwanted (Branches → trash icon).
If someone wants to add the round-trip later, the patch is small:
1. In `WCS/client/src/pages/CharacterCreation.tsx`, read `new URLSearchParams(window.location.search).get('return')` on mount.
2. Validate the host is in an allowlist (`*.grudge-studio.com`, `*.grudgewarlords.com`, `*.pages.dev`, `*.vercel.app`, `localhost`).
3. After the successful `setCharacter(character)` call (around line 290), if a valid return URL exists, append `?character_id=<id>` and redirect to it instead of `setLocation('/dashboard')`.
4. Do the same on the Cancel button when `step === 'race'`.
Leaving WCS unchanged is fine — one-way redirect captures ~90% of the value (single source of truth for the UI, no duplication, users just click back when done).
## Rollback plan
- Every DNS change is a CNAME flip — just point the record back at
  `cname.vercel-dns.com` for the corresponding Vercel project.
- Do not rotate `JWT_SECRET` until the Pages cutover is green.
- The Worker can be disabled instantly in the dashboard (Triggers →
  Remove Route) without redeploying.
- Vercel projects are still there until you delete them manually, so
  `alias` can be re-added if needed.
