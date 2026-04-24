/**
 * grudge-badge-reader
 * ------------------------------------------------------------------
 * Cloudflare Worker that sits in front of gated backend routes and
 * rejects requests without a valid Grudge JWT *before* they reach the
 * origin. On success, forwards the request with identity headers so the
 * backend can trust the caller without re-verifying.
 *
 * Rules:
 *   1. If the request's path does not match any ALLOWED_PREFIXES,
 *      pass through untouched.
 *   2. Else require `Authorization: Bearer <jwt>` or a cookie named
 *      `grudge_auth_token`. If missing, redirect the browser to the
 *      auth gateway (`id.grudge-studio.com/auth/sso-check`) with a
 *      `return=<origUrl>` so the user comes back after login.
 *   3. Verify the JWT signature (HS256 only) against `JWT_SECRET`.
 *      Reject if exp < now, signature mismatch, or alg != HS256.
 *   4. On success, strip the cookie+bearer from the outbound request
 *      and attach `X-Grudge-User-Id` / `X-Grudge-Id` headers so the
 *      backend can short-circuit its own verification.
 *
 * Deploy:  `npx wrangler deploy`
 * Secrets: `npx wrangler secret put JWT_SECRET`
 */

export interface Env {
  JWT_SECRET: string;
  ORIGIN_BASE: string;
  AUTH_GATEWAY_BASE: string;
  ALLOWED_PREFIXES: string;
}

interface JwtPayload {
  sub?: string;
  userId?: string | number;
  grudgeId?: string;
  grudge_id?: string;
  username?: string;
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

const encoder = new TextEncoder();

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyHs256(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const sig = base64UrlDecode(sigB64);
  const ok = await crypto.subtle.verify('HMAC', key, sig, data);
  if (!ok) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  return payload;
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookie = req.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)grudge_auth_token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

function matchesGatedPrefix(path: string, prefixes: string): boolean {
  if (!prefixes) return true;
  return prefixes
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
}

function redirectToGateway(req: Request, env: Env): Response {
  const origUrl = new URL(req.url).toString();
  const gateway = new URL(env.AUTH_GATEWAY_BASE);
  gateway.pathname = '/auth/sso-check';
  gateway.searchParams.set('return', origUrl);
  if (req.method === 'GET' || req.method === 'HEAD') {
    return Response.redirect(gateway.toString(), 302);
  }
  return new Response(
    JSON.stringify({ error: 'unauthorized', login: gateway.toString() }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

async function forwardToOrigin(req: Request, env: Env, payload: JwtPayload): Promise<Response> {
  const reqUrl = new URL(req.url);
  const originUrl = new URL(env.ORIGIN_BASE);
  originUrl.pathname = reqUrl.pathname;
  originUrl.search = reqUrl.search;

  const outHeaders = new Headers(req.headers);
  outHeaders.delete('cookie');
  outHeaders.delete('authorization');
  outHeaders.set('X-Grudge-User-Id', String(payload.userId ?? payload.sub ?? ''));
  outHeaders.set('X-Grudge-Id', String(payload.grudgeId ?? payload.grudge_id ?? ''));
  if (payload.username) outHeaders.set('X-Grudge-Username', String(payload.username));
  outHeaders.set('X-Edge-Verified', 'grudge-badge-reader');

  const init: RequestInit = {
    method: req.method,
    headers: outHeaders,
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
  }

  return fetch(originUrl.toString(), init);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Health/diagnostic endpoint: `/__edge/health` returns 200 regardless of auth.
    if (url.pathname === '/__edge/health') {
      return new Response(
        JSON.stringify({ ok: true, worker: 'grudge-badge-reader', time: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    // If the path is not in the gated list, pass through.
    if (!matchesGatedPrefix(url.pathname, env.ALLOWED_PREFIXES || '')) {
      return forwardToOriginUnauthed(req, env);
    }

    const token = extractToken(req);
    if (!token) return redirectToGateway(req, env);

    if (!env.JWT_SECRET) {
      return new Response('JWT_SECRET not configured', { status: 500 });
    }

    const payload = await verifyHs256(token, env.JWT_SECRET);
    if (!payload) return redirectToGateway(req, env);

    return forwardToOrigin(req, env, payload);
  },
};

async function forwardToOriginUnauthed(req: Request, env: Env): Promise<Response> {
  const reqUrl = new URL(req.url);
  const originUrl = new URL(env.ORIGIN_BASE);
  originUrl.pathname = reqUrl.pathname;
  originUrl.search = reqUrl.search;
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    redirect: 'manual',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
  return fetch(originUrl.toString(), init);
}
