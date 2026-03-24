/**
 * ALE - Grudge Studio Edge AI Gateway
 * Cloudflare Worker at ale.grudge.workers.dev
 *
 * Routes:
 *   GET  /              - Status + available endpoints
 *   POST /ai/chat       - AI chat proxy (Anthropic Claude)
 *   POST /ai/complete   - AI completion proxy (OpenAI)
 *   ANY  /api/*         - Proxy to grudge-backend
 *   GET  /health        - Backend health check relay
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  BACKEND_URL: string;
  ALLOWED_ORIGINS: string;
  RATE_LIMIT: KVNamespace;
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
      model: body.model || "claude-sonnet-4-20250514",
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
          service: "ALE - Grudge Studio Edge AI Gateway",
          status: "online",
          version: "1.0.0",
          endpoints: {
            "POST /ai/chat": "Anthropic Claude chat (message, system?, model?)",
            "POST /ai/complete": "OpenAI completion (prompt, system?, model?)",
            "ANY /api/*": "Proxy to Grudge Backend",
            "GET /health": "Backend health relay",
          },
          features: {
            anthropic: !!env.ANTHROPIC_API_KEY,
            openai: !!env.OPENAI_API_KEY,
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
