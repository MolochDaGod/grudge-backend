// ============================================
// CANONICAL RACE DEFINITIONS
// Single source of truth for all Grudge Warlord games
// ============================================

export interface RaceDef {
  id: string;
  name: string;
  faction: FactionId;
  color: string;
  description: string;
  shortDesc: string;
  lore: string;
  bonuses: Record<AttributeKey, number>;
  topBonuses: string[];
  passive: string;
  trait: string;
  /** Prefab base ID — each game engine maps this to its own model/sprite */
  prefabBase: string;
}

export type FactionId = "crusade" | "fabled" | "legion";
export type RaceId = "human" | "barbarian" | "dwarf" | "elf" | "orc" | "undead";
export type AttributeKey =
  | "Strength"
  | "Vitality"
  | "Endurance"
  | "Intellect"
  | "Wisdom"
  | "Dexterity"
  | "Agility"
  | "Tactics";

export const FACTIONS: Record<FactionId, { name: string; color: string; description: string }> = {
  crusade: {
    name: "Crusade",
    color: "#c9873b",
    description: "The righteous alliance of Humans and Barbarians",
  },
  fabled: {
    name: "Fabled",
    color: "#4ade80",
    description: "The ancient covenant of Elves and Dwarves",
  },
  legion: {
    name: "Legion",
    color: "#ef4444",
    description: "The relentless horde of Orcs and Undead",
  },
};

export const RACES: Record<RaceId, RaceDef> = {
  human: {
    id: "human",
    name: "Human",
    faction: "crusade",
    color: "#94a3b8",
    description: "Versatile and adaptable — masters of none, capable of all.",
    shortDesc: "Versatile and adaptable, Humans excel in any role",
    lore: "The most numerous of the Grudge War survivors, Humans thrive through sheer adaptability. Where other races rely on innate gifts, Humans forge their destiny through will and cunning.",
    bonuses: { Strength: 1, Intellect: 1, Vitality: 1, Dexterity: 1, Endurance: 1, Wisdom: 1, Agility: 1, Tactics: 1 },
    topBonuses: ["+1 Str", "+1 Int", "+1 Wis", "+2 Tac"],
    passive: "+1 to all attributes",
    trait: "Adaptable",
    prefabBase: "human",
  },
  barbarian: {
    id: "barbarian",
    name: "Barbarian",
    faction: "crusade",
    color: "#f43f5e",
    description: "Untamed fury given form — raw power and relentless aggression.",
    shortDesc: "Savage warriors of the frozen north who fight for honor",
    lore: "From the frozen steppes and scorched badlands, Barbarians reject civilization and embrace primal rage. Their ferocity in battle is unmatched, striking with wild abandon that terrifies even hardened soldiers.",
    bonuses: { Strength: 3, Vitality: 1, Endurance: 1, Dexterity: 0, Agility: 2, Intellect: 0, Wisdom: 0, Tactics: 1 },
    topBonuses: ["+3 Str", "+2 Vit", "+2 End"],
    passive: "+3 Strength, +2 Agility, +1 Vitality, +1 Endurance, +1 Tactics",
    trait: "Berserker Rage",
    prefabBase: "barbarian",
  },
  dwarf: {
    id: "dwarf",
    name: "Dwarf",
    faction: "fabled",
    color: "#f59e0b",
    description: "Stout mountain folk — unyielding defense and masterful craftsmanship.",
    shortDesc: "Sturdy and resilient, Dwarves are master craftsmen and ancient warriors",
    lore: "Deep beneath the mountains, the Dwarves forged their kingdoms in stone and iron. Generations of mining and warfare have made them nearly unbreakable, with an endurance that outlasts any foe.",
    bonuses: { Strength: 1, Vitality: 2, Endurance: 3, Dexterity: 1, Agility: 0, Intellect: 0, Wisdom: 1, Tactics: 0 },
    topBonuses: ["+2 Str", "+3 Vit", "+3 End"],
    passive: "+3 Endurance, +2 Vitality, +1 Strength, +1 Dexterity, +1 Wisdom",
    trait: "Stoneborn",
    prefabBase: "dwarf",
  },
  elf: {
    id: "elf",
    name: "Elf",
    faction: "fabled",
    color: "#22d3ee",
    description: "Ancient and graceful — wielders of arcane arts and deadly precision.",
    shortDesc: "Ancient masters of arcane arts and deadly precision",
    lore: "The Elves walked this world before the first grudge was spoken. Their mastery of magic and movement is unrivaled, though their arrogance has earned them many enemies.",
    bonuses: { Strength: 0, Vitality: 0, Endurance: 0, Dexterity: 2, Agility: 2, Intellect: 3, Wisdom: 1, Tactics: 0 },
    topBonuses: ["+3 Int", "+2 Dex", "+2 Agi"],
    passive: "+3 Intellect, +2 Dexterity, +2 Agility, +1 Wisdom",
    trait: "Arcane Affinity",
    prefabBase: "elf",
  },
  orc: {
    id: "orc",
    name: "Orc",
    faction: "legion",
    color: "#65a30d",
    description: "Savage brutes bred for war — crushing power and iron will.",
    shortDesc: "Savage brutes bred for war and conquest",
    lore: "Born in the blood pits of the Shattered Wastes, Orcs know nothing but battle. Their bones are dense as stone, their muscles forged by a lifetime of brutality.",
    bonuses: { Strength: 4, Vitality: 2, Endurance: 2, Dexterity: 0, Agility: 0, Intellect: 0, Wisdom: 0, Tactics: 0 },
    topBonuses: ["+4 Str", "+2 Vit", "+2 End"],
    passive: "+4 Strength, +2 Vitality, +2 Endurance",
    trait: "Bloodrage",
    prefabBase: "orc",
  },
  undead: {
    id: "undead",
    name: "Undead",
    faction: "legion",
    color: "#a78bfa",
    description: "Death-touched revenants fueled by dark energy and grudges unresolved.",
    shortDesc: "Death-touched revenants fueled by unresolved grudges",
    lore: "Neither alive nor truly dead, the Undead are sustained by the grudges that bind them to this world. Their rotting flesh hides an unbreakable will and dark power.",
    bonuses: { Strength: 1, Vitality: 3, Endurance: 2, Dexterity: 0, Agility: 0, Intellect: 0, Wisdom: 2, Tactics: 0 },
    topBonuses: ["+3 Vit", "+2 End", "+2 Wis"],
    passive: "+3 Vitality, +2 Endurance, +2 Wisdom, +1 Strength",
    trait: "Undying Will",
    prefabBase: "undead",
  },
};

export const RACE_LIST = Object.values(RACES);
export const VALID_RACE_IDS = Object.keys(RACES) as RaceId[];
