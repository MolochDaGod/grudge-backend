/**
 * Seed Script — populates static game data tables.
 * Run via: npx tsx server/seed.ts
 *
 * Seeds: crafting_recipes, achievements_def, island_state,
 *        moba_heroes, moba_abilities, moba_items
 */

import "dotenv/config";
import { db } from "./db.js";
import {
  craftingRecipes,
  achievementsDef,
  islandState,
  mobaHeroes,
  mobaAbilities,
  mobaItems,
} from "../shared/schema.js";

async function seed() {
  console.log("[seed] Starting...");

  // ============================================
  // CRAFTING RECIPES
  // ============================================

  const recipes = [
    // Swords
    { recipeKey: "sword_t1", name: "Iron Sword", outputItemKey: "iron_sword_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "mining", requiredLevel: 0, costGold: 50, craftTimeSeconds: 30, classRestriction: "warrior" },
    { recipeKey: "sword_t2", name: "Steel Sword", outputItemKey: "steel_sword_t2", outputItemType: "weapon", outputTier: 2, requiredProfession: "mining", requiredLevel: 25, costGold: 100, craftTimeSeconds: 60, classRestriction: "warrior" },
    { recipeKey: "sword_t3", name: "Tempered Sword", outputItemKey: "tempered_sword_t3", outputItemType: "weapon", outputTier: 3, requiredProfession: "mining", requiredLevel: 50, costGold: 200, craftTimeSeconds: 120, classRestriction: "warrior" },
    { recipeKey: "sword_t4", name: "Dragonbone Sword", outputItemKey: "dragonbone_sword_t4", outputItemType: "weapon", outputTier: 4, requiredProfession: "mining", requiredLevel: 75, costGold: 400, craftTimeSeconds: 180, classRestriction: "warrior" },
    { recipeKey: "sword_t5", name: "Celestial Blade", outputItemKey: "celestial_blade_t5", outputItemType: "weapon", outputTier: 5, requiredProfession: "mining", requiredLevel: 100, costGold: 800, craftTimeSeconds: 300, classRestriction: "warrior" },
    { recipeKey: "sword_t6", name: "Grudge Slayer", outputItemKey: "grudge_slayer_t6", outputItemType: "weapon", outputTier: 6, requiredProfession: "mining", requiredLevel: 100, costGold: 2000, craftTimeSeconds: 600, classRestriction: "warrior" },
    // Staffs
    { recipeKey: "staff_t1", name: "Wooden Staff", outputItemKey: "wooden_staff_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "woodcutting", requiredLevel: 0, costGold: 50, craftTimeSeconds: 30 },
    { recipeKey: "staff_t2", name: "Ironwood Staff", outputItemKey: "ironwood_staff_t2", outputItemType: "weapon", outputTier: 2, requiredProfession: "woodcutting", requiredLevel: 25, costGold: 100, craftTimeSeconds: 60 },
    { recipeKey: "staff_t3", name: "Elderstave", outputItemKey: "elderstave_t3", outputItemType: "weapon", outputTier: 3, requiredProfession: "woodcutting", requiredLevel: 50, costGold: 200, craftTimeSeconds: 120 },
    // Bows
    { recipeKey: "bow_t1", name: "Hunting Bow", outputItemKey: "hunting_bow_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "woodcutting", requiredLevel: 0, costGold: 50, craftTimeSeconds: 30 },
    { recipeKey: "bow_t2", name: "Recurve Bow", outputItemKey: "recurve_bow_t2", outputItemType: "weapon", outputTier: 2, requiredProfession: "woodcutting", requiredLevel: 25, costGold: 100, craftTimeSeconds: 60 },
    { recipeKey: "bow_t3", name: "Shadowbow", outputItemKey: "shadowbow_t3", outputItemType: "weapon", outputTier: 3, requiredProfession: "woodcutting", requiredLevel: 50, costGold: 200, craftTimeSeconds: 120 },
    // Shields
    { recipeKey: "shield_t1", name: "Wooden Shield", outputItemKey: "wooden_shield_t1", outputItemType: "shield", outputTier: 1, requiredProfession: "woodcutting", requiredLevel: 0, costGold: 60, craftTimeSeconds: 30, classRestriction: "warrior" },
    { recipeKey: "shield_t2", name: "Iron Shield", outputItemKey: "iron_shield_t2", outputItemType: "shield", outputTier: 2, requiredProfession: "mining", requiredLevel: 25, costGold: 120, craftTimeSeconds: 60, classRestriction: "warrior" },
    { recipeKey: "shield_t3", name: "Steel Shield", outputItemKey: "steel_shield_t3", outputItemType: "shield", outputTier: 3, requiredProfession: "mining", requiredLevel: 50, costGold: 240, craftTimeSeconds: 120, classRestriction: "warrior" },
    // Cloth Armor
    { recipeKey: "cloth_chest_t1", name: "Cloth Robe T1", outputItemKey: "cloth_robe_t1", outputItemType: "armor", outputTier: 1, requiredProfession: "farming", requiredLevel: 0, costGold: 40, craftTimeSeconds: 20, classRestriction: "mage" },
    { recipeKey: "cloth_chest_t2", name: "Cloth Robe T2", outputItemKey: "cloth_robe_t2", outputItemType: "armor", outputTier: 2, requiredProfession: "farming", requiredLevel: 25, costGold: 80, craftTimeSeconds: 40, classRestriction: "mage" },
    // Leather Armor
    { recipeKey: "leather_chest_t1", name: "Leather Vest T1", outputItemKey: "leather_vest_t1", outputItemType: "armor", outputTier: 1, requiredProfession: "hunting", requiredLevel: 0, costGold: 50, craftTimeSeconds: 20, classRestriction: "ranger" },
    { recipeKey: "leather_chest_t2", name: "Cured Leather T2", outputItemKey: "cured_leather_t2", outputItemType: "armor", outputTier: 2, requiredProfession: "hunting", requiredLevel: 25, costGold: 100, craftTimeSeconds: 40, classRestriction: "ranger" },
    // Metal Armor
    { recipeKey: "metal_chest_t1", name: "Iron Chainmail T1", outputItemKey: "iron_chainmail_t1", outputItemType: "armor", outputTier: 1, requiredProfession: "mining", requiredLevel: 0, costGold: 80, craftTimeSeconds: 30, classRestriction: "warrior" },
    { recipeKey: "metal_chest_t2", name: "Steel Plate T2", outputItemKey: "steel_plate_t2", outputItemType: "armor", outputTier: 2, requiredProfession: "mining", requiredLevel: 25, costGold: 160, craftTimeSeconds: 60, classRestriction: "warrior" },
    // Capes
    { recipeKey: "cape_t1", name: "Traveler Cape", outputItemKey: "traveler_cape_t1", outputItemType: "cape", outputTier: 1, requiredProfession: "farming", requiredLevel: 0, costGold: 60, craftTimeSeconds: 30 },
    { recipeKey: "cape_t2", name: "Ranger Cape", outputItemKey: "ranger_cape_t2", outputItemType: "cape", outputTier: 2, requiredProfession: "farming", requiredLevel: 25, costGold: 120, craftTimeSeconds: 60 },
    // Relics
    { recipeKey: "relic_t1", name: "Iron Talisman", outputItemKey: "iron_talisman_t1", outputItemType: "relic", outputTier: 1, requiredProfession: "none", requiredLevel: 0, costGold: 100, craftTimeSeconds: 60 },
    { recipeKey: "relic_t2", name: "Silver Charm", outputItemKey: "silver_charm_t2", outputItemType: "relic", outputTier: 2, requiredProfession: "none", requiredLevel: 25, costGold: 200, craftTimeSeconds: 120 },
    // Daggers
    { recipeKey: "dagger_t1", name: "Iron Dagger", outputItemKey: "iron_dagger_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "mining", requiredLevel: 0, costGold: 40, craftTimeSeconds: 20 },
    // Spears
    { recipeKey: "spear_t1", name: "Wooden Spear", outputItemKey: "wooden_spear_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "woodcutting", requiredLevel: 0, costGold: 50, craftTimeSeconds: 30 },
    // Maces
    { recipeKey: "mace_t1", name: "Stone Mace", outputItemKey: "stone_mace_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "mining", requiredLevel: 0, costGold: 50, craftTimeSeconds: 30 },
    // Hammers
    { recipeKey: "hammer_t1", name: "Iron Hammer", outputItemKey: "iron_hammer_t1", outputItemType: "weapon", outputTier: 1, requiredProfession: "mining", requiredLevel: 0, costGold: 60, craftTimeSeconds: 30, classRestriction: "worge" },
  ];

  console.log(`[seed] Inserting ${recipes.length} crafting recipes...`);
  for (const recipe of recipes) {
    await db.insert(craftingRecipes).values(recipe).onConflictDoNothing();
  }

  // ============================================
  // ACHIEVEMENTS
  // ============================================

  const achievements = [
    { achKey: "first_login", name: "Welcome to Grudge", description: "Log in for the first time.", points: 10 },
    { achKey: "first_character", name: "Hero Born", description: "Create your first character.", points: 10 },
    { achKey: "level_10", name: "Getting Started", description: "Reach level 10 with any character.", points: 25 },
    { achKey: "level_50", name: "Battle-Hardened", description: "Reach level 50 with any character.", points: 50 },
    { achKey: "level_100", name: "Warlord", description: "Reach max level 100 with any character.", points: 100 },
    { achKey: "first_crew", name: "Crew Up", description: "Join or create a crew.", points: 15 },
    { achKey: "claim_base", name: "Homestead", description: "Claim a pirate base for your crew.", points: 30 },
    { achKey: "gouldstone_x1", name: "The Clone", description: "Deploy your first Gouldstone companion.", points: 20 },
    { achKey: "gouldstone_x15", name: "Legion", description: "Have 15 active Gouldstone companions.", points: 75 },
    { achKey: "profession_25", name: "Apprentice", description: "Reach level 25 in any profession.", points: 20 },
    { achKey: "profession_100", name: "Grandmaster", description: "Reach level 100 in any profession.", points: 100 },
    { achKey: "first_kill", name: "Blood on My Hands", description: "Win your first combat encounter.", points: 10 },
    { achKey: "launcher_install", name: "Ready to Launch", description: "Register your computer with the Grudge Launcher.", points: 10 },
    { achKey: "puter_sync", name: "Cloud Warrior", description: "Sync a character save to Puter Cloud.", points: 15 },
  ];

  console.log(`[seed] Inserting ${achievements.length} achievements...`);
  for (const ach of achievements) {
    await db.insert(achievementsDef).values(ach).onConflictDoNothing();
  }

  // ============================================
  // WORLD ISLANDS
  // ============================================

  const islands = [
    { islandKey: "spawn", displayName: "Spawn Arena" },
    { islandKey: "starter_island", displayName: "Starter Island" },
    { islandKey: "crusade_island", displayName: "Crusade Island" },
    { islandKey: "fabled_island", displayName: "Fabled Island" },
    { islandKey: "piglin_outpost", displayName: "Piglin Outpost" },
    { islandKey: "pirate_cove", displayName: "Pirate Cove" },
    { islandKey: "elven_grove", displayName: "Elven Grove" },
    { islandKey: "undead_wastes", displayName: "Undead Wastes" },
    { islandKey: "orc_stronghold", displayName: "Orc Stronghold" },
    { islandKey: "mage_tower", displayName: "Mage Tower" },
  ];

  console.log(`[seed] Inserting ${islands.length} world islands...`);
  for (const island of islands) {
    await db.insert(islandState).values(island).onConflictDoNothing();
  }

  // ============================================
  // MOBA HEROES (26 heroes)
  // ============================================

  const heroes = [
    { id: 0, name: "Sir Aldric Valorheart", title: "The Iron Bastion", race: "Human", heroClass: "Warrior", faction: "Crusade", rarity: "Rare", hp: 245, atk: 23, def: 19, spd: 57, rng: "1.5", mp: 95, quote: "The shield breaks before the will does." },
    { id: 1, name: "Gareth Moonshadow", title: "The Twilight Stalker", race: "Human", heroClass: "Worg", faction: "Crusade", rarity: "Rare", hp: 235, atk: 22, def: 16, spd: 67, rng: "1.5", mp: 100, quote: "The beast within is not my curse. It is my salvation." },
    { id: 2, name: "Archmage Elara Brightspire", title: "The Storm Caller", race: "Human", heroClass: "Mage", faction: "Crusade", rarity: "Epic", hp: 175, atk: 21, def: 9, spd: 62, rng: "5.5", mp: 155, quote: "Knowledge is the flame. I am merely the torch." },
    { id: 3, name: "Kael Shadowblade", title: "The Shadow Blade", race: "Human", heroClass: "Ranger", faction: "Crusade", rarity: "Rare", hp: 185, atk: 22, def: 11, spd: 72, rng: "6.5", mp: 115, quote: "You never see the arrow that kills you." },
    { id: 16, name: "Grommash Ironjaw", title: "The Warchief", race: "Orc", heroClass: "Warrior", faction: "Legion", rarity: "Epic", hp: 250, atk: 27, def: 19, spd: 57, rng: "1.5", mp: 80, quote: "BLOOD AND THUNDER!" },
    { id: 24, name: "Racalvin the Pirate King", title: "The Scourge of the Seven Seas", race: "Barbarian", heroClass: "Ranger", faction: "Pirates", rarity: "Legendary", hp: 225, atk: 30, def: 9, spd: 78, rng: "6.5", mp: 105, quote: "The sea does not bow. Neither do I.", isSecret: true },
    { id: 25, name: "Cpt. John Wayne", title: "The Sky Captain", race: "Human", heroClass: "Warrior", faction: "Pirates", rarity: "Legendary", hp: 240, atk: 30, def: 18, spd: 60, rng: "2.5", mp: 90, quote: "The ground is for those who've given up dreaming.", isSecret: true },
  ];

  console.log(`[seed] Inserting ${heroes.length} MOBA heroes...`);
  for (const hero of heroes) {
    await db.insert(mobaHeroes).values(hero).onConflictDoNothing();
  }

  // ============================================
  // MOBA ITEMS (13 items)
  // ============================================

  const items = [
    { id: 0, name: "Short Sword", cost: 300, hp: 0, atk: 10, def: 0, spd: 0, mp: 0, description: "+10 Attack", tier: 1 },
    { id: 1, name: "Iron Shield", cost: 300, hp: 0, atk: 0, def: 10, spd: 0, mp: 0, description: "+10 Defense", tier: 1 },
    { id: 2, name: "Swift Boots", cost: 350, hp: 0, atk: 0, def: 0, spd: 12, mp: 0, description: "+12 Speed", tier: 1 },
    { id: 3, name: "Mana Crystal", cost: 300, hp: 0, atk: 0, def: 0, spd: 0, mp: 30, description: "+30 Mana", tier: 1 },
    { id: 4, name: "Health Pendant", cost: 400, hp: 60, atk: 0, def: 0, spd: 0, mp: 0, description: "+60 Health", tier: 1 },
    { id: 5, name: "Flaming Blade", cost: 850, hp: 0, atk: 25, def: 0, spd: 0, mp: 0, description: "+25 Attack", tier: 2 },
    { id: 6, name: "Fortress Shield", cost: 900, hp: 100, atk: 0, def: 20, spd: 0, mp: 0, description: "+20 DEF +100 HP", tier: 2 },
    { id: 7, name: "Arcane Staff", cost: 850, hp: 0, atk: 20, def: 0, spd: 0, mp: 50, description: "+20 ATK +50 MP", tier: 2 },
    { id: 8, name: "Shadow Cloak", cost: 750, hp: 0, atk: 10, def: 0, spd: 18, mp: 0, description: "+10 ATK +18 SPD", tier: 2 },
    { id: 9, name: "Divine Armor", cost: 1500, hp: 200, atk: 0, def: 30, spd: 0, mp: 0, description: "+30 DEF +200 HP", tier: 3 },
    { id: 10, name: "Doom Blade", cost: 1600, hp: 0, atk: 40, def: 0, spd: 5, mp: 0, description: "+40 ATK +5 SPD", tier: 3 },
    { id: 11, name: "Staff of Ages", cost: 1400, hp: 50, atk: 30, def: 0, spd: 0, mp: 80, description: "+30 ATK +80 MP +50 HP", tier: 3 },
    { id: 12, name: "Divine Rapier", cost: 2200, hp: 0, atk: 60, def: 0, spd: 8, mp: 0, description: "+60 ATK +8 SPD. Dropped on death!", tier: 3 },
  ];

  console.log(`[seed] Inserting ${items.length} MOBA items...`);
  for (const item of items) {
    await db.insert(mobaItems).values(item).onConflictDoNothing();
  }

  // ============================================
  // MOBA ABILITIES (core set)
  // ============================================

  const abilities = [
    // Warrior
    { abilityClass: "Warrior", name: "Shield Bash", hotkey: "Q", cooldown: "6", manaCost: 20, damage: 30, abilityRange: 80, radius: 0, duration: "1.5", abilityType: "damage", castType: "targeted", description: "Bash target, dealing damage and stunning for 1.5s" },
    { abilityClass: "Warrior", name: "Rally", hotkey: "W", cooldown: "15", manaCost: 30, damage: 0, abilityRange: 0, radius: 200, duration: "5", abilityType: "buff", castType: "self_cast", description: "Rally allies, boosting ATK by 25% for 5s" },
    { abilityClass: "Warrior", name: "Blade Storm", hotkey: "E", cooldown: "10", manaCost: 35, damage: 50, abilityRange: 0, radius: 120, duration: "0", abilityType: "aoe", castType: "self_cast", description: "Spin with your blade dealing AoE damage" },
    { abilityClass: "Warrior", name: "Avatar", hotkey: "R", cooldown: "60", manaCost: 80, damage: 0, abilityRange: 0, radius: 0, duration: "10", abilityType: "buff", castType: "self_cast", description: "Transform into a giant, +50% HP and ATK for 10s" },
    // Mage
    { abilityClass: "Mage", name: "Fireball", hotkey: "Q", cooldown: "4", manaCost: 25, damage: 55, abilityRange: 400, radius: 60, duration: "0", abilityType: "damage", castType: "skillshot", description: "Hurl a fireball dealing AoE damage", maxCharges: 2, chargeRecharge: "4" },
    { abilityClass: "Mage", name: "Frost Nova", hotkey: "W", cooldown: "12", manaCost: 35, damage: 30, abilityRange: 0, radius: 180, duration: "2", abilityType: "aoe", castType: "self_cast", description: "Freeze nearby enemies, dealing damage and slowing" },
    { abilityClass: "Mage", name: "Arcane Barrier", hotkey: "E", cooldown: "18", manaCost: 40, damage: 0, abilityRange: 0, radius: 0, duration: "4", abilityType: "heal", castType: "self_cast", description: "Create a magic shield absorbing 100 damage" },
    { abilityClass: "Mage", name: "Meteor", hotkey: "R", cooldown: "50", manaCost: 90, damage: 120, abilityRange: 500, radius: 150, duration: "0", abilityType: "aoe", castType: "ground_aoe", description: "Call down a meteor dealing massive AoE damage" },
    // Ranger
    { abilityClass: "Ranger", name: "Power Shot", hotkey: "Q", cooldown: "5", manaCost: 20, damage: 45, abilityRange: 500, radius: 0, duration: "0", abilityType: "damage", castType: "line", description: "Fire a piercing shot dealing high damage", maxCharges: 3, chargeRecharge: "5" },
    { abilityClass: "Ranger", name: "Trap", hotkey: "W", cooldown: "14", manaCost: 25, damage: 20, abilityRange: 300, radius: 50, duration: "2", abilityType: "debuff", castType: "ground_aoe", description: "Place a trap that roots for 2s" },
    { abilityClass: "Ranger", name: "Shadow Step", hotkey: "E", cooldown: "10", manaCost: 30, damage: 0, abilityRange: 250, radius: 0, duration: "0", abilityType: "dash", castType: "ground_aoe", description: "Teleport to location, becoming invisible for 1s" },
    { abilityClass: "Ranger", name: "Storm of Arrows", hotkey: "R", cooldown: "55", manaCost: 80, damage: 80, abilityRange: 400, radius: 200, duration: "3", abilityType: "aoe", castType: "ground_aoe", description: "Rain arrows over an area for 3s" },
    // Worg
    { abilityClass: "Worg", name: "Feral Charge", hotkey: "Q", cooldown: "8", manaCost: 25, damage: 40, abilityRange: 300, radius: 0, duration: "0", abilityType: "dash", castType: "targeted", description: "Dash to target, dealing damage on impact" },
    { abilityClass: "Worg", name: "Howl", hotkey: "W", cooldown: "12", manaCost: 20, damage: 0, abilityRange: 0, radius: 250, duration: "3", abilityType: "debuff", castType: "self_cast", description: "Howl, slowing enemies by 30% for 3s" },
    { abilityClass: "Worg", name: "Rend", hotkey: "E", cooldown: "5", manaCost: 15, damage: 60, abilityRange: 80, radius: 0, duration: "3", abilityType: "damage", castType: "targeted", description: "Rend target, dealing damage over 3s" },
    { abilityClass: "Worg", name: "Primal Fury", hotkey: "R", cooldown: "55", manaCost: 70, damage: 0, abilityRange: 0, radius: 0, duration: "12", abilityType: "buff", castType: "self_cast", description: "Enter frenzy, +40% ATK SPD and lifesteal for 12s" },
  ];

  console.log(`[seed] Inserting ${abilities.length} MOBA abilities...`);
  for (const ability of abilities) {
    await db.insert(mobaAbilities).values(ability).onConflictDoNothing();
  }

  console.log("[seed] Done!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] Error:", err);
  process.exit(1);
});
