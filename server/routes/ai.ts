// ─────────────────────────────────────────────────────────────
// AI Agent Routes — consolidated from legacy ai-agent microservice
// Covers: chat, missions, companions, factions, lore, art,
//         balance, dev, narrate, and LLM diagnostics.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { chat, chatJSON, getProviderStatus, getGameContext } from "../lib/llm-provider.js";
import {
  generateMission,
  assignProfile,
  getAvailableStyles,
  BEHAVIOR_PROFILES,
  FACTION_DATA,
  PROMPTS,
  SYSTEM_CONTEXT,
} from "../lib/ai-context.js";

const router = Router();

const MISSION_TYPES = ["harvesting", "fighting", "sailing", "competing"];
const VALID_CLASSES = ["warrior", "mage", "ranger", "worge"];

// ============================================
// GET /ai/health
// ============================================

router.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-agent", version: SYSTEM_CONTEXT.version });
});

// ============================================
// GET /ai/context
// ============================================

router.get("/context", (_req, res) => res.json(SYSTEM_CONTEXT));

// ============================================
// GET /ai/llm/status — provider diagnostics
// ============================================

router.get("/llm/status", (_req, res) => {
  res.json(getProviderStatus());
});

// ============================================
// POST /ai/chat — general purpose chat
// ============================================

router.post("/chat", async (req, res, next) => {
  try {
    const { message, context, provider, history, temperature, maxTokens } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const messages = [
      {
        role: "system" as const,
        content: [
          "You are the Grudge Studio AI assistant for Grudge Warlords.",
          "You help with game development, player support, lore, combat mechanics, and tooling.",
          "Be concise, technical, and production-ready. Use code blocks when appropriate.",
          getGameContext(),
          context || "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      ...(history || []).map((h: any) => ({ role: h.role, content: h.content })),
      { role: "user" as const, content: message },
    ];

    const result = await chat(messages, {
      preferProvider: provider,
      temperature: temperature || 0.7,
      maxTokens: maxTokens || 2048,
    });

    if (result.fallback) {
      return res.json({
        content: "AI providers are currently unavailable. Please try again later.",
        provider: "fallback",
        model: "none",
        fallback: true,
      });
    }

    res.json({ content: result.content, provider: result.provider, model: result.model, usage: result.usage });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/chat/json — structured JSON output
// ============================================

router.post("/chat/json", async (req, res, next) => {
  try {
    const { message, schema, context, provider } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const messages = [
      {
        role: "system" as const,
        content: [
          "You are the Grudge Studio AI. Return ONLY valid JSON matching the requested schema.",
          "No markdown, no explanation, just the JSON object.",
          getGameContext(),
          context || "",
          schema ? `Expected JSON schema: ${JSON.stringify(schema)}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      { role: "user" as const, content: message },
    ];

    const result = await chatJSON(messages, { preferProvider: provider, temperature: 0.3 });
    res.json({ data: result.data, provider: result.provider, model: result.model });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/mission/generate
// ============================================

function templateFallback(character: any, type: string | null, count: number) {
  const seed = Date.now();
  const missions: any[] = [];
  if (type) {
    const n = Math.min(Math.max(1, count), 11);
    for (let i = 0; i < n; i++) missions.push(generateMission(character, type, seed + i * 7919));
  } else {
    MISSION_TYPES.forEach((t, i) => missions.push(generateMission(character, t, seed + i * 7919)));
  }
  return missions;
}

router.post("/mission/generate", async (req, res, next) => {
  try {
    const { character, type, count = 1, useLLM = false } = req.body;
    if (!character) return res.status(400).json({ error: "character required" });
    if (type && !MISSION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MISSION_TYPES.join(", ")}` });
    }

    if (!useLLM) {
      return res.json({ missions: templateFallback(character, type, count), source: "template", generated_at: new Date().toISOString() });
    }

    const n = type ? Math.min(Math.max(1, count), 11) : 4;
    const examples = templateFallback(character, type, 2);

    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.mission() },
        {
          role: "user",
          content: `Generate ${n} unique missions for a level ${character.level || 1} ${character.class || "warrior"} in the ${character.faction || "pirate"} faction.${type ? ` Type: ${type}` : " Generate one per type: harvesting, fighting, sailing, competing."}\n\nHere are example missions for reference:\n${JSON.stringify(examples, null, 2)}\n\nReturn a JSON array of ${n} mission objects.`,
        },
      ],
      { temperature: 0.8 }
    );

    if (result.fallback) {
      return res.json({ missions: templateFallback(character, type, count), source: "template_fallback", generated_at: new Date().toISOString() });
    }

    const missions = Array.isArray(result.data) ? result.data : [result.data];
    res.json({ missions, source: "llm", provider: result.provider, model: result.model, usage: result.usage, generated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/companion/assign
// ============================================

router.post("/companion/assign", (req, res) => {
  const { class: cls, style = "balanced", faction, gouldstone_id } = req.body;
  if (!cls) return res.status(400).json({ error: "class required" });
  const normalized = cls.toLowerCase();
  if (!VALID_CLASSES.includes(normalized)) {
    return res.status(400).json({ error: `class must be one of: ${VALID_CLASSES.join(", ")}` });
  }
  const profile = assignProfile(normalized, style, faction);
  res.json({ gouldstone_id: gouldstone_id || null, profile, available_styles: getAvailableStyles(normalized) });
});

// ============================================
// GET /ai/companion/profiles/:cls
// ============================================

router.get("/companion/profiles/:cls", (req, res) => {
  const cls = req.params.cls.toLowerCase();
  if (!VALID_CLASSES.includes(cls)) {
    return res.status(400).json({ error: `class must be one of: ${VALID_CLASSES.join(", ")}` });
  }
  res.json({ class: cls, profiles: BEHAVIOR_PROFILES[cls], styles: getAvailableStyles(cls) });
});

// ============================================
// POST /ai/companion/interact — LLM dialogue
// ============================================

router.post("/companion/interact", async (req, res, next) => {
  try {
    const { class: cls, style = "balanced", faction, situation = "idle", context, player_name } = req.body;
    if (!cls) return res.status(400).json({ error: "class required" });
    const normalized = cls.toLowerCase();
    if (!VALID_CLASSES.includes(normalized)) {
      return res.status(400).json({ error: `class must be one of: ${VALID_CLASSES.join(", ")}` });
    }

    const profile = assignProfile(normalized, style, faction);

    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.companion() },
        {
          role: "user",
          content: `Generate dialogue for a Gouldstone companion.\n\nCompanion profile:\n- Class: ${normalized}\n- Style: ${style}\n- Faction: ${faction || "pirate"}\n- Combat style: ${profile.combat_style}\n- Dialogue tone: ${profile.dialogue_tone}\n- Faction prefix: ${profile.faction_dialogue.prefix}\n\nSituation: ${situation}\n${context ? `Context: ${context}` : ""}\n${player_name ? `Player name: ${player_name}` : ""}\n\nReturn JSON: { "dialogue": "...", "action_hint": "...", "emote": "...", "context": "${situation}" }`,
        },
      ],
      { temperature: 0.9 }
    );

    if (result.fallback) {
      const fallbackLines: Record<string, string> = {
        combat: "I've got your back!",
        idle: "Ready when you are.",
        harvesting: "This spot looks promising.",
        sailing: "Steady as she goes.",
        travel: "The road ahead looks clear.",
      };
      return res.json({
        dialogue: `${profile.faction_dialogue.prefix} ${fallbackLines[situation] || fallbackLines.idle}`.trim(),
        action_hint: null,
        emote: null,
        context: situation,
        profile,
        source: "fallback",
      });
    }

    res.json({ ...(result.data || { dialogue: result.raw }), profile, source: "llm", provider: result.provider, model: result.model, usage: result.usage });
  } catch (err) {
    next(err);
  }
});

// ============================================
// GET /ai/faction/:faction/intel
// ============================================

router.get("/faction/:faction/intel", (req, res) => {
  const faction = req.params.faction.toLowerCase();
  const base = FACTION_DATA[faction] || { strengths: [], weakness: null, lore: "Unknown faction." };
  res.json({
    faction,
    lore: base.lore,
    strengths: base.strengths,
    weakness: base.weakness,
    intel: {
      active_crews: null,
      active_missions_today: null,
      completed_missions_today: null,
      threat_level: "unknown",
      momentum: "unknown",
    },
    generated_at: new Date().toISOString(),
  });
});

// ============================================
// GET /ai/faction/standings/all
// ============================================

router.get("/faction/standings/all", (_req, res) => {
  const factions = Object.keys(FACTION_DATA);
  const standings = factions.map((f) => ({ faction: f, crews: 0, missions_today: 0, score: 0 }));
  res.json({ standings, generated_at: new Date().toISOString() });
});

// ============================================
// POST /ai/lore/generate
// ============================================

const VALID_LORE_TYPES = ["quest", "npc_dialogue", "item_description", "boss_intro", "location", "event"];

router.post("/lore/generate", async (req, res, next) => {
  try {
    const { type, faction, tier, context, count = 1 } = req.body;
    if (!type) return res.status(400).json({ error: "type required" });
    if (!VALID_LORE_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_LORE_TYPES.join(", ")}` });
    }

    const n = Math.min(Math.max(1, count), 5);
    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.lore() },
        {
          role: "user",
          content: `Generate ${n} ${type.replace("_", " ")} entries.\nFaction: ${faction || "any"}\n${tier ? `Tier: ${tier}` : ""}\n${context ? `Additional context: ${context}` : ""}\n\nReturn JSON array of ${n} objects.`,
        },
      ],
      { temperature: 0.8 }
    );

    if (result.fallback) return res.json({ content: [], fallback: true, message: "LLM unavailable" });
    res.json({ type, content: result.data || result.raw, faction: faction || "any", provider: result.provider, model: result.model, usage: result.usage, generated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/art/prompt
// ============================================

const VALID_ART_CATEGORIES = ["character", "weapon", "armor", "monster", "environment", "prop", "vehicle", "effect"];

router.post("/art/prompt", async (req, res, next) => {
  try {
    const { category, description, service, race, class: cls, faction, tier, count = 1 } = req.body;
    if (!category || !description) return res.status(400).json({ error: "category and description required" });
    if (!VALID_ART_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_ART_CATEGORIES.join(", ")}` });
    }

    const n = Math.min(Math.max(1, count), 5);
    const svc = service || "meshy";

    const contextParts = [`Category: ${category}`, `Target service: ${svc}`, `Description: ${description}`, race ? `Race: ${race}` : null, cls ? `Class: ${cls}` : null, faction ? `Faction: ${faction}` : null, tier ? `Quality tier: ${tier}` : null].filter(Boolean).join("\n");

    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.art() },
        { role: "user", content: `Generate ${n} 3D model prompt(s) for Grudge Warlords.\n\n${contextParts}\n\nReturn JSON array of ${n} objects.` },
      ],
      { temperature: 0.7 }
    );

    if (result.fallback) return res.json({ prompts: [], fallback: true, message: "LLM unavailable" });
    res.json({ category, service: svc, prompts: result.data || result.raw, provider: result.provider, model: result.model, usage: result.usage, generated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/balance/analyze
// ============================================

router.post("/balance/analyze", async (req, res, next) => {
  try {
    const { focus = "all" } = req.body;

    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.balance() },
        {
          role: "user",
          content: `Analyze game balance${focus !== "all" ? ` focused on ${focus}` : ""}.\n\nDATABASE UNAVAILABLE — analyze based on game design knowledge only.\n\nReturn JSON: { "summary": "...", "severity": "...", "issues": [...], "recommendations": [...], "metrics": {...} }`,
        },
      ],
      { temperature: 0.2 }
    );

    if (result.fallback) return res.json({ summary: "LLM unavailable", stats: {}, fallback: true });
    res.json({ analysis: result.data || result.raw, provider: result.provider, model: result.model, usage: result.usage, analyzed_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/dev/review
// ============================================

router.post("/dev/review", async (req, res, next) => {
  try {
    const { code, filename, context } = req.body;
    if (!code) return res.status(400).json({ error: "code required" });

    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.dev() },
        {
          role: "user",
          content: `Review this script${filename ? ` (${filename})` : ""}${context ? `\nContext: ${context}` : ""}:\n\n\`\`\`\n${code}\n\`\`\`\n\nReturn JSON: { "summary": "...", "issues": [...], "suggestions": [...], "score": 0-100 }`,
        },
      ],
      { temperature: 0.2 }
    );

    if (result.fallback) return res.json({ review: "LLM unavailable — manual review required", issues: [], suggestions: [], fallback: true });
    res.json({ review: result.data || result.raw, provider: result.provider, model: result.model, usage: result.usage });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/dev/generate
// ============================================

router.post("/dev/generate", async (req, res, next) => {
  try {
    const { type, name, description, references } = req.body;
    if (!name || !description) return res.status(400).json({ error: "name and description required" });

    const refText = references?.length ? `\nReference: ${references.join(", ")}` : "";

    const result = await chatJSON(
      [
        { role: "system", content: PROMPTS.dev() },
        {
          role: "user",
          content: `Generate a ${type || "addon"} called "${name}".\n\nDescription: ${description}${refText}\n\nReturn JSON: { "files": [{ "filename": "...", "content": "...", "description": "..." }], "setup_instructions": [...] }`,
        },
      ],
      { maxTokens: 8192, temperature: 0.3 }
    );

    if (result.fallback) return res.json({ files: [], fallback: true, message: "LLM unavailable" });
    res.json({ ...result.data, provider: result.provider, model: result.model, usage: result.usage });
  } catch (err) {
    next(err);
  }
});

// ============================================
// POST /ai/narrate — campaign narrative
// ============================================

router.post("/narrate", async (req, res, next) => {
  try {
    const { eventType, playerName, planetName, factionName, conquestPercent, recentBattles, context } = req.body;
    if (!eventType) return res.status(400).json({ error: "eventType required" });

    let prompt = `Generate a campaign narrative for event type: "${eventType}".\n`;
    if (playerName) prompt += `Player name: ${playerName}.\n`;
    if (planetName) prompt += `Planet: ${planetName}.\n`;
    if (factionName) prompt += `Player's faction: ${factionName}.\n`;
    if (conquestPercent != null) prompt += `Conquest progress: ${conquestPercent}%.\n`;
    if (recentBattles) prompt += `Recent battles: ${recentBattles}.\n`;
    if (context) prompt += `Additional context: ${context}.\n`;
    prompt += `\nRespond in JSON: { "title": "short title", "narrative": "2-4 sentences" }`;

    const result = await chatJSON(
      [
        {
          role: "system",
          content:
            "You are the AI narrator for Gruda Armada, a space RTS campaign. Write dramatic, evocative, short narrative text (2-4 sentences). Use second person. Be specific to the event type.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.8 }
    );

    if (result.fallback) {
      return res.json({
        title: eventType.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        narrative: `Something unfolds near ${planetName || "your position"} in the darkness of space.`,
      });
    }

    res.json(result.data || { title: eventType, narrative: result.content });
  } catch (err) {
    next(err);
  }
});

export default router;
