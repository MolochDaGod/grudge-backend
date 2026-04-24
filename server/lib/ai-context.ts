// ─────────────────────────────────────────────────────────────
// AI Agent Context — System Context, Behavior Profiles, Mission
// Templates, and Role Prompts. Ported from grudge-studio-backend.
// ─────────────────────────────────────────────────────────────

// ============================================
// SYSTEM CONTEXT
// ============================================

export const SYSTEM_CONTEXT = {
  version: "5.0.0",
  gameSystems: {
    missionTypes: ["harvesting", "fighting", "sailing", "competing"] as const,
    maxMissionsPerDay: 11,
    classes: ["warrior", "mage", "ranger", "worge"] as const,
    factions: ["pirate", "undead", "elven", "orcish"] as const,
    maxGouldstones: 15,
    mechanics: {
      warrior:
        "Stamina system — fills via parry/dodge/block. Double jump, AoE, group invincibility. Perfect parry = extra stamina.",
      mage: "Teleport blocks (max 10 total per map). Staff/tome/wand/off-hand. Ranged control + healing.",
      ranger:
        "RMB+LMB = parry attempt. Perfect parry = instant dash counter, enemy stunned 0.5s, 2s window.",
      worge:
        "3 forms: Bear (tank/powerful), Raptor (invisible/rogue), Bird (flyable, mountable by players/AI).",
      gouldstone:
        "Clones player with same stats/gear/professions. Up to 15 allies. From faction vendors or boss drops.",
      zKey: "Dynamic combat mechanic — random chat bubble triggers, stacking buffs, flame stack UI, PvP interaction.",
      hotbar: "Combat: slots 1-4 = skills, 5 = empty, 6-8 = consumables (food/potions/on-use relics).",
    },
  },
};

export function getGameContext(): string {
  const s = SYSTEM_CONTEXT.gameSystems;
  return `GRUDGE WARLORDS GAME CONTEXT:
Classes: ${s.classes.join(", ")}
Factions: ${s.factions.join(", ")}
Mission types: ${s.missionTypes.join(", ")} (max ${s.maxMissionsPerDay}/day)
Max Gouldstones: ${s.maxGouldstones}
Warrior: ${s.mechanics.warrior}
Mage: ${s.mechanics.mage}
Ranger: ${s.mechanics.ranger}
Worge: ${s.mechanics.worge}
Gouldstone: ${s.mechanics.gouldstone}
Z-Key: ${s.mechanics.zKey}
Hotbar: ${s.mechanics.hotbar}`;
}

// ============================================
// BEHAVIOR PROFILES (Gouldstone companions)
// ============================================

export const BEHAVIOR_PROFILES: Record<string, Record<string, any>> = {
  warrior: {
    balanced: { combat_style: "melee_balanced", priority: ["target_lock", "charge_attack", "parry", "aoe_sweep"], stamina_use: "conservative", ally_behavior: "protect_captain", dialogue_tone: "stoic" },
    berserker: { combat_style: "melee_all_in", priority: ["charge_attack", "aoe_sweep", "double_jump", "group_invincibility"], stamina_use: "full_burn", ally_behavior: "attack_nearest", dialogue_tone: "frenzied" },
    guardian: { combat_style: "defensive_tank", priority: ["block", "parry", "group_invincibility", "shield_bash"], stamina_use: "parry_focused", ally_behavior: "intercept_attacks", dialogue_tone: "disciplined" },
  },
  mage: {
    balanced: { combat_style: "ranged_control", priority: ["ranged_spell", "teleport_block", "crowd_control", "healing"], teleport_blocks: 5, ally_behavior: "support_and_attack", dialogue_tone: "arcane" },
    archmage: { combat_style: "ranged_burst", priority: ["burst_spell", "teleport_block", "ranged_spell", "retreat"], teleport_blocks: 8, ally_behavior: "ranged_support", dialogue_tone: "ancient" },
    healer: { combat_style: "support_mage", priority: ["healing", "crowd_control", "teleport_block", "ranged_spell"], teleport_blocks: 3, ally_behavior: "heal_priority", dialogue_tone: "calm" },
  },
  ranger: {
    balanced: { combat_style: "ranged_skirmish", priority: ["bow_shot", "parry_counter", "dash_attack", "retreat"], parry_window_ms: 2000, ally_behavior: "flank_and_shoot", dialogue_tone: "sharp" },
    assassin: { combat_style: "burst_sniper", priority: ["stealth_approach", "burst_shot", "dash_attack", "parry_counter"], parry_window_ms: 2000, ally_behavior: "priority_target_kill", dialogue_tone: "cold" },
    beastmaster: { combat_style: "sustained_ranged", priority: ["bow_shot", "spread_shot", "parry_counter", "tracking"], parry_window_ms: 2000, ally_behavior: "patrol_perimeter", dialogue_tone: "wild" },
  },
  worge: {
    balanced: { combat_style: "shapeshifter", priority: ["bear_charge", "raptor_stealth", "bird_scout", "melee_hybrid"], form_weights: { bear: 0.5, raptor: 0.3, bird: 0.2 }, ally_behavior: "adaptive_form", dialogue_tone: "bestial" },
    bear_tank: { combat_style: "bear_tank", priority: ["bear_charge", "bear_maul", "bear_roar", "protect_allies"], form_weights: { bear: 0.9, raptor: 0.05, bird: 0.05 }, ally_behavior: "frontline_tank", dialogue_tone: "rumbling" },
    raptor_rogue: { combat_style: "raptor_assassin", priority: ["raptor_stealth", "raptor_pounce", "raptor_shred", "bird_escape"], form_weights: { bear: 0.1, raptor: 0.8, bird: 0.1 }, ally_behavior: "flank_invisible", dialogue_tone: "hissing" },
    sky_rider: { combat_style: "aerial_support", priority: ["bird_flight", "bird_dive", "bear_land_charge", "raptor_escape"], form_weights: { bear: 0.2, raptor: 0.1, bird: 0.7 }, ally_behavior: "air_support_and_mount", dialogue_tone: "soaring" },
  },
};

export const FACTION_DIALOGUE: Record<string, { prefix: string; tone_mod: string }> = {
  pirate: { prefix: "Arrr,", tone_mod: "boisterous" },
  undead: { prefix: "*rasps*", tone_mod: "hollow" },
  elven: { prefix: "*whispers*", tone_mod: "ethereal" },
  orcish: { prefix: "GRAGH!", tone_mod: "thunderous" },
  default: { prefix: "", tone_mod: "neutral" },
};

export function assignProfile(cls: string, style: string, faction?: string) {
  const classProfiles = BEHAVIOR_PROFILES[cls] || BEHAVIOR_PROFILES.warrior;
  const profile = classProfiles[style] || classProfiles.balanced;
  const factionMod = FACTION_DIALOGUE[(faction || "").toLowerCase()] || FACTION_DIALOGUE.default;
  return { class: cls, style, ...profile, faction_dialogue: factionMod, assigned_at: new Date().toISOString() };
}

export function getAvailableStyles(cls: string): string[] {
  return Object.keys(BEHAVIOR_PROFILES[cls] || BEHAVIOR_PROFILES.warrior);
}

// ============================================
// MISSION TEMPLATES
// ============================================

const REWARD_TABLES: Record<string, { xp: [number, number]; gold: [number, number] }> = {
  low: { xp: [40, 80], gold: [10, 25] },
  mid: { xp: [100, 200], gold: [30, 75] },
  high: { xp: [250, 500], gold: [80, 150] },
  elite: { xp: [600, 1000], gold: [200, 400] },
};

const MISSION_TEMPLATES: Record<string, Record<string, Record<string, string[]>>> = {
  harvesting: {
    default: {
      low: ["Gather iron ore from the Rust Caverns", "Fish the Tide Shores at dawn", "Cut timber from the Briar Woods", "Farm wild wheat near the Old Mill", "Hunt boar in the Mudstone Hills"],
      mid: ["Mine gold veins beneath Shattered Peak", "Deep-sea fish near the Abyssal Reef", "Log ancient oaks in the Cursed Forest", "Cultivate shadowbloom in the Hollow Fields", "Hunt wyvern cubs near Ashfall Ridge"],
      high: ["Extract crystal ore from the Ember Mines", "Harvest leviathan kelp from the Storm Deep", "Fell elder ironwood in the Wraithwood", "Grow bloodroot in the Plagued Flats", "Hunt spectral elk in the Ghostfen"],
      elite: ["Carve elder stone from the Primordial Vaults", "Pull abyssal coral from the Sunken City", "Harvest godwood from the Ancient Grove", "Cultivate star-grain in the Celestial Fields", "Hunt the Undying Mammoth in the Frozen Wastes"],
    },
    pirate: {
      low: ["Scavenge salvage from the wrecked galleon", "Fish for bonefish near Skull Cove", "Cut planks from the Mangrove Thicket"],
      mid: ["Raid the merchant convoy for exotic spices", "Dive the sunken treasure hoard", "Fell ironwood masts from the beached warship"],
      high: ["Seize the royal ore shipment at sea", "Harvest dragonbone from the sea serpent carcass"],
      elite: ["Claim the legendary Tidestone from the Drowned Keep"],
    },
  },
  fighting: {
    default: {
      low: ["Clear the bandit camp on the Trade Road", "Defeat the cave troll at the eastern pass", "Repel the goblin raid on the outpost"],
      mid: ["Storm the pirate fortress on Daggerpoint Isle", "Defeat the rogue warlord and his mercenaries", "Ambush the rival faction patrol near the border"],
      high: ["Slay the sea dragon terrorizing the trade lanes", "Defeat the cursed knight guarding the ruins", "Eliminate the shapeshifter assassin"],
      elite: ["Defeat the legendary Warlord Grakkus", "Slay the Lich King's Champion", "Destroy the Void Titan awakened from the deep"],
    },
  },
  sailing: {
    default: {
      low: ["Patrol the coastal waters and report enemy movements", "Escort the merchant vessel to safe harbor"],
      mid: ["Intercept the pirate fleet blockading the port", "Navigate the Maelstrom to reach the Fabled Isle"],
      high: ["Lead the naval assault on the fortress coast", "Sail through the ghost fleet to reach the Cursed Reef"],
      elite: ["Command the flagship in the Final Armada battle", "Sail into the Storm God's Eye and return alive"],
    },
  },
  competing: {
    default: {
      low: ["Win the faction trial at the Proving Grounds", "Place top 3 in the harvest competition at the Autumn Fair"],
      mid: ["Win the arena tournament in the Capital", "Beat the champion crafter in the forge duel"],
      high: ["Claim the Warlord's Belt in the Grand Tournament", "Win the sailing race around the Shattered Isles"],
      elite: ["Become Champion of the Grudge Colosseum", "Win the legendary Pirate King's Gambit"],
    },
  },
};

export function getLevelTier(level: number): string {
  if (level <= 24) return "low";
  if (level <= 49) return "mid";
  if (level <= 74) return "high";
  return "elite";
}

function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function randRange(min: number, max: number, seed: number): number {
  return min + Math.floor(seededRand(seed) * (max - min + 1));
}

function pickTemplate(type: string, faction: string, tier: string, seed: number): string {
  const byType = MISSION_TEMPLATES[type] || MISSION_TEMPLATES.harvesting;
  const byFaction = byType[faction] || byType.default;
  const list = byFaction[tier] || byFaction.low || byType.default.low;
  return list[Math.floor(seededRand(seed) * list.length)];
}

export function generateMission(
  character: { level?: number; faction?: string },
  type: string,
  seed: number
) {
  const tier = getLevelTier(character.level || 1);
  const faction = (character.faction || "default").toLowerCase();
  const rewards = REWARD_TABLES[tier];
  return {
    title: pickTemplate(type, faction, tier, seed),
    type,
    tier,
    reward_xp: randRange(rewards.xp[0], rewards.xp[1], seed + 1),
    reward_gold: randRange(rewards.gold[0], rewards.gold[1], seed + 2),
  };
}

// ============================================
// SYSTEM PROMPTS
// ============================================

const BASE = `You are an AI agent for Grudge Warlords, a souls-like MMO RPG.
The game has 6 races (Human, Orc, Elf, Undead, Barbarian, Dwarf), 4 classes (Warrior, Mage, Ranger, Worge), and 4 factions (Pirate, Undead, Elven, Orcish).
Backend: Node.js, PostgreSQL, Drizzle ORM, Cloudflare Workers. Game data at ObjectStore.`;

export const PROMPTS = {
  mission: () =>
    `${BASE}\n${getGameContext()}\n\nYou are the MISSION AGENT. Generate dynamic, engaging missions.\nMISSION TYPES: harvesting, fighting, sailing, competing\nTIER by level: low (1-24), mid (25-49), high (50-74), elite (75-100)\nREWARD RANGES: low: 40-80 XP 10-25 gold, mid: 100-200 XP 30-75 gold, high: 250-500 XP 80-150 gold, elite: 600-1000 XP 200-400 gold\nOUTPUT: JSON array of mission objects with { title, description, type, tier, objective, reward_xp, reward_gold }`,

  companion: () =>
    `${BASE}\n${getGameContext()}\n\nYou are the COMPANION AGENT. Generate dynamic dialogue for Gouldstone AI companions.\nCompanions are clones created via Gouldstone items (same stats/gear/profession levels). Max 15 per player.\nStay in character for class+faction. Short responses (1-2 sentences) for combat, longer for idle/travel.\nOUTPUT: JSON with { dialogue, action_hint?, emote?, context }`,

  lore: () =>
    `${BASE}\n${getGameContext()}\n\nYou are the LORE AGENT. Generate quest text, NPC dialogue, item descriptions, and world narrative.\nTONE: Dark fantasy with pirate/nautical themes. Gritty, not cartoonish. Think Dark Souls meets Pirates of the Caribbean.\nNever break the 4th wall. Item descriptions: 1-3 sentences. Quest text needs: hook, objective, stakes.\nOUTPUT: JSON with generated content and metadata (type, faction, tier, word_count).`,

  art: () =>
    `${BASE}\n\nYou are the ART AGENT. Generate prompts for 3D model generation services (Meshy, Tripo, text2vox).\nGRUDGE ART STYLE: Medieval dark fantasy with nautical/pirate elements, stylized but not cartoonish.\nBe specific about polycount target, material/texture notes, pose, and scale reference.\nOUTPUT: JSON with { prompt, service, style_tags[], polycount_target, notes }`,

  balance: () =>
    `${BASE}\n${getGameContext()}\n\nYou are the BALANCE AGENT. Analyze combat data, economy stats, and player progression.\nFlag class win-rate disparities (>55% concern, >60% critical). Detect gold inflation/deflation.\nOUTPUT: JSON with { summary, severity, issues[], recommendations[], metrics }`,

  dev: () =>
    `${BASE}\n${getGameContext()}\n\nYou are the CODE AGENT. Write, review, and generate game scripts.\nWhen reviewing code, check for: networking errors, null refs, race conditions, DB injection.\nOUTPUT: JSON with review results or generated files.`,
};

// ============================================
// FACTION DATA
// ============================================

export const FACTION_DATA: Record<string, { strengths: string[]; weakness: string; lore: string }> = {
  pirate: { strengths: ["sailing", "fighting"], weakness: "harvesting", lore: "Masters of the open sea. Pirates raid convoys and seize territory through force and cunning." },
  undead: { strengths: ["harvesting", "fighting"], weakness: "competing", lore: "The Undead horde grows through death itself, turning every fallen foe into a new soldier." },
  elven: { strengths: ["harvesting", "competing"], weakness: "fighting", lore: "Ancient elves command the forests and arcane arts, excelling in craft, trade, and magic." },
  orcish: { strengths: ["fighting", "competing"], weakness: "sailing", lore: "Orcish warbands dominate land combat, their brute strength unmatched in direct confrontation." },
};
