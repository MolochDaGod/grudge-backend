/**
 * Grudge Studio — Character Avatar Generator
 *
 * Uses the same art-direction prompt that produced the Racalvin test NFT.
 * Every character gets a unique, hand-painted-style collectible card portrait
 * while staying true to the Grudge Studio brand:
 *   - Ornate gold border frame
 *   - Character name engraved in gold medieval font
 *   - Faction-themed color palette
 *   - Dark fantasy painted illustration style
 *   - Cinematic lighting + legendary rarity glow
 *
 * Images are generated via FLUX.1-schnell through either:
 *   1. Puter AI server (preferred — puter.work)
 *   2. Fallback: placeholder from ObjectStore
 */

import { FACTIONS, type RaceId, type FactionId } from "../../shared/gameData/races.js";

const PUTER_SERVER = process.env.PUTER_SERVER_URL || "https://grudge-server.puter.work";

/** Faction → color theme mapping for the prompt */
const FACTION_THEMES: Record<FactionId, string> = {
  crusade: "gold and white holy light, noble crusader theme, warm amber undertones",
  fabled:  "emerald green and silver moonlight, ancient elven mysticism, cool ethereal tones",
  legion:  "dark purple and crimson hellfire, savage war paint, ominous blood-red glow",
};

/**
 * Build the exact prompt that produces the Grudge Warlords card art style.
 * This is the canonical prompt — all games must use this for cNFT images.
 */
export function buildAvatarPrompt(
  heroName: string,
  race: string,
  heroClass: string,
  faction: FactionId = "crusade",
): string {
  const factionTheme = FACTION_THEMES[faction] || FACTION_THEMES.crusade;

  return [
    `Fantasy RPG collectible card art, ornate gold border frame,`,
    `${race} ${heroClass} character portrait,`,
    `the name "${heroName}" engraved in stylized gold medieval font at the bottom of the card,`,
    `dramatic heroic pose, intricate armor details, ${factionTheme},`,
    `dark fantasy painted illustration style, cinematic lighting,`,
    `card game artwork, legendary rarity glow effect,`,
    `detailed face and expression, rich painterly textures,`,
    `no watermark, high quality, 1024x1024`,
  ].join(" ");
}

/**
 * Generate a character avatar image using the Grudge card art style.
 * Returns a data URL (base64) or a public URL, or null if generation fails.
 */
export async function generateHeroAvatar(
  heroName: string,
  race: string,
  heroClass: string,
  faction: FactionId = "crusade",
): Promise<string | null> {
  const prompt = buildAvatarPrompt(heroName, race, heroClass, faction);

  try {
    const res = await fetch(`${PUTER_SERVER}/api/ai/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: "black-forest-labs/FLUX.1-schnell",
        size: "1024x1024",
        quality: "high",
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      console.error("[AvatarGen] Puter image gen failed:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    // Puter returns { url: "..." } or { image: "data:image/png;base64,..." }
    return data.url || data.image || data.src || null;
  } catch (error) {
    console.error("[AvatarGen] Image generation error:", error);
    return null;
  }
}

/**
 * Get a fallback avatar URL from ObjectStore when AI generation is unavailable.
 */
export function getFallbackAvatarUrl(raceId: string): string {
  return `https://molochdagod.github.io/ObjectStore/icons/races/${raceId || "human"}.png`;
}
