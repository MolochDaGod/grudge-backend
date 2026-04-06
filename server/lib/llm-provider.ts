// ─────────────────────────────────────────────────────────────
// LLM Provider with Fallback Chain
// Anthropic → OpenAI → DeepSeek → Gemini → Ollama → fallback
// ─────────────────────────────────────────────────────────────

import { getGameContext } from "./ai-context.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMOptions {
  preferProvider?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface LLMResult {
  content: string;
  provider: string;
  model: string;
  usage: { input?: number; output?: number };
  fallback?: boolean;
}

interface ProviderConfig {
  name: string;
  enabled: () => boolean;
  model: () => string;
  maxTokens: number;
  call: (messages: LLMMessage[], opts: LLMOptions) => Promise<LLMResult>;
}

// ── Provider configurations ─────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  {
    name: "anthropic",
    enabled: () => !!process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    maxTokens: 4096,
    call: async (messages, opts) => {
      const systemMsg = messages.find((m) => m.role === "system")?.content || "";
      const chatMsgs = messages.filter((m) => m.role !== "system");

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model || PROVIDERS[0].model(),
          max_tokens: opts.maxTokens || PROVIDERS[0].maxTokens,
          system: systemMsg,
          messages: chatMsgs,
          temperature: opts.temperature ?? 0.7,
        }),
      });

      const data = (await resp.json()) as any;
      return {
        content: data.content?.[0]?.text || "",
        provider: "anthropic",
        model: opts.model || PROVIDERS[0].model(),
        usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
      };
    },
  },
  {
    name: "openai",
    enabled: () => !!process.env.OPENAI_API_KEY,
    model: () => process.env.OPENAI_MODEL || "gpt-4o",
    maxTokens: 4096,
    call: async (messages, opts) => {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model || PROVIDERS[1].model(),
          messages,
          max_tokens: opts.maxTokens || PROVIDERS[1].maxTokens,
          temperature: opts.temperature ?? 0.7,
        }),
      });

      const data = (await resp.json()) as any;
      return {
        content: data.choices?.[0]?.message?.content || "",
        provider: "openai",
        model: opts.model || PROVIDERS[1].model(),
        usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
      };
    },
  },
  {
    name: "deepseek",
    enabled: () => !!process.env.DEEPSEEK_API_KEY,
    model: () => process.env.DEEPSEEK_MODEL || "deepseek-chat",
    maxTokens: 4096,
    call: async (messages, opts) => {
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model || "deepseek-chat",
          messages,
          max_tokens: opts.maxTokens || 4096,
          temperature: opts.temperature ?? 0.7,
        }),
      });

      const data = (await resp.json()) as any;
      return {
        content: data.choices?.[0]?.message?.content || "",
        provider: "deepseek",
        model: opts.model || "deepseek-chat",
        usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
      };
    },
  },
  {
    name: "gemini",
    enabled: () => !!process.env.GEMINI_API_KEY,
    model: () => process.env.GEMINI_MODEL || "gemini-2.0-flash",
    maxTokens: 8192,
    call: async (messages, opts) => {
      const key = process.env.GEMINI_API_KEY!;
      const model = opts.model || "gemini-2.0-flash";
      const systemMsg = messages.find((m) => m.role === "system")?.content || "";
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: systemMsg ? { parts: [{ text: systemMsg }] } : undefined,
            contents,
            generationConfig: {
              temperature: opts.temperature ?? 0.7,
              maxOutputTokens: opts.maxTokens || 8192,
            },
          }),
        }
      );

      const data = (await resp.json()) as any;
      return {
        content: data?.candidates?.[0]?.content?.parts?.[0]?.text || "",
        provider: "gemini",
        model,
        usage: {
          input: data?.usageMetadata?.promptTokenCount,
          output: data?.usageMetadata?.candidatesTokenCount,
        },
      };
    },
  },
  {
    name: "ollama",
    enabled: () => !!process.env.OLLAMA_URL,
    model: () => process.env.OLLAMA_MODEL || "llama3.2",
    maxTokens: 4096,
    call: async (messages, opts) => {
      const baseUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      const model = opts.model || process.env.OLLAMA_MODEL || "llama3.2";
      const resp = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: false }),
      });

      const data = (await resp.json()) as any;
      return {
        content: data?.message?.content || "",
        provider: "ollama",
        model,
        usage: { input: data?.prompt_eval_count, output: data?.eval_count },
      };
    },
  },
];

// ── Core chat function with fallback ────────────────────────

export async function chat(
  messages: LLMMessage[],
  opts: LLMOptions = {}
): Promise<LLMResult> {
  let chain = [...PROVIDERS];
  if (opts.preferProvider) {
    const preferred = chain.find((p) => p.name === opts.preferProvider);
    if (preferred) {
      chain = [preferred, ...chain.filter((p) => p.name !== opts.preferProvider)];
    }
  }

  chain = chain.filter((p) => p.enabled());

  if (chain.length === 0) {
    console.warn("[llm] No API keys configured — returning fallback");
    return { content: "", provider: "none", model: "none", usage: {}, fallback: true };
  }

  for (const provider of chain) {
    try {
      return await provider.call(messages, opts);
    } catch (err: any) {
      console.warn(`[llm] ${provider.name} failed: ${err.message}`);
      continue;
    }
  }

  console.error("[llm] All providers exhausted — returning fallback");
  return { content: "", provider: "none", model: "none", usage: {}, fallback: true };
}

// ── JSON extraction helper ──────────────────────────────────

export interface LLMJSONResult extends LLMResult {
  data: any;
  raw?: string;
}

export async function chatJSON(
  messages: LLMMessage[],
  opts: LLMOptions = {}
): Promise<LLMJSONResult> {
  const result = await chat(messages, { ...opts, temperature: opts.temperature ?? 0.3 });
  if (result.fallback) return { data: null, ...result };

  try {
    let text = result.content.trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1].trim();

    const start = text.indexOf("{") !== -1 ? text.indexOf("{") : text.indexOf("[");
    const end =
      text.lastIndexOf("}") !== -1 ? text.lastIndexOf("}") + 1 : text.lastIndexOf("]") + 1;
    if (start !== -1 && end > start) {
      text = text.substring(start, end);
    }

    const data = JSON.parse(text);
    return { data, ...result };
  } catch {
    console.warn("[llm] JSON parse failed, returning raw content");
    return { data: null, raw: result.content, ...result };
  }
}

// ── Status/diagnostics ──────────────────────────────────────

export function getProviderStatus() {
  return PROVIDERS.map((p) => ({
    name: p.name,
    enabled: p.enabled(),
    model: p.enabled() ? p.model() : null,
  }));
}

export { getGameContext };
