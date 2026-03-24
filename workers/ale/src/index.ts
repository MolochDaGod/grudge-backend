/**
 * ALE - Grudge Studio Edge AI Gateway
 * Cloudflare Worker — ai.grudge-studio.com / grudge-ai-hub.grudge.workers.dev
 *
 * Routes:
 *   GET  /              - Status + available endpoints
 *   POST /ai/chat       - Anthropic Claude proxy
 *   POST /ai/complete   - OpenAI proxy
 *   POST /ai/cf         - Cloudflare Workers AI (llama-3, etc.)
 *   ANY  /api/*         - Proxy to Grudge Backend (api.grudge-studio.com)
 *   GET  /health        - Backend health relay
 */

// Minimal type shim for the Workers AI binding
type AiTextGenerationInput = {
  messages: { role: string; content: string }[];
  max_tokens?: number;
};
type AiTextGenerationOutput = {
  response?: string;
};
interface AiBinding {
  run(
    model: string,
    input: AiTextGenerationInput
  ): Promise<AiTextGenerationOutput>;
}

interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: { contentType?: string };
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface R2Bucket {
  put(key: string, value: ReadableStream | ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<void>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; limit?: number }): Promise<{ objects: { key: string; size: number; etag: string }[] }>;
}

interface Env {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  CF_AI_TOKEN: string;   // cfut_... secret — used as fallback REST token
  CF_ACCOUNT_ID: string; // set in [vars] — ee475864...
  BACKEND_URL: string;
  ALLOWED_ORIGINS: string;
  RATE_LIMIT: KVNamespace;
  AI: AiBinding;         // Cloudflare Workers AI binding
  ASSETS: R2Bucket;      // grudge-assets R2 bucket
}

// ============================================
// CORS
// ============================================

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const isAllowed =
    allowed.includes(origin) ||
    origin.endsWith(".vercel.app") ||
    origin.endsWith(".grudge-studio.com");

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function corsResponse(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

// ============================================
// RATE LIMITING (simple KV-based)
// ============================================

async function checkRateLimit(
  env: Env,
  key: string,
  maxRequests: number,
  windowSec: number
): Promise<{ allowed: boolean; remaining: number }> {
  if (!env.RATE_LIMIT) return { allowed: true, remaining: maxRequests };

  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}:${Math.floor(now / windowSec)}`;
  const current = parseInt((await env.RATE_LIMIT.get(windowKey)) || "0");

  if (current >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  await env.RATE_LIMIT.put(windowKey, String(current + 1), {
    expirationTtl: windowSec * 2,
  });

  return { allowed: true, remaining: maxRequests - current - 1 };
}

// ============================================
// AI HANDLERS
// ============================================

async function handleAnthropicChat(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "AI not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    message: string;
    system?: string;
    model?: string;
    max_tokens?: number;
  };

  if (!body.message) {
    return Response.json({ error: "message required" }, { status: 400 });
  }

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: body.model || "claude-3-5-sonnet-20241022",
      max_tokens: body.max_tokens || 1024,
      system:
        body.system ||
        "You are ALE, the AI assistant for Grudge Warlords - a souls-like MMO with islands, factions, crafting, and 5 classes (Warrior, Mage, Ranger, Rogue, Worge). Help players with game questions, lore, builds, and strategy.",
      messages: [{ role: "user", content: body.message }],
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text();
    console.error("Anthropic error:", anthropicRes.status, err);
    return Response.json(
      { error: "AI request failed", status: anthropicRes.status },
      { status: 502 }
    );
  }

  const data = (await anthropicRes.json()) as {
    content: { type: string; text: string }[];
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  const text = data.content?.[0]?.text || "No response";

  return Response.json({
    success: true,
    response: text,
    model: data.model,
    usage: data.usage,
  });
}

async function handleOpenAIComplete(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return Response.json({ error: "OpenAI not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    prompt: string;
    system?: string;
    model?: string;
    max_tokens?: number;
  };

  if (!body.prompt) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: body.model || "gpt-4o-mini",
      max_tokens: body.max_tokens || 1024,
      messages: [
        {
          role: "system",
          content:
            body.system ||
            "You are ALE, the AI game master for Grudge Warlords.",
        },
        { role: "user", content: body.prompt },
      ],
    }),
  });

  if (!openaiRes.ok) {
    return Response.json(
      { error: "AI request failed", status: openaiRes.status },
      { status: 502 }
    );
  }

  const data = (await openaiRes.json()) as {
    choices: { message: { content: string } }[];
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return Response.json({
    success: true,
    response: data.choices?.[0]?.message?.content || "No response",
    model: data.model,
    usage: data.usage,
  });
}

// ============================================
// R2 ASSET HANDLERS
// ============================================

const ASSETS_PUBLIC = "https://assets.grudge-studio.com";
const ALLOWED_EXTS = new Set(["png","jpg","jpeg","gif","webp","mp3","ogg","wav","glb","gltf","vox"]);
const EXT_MIME: Record<string,string> = {
  png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg",
  gif:"image/gif", webp:"image/webp",
  mp3:"audio/mpeg", ogg:"audio/ogg", wav:"audio/wav",
  glb:"model/gltf-binary", gltf:"model/gltf+json",
  vox:"application/octet-stream",
};

/** PUT /assets/upload?key=players/GRUDGE_XXX/avatar.png
 *  Body = raw file bytes. Returns { publicUrl }.
 *  Or POST /assets/upload with JSON { filename, category, grudgeId } for a metadata-only key reservation. */
async function handleAssetUpload(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return Response.json({ error: "R2 not configured" }, { status: 503 });

  const url = new URL(request.url);

  if (request.method === "PUT") {
    // Direct binary upload — client sends raw bytes
    const key = url.searchParams.get("key");
    if (!key) return Response.json({ error: "key query param required" }, { status: 400 });

    const ext = key.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTS.has(ext)) return Response.json({ error: `File type .${ext} not allowed` }, { status: 400 });

    const contentType = request.headers.get("Content-Type") || EXT_MIME[ext] || "application/octet-stream";
    await env.ASSETS.put(key, request.body as ReadableStream, { httpMetadata: { contentType } });

    return Response.json({
      success: true,
      key,
      publicUrl: `${ASSETS_PUBLIC}/${key}`,
    });
  }

  if (request.method === "POST") {
    // Returns a key the client should use for a subsequent PUT
    const body = await request.json() as { filename?: string; category?: string; grudgeId?: string };
    const { filename, category = "general", grudgeId = "guest" } = body;
    if (!filename) return Response.json({ error: "filename required" }, { status: 400 });

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_EXTS.has(ext)) return Response.json({ error: `File type .${ext} not allowed` }, { status: 400 });

    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `players/${grudgeId}/${category}/${Date.now()}-${safe}`;
    const uploadUrl = `https://ai.grudge-studio.com/assets/upload?key=${encodeURIComponent(key)}`;

    return Response.json({
      success: true,
      key,
      uploadUrl,
      publicUrl: `${ASSETS_PUBLIC}/${key}`,
      method: "PUT",
      contentType: EXT_MIME[ext] || "application/octet-stream",
    });
  }

  return Response.json({ error: "PUT or POST required" }, { status: 405 });
}

/** GET /assets/list?prefix=players/GRUDGE_XXX */
async function handleAssetList(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return Response.json({ error: "R2 not configured" }, { status: 503 });
  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix") || "";
  const result = await env.ASSETS.list({ prefix, limit: 100 });
  return Response.json({
    success: true,
    assets: result.objects.map((o) => ({
      key: o.key,
      size: o.size,
      etag: o.etag,
      url: `${ASSETS_PUBLIC}/${o.key}`,
    })),
  });
}

// ============================================
// CLOUDFLARE WORKERS AI HANDLER
// ============================================

async function handleCFAI(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as {
    messages?: { role: string; content: string }[];
    message?: string;
    system?: string;
    model?: string;
    max_tokens?: number;
  };

  const model = body.model || "@cf/meta/llama-3-8b-instruct";

  // Build messages array
  const messages: { role: string; content: string }[] = [];
  if (body.system) {
    messages.push({ role: "system", content: body.system });
  } else {
    messages.push({
      role: "system",
      content:
        "You are ALE, the AI assistant for Grudge Warlords — a souls-like MMO with islands, factions, crafting, and 5 classes (Warrior, Mage, Ranger, Rogue, Worge).",
    });
  }

  if (body.messages) {
    messages.push(...body.messages);
  } else if (body.message) {
    messages.push({ role: "user", content: body.message });
  } else {
    return Response.json({ error: "message or messages required" }, { status: 400 });
  }

  // Prefer the Workers AI binding (zero cost, no external call)
  if (env.AI) {
    try {
      const result = await env.AI.run(model, {
        messages,
        max_tokens: body.max_tokens || 512,
      });
      return Response.json({
        success: true,
        response: result.response || "",
        model,
        source: "workers-ai-binding",
      });
    } catch (err) {
      console.error("Workers AI binding error:", err);
      // Fall through to REST fallback
    }
  }

  // REST fallback — uses CF_AI_TOKEN secret
  if (!env.CF_AI_TOKEN || !env.CF_ACCOUNT_ID) {
    return Response.json({ error: "Cloudflare AI not configured" }, { status: 503 });
  }

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_AI_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    }
  );

  if (!cfRes.ok) {
    const err = await cfRes.text();
    console.error("CF AI REST error:", cfRes.status, err);
    return Response.json(
      { error: "Cloudflare AI request failed", status: cfRes.status },
      { status: 502 }
    );
  }

  const cfData = (await cfRes.json()) as { result?: { response?: string } };
  return Response.json({
    success: true,
    response: cfData.result?.response || "",
    model,
    source: "workers-ai-rest",
  });
}

// ============================================
// API PROXY
// ============================================

async function proxyToBackend(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const backendUrl = env.BACKEND_URL || "http://localhost:5000";
  const url = `${backendUrl}${path}`;

  const headers = new Headers(request.headers);
  headers.delete("Host");

  const proxyRes = await fetch(url, {
    method: request.method,
    headers,
    body: request.method !== "GET" ? request.body : undefined,
  });

  return new Response(proxyRes.body, {
    status: proxyRes.status,
    headers: proxyRes.headers,
  });
}

// ============================================
// ROUTER
// ============================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(request, env);
    }

    const cors = corsHeaders(request, env);

    // Status page
    if (path === "/" || path === "") {
      return Response.json(
        {
          service: "ALE — Grudge Studio Edge AI Gateway",
          status: "online",
          version: "2.0.0",
          endpoints: {
            "POST /ai/chat": "Anthropic Claude (message, system?, model?, max_tokens?)",
            "POST /ai/complete": "OpenAI GPT (prompt, system?, model?, max_tokens?)",
            "POST /ai/cf": "Cloudflare Workers AI (message|messages, model?, system?, max_tokens?)",
            "ANY  /api/*": "Proxy to Grudge Backend",
            "GET  /health": "Backend health relay",
          },
          features: {
            anthropic: !!env.ANTHROPIC_API_KEY,
            openai: !!env.OPENAI_API_KEY,
            cloudflareAI: !!(env.AI || env.CF_AI_TOKEN),
            r2Storage: !!env.ASSETS,
            rateLimit: !!env.RATE_LIMIT,
          },
          timestamp: new Date().toISOString(),
        },
        { headers: cors }
      );
    }

    // Health relay
    if (path === "/health") {
      try {
        const backend = await proxyToBackend(request, env, "/api/health");
        const data = await backend.json();
        return Response.json(
          { edge: "healthy", backend: data },
          { headers: cors }
        );
      } catch {
        return Response.json(
          { edge: "healthy", backend: "unreachable" },
          { status: 200, headers: cors }
        );
      }
    }

    // AI Chat (Anthropic)
    if (path === "/ai/chat" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateCheck = await checkRateLimit(env, `ai:${ip}`, 30, 60);
      if (!rateCheck.allowed) {
        return Response.json(
          { error: "Rate limit exceeded. Try again in 60s." },
          {
            status: 429,
            headers: {
              ...cors,
              "X-RateLimit-Remaining": String(rateCheck.remaining),
            },
          }
        );
      }
      const res = await handleAnthropicChat(request, env);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...cors },
      });
    }

    // AI Complete (OpenAI)
    if (path === "/ai/complete" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateCheck = await checkRateLimit(env, `ai:${ip}`, 30, 60);
      if (!rateCheck.allowed) {
        return Response.json(
          { error: "Rate limit exceeded. Try again in 60s." },
          { status: 429, headers: cors }
        );
      }
      const res = await handleOpenAIComplete(request, env);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...cors },
      });
    }

    // Assets — R2 upload (PUT/POST) and list (GET)
    if (path === "/assets/upload") {
      const res = await handleAssetUpload(request, env);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...cors },
      });
    }

    if (path === "/assets/list" && request.method === "GET") {
      const res = await handleAssetList(request, env);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...cors },
      });
    }

    // AI CF (Cloudflare Workers AI)
    if (path === "/ai/cf" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateCheck = await checkRateLimit(env, `ai:${ip}`, 60, 60);
      if (!rateCheck.allowed) {
        return Response.json(
          { error: "Rate limit exceeded. Try again in 60s." },
          { status: 429, headers: cors }
        );
      }
      const res = await handleCFAI(request, env);
      return new Response(res.body, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), ...cors },
      });
    }

    // API proxy
    if (path.startsWith("/api/")) {
      try {
        const res = await proxyToBackend(request, env, path);
        return new Response(res.body, {
          status: res.status,
          headers: { ...Object.fromEntries(res.headers), ...cors },
        });
      } catch {
        return Response.json(
          { error: "Backend unreachable" },
          { status: 502, headers: cors }
        );
      }
    }

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: cors }
    );
  },
};
