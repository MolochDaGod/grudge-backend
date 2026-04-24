# grudge-badge-reader

Edge Worker that gates selected paths on `edge.grudge-studio.com` with a JWT
check before forwarding to the backend origin (`api.grudge-studio.com`).

## Deploy

```powershell
cd F:\GitHub\grudge-backend\workers\badge-reader
npm install
npx wrangler login                  # one-time
npx wrangler secret put JWT_SECRET  # paste the backend's JWT_SECRET
npx wrangler deploy
```

After first deploy, the Worker is reachable at
`https://grudge-badge-reader.<your-subdomain>.workers.dev`. Attach the
production route in the Cloudflare dashboard:

1. Workers & Pages → `grudge-badge-reader` → Triggers → **Add Route**
2. Route: `edge.grudge-studio.com/*`
3. Zone: `grudge-studio.com`

Then add a DNS CNAME record (orange cloud ON):

```
edge   CNAME   grudge-badge-reader.<your-subdomain>.workers.dev
```

## Configuration

Environment values live in `wrangler.toml` (`[vars]` block) and as Worker
secrets:

| Key                 | Type   | Default                               | Purpose                                    |
| ------------------- | ------ | ------------------------------------- | ------------------------------------------ |
| `JWT_SECRET`        | secret | —                                     | HS256 signing secret (shared with backend) |
| `ORIGIN_BASE`       | var    | `https://api.grudge-studio.com`       | Upstream host                              |
| `AUTH_GATEWAY_BASE` | var    | `https://id.grudge-studio.com`        | Where unauthed users get redirected        |
| `ALLOWED_PREFIXES`  | var    | `/admin,/editor,/island,/wallet,...`  | Only these paths are gated                 |

## Behavior

- `GET /__edge/health` — returns 200 always (uptime probe).
- Path **not** in `ALLOWED_PREFIXES` → pass-through unauthenticated.
- Path gated + no token → 302 redirect to
  `id.grudge-studio.com/auth/sso-check?return=<orig>` for browsers, or
  401 JSON for API callers.
- Path gated + invalid/expired token → same 302 / 401.
- Path gated + valid token → request forwarded with
  `X-Grudge-User-Id`, `X-Grudge-Id`, `X-Grudge-Username`,
  `X-Edge-Verified: grudge-badge-reader` headers; `Authorization` and
  cookie stripped so the origin doesn't re-verify.

## Testing

```powershell
# health
curl https://grudge-badge-reader.<subdomain>.workers.dev/__edge/health

# anon request to gated path (should 302)
curl -i https://grudge-badge-reader.<subdomain>.workers.dev/admin/ping

# authed request
$token = "<jwt>"
curl -H "Authorization: Bearer $token" https://grudge-badge-reader.<subdomain>.workers.dev/admin/ping
```
