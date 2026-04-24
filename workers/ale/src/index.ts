/**
 * ALE - Grudge Studio Edge AI Gateway & Legion Hub
 * Cloudflare Worker — ai.grudge-studio.com / grudge-ai-hub.grudge.workers.dev
 *
 * Routes:
 *   GET  /                       - Status + available endpoints
 *   POST /ai/chat                - Anthropic Claude proxy
 *   POST /ai/complete            - OpenAI proxy
 *   POST /ai/cf                  - Cloudflare Workers AI (llama-3, etc.)
 *   ANY  /api/*                  - Proxy to Grudge Backend
 *   GET  /health                 - Backend health relay
 *
 * Legion AI Hub:
 *   POST /debug/log              - Structured debug logging (KV-backed)
 *   GET  /debug/logs             - Retrieve recent debug logs
 *   GET  /accounts/:grudgeId     - Account info proxy to backend
 *   POST /legion/dispatch        - Dispatch AI agent tasks (KV job queue)
 *   GET  /legion/status          - Active agent task status
 *
 * ObjectStore API:
 *   GET  /v1/assets              - List R2 objects
 *   GET  /v1/assets/:id          - Single asset metadata
 *   GET  /v1/assets/:id/file     - Redirect to CDN
 *   POST /assets/upload          - Reserve upload key
 *   PUT  /assets/upload?key=...  - Stream file to R2
 *   GET  /assets/list            - List assets by prefix
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
// OBJECTSTORE v1 API — compatible with GDevelopAssistant objectstore.ts
// GET /v1/assets            — list R2 objects as R2Asset schema
// GET /v1/assets/:id        — single asset metadata
// GET /v1/assets/:id/file   — redirect to CDN
// GET /health               — used by useObjectStoreHealth()
// ============================================

function keyToCategory(key: string): string {
  const parts = key.split("/");
  if (parts.length >= 2) return parts[1]; // players/<category>/...
  const ext = key.split(".").pop()?.toLowerCase() || "";
  if (["mp3","ogg","wav"].includes(ext)) return "sound";
  if (["glb","gltf","vox"].includes(ext)) return "unit";
  if (["png","jpg","webp"].includes(ext)) return "sprite";
  return "general";
}

function objToR2Asset(obj: { key: string; size: number; etag: string }, publicBase: string) {
  const filename = obj.key.split("/").pop() || obj.key;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string,string> = {
    png:"image/png",jpg:"image/jpeg",webp:"image/webp",gif:"image/gif",
    mp3:"audio/mpeg",ogg:"audio/ogg",wav:"audio/wav",
    glb:"model/gltf-binary",gltf:"model/gltf+json",vox:"application/octet-stream",
  };
  return {
    id: encodeURIComponent(obj.key),
    key: obj.key,
    filename,
    mime: mimeMap[ext] || "application/octet-stream",
    size: obj.size,
    sha256: obj.etag || null,
    category: keyToCategory(obj.key),
    tags: [],
    visibility: "public",
    metadata: {},
    file_url: `${publicBase}/${obj.key}`,
    created_at: new Date().toISOString(),
  };
}

async function handleObjectStoreList(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS) return Response.json({ status: "error", message: "R2 not bound" }, { status: 503 });
  const url = new URL(request.url);
  const prefix   = url.searchParams.get("prefix") || "";
  const category = url.searchParams.get("category") || "";
  const limit    = Math.min(parseInt(url.searchParams.get("limit") || "100"), 1000);
  const offset   = parseInt(url.searchParams.get("offset") || "0");

  const result = await env.ASSETS.list({ prefix: prefix || category ? `players/` : "", limit: limit + offset });
  let objects = result.objects;
  if (category) objects = objects.filter(o => keyToCategory(o.key) === category);

  const page = objects.slice(offset, offset + limit);
  return Response.json({
    items: page.map(o => objToR2Asset(o, ASSETS_PUBLIC)),
    count: page.length,
    total: objects.length,
    limit,
    offset,
  });
}

async function handleObjectStoreGet(key: string, env: Env): Promise<Response> {
  if (!env.ASSETS) return Response.json({ error: "R2 not bound" }, { status: 503 });
  const decoded = decodeURIComponent(key);
  const obj = await env.ASSETS.get(decoded);
  if (!obj) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(objToR2Asset({ key: decoded, size: 0, etag: "" }, ASSETS_PUBLIC));
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
// LEGION AI HUB — Debug, Accounts, Task Dispatch
// ============================================

/** POST /debug/log — store structured debug entries in KV */
async function handleDebugLog(request: Request, env: Env): Promise<Response> {
  if (!env.RATE_LIMIT) return Response.json({ error: "KV not configured" }, { status: 503 });

  const body = (await request.json()) as {
    level?: string;
    source?: string;
    message: string;
    data?: unknown;
  };

  if (!body.message) return Response.json({ error: "message required" }, { status: 400 });

  const ts = Date.now();
  const entry = {
    timestamp: new Date(ts).toISOString(),
    level: body.level || "info",
    source: body.source || "unknown",
    message: body.message,
    data: body.data || null,
  };

  const key = `debug:${ts}:${Math.random().toString(36).slice(2, 8)}`;
  await env.RATE_LIMIT.put(key, JSON.stringify(entry), { expirationTtl: 86400 }); // 24h TTL

  return Response.json({ success: true, key, entry });
}

/** GET /debug/logs?limit=50&source=worker — retrieve recent debug logs */
async function handleDebugLogs(request: Request, env: Env): Promise<Response> {
  if (!env.RATE_LIMIT) return Response.json({ error: "KV not configured" }, { status: 503 });

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
  const sourceFilter = url.searchParams.get("source") || "";

  const listed = await env.RATE_LIMIT.list({ prefix: "debug:", limit: limit * 2 });
  const entries: unknown[] = [];

  for (const key of listed.keys.slice(0, limit * 2)) {
    if (entries.length >= limit) break;
    const val = await env.RATE_LIMIT.get(key.name);
    if (!val) continue;
    try {
      const parsed = JSON.parse(val);
      if (sourceFilter && parsed.source !== sourceFilter) continue;
      entries.push(parsed);
    } catch {}
  }

  return Response.json({ logs: entries, count: entries.length });
}

/** GET /accounts/:grudgeId — proxy account info from backend */
async function handleAccountLookup(request: Request, env: Env, grudgeId: string): Promise<Response> {
  try {
    const res = await proxyToBackend(request, env, `/api/users/${encodeURIComponent(grudgeId)}`);
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch {
    return Response.json({ error: "Backend unreachable" }, { status: 502 });
  }
}

/** POST /legion/dispatch — queue an AI agent task */
async function handleLegionDispatch(request: Request, env: Env): Promise<Response> {
  if (!env.RATE_LIMIT) return Response.json({ error: "KV not configured" }, { status: 503 });

  const body = (await request.json()) as {
    agent: string;      // e.g. "code", "art", "lore", "balance", "qa", "mission"
    task: string;       // description of what to do
    priority?: number;  // 0=low, 1=normal, 2=high
    context?: unknown;  // arbitrary context payload
  };

  if (!body.agent || !body.task) {
    return Response.json({ error: "agent and task required" }, { status: 400 });
  }

  const taskId = `task:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id: taskId,
    agent: body.agent,
    task: body.task,
    priority: body.priority ?? 1,
    context: body.context || null,
    status: "queued",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    result: null,
  };

  await env.RATE_LIMIT.put(taskId, JSON.stringify(task), { expirationTtl: 86400 * 7 }); // 7 day TTL

  // Index by agent for listing
  const agentKey = `agent:${body.agent}:tasks`;
  const existing = (await env.RATE_LIMIT.get(agentKey)) || "[]";
  const taskIds: string[] = JSON.parse(existing);
  taskIds.unshift(taskId);
  if (taskIds.length > 100) taskIds.length = 100; // Keep last 100
  await env.RATE_LIMIT.put(agentKey, JSON.stringify(taskIds), { expirationTtl: 86400 * 7 });

  return Response.json({ success: true, task });
}

/** GET /legion/status?agent=code — list agent tasks */
async function handleLegionStatus(request: Request, env: Env): Promise<Response> {
  if (!env.RATE_LIMIT) return Response.json({ error: "KV not configured" }, { status: 503 });

  const url = new URL(request.url);
  const agent = url.searchParams.get("agent") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);

  if (agent) {
    const agentKey = `agent:${agent}:tasks`;
    const raw = (await env.RATE_LIMIT.get(agentKey)) || "[]";
    const taskIds: string[] = JSON.parse(raw);
    const tasks: unknown[] = [];
    for (const tid of taskIds.slice(0, limit)) {
      const val = await env.RATE_LIMIT.get(tid);
      if (val) tasks.push(JSON.parse(val));
    }
    return Response.json({ agent, tasks, count: tasks.length });
  }

  // List all agents
  const agents = ["code", "art", "lore", "balance", "qa", "mission"];
  const summary: Record<string, number> = {};
  for (const a of agents) {
    const raw = (await env.RATE_LIMIT.get(`agent:${a}:tasks`)) || "[]";
    summary[a] = JSON.parse(raw).length;
  }
  return Response.json({ agents: summary });
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
          service: "ALE — Grudge Studio Edge AI Gateway & Legion Hub",
          status: "online",
          version: "3.0.0",
          endpoints: {
            ai: {
              "POST /ai/chat": "Anthropic Claude",
              "POST /ai/complete": "OpenAI GPT",
              "POST /ai/cf": "Cloudflare Workers AI",
            },
            legion: {
              "POST /legion/dispatch": "Queue AI agent task (agent, task, priority?, context?)",
              "GET  /legion/status": "Agent task status (?agent=code&limit=20)",
            },
            debug: {
              "POST /debug/log": "Store debug entry (level?, source?, message, data?)",
              "GET  /debug/logs": "Retrieve logs (?limit=50&source=worker)",
            },
            accounts: {
              "GET /accounts/:grudgeId": "Account info proxy",
            },
            storage: {
              "POST /assets/upload": "Reserve upload key",
              "PUT  /assets/upload?key=...": "Stream file to R2",
              "GET  /assets/list": "List R2 assets",
              "GET  /v1/assets": "ObjectStore API (paginated)",
            },
            proxy: {
              "ANY /api/*": "Proxy to Grudge Backend",
              "GET /health": "Backend health relay",
            },
          },
          features: {
            anthropic: !!env.ANTHROPIC_API_KEY,
            openai: !!env.OPENAI_API_KEY,
            cloudflareAI: !!(env.AI || env.CF_AI_TOKEN),
            r2Storage: !!env.ASSETS,
            rateLimit: !!env.RATE_LIMIT,
            legionHub: true,
            gRPC: true,
          },
          agents: ["code", "art", "lore", "balance", "qa", "mission"],
          timestamp: new Date().toISOString(),
        },
        { headers: cors }
      );
    }

    // Health relay (also used as objectstore health check)
    if (path === "/health") {
      let backendData: unknown = "unreachable";
      try { const b = await proxyToBackend(request, env, "/api/health"); backendData = await b.json(); } catch {}
      return Response.json(
        { status: "ok", service: "grudge-objectstore", edge: "healthy", r2: !!env.ASSETS, backend: backendData },
        { headers: cors }
      );
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

    // ObjectStore v1 API (used by GDevelopAssistant asset gallery)
    if (path === "/v1/assets" && request.method === "GET") {
      const res = await handleObjectStoreList(request, env);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
    }
    if (path.startsWith("/v1/assets/") && request.method === "GET") {
      const encoded = path.replace("/v1/assets/", "");
      if (encoded.endsWith("/file")) {
        // Redirect to CDN
        const key = decodeURIComponent(encoded.replace("/file", ""));
        return Response.redirect(`${ASSETS_PUBLIC}/${key}`, 302);
      }
      const res = await handleObjectStoreGet(encoded, env);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
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

    // ---- Legion AI Hub Routes ----

    // Debug logging
    if (path === "/debug/log" && request.method === "POST") {
      const res = await handleDebugLog(request, env);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
    }
    if (path === "/debug/logs" && request.method === "GET") {
      const res = await handleDebugLogs(request, env);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
    }

    // Account lookup
    if (path.startsWith("/accounts/") && request.method === "GET") {
      const grudgeId = path.replace("/accounts/", "");
      if (!grudgeId) return Response.json({ error: "grudgeId required" }, { status: 400, headers: cors });
      const res = await handleAccountLookup(request, env, grudgeId);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
    }

    // Legion dispatch & status
    if (path === "/legion/dispatch" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const rateCheck = await checkRateLimit(env, `legion:${ip}`, 20, 60);
      if (!rateCheck.allowed) {
        return Response.json({ error: "Rate limit exceeded." }, { status: 429, headers: cors });
      }
      const res = await handleLegionDispatch(request, env);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
    }
    if (path === "/legion/status" && request.method === "GET") {
      const res = await handleLegionStatus(request, env);
      return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors } });
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
