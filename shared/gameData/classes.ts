// ============================================
// CANONICAL CLASS DEFINITIONS
// Single source of truth for all Grudge Warlord games
// ============================================

import type { AttributeKey } from "./races.js";

export type ClassId = "warrior" | "mage" | "worge" | "ranger";
export type WeaponType =
  | "sword" | "2h_sword" | "shield" | "dagger" | "mace" | "hammer"
  | "staff" | "wand" | "bow" | "crossbow" | "gun" | "spear"
  | "tome" | "off_hand_relic" | "cape" | "2h_weapon" | "thrown";

export interface ClassAbility {
  id: string;
  name: string;
  description: string;
  type: "physical" | "magical" | "buff" | "heal" | "heal_over_time" | "summon_totem" | "summon_companion" | "focus";
  damage: number;
  manaCost: number;
  staminaCost: number;
  cooldown: number;
  target: "enemy" | "self";
}

export interface ClassDef {
  id: ClassId;
  name: string;
  color: string;
  description: string;
  lore: string;
  startingAttributes: Record<AttributeKey, number>;
  allowedWeapons: WeaponType[];
  abilities: ClassAbility[];
  signatureAbility: ClassAbility;
  /** Prefab suffix — combined with race prefabBase for full ID */
  prefabSuffix: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: "warrior",
    name: "Warrior",
    color: "#ef4444",
    description: "A fearless frontline fighter specializing in raw power and defense.",
    lore: "Forged in the crucible of the Grudge Wars, Warriors are the backbone of any warband. Their strength and endurance are unmatched on the battlefield.",
    startingAttributes: { Strength: 5, Vitality: 3, Endurance: 2, Dexterity: 1, Agility: 1, Intellect: 0, Wisdom: 0, Tactics: 0 },
    allowedWeapons: ["sword", "2h_sword", "shield", "mace", "hammer", "2h_weapon", "spear", "dagger"],
    abilities: [
      { id: "slash", name: "Slash", description: "A steady sword strike that restores resources", type: "physical", damage: 0.9, manaCost: 0, staminaCost: 0, cooldown: 0, target: "enemy" },
      { id: "power_strike", name: "Power Strike", description: "A devastating blow dealing 2x damage", type: "physical", damage: 2.0, manaCost: 0, staminaCost: 25, cooldown: 2, target: "enemy" },
      { id: "war_cry", name: "War Cry", description: "Boost your damage by 30% for 3 turns", type: "buff", damage: 0, manaCost: 0, staminaCost: 30, cooldown: 5, target: "self" },
      { id: "shield_bash", name: "Shield Bash", description: "Stun the enemy for 1 turn", type: "physical", damage: 0.8, manaCost: 0, staminaCost: 20, cooldown: 4, target: "enemy" },
      { id: "cleave", name: "Cleave", description: "Slash deep, hitting all enemies and causing bleed", type: "physical", damage: 1.5, manaCost: 0, staminaCost: 22, cooldown: 3, target: "enemy" },
      { id: "demon_blade", name: "Demon Blade", description: "Transform into a Demon Swordsman for 3 turns", type: "buff", damage: 0, manaCost: 0, staminaCost: 40, cooldown: 8, target: "self" },
    ],
    signatureAbility: { id: "invincible", name: "Invincible", description: "Become invulnerable for 2 turns", type: "buff", damage: 0, manaCost: 0, staminaCost: 35, cooldown: 8, target: "self" },
    prefabSuffix: "warrior",
  },
  mage: {
    id: "mage",
    name: "Mage Priest",
    color: "#8b5cf6",
    description: "Master of arcane magic and divine healing arts.",
    lore: "Drawing power from ancient ley lines and forgotten gods, Mage Priests wield destructive magic alongside sacred healing — a balance few can master.",
    startingAttributes: { Strength: 0, Vitality: 1, Endurance: 1, Dexterity: 0, Agility: 0, Intellect: 5, Wisdom: 4, Tactics: 1 },
    allowedWeapons: ["staff", "tome", "mace", "off_hand_relic", "wand"],
    abilities: [
      { id: "arcane_bolt", name: "Arcane Bolt", description: "A focused arcane pulse that restores resources", type: "magical", damage: 1.0, manaCost: 0, staminaCost: 0, cooldown: 0, target: "enemy" },
      { id: "fireball", name: "Fireball", description: "Hurls fire dealing massive damage + burn", type: "magical", damage: 2.5, manaCost: 35, staminaCost: 0, cooldown: 3, target: "enemy" },
      { id: "heal", name: "Divine Heal", description: "Restore 30% of max HP", type: "heal", damage: 0, manaCost: 40, staminaCost: 0, cooldown: 4, target: "self" },
      { id: "ice_storm", name: "Ice Storm", description: "Freezes all enemies, reducing their damage", type: "magical", damage: 1.8, manaCost: 30, staminaCost: 0, cooldown: 3, target: "enemy" },
    ],
    signatureAbility: { id: "mana_shield", name: "Mana Shield", description: "Convert mana into a protective barrier", type: "buff", damage: 0, manaCost: 50, staminaCost: 0, cooldown: 5, target: "self" },
    prefabSuffix: "mage",
  },
  worge: {
    id: "worge",
    name: "Worge",
    color: "#d97706",
    description: "A shapeshifter who wields nature and storm magic in human form, then transforms into a devastating beast.",
    lore: "Worges walk between worlds — scholars of storm and root in mortal guise, unstoppable predators in beast form.",
    startingAttributes: { Strength: 2, Vitality: 2, Endurance: 1, Dexterity: 2, Agility: 2, Intellect: 2, Wisdom: 1, Tactics: 0 },
    allowedWeapons: ["staff", "spear", "dagger", "bow", "hammer", "mace", "off_hand_relic"],
    abilities: [
      { id: "mace_strike", name: "Mace Strike", description: "A storm-charged mace blow that restores resources", type: "physical", damage: 1.0, manaCost: 0, staminaCost: 0, cooldown: 0, target: "enemy" },
      { id: "lightning_lash", name: "Lightning Lash", description: "Call down a bolt of lightning on the target", type: "magical", damage: 1.8, manaCost: 25, staminaCost: 0, cooldown: 2, target: "enemy" },
      { id: "natures_grasp", name: "Nature's Grasp", description: "Vines heal you over 3 turns", type: "heal_over_time", damage: 0, manaCost: 20, staminaCost: 0, cooldown: 4, target: "self" },
      { id: "dagger_toss", name: "Dagger Toss", description: "Hurl an envenomed dagger, poisoning for 3 turns", type: "physical", damage: 0.9, manaCost: 0, staminaCost: 15, cooldown: 3, target: "enemy" },
    ],
    signatureAbility: { id: "bear_form", name: "Worge Transform", description: "Transform into a ferocious beast, boosting damage and defense", type: "buff", damage: 0, manaCost: 0, staminaCost: 20, cooldown: 0, target: "self" },
    prefabSuffix: "worge",
  },
  ranger: {
    id: "ranger",
    name: "Ranger",
    color: "#22c55e",
    description: "A deadly marksman with precise long-range attacks.",
    lore: "Silent and patient, Rangers strike from the shadows with lethal precision. Their arrows find gaps in even the thickest armor.",
    startingAttributes: { Strength: 1, Vitality: 1, Endurance: 1, Dexterity: 4, Agility: 3, Intellect: 1, Wisdom: 0, Tactics: 1 },
    allowedWeapons: ["bow", "crossbow", "gun", "dagger", "2h_sword", "spear"],
    abilities: [
      { id: "quick_shot", name: "Quick Shot", description: "A swift arrow that restores resources", type: "physical", damage: 0.8, manaCost: 0, staminaCost: 0, cooldown: 0, target: "enemy" },
      { id: "aimed_shot", name: "Aimed Shot", description: "A carefully aimed shot that always crits", type: "physical", damage: 2.0, manaCost: 0, staminaCost: 20, cooldown: 2, target: "enemy" },
      { id: "poison_arrow", name: "Poison Arrow", description: "Poisons the enemy for damage over time", type: "physical", damage: 0.7, manaCost: 0, staminaCost: 15, cooldown: 3, target: "enemy" },
      { id: "evasive_maneuver", name: "Evasive Roll", description: "Increase evasion by 50% for 2 turns", type: "buff", damage: 0, manaCost: 0, staminaCost: 15, cooldown: 4, target: "self" },
      { id: "volley", name: "Arrow Volley", description: "Rain arrows on all enemies", type: "physical", damage: 2.4, manaCost: 0, staminaCost: 28, cooldown: 4, target: "enemy" },
    ],
    signatureAbility: { id: "focus", name: "Focus", description: "Passive: +10% crit per turn. Active: Double stacks and guarantee next crit.", type: "focus", damage: 0, manaCost: 0, staminaCost: 15, cooldown: 4, target: "self" },
    prefabSuffix: "ranger",
  },
};

export const CLASS_LIST = Object.values(CLASSES);
export const VALID_CLASS_IDS = Object.keys(CLASSES) as ClassId[];

/**
 * Build a prefab ID from race + class for model resolution.
 * Example: "human_warrior", "elf_mage", "orc_ranger"
 */
export function buildPrefabId(raceId: string, classId: string): string {
  return `${raceId}_${classId}`;
}

/** Class tier names by rank range */
export const CLASS_TIERS = [
  { minRank: 1, maxRank: 10, name: "Legendary", color: "#89f7fe" },
  { minRank: 11, maxRank: 50, name: "Warlord", color: "#f97316" },
  { minRank: 51, maxRank: 100, name: "Epic", color: "#a855f7" },
  { minRank: 101, maxRank: 200, name: "Hero", color: "#3b82f6" },
  { minRank: 201, maxRank: 300, name: "Normal", color: "#9ca3af" },
];
