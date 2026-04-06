import { relations } from "drizzle-orm";
import {
  pgTable,
  varchar,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  bigint,
  serial,
  smallint,
  decimal,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================
// USERS TABLE
// ============================================

export const users = pgTable("users", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 255 }),
  displayName: varchar("display_name", { length: 100 }),
  avatarUrl: text("avatar_url"),

  // Computed + stored Grudge ID (GRUDGE_XXXXXXXXXXXX)
  grudgeId: varchar("grudge_id", { length: 30 }),

  // External Auth Identifiers
  puterId: varchar("puter_id", { length: 100 }),
  walletAddress: varchar("wallet_address", { length: 100 }), // primary wallet (legacy compat)

  // Crossmint Wallet Integration (primary custodial wallet)
  crossmintWalletId: varchar("crossmint_wallet_id", { length: 100 }),
  crossmintEmail: varchar("crossmint_email", { length: 255 }),
  walletType: varchar("wallet_type", { length: 20 }), // crossmint, phantom, web3auth, etc.

  // Faction
  faction: varchar("faction", { length: 20 }), // order, chaos, neutral
  factionReputation: integer("faction_reputation").default(0),

  // Flags
  hasHomeIsland: boolean("has_home_island").default(false),
  isPremium: boolean("is_premium").default(false),
  premiumUntil: timestamp("premium_until"),
  isGuest: boolean("is_guest").default(false),
  emailVerified: boolean("email_verified").default(false),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
  lastLoginAt: timestamp("last_login_at"),
});

// ============================================
// WALLETS TABLE — multi-wallet support per user
// ============================================

export const wallets = pgTable("wallets", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  walletAddress: varchar("wallet_address", { length: 100 }).notNull(),
  walletType: varchar("wallet_type", { length: 30 }).notNull(),
  // crossmint | phantom | solflare | web3auth | backpack | custom
  walletNetwork: varchar("wallet_network", { length: 20 }).default("mainnet"),
  // mainnet | devnet | testnet
  isPrimary: boolean("is_primary").default(false),
  isVerified: boolean("is_verified").default(false),
  crossmintWalletId: varchar("crossmint_wallet_id", { length: 100 }),
  web3authVerifier: varchar("web3auth_verifier", { length: 100 }),
  label: varchar("label", { length: 50 }), // user-defined label
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  walletAddressIdx: index("wallets_address_idx").on(table.walletAddress),
  walletUserIdx: index("wallets_user_idx").on(table.userId),
  walletUnique: uniqueIndex("wallets_user_address_unique").on(table.userId, table.walletAddress),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
}));

// ============================================
// NONCE STORE — one-time wallet challenge nonces
// ============================================

export const walletNonces = pgTable("wallet_nonces", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  walletAddress: varchar("wallet_address", { length: 100 }).notNull(),
  nonce: varchar("nonce", { length: 64 }).notNull().unique(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now()),
}, (table) => ({
  nonceWalletIdx: index("nonces_wallet_idx").on(table.walletAddress),
}));

export const usersRelations = relations(users, ({ many }) => ({
  characters: many(characters),
  islands: many(islands),
  aiAgents: many(aiAgents),
  gameSessions: many(gameSessions),
  afkJobs: many(afkJobs),
  authTokens: many(authTokens),
  authProviders: many(authProviders),
  battleArenaStats: many(battleArenaStats),
  wallets: many(wallets),
}));

// ============================================
// AUTH PROVIDERS TABLE (Discord, Google, Puter OAuth linking)
// ============================================

export const authProviders = pgTable("auth_providers", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: varchar("account_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 20 }).notNull(), // discord, google, puter
  providerId: varchar("provider_id", { length: 255 }).notNull(),
  profileData: jsonb("profile_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const authProvidersRelations = relations(authProviders, ({ one }) => ({
  account: one(users, {
    fields: [authProviders.accountId],
    references: [users.id],
  }),
}));

// ============================================
// AUTH TOKENS TABLE
// ============================================

export const authTokens = pgTable("auth_tokens", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  tokenType: varchar("token_type", { length: 20 }).notNull(), // standard, guest, wallet, puter
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now()),
  lastUsedAt: bigint("last_used_at", { mode: "number" }),
  deviceInfo: jsonb("device_info"),
  ipAddress: varchar("ip_address", { length: 45 }),
});

export const authTokensRelations = relations(authTokens, ({ one }) => ({
  user: one(users, { fields: [authTokens.userId], references: [users.id] }),
}));

// ============================================
// CHARACTERS TABLE
// ============================================

export const characters = pgTable("characters", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  classId: varchar("class_id", { length: 50 }), // warrior, mage, ranger, rogue, worge
  raceId: varchar("race_id", { length: 50 }),
  profession: varchar("profession", { length: 50 }),
  level: integer("level").default(1),
  experience: integer("experience").default(0),
  gold: integer("gold").default(1000),
  skillPoints: integer("skill_points").default(5),
  attributePoints: integer("attribute_points").default(0),
  attributes: jsonb("attributes").$type<{
    Strength: number;
    Vitality: number;
    Endurance: number;
    Intellect: number;
    Wisdom: number;
    Dexterity: number;
    Agility: number;
    Tactics: number;
  }>(),
  equipment: jsonb("equipment").$type<{
    head: string | null;
    chest: string | null;
    legs: string | null;
    feet: string | null;
    hands: string | null;
    shoulders: string | null;
    mainHand: string | null;
    offHand: string | null;
    accessory1: string | null;
    accessory2: string | null;
  }>(),
  professionProgression: jsonb("profession_progression"),
  currentHealth: integer("current_health"),
  currentMana: integer("current_mana"),
  currentStamina: integer("current_stamina"),
  avatarUrl: text("avatar_url"),

  // Cross-game identity
  factionId: varchar("faction_id", { length: 20 }), // crusade, fabled, legion — derived from race
  prefabId: varchar("prefab_id", { length: 100 }),   // e.g. human_warrior — for model resolution
  modelVariant: varchar("model_variant", { length: 50 }), // cosmetic variant override

  // Weapon skill proficiencies (leveled per weapon type)
  weaponSkills: jsonb("weapon_skills").$type<Record<string, number>>(), // e.g. { sword: 12, bow: 5 }

  // Game origin — which game/app created this character
  gameOrigin: varchar("game_origin", { length: 50 }), // grudge-wars, wcs, dcq, moba, babylon, island

  // cNFT Integration (inline quick-reference)
  cnftMintId: varchar("cnft_mint_id", { length: 100 }),
  cnftMetadataUri: text("cnft_metadata_uri"),
  cnftStatus: varchar("cnft_status", { length: 20 }), // pending, minted, failed

  createdAt: timestamp("created_at").defaultNow(),
});

export const charactersRelations = relations(
  characters,
  ({ one, many }) => ({
    user: one(users, {
      fields: [characters.userId],
      references: [users.id],
    }),
    inventoryItems: many(inventoryItems),
    craftedItems: many(craftedItems),
    unlockedSkills: many(unlockedSkills),
    unlockedRecipes: many(unlockedRecipes),
    craftingJobs: many(craftingJobs),
    shopTransactions: many(shopTransactions),
  })
);

// ============================================
// INVENTORY TABLE
// ============================================

export const inventoryItems = pgTable("inventory_items", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  itemType: varchar("item_type", { length: 50 }).notNull(),
  itemName: varchar("item_name", { length: 100 }).notNull(),
  quantity: integer("quantity").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const inventoryItemsRelations = relations(
  inventoryItems,
  ({ one }) => ({
    character: one(characters, {
      fields: [inventoryItems.characterId],
      references: [characters.id],
    }),
  })
);

// ============================================
// CRAFTED ITEMS TABLE
// ============================================

export const craftedItems = pgTable("crafted_items", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  itemName: varchar("item_name", { length: 100 }).notNull(),
  profession: varchar("profession", { length: 50 }),
  itemType: varchar("item_type", { length: 50 }).notNull(),
  tier: integer("tier").notNull(),
  equipped: boolean("equipped").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const craftedItemsRelations = relations(craftedItems, ({ one }) => ({
  character: one(characters, {
    fields: [craftedItems.characterId],
    references: [characters.id],
  }),
}));

// ============================================
// UNLOCKED SKILLS TABLE
// ============================================

export const unlockedSkills = pgTable("unlocked_skills", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  nodeId: varchar("node_id", { length: 50 }).notNull(),
  profession: varchar("profession", { length: 50 }).notNull(),
  skillName: varchar("skill_name", { length: 100 }).notNull(),
  tier: integer("tier").notNull(),
  unlockedAt: timestamp("unlocked_at").defaultNow(),
});

export const unlockedSkillsRelations = relations(
  unlockedSkills,
  ({ one }) => ({
    character: one(characters, {
      fields: [unlockedSkills.characterId],
      references: [characters.id],
    }),
  })
);

// ============================================
// UNLOCKED RECIPES TABLE
// ============================================

export const unlockedRecipes = pgTable("unlocked_recipes", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  recipeId: varchar("recipe_id", { length: 50 }).notNull(),
  source: varchar("source", { length: 50 }),
  unlockedAt: timestamp("unlocked_at").defaultNow(),
});

export const unlockedRecipesRelations = relations(
  unlockedRecipes,
  ({ one }) => ({
    character: one(characters, {
      fields: [unlockedRecipes.characterId],
      references: [characters.id],
    }),
  })
);

// ============================================
// CRAFTING JOBS TABLE
// ============================================

export const craftingJobs = pgTable("crafting_jobs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  recipeId: varchar("recipe_id", { length: 50 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  duration: integer("duration").notNull(),
  completesAt: timestamp("completes_at").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  inputItems: jsonb("input_items"),
  stationInstanceId: varchar("station_instance_id", { length: 50 }),
  profession: varchar("profession", { length: 50 }),
  tier: integer("tier").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const craftingJobsRelations = relations(craftingJobs, ({ one }) => ({
  character: one(characters, {
    fields: [craftingJobs.characterId],
    references: [characters.id],
  }),
}));

// ============================================
// SHOP TRANSACTIONS TABLE
// ============================================

export const shopTransactions = pgTable("shop_transactions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  transactionType: varchar("transaction_type", { length: 20 }).notNull(),
  itemCategory: varchar("item_category", { length: 50 }).notNull(),
  itemId: varchar("item_id", { length: 50 }).notNull(),
  itemName: varchar("item_name", { length: 100 }).notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: integer("unit_price").notNull(),
  totalPrice: integer("total_price").notNull(),
  tier: integer("tier"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const shopTransactionsRelations = relations(
  shopTransactions,
  ({ one }) => ({
    character: one(characters, {
      fields: [shopTransactions.characterId],
      references: [characters.id],
    }),
  })
);

// ============================================
// ISLANDS TABLE
// ============================================

export const islands = pgTable("islands", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 100 }).notNull(),
  islandType: varchar("island_type", { length: 50 }).notNull(),
  seed: integer("seed"),
  width: integer("width").default(130),
  height: integer("height").default(105),
  terrain: jsonb("terrain"),
  buildings: jsonb("buildings"),
  harvestNodes: jsonb("harvest_nodes"),
  campPosition: jsonb("camp_position"),
  data: jsonb("data"),
  lastVisited: timestamp("last_visited"),

  // cNFT Integration
  cnftMintId: varchar("cnft_mint_id", { length: 100 }),
  cnftMetadataUri: text("cnft_metadata_uri"),
  cnftStatus: varchar("cnft_status", { length: 20 }), // pending, minted, failed

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const islandsRelations = relations(islands, ({ one, many }) => ({
  user: one(users, { fields: [islands.userId], references: [users.id] }),
  aiAgents: many(aiAgents),
  gameSessions: many(gameSessions),
  afkJobs: many(afkJobs),
}));

// ============================================
// AI AGENTS TABLE
// ============================================

export const aiAgents = pgTable("ai_agents", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  characterId: varchar("character_id", { length: 36 }).references(
    () => characters.id
  ),
  islandId: varchar("island_id", { length: 36 }).references(() => islands.id),
  name: varchar("name", { length: 100 }).notNull(),
  agentType: varchar("agent_type", { length: 50 }).default("npc"),
  personality: text("personality").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  temperature: integer("temperature").default(70),
  maxTokens: integer("max_tokens").default(150),
  gameKnowledge: jsonb("game_knowledge"),
  behaviorFlags: jsonb("behavior_flags"),
  units: jsonb("units"),
  memory: jsonb("memory"),
  status: varchar("status", { length: 50 }).default("idle"),
  lastActionAt: timestamp("last_action_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const aiAgentsRelations = relations(aiAgents, ({ one }) => ({
  user: one(users, { fields: [aiAgents.userId], references: [users.id] }),
  character: one(characters, {
    fields: [aiAgents.characterId],
    references: [characters.id],
  }),
  island: one(islands, {
    fields: [aiAgents.islandId],
    references: [islands.id],
  }),
}));

// ============================================
// GAME SESSIONS TABLE
// ============================================

export const gameSessions = pgTable("game_sessions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  islandId: varchar("island_id", { length: 36 })
    .notNull()
    .references(() => islands.id),
  characterId: varchar("character_id", { length: 36 }).references(
    () => characters.id
  ),
  checkpoint: jsonb("checkpoint"),
  pendingResources: jsonb("pending_resources"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  isActive: boolean("is_active").default(true),
});

export const gameSessionsRelations = relations(
  gameSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [gameSessions.userId],
      references: [users.id],
    }),
    island: one(islands, {
      fields: [gameSessions.islandId],
      references: [islands.id],
    }),
    character: one(characters, {
      fields: [gameSessions.characterId],
      references: [characters.id],
    }),
    afkJobs: many(afkJobs),
  })
);

// ============================================
// AFK JOBS TABLE
// ============================================

export const afkJobs = pgTable("afk_jobs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  islandId: varchar("island_id", { length: 36 })
    .notNull()
    .references(() => islands.id),
  sessionId: varchar("session_id", { length: 36 }).references(
    () => gameSessions.id
  ),
  characterId: varchar("character_id", { length: 36 }).references(
    () => characters.id
  ),
  jobType: varchar("job_type", { length: 50 }).notNull(),
  targetNodeId: varchar("target_node_id", { length: 50 }),
  targetBuildingId: varchar("target_building_id", { length: 50 }),
  projectedYield: jsonb("projected_yield"),
  actualYield: jsonb("actual_yield"),
  startedAt: timestamp("started_at").defaultNow(),
  endsAt: timestamp("ends_at"),
  completedAt: timestamp("completed_at"),
  isCompleted: boolean("is_completed").default(false),
});

export const afkJobsRelations = relations(afkJobs, ({ one }) => ({
  user: one(users, { fields: [afkJobs.userId], references: [users.id] }),
  island: one(islands, {
    fields: [afkJobs.islandId],
    references: [islands.id],
  }),
  session: one(gameSessions, {
    fields: [afkJobs.sessionId],
    references: [gameSessions.id],
  }),
  character: one(characters, {
    fields: [afkJobs.characterId],
    references: [characters.id],
  }),
}));

// ============================================
// UUID LEDGER TABLE
// ============================================

export const uuidLedger = pgTable("uuid_ledger", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  grudgeUuid: varchar("grudge_uuid", { length: 50 }).notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  accountId: varchar("account_id", { length: 36 }).references(() => users.id),
  characterId: varchar("character_id", { length: 36 }).references(
    () => characters.id
  ),
  relatedUuids: jsonb("related_uuids"),
  outputUuid: varchar("output_uuid", { length: 50 }),
  previousState: jsonb("previous_state"),
  newState: jsonb("new_state"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const uuidLedgerRelations = relations(uuidLedger, ({ one }) => ({
  account: one(users, {
    fields: [uuidLedger.accountId],
    references: [users.id],
  }),
  character: one(characters, {
    fields: [uuidLedger.characterId],
    references: [characters.id],
  }),
}));

// ============================================
// RESOURCE LEDGER TABLE
// ============================================

export const resourceLedger = pgTable("resource_ledger", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  accountId: varchar("account_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  characterId: varchar("character_id", { length: 36 }).references(
    () => characters.id
  ),
  resourceName: varchar("resource_name", { length: 100 }).notNull(),
  quantity: integer("quantity").notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  sourceId: varchar("source_id", { length: 50 }),
  isCommitted: boolean("is_committed").default(false),
  committedAt: timestamp("committed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const resourceLedgerRelations = relations(
  resourceLedger,
  ({ one }) => ({
    account: one(users, {
      fields: [resourceLedger.accountId],
      references: [users.id],
    }),
    character: one(characters, {
      fields: [resourceLedger.characterId],
      references: [characters.id],
    }),
  })
);

// ============================================
// BATTLE ARENA STATS TABLE
// ============================================

export const battleArenaStats = pgTable("battle_arena_stats", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  totalKills: bigint("total_kills", { mode: "number" }).default(0),
  totalDeaths: bigint("total_deaths", { mode: "number" }).default(0),
  totalMatches: bigint("total_matches", { mode: "number" }).default(0),
  totalPlaytimeMinutes: integer("total_playtime_minutes").default(0),
  highestKillstreak: integer("highest_killstreak").default(0),
  createdAt: bigint("created_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: bigint("updated_at", { mode: "number" })
    .notNull()
    .$defaultFn(() => Date.now()),
});

export const battleArenaStatsRelations = relations(
  battleArenaStats,
  ({ one }) => ({
    user: one(users, {
      fields: [battleArenaStats.userId],
      references: [users.id],
    }),
  })
);

// ============================================
// GOLD TRANSACTIONS TABLE
// ============================================

export const goldTransactions = pgTable("gold_transactions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id),
  amount: integer("amount").notNull(), // positive = credit, negative = debit
  balanceAfter: integer("balance_after").notNull(),
  txType: varchar("tx_type", { length: 30 }).notNull(), // purchase, craft_cost, transfer_in, transfer_out, mission_reward, loot, admin
  refId: varchar("ref_id", { length: 100 }), // reference to related entity
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const goldTransactionsRelations = relations(goldTransactions, ({ one }) => ({
  user: one(users, { fields: [goldTransactions.userId], references: [users.id] }),
  character: one(characters, { fields: [goldTransactions.characterId], references: [characters.id] }),
}));

// ============================================
// MISSIONS TABLE
// ============================================

export const missions = pgTable("missions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  characterId: varchar("character_id", { length: 36 })
    .references(() => characters.id),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  missionType: varchar("mission_type", { length: 30 }).notNull(), // harvest, fight, sail, compete, explore
  objectives: jsonb("objectives"), // [{type, target, current, required}]
  rewards: jsonb("rewards"), // {gold, xp, items[]}
  status: varchar("status", { length: 20 }).notNull().default("active"), // active, completed, abandoned, expired
  difficulty: integer("difficulty").default(1), // 1-10
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const missionsRelations = relations(missions, ({ one }) => ({
  user: one(users, { fields: [missions.userId], references: [users.id] }),
  character: one(characters, { fields: [missions.characterId], references: [characters.id] }),
}));

// ============================================
// CREWS TABLE
// ============================================

export const crews = pgTable("crews", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 100 }).notNull().unique(),
  leaderId: varchar("leader_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  faction: varchar("faction", { length: 20 }), // order, chaos, neutral
  baseIslandId: varchar("base_island_id", { length: 36 })
    .references(() => islands.id),
  maxMembers: integer("max_members").default(5),
  isRecruiting: boolean("is_recruiting").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const crewMembers = pgTable("crew_members", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  crewId: varchar("crew_id", { length: 36 })
    .notNull()
    .references(() => crews.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  role: varchar("role", { length: 20 }).notNull().default("member"), // leader, officer, member
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const crewsRelations = relations(crews, ({ one, many }) => ({
  leader: one(users, { fields: [crews.leaderId], references: [users.id] }),
  baseIsland: one(islands, { fields: [crews.baseIslandId], references: [islands.id] }),
  members: many(crewMembers),
}));

export const crewMembersRelations = relations(crewMembers, ({ one }) => ({
  crew: one(crews, { fields: [crewMembers.crewId], references: [crews.id] }),
  user: one(users, { fields: [crewMembers.userId], references: [users.id] }),
}));

// ============================================
// COMBAT LOG TABLE
// ============================================

export const combatLog = pgTable("combat_log", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  attackerId: varchar("attacker_id", { length: 36 })
    .references(() => characters.id),
  defenderId: varchar("defender_id", { length: 36 })
    .references(() => characters.id),
  outcome: varchar("outcome", { length: 20 }).notNull(), // kill, death, flee, draw
  combatType: varchar("combat_type", { length: 20 }).notNull(), // pve, pvp, duel, arena
  combatData: jsonb("combat_data"), // {damage, abilities_used, duration_ms, etc}
  islandId: varchar("island_id", { length: 36 }).references(() => islands.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const combatLogRelations = relations(combatLog, ({ one }) => ({
  attacker: one(characters, { fields: [combatLog.attackerId], references: [characters.id] }),
  defender: one(characters, { fields: [combatLog.defenderId], references: [characters.id] }),
  island: one(islands, { fields: [combatLog.islandId], references: [islands.id] }),
}));

// ============================================
// P0 — GOULDSTONES (AI Companion Clones)
// ============================================

export const gouldstones = pgTable("gouldstones", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  ownerUserId: varchar("owner_user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 64 }).notNull(),
  raceId: varchar("race_id", { length: 32 }).notNull(),
  classId: varchar("class_id", { length: 32 }).notNull(),
  level: integer("level").default(1),
  stats: jsonb("stats").notNull(), // {hp, max_hp, strength, dexterity, intelligence, ...}
  gear: jsonb("gear").notNull(),   // [{item_key, slot, tier, item_type}, ...]
  professionLevels: jsonb("profession_levels").notNull(), // {mining, fishing, woodcutting, farming, hunting}
  behaviorProfile: varchar("behavior_profile", { length: 64 }).default("balanced"),
  faction: varchar("faction", { length: 32 }),
  source: varchar("source", { length: 20 }).default("vendor"), // vendor, boss_drop, crafted
  isActive: boolean("is_active").default(true),
  deployedIslandId: varchar("deployed_island_id", { length: 36 }).references(() => islands.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  ownerActiveIdx: index("gouldstones_owner_active_idx").on(table.ownerUserId, table.isActive),
}));

export const gouldstonesRelations = relations(gouldstones, ({ one }) => ({
  owner: one(users, { fields: [gouldstones.ownerUserId], references: [users.id] }),
  deployedIsland: one(islands, { fields: [gouldstones.deployedIslandId], references: [islands.id] }),
}));

// ============================================
// P0 — PROFESSION PROGRESS
// ============================================

export const professionProgress = pgTable("profession_progress", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  profession: varchar("profession", { length: 30 }).notNull(), // mining, fishing, woodcutting, farming, hunting
  xp: integer("xp").default(0),
  level: smallint("level").default(0), // 0-100
  milestone: smallint("milestone").default(0), // 0, 25, 50, 75, 100
  unlockedTier: smallint("unlocked_tier").default(1), // 1-5
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  charProfUnique: uniqueIndex("profession_progress_char_prof_uq").on(table.characterId, table.profession),
  charIdx: index("profession_progress_char_idx").on(table.characterId),
}));

export const professionProgressRelations = relations(professionProgress, ({ one }) => ({
  character: one(characters, { fields: [professionProgress.characterId], references: [characters.id] }),
  user: one(users, { fields: [professionProgress.userId], references: [users.id] }),
}));

// ============================================
// P0 — CRAFTING RECIPES
// ============================================

export const craftingRecipes = pgTable("crafting_recipes", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  recipeKey: varchar("recipe_key", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  outputItemKey: varchar("output_item_key", { length: 128 }).notNull(),
  outputItemType: varchar("output_item_type", { length: 30 }).notNull(), // weapon, armor, shield, off_hand, relic, cape, tome, wand
  outputTier: smallint("output_tier").notNull().default(1), // 1-6
  requiredProfession: varchar("required_profession", { length: 30 }).default("none"),
  requiredLevel: smallint("required_level").default(0),
  costGold: integer("cost_gold").default(0),
  costMaterials: jsonb("cost_materials"), // [{item_key, quantity}, ...]
  craftTimeSeconds: integer("craft_time_seconds").default(0),
  classRestriction: varchar("class_restriction", { length: 32 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  typeTierIdx: index("crafting_recipes_type_tier_idx").on(table.outputItemType, table.outputTier),
}));

// ============================================
// P0 — ISLAND STATE (World Islands)
// ============================================

export const islandState = pgTable("island_state", {
  islandKey: varchar("island_key", { length: 64 }).primaryKey(),
  displayName: varchar("display_name", { length: 128 }),
  controllingCrewId: varchar("controlling_crew_id", { length: 36 })
    .references(() => crews.id, { onDelete: "set null" }),
  claimFlagPlantedAt: timestamp("claim_flag_planted_at"),
  activePlayers: jsonb("active_players").default([]),
  resources: jsonb("resources").default({}),
  lastUpdated: timestamp("last_updated")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  crewIdx: index("island_state_crew_idx").on(table.controllingCrewId),
}));

export const islandStateRelations = relations(islandState, ({ one }) => ({
  controllingCrew: one(crews, { fields: [islandState.controllingCrewId], references: [crews.id] }),
}));

// ============================================
// P1 — USER PROFILES
// ============================================

export const userProfiles = pgTable("user_profiles", {
  userId: varchar("user_id", { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  avatarUrl: varchar("avatar_url", { length: 512 }),
  bio: text("bio"),
  socialLinks: jsonb("social_links"), // {twitter, discord_tag, twitch, youtube}
  country: varchar("country", { length: 4 }), // ISO 3166-1 alpha-2
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

// ============================================
// P1 — FRIENDSHIPS
// ============================================

export const friendships = pgTable("friendships", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  requesterUserId: varchar("requester_user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  addresseeUserId: varchar("addressee_user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 10 }).notNull().default("pending"), // pending, accepted, blocked
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  pairUnique: uniqueIndex("friendships_pair_uq").on(table.requesterUserId, table.addresseeUserId),
  addresseeIdx: index("friendships_addressee_idx").on(table.addresseeUserId, table.status),
}));

// ============================================
// P1 — NOTIFICATIONS
// ============================================

export const notifications = pgTable("notifications", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 64 }).notNull(), // friend_request, achievement, crew_invite, etc.
  payload: jsonb("payload"),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userUnreadIdx: index("notifications_user_unread_idx").on(table.userId, table.isRead, table.createdAt),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// ============================================
// P1 — ACHIEVEMENTS
// ============================================

export const achievementsDef = pgTable("achievements_def", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  achKey: varchar("ach_key", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  iconUrl: varchar("icon_url", { length: 512 }),
  points: smallint("points").default(10),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userAchievements = pgTable("user_achievements", {
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  achievementKey: varchar("achievement_key", { length: 128 })
    .notNull()
    .references(() => achievementsDef.achKey, { onDelete: "cascade" }),
  earnedAt: timestamp("earned_at").defaultNow(),
}, (table) => ({
  pk: uniqueIndex("user_achievements_pk").on(table.userId, table.achievementKey),
}));

// ============================================
// P1 — CLOUD SAVES
// ============================================

export const cloudSaves = pgTable("cloud_saves", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  characterId: varchar("character_id", { length: 36 })
    .references(() => characters.id, { onDelete: "set null" }),
  saveKey: varchar("save_key", { length: 128 }).notNull(), // autosave, checkpoint_1, export
  puterPath: varchar("puter_path", { length: 512 }).notNull(),
  sizeBytes: integer("size_bytes").default(0),
  checksum: varchar("checksum", { length: 64 }),
  syncedAt: timestamp("synced_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  charSaveUnique: uniqueIndex("cloud_saves_char_save_uq").on(table.userId, table.characterId, table.saveKey),
  userSavesIdx: index("cloud_saves_user_idx").on(table.userId, table.syncedAt),
}));

export const cloudSavesRelations = relations(cloudSaves, ({ one }) => ({
  user: one(users, { fields: [cloudSaves.userId], references: [users.id] }),
  character: one(characters, { fields: [cloudSaves.characterId], references: [characters.id] }),
}));

// ============================================
// P2 — PVP LOBBIES
// ============================================

export const pvpLobbies = pgTable("pvp_lobbies", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  lobbyCode: varchar("lobby_code", { length: 8 }).notNull().unique(),
  mode: varchar("mode", { length: 20 }).notNull().default("duel"), // duel, crew_battle, arena_ffa
  island: varchar("island", { length: 64 }).notNull().default("spawn"),
  hostUserId: varchar("host_user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("waiting"), // waiting, ready, in_progress, finished, cancelled
  maxPlayers: smallint("max_players").notNull().default(2),
  settings: jsonb("settings").default({}), // {friendly_fire, time_limit_s, respawns, wager_gold}
  createdAt: timestamp("created_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, (table) => ({
  statusIdx: index("pvp_lobbies_status_idx").on(table.status, table.createdAt),
  hostIdx: index("pvp_lobbies_host_idx").on(table.hostUserId),
}));

export const pvpLobbyPlayers = pgTable("pvp_lobby_players", {
  lobbyId: varchar("lobby_id", { length: 36 })
    .notNull()
    .references(() => pvpLobbies.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  team: smallint("team").notNull().default(0), // 0=FFA, 1=red, 2=blue
  isReady: boolean("is_ready").notNull().default(false),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (table) => ({
  pk: uniqueIndex("pvp_lobby_players_pk").on(table.lobbyId, table.userId),
  lobbyIdx: index("pvp_lobby_players_lobby_idx").on(table.lobbyId, table.isReady),
}));

export const pvpMatches = pgTable("pvp_matches", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  lobbyId: varchar("lobby_id", { length: 36 })
    .notNull()
    .references(() => pvpLobbies.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 20 }).notNull(),
  island: varchar("island", { length: 64 }).notNull(),
  winnerUserId: varchar("winner_user_id", { length: 36 }),
  winnerTeam: smallint("winner_team"),
  durationMs: integer("duration_ms").default(0),
  matchData: jsonb("match_data").default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  winnerIdx: index("pvp_matches_winner_idx").on(table.winnerUserId, table.createdAt),
  modeIdx: index("pvp_matches_mode_idx").on(table.mode, table.createdAt),
}));

export const pvpRatings = pgTable("pvp_ratings", {
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 20 }).notNull(), // duel, crew_battle, arena_ffa
  rating: integer("rating").notNull().default(1200),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  draws: integer("draws").default(0),
  streak: integer("streak").default(0),
  peakRating: integer("peak_rating").notNull().default(1200),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  pk: uniqueIndex("pvp_ratings_pk").on(table.userId, table.mode),
  ratingIdx: index("pvp_ratings_rating_idx").on(table.mode, table.rating),
}));

// ============================================
// P3 — MOBA HEROES
// ============================================

export const mobaHeroes = pgTable("moba_heroes", {
  id: integer("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  title: varchar("title", { length: 128 }).notNull(),
  race: varchar("race", { length: 32 }).notNull(),
  heroClass: varchar("hero_class", { length: 32 }).notNull(),
  faction: varchar("faction", { length: 32 }).notNull(),
  rarity: varchar("rarity", { length: 32 }).notNull().default("Common"),
  hp: integer("hp").notNull().default(200),
  atk: integer("atk").notNull().default(20),
  def: integer("def").notNull().default(10),
  spd: integer("spd").notNull().default(60),
  rng: decimal("rng", { precision: 4, scale: 1 }).notNull().default("1.5"),
  mp: integer("mp").notNull().default(100),
  quote: text("quote"),
  isSecret: boolean("is_secret").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  classIdx: index("moba_heroes_class_idx").on(table.heroClass),
  factionIdx: index("moba_heroes_faction_idx").on(table.faction),
}));

// ============================================
// P3 — MOBA ABILITIES
// ============================================

export const mobaAbilities = pgTable("moba_abilities", {
  id: serial("id").primaryKey(),
  abilityClass: varchar("ability_class", { length: 64 }).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  hotkey: varchar("hotkey", { length: 1 }).notNull(),
  cooldown: decimal("cooldown", { precision: 5, scale: 1 }).notNull().default("0"),
  manaCost: integer("mana_cost").notNull().default(0),
  damage: integer("damage").notNull().default(0),
  abilityRange: integer("ability_range").notNull().default(0),
  radius: integer("radius").notNull().default(0),
  duration: decimal("duration", { precision: 5, scale: 1 }).notNull().default("0"),
  abilityType: varchar("ability_type", { length: 20 }).notNull().default("damage"),
  castType: varchar("cast_type", { length: 20 }).notNull().default("targeted"),
  description: text("description"),
  maxCharges: integer("max_charges"),
  chargeRecharge: decimal("charge_recharge", { precision: 5, scale: 1 }),
}, (table) => ({
  classIdx: index("moba_abilities_class_idx").on(table.abilityClass),
}));

// ============================================
// P3 — MOBA ITEMS
// ============================================

export const mobaItems = pgTable("moba_items", {
  id: integer("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  cost: integer("cost").notNull().default(0),
  hp: integer("hp").notNull().default(0),
  atk: integer("atk").notNull().default(0),
  def: integer("def").notNull().default(0),
  spd: integer("spd").notNull().default(0),
  mp: integer("mp").notNull().default(0),
  description: text("description"),
  tier: smallint("tier").notNull().default(1),
});

// ============================================
// P3 — DUNGEON RUNS
// ============================================

export const dungeonRuns = pgTable("dungeon_runs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  heroId: integer("hero_id").notNull(),
  heroName: varchar("hero_name", { length: 128 }).notNull(),
  heroClass: varchar("hero_class", { length: 32 }).notNull(),
  floorsReached: integer("floors_reached").notNull().default(1),
  kills: integer("kills").notNull().default(0),
  goldEarned: integer("gold_earned").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  outcome: varchar("outcome", { length: 20 }).notNull().default("died"), // cleared, died, abandoned
  runData: jsonb("run_data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  playerIdx: index("dungeon_runs_player_idx").on(table.userId, table.createdAt),
  leaderboardIdx: index("dungeon_runs_leaderboard_idx").on(table.floorsReached, table.durationMs),
}));

export const dungeonRunsRelations = relations(dungeonRuns, ({ one }) => ({
  user: one(users, { fields: [dungeonRuns.userId], references: [users.id] }),
}));

// ============================================
// P3 — MOBA MATCH RESULTS
// ============================================

export const mobaMatchResults = pgTable("moba_match_results", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  heroName: varchar("hero_name", { length: 128 }).notNull(),
  heroClass: varchar("hero_class", { length: 32 }).notNull(),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  assists: integer("assists").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  win: boolean("win").notNull().default(false),
  matchData: jsonb("match_data"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  playerIdx: index("moba_results_player_idx").on(table.userId, table.createdAt),
  leaderboardIdx: index("moba_results_leaderboard_idx").on(table.win, table.kills),
}));

export const mobaMatchResultsRelations = relations(mobaMatchResults, ({ one }) => ({
  user: one(users, { fields: [mobaMatchResults.userId], references: [users.id] }),
}));

// ============================================
// P3 — PLAYER ISLANDS (home bases, separate from world islands)
// ============================================

export const playerIslands = pgTable("player_islands", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 128 }).notNull(),
  zoneData: jsonb("zone_data"),
  conquerProgress: jsonb("conquer_progress"),
  questProgress: jsonb("quest_progress"),
  unlockedLocations: jsonb("unlocked_locations"),
  harvestState: jsonb("harvest_state"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  userIdx: index("player_islands_user_idx").on(table.userId),
}));

export const playerIslandsRelations = relations(playerIslands, ({ one }) => ({
  user: one(users, { fields: [playerIslands.userId], references: [users.id] }),
}));

// ============================================
// P4 — LAUNCHER VERSIONS
// ============================================

export const launcherVersions = pgTable("launcher_versions", {
  id: serial("id").primaryKey(),
  version: varchar("version", { length: 32 }).notNull().unique(),
  channel: varchar("channel", { length: 10 }).default("stable"), // stable, beta, dev
  windowsUrl: varchar("windows_url", { length: 1024 }),
  windowsSha256: varchar("windows_sha256", { length: 64 }),
  macUrl: varchar("mac_url", { length: 1024 }),
  macSha256: varchar("mac_sha256", { length: 64 }),
  linuxUrl: varchar("linux_url", { length: 1024 }),
  linuxSha256: varchar("linux_sha256", { length: 64 }),
  patchNotes: text("patch_notes"),
  minVersion: varchar("min_version", { length: 32 }),
  isCurrent: boolean("is_current").default(false),
  publishedAt: timestamp("published_at").defaultNow(),
});

// ============================================
// P4 — COMPUTER REGISTRATIONS
// ============================================

export const computerRegistrations = pgTable("computer_registrations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  computerId: varchar("computer_id", { length: 128 }).notNull().unique(),
  fingerprintHash: varchar("fingerprint_hash", { length: 64 }),
  platform: varchar("platform", { length: 32 }),
  label: varchar("label", { length: 64 }),
  launcherVersion: varchar("launcher_version", { length: 32 }),
  firstSeen: timestamp("first_seen").defaultNow(),
  lastSeen: timestamp("last_seen")
    .defaultNow()
    .$onUpdate(() => new Date()),
  isRevoked: boolean("is_revoked").default(false),
}, (table) => ({
  ownerIdx: index("computer_registrations_owner_idx").on(table.userId, table.isRevoked),
}));

export const computerRegistrationsRelations = relations(computerRegistrations, ({ one }) => ({
  user: one(users, { fields: [computerRegistrations.userId], references: [users.id] }),
}));

// ============================================
// P4 — LAUNCH TOKENS
// ============================================

export const launchTokens = pgTable("launch_tokens", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 256 }).notNull().unique(),
  computerId: varchar("computer_id", { length: 128 }),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  tokenLookupIdx: index("launch_tokens_lookup_idx").on(table.token, table.used, table.expiresAt),
}));

// ============================================
// P4 — GRUDGE DEVICES (GRUDA Node pairing)
// ============================================

export const grudgeDevices = pgTable("grudge_devices", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  code: varchar("code", { length: 6 }).notNull().unique(),
  deviceId: varchar("device_id", { length: 128 }).notNull(),
  deviceName: varchar("device_name", { length: 64 }).default("GRUDA Node"),
  deviceType: varchar("device_type", { length: 32 }).default("node"), // node, mobile, desktop, web
  userId: varchar("user_id", { length: 36 })
    .references(() => users.id, { onDelete: "set null" }),
  status: varchar("status", { length: 10 }).notNull().default("pending"), // pending, approved, expired, revoked
  ip: varchar("ip", { length: 64 }),
  pairedAt: timestamp("paired_at"),
  lastSeen: timestamp("last_seen"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  codeIdx: index("grudge_devices_code_idx").on(table.code),
  userIdx: index("grudge_devices_user_idx").on(table.userId),
  statusIdx: index("grudge_devices_status_idx").on(table.status),
}));

export const grudgeDevicesRelations = relations(grudgeDevices, ({ one }) => ({
  user: one(users, { fields: [grudgeDevices.userId], references: [users.id] }),
}));

// ============================================
// P4 — WALLET INDEX (HD derivation counter)
// ============================================

export const walletIndex = pgTable("wallet_index", {
  id: serial("id").primaryKey(),
  nextIndex: integer("next_index").default(0),
});

// ============================================
// P5 — ASSETS (R2 metadata)
// ============================================

export const assets = pgTable("assets", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  r2Key: varchar("r2_key", { length: 512 }).notNull().unique(),
  filename: varchar("filename", { length: 256 }).notNull(),
  mime: varchar("mime", { length: 128 }),
  size: bigint("size", { mode: "number" }).default(0),
  sha256: varchar("sha256", { length: 64 }),
  category: varchar("category", { length: 20 }).notNull().default("other"),
  tags: jsonb("tags"),
  visibility: varchar("visibility", { length: 10 }).notNull().default("public"),
  ownerUserId: varchar("owner_user_id", { length: 36 })
    .references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  isDeleted: boolean("is_deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  categoryIdx: index("assets_category_idx").on(table.category, table.isDeleted),
  ownerIdx: index("assets_owner_idx").on(table.ownerUserId, table.isDeleted),
}));

export const assetsRelations = relations(assets, ({ one }) => ({
  owner: one(users, { fields: [assets.ownerUserId], references: [users.id] }),
}));

// ============================================
// P5 — ASSET CONVERSIONS
// ============================================

export const assetConversions = pgTable("asset_conversions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sourceAssetId: varchar("source_asset_id", { length: 36 })
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  outputAssetId: varchar("output_asset_id", { length: 36 })
    .references(() => assets.id, { onDelete: "set null" }),
  inputFormat: varchar("input_format", { length: 32 }).notNull(),
  outputFormat: varchar("output_format", { length: 32 }).notNull(),
  status: varchar("status", { length: 15 }).notNull().default("queued"), // queued, processing, completed, failed
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  statusIdx: index("asset_conversions_status_idx").on(table.status, table.createdAt),
}));

// ============================================
// P5 — ASSET BUNDLES
// ============================================

export const assetBundles = pgTable("asset_bundles", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  ownerUserId: varchar("owner_user_id", { length: 36 })
    .references(() => users.id, { onDelete: "set null" }),
  r2Key: varchar("r2_key", { length: 512 }),
  size: bigint("size", { mode: "number" }).default(0),
  status: varchar("status", { length: 10 }).notNull().default("building"), // building, ready, failed
  createdAt: timestamp("created_at").defaultNow(),
});

export const assetBundleItems = pgTable("asset_bundle_items", {
  bundleId: varchar("bundle_id", { length: 36 })
    .notNull()
    .references(() => assetBundles.id, { onDelete: "cascade" }),
  assetId: varchar("asset_id", { length: 36 })
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: uniqueIndex("asset_bundle_items_pk").on(table.bundleId, table.assetId),
}));

// ============================================
// P5 — ARENA TEAMS
// ============================================

export const arenaTeams = pgTable("arena_teams", {
  teamId: varchar("team_id", { length: 64 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  ownerName: varchar("owner_name", { length: 128 }).notNull().default("Unknown Warlord"),
  status: varchar("status", { length: 32 }).notNull().default("ranked"),
  heroes: jsonb("heroes").notNull(),
  heroCount: integer("hero_count").notNull().default(0),
  avgLevel: integer("avg_level").notNull().default(1),
  shareToken: varchar("share_token", { length: 64 }),
  snapshotHash: varchar("snapshot_hash", { length: 64 }),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  totalBattles: integer("total_battles").notNull().default(0),
  rewards: jsonb("rewards").notNull().default({ gold: 0, resources: 0, equipment: [] }),
  demotedAt: timestamp("demoted_at"),
  demoteReason: text("demote_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  winsIdx: index("arena_teams_wins_idx").on(table.wins),
  ownerIdx: index("arena_teams_owner_idx").on(table.ownerId),
  statusIdx: index("arena_teams_status_idx").on(table.status),
}));

// ============================================
// P5 — ARENA BATTLES
// ============================================

export const arenaBattles = pgTable("arena_battles", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  battleId: varchar("battle_id", { length: 64 }).notNull(),
  teamId: varchar("team_id", { length: 64 }).notNull(),
  challengerName: varchar("challenger_name", { length: 128 }).notNull().default("Arena Challenger"),
  result: varchar("result", { length: 32 }).notNull(), // win, loss, draw
  battleLog: jsonb("battle_log"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  teamIdx: index("arena_battles_team_idx").on(table.teamId),
  createdIdx: index("arena_battles_created_idx").on(table.createdAt),
}));

// ============================================
// CHARACTER NFTS — Detailed Solana cNFT tracking
// Mirrors grudge-builder's characterNFTs table
// ============================================

export const characterNfts = pgTable("character_nfts", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),

  characterId: varchar("character_id", { length: 36 })
    .notNull()
    .unique()
    .references(() => characters.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // NFT identifiers
  mintAddress: text("mint_address"),           // Solana mint address once minted
  assetId: text("asset_id"),                   // Compressed NFT asset ID (Metaplex Read API)
  collectionAddress: text("collection_address"),// Collection the NFT belongs to

  // NFT metadata
  metadataUri: text("metadata_uri"),           // Arweave/IPFS URI for off-chain metadata
  imageUri: text("image_uri"),                 // Permanent avatar image URL

  // Status tracking
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  // pending | minting | minted | upgrading | transferred | burned
  isCompressed: boolean("is_compressed").notNull().default(true),

  // Crossmint tracking
  crossmintActionId: text("crossmint_action_id"),

  // Ownership
  ownerWalletAddress: text("owner_wallet_address"),
  mintedToExternal: boolean("minted_to_external").notNull().default(false),

  // Timestamps
  mintedAt: timestamp("minted_at"),
  upgradedAt: timestamp("upgraded_at"),
  transferredAt: timestamp("transferred_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const characterNftsRelations = relations(characterNfts, ({ one }) => ({
  character: one(characters, {
    fields: [characterNfts.characterId],
    references: [characters.id],
  }),
  user: one(users, {
    fields: [characterNfts.userId],
    references: [users.id],
  }),
}));

// ============================================
// INSERT SCHEMAS (Zod validation)
// ============================================

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCharacterSchema = createInsertSchema(characters).omit({ id: true, createdAt: true });
export const insertAuthTokenSchema = createInsertSchema(authTokens).omit({ id: true });
export const insertAuthProviderSchema = createInsertSchema(authProviders).omit({ id: true, createdAt: true });
export const insertWalletSchema = createInsertSchema(wallets).omit({ id: true, createdAt: true });
export const insertGouldstoneSchema = createInsertSchema(gouldstones).omit({ id: true, createdAt: true });
export const insertCraftingRecipeSchema = createInsertSchema(craftingRecipes).omit({ id: true, createdAt: true });
export const insertMobaHeroSchema = createInsertSchema(mobaHeroes).omit({ createdAt: true });
export const insertCharacterNftSchema = createInsertSchema(characterNfts).omit({ id: true, createdAt: true, updatedAt: true });

// ============================================
// TYPES
// ============================================

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Character = typeof characters.$inferSelect;
export type InsertCharacter = z.infer<typeof insertCharacterSchema>;
export type AuthToken = typeof authTokens.$inferSelect;
export type AuthProvider = typeof authProviders.$inferSelect;
export type Island = typeof islands.$inferSelect;
export type AiAgent = typeof aiAgents.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
export type BattleArenaStat = typeof battleArenaStats.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type WalletNonce = typeof walletNonces.$inferSelect;
export type Gouldstone = typeof gouldstones.$inferSelect;
export type InsertGouldstone = z.infer<typeof insertGouldstoneSchema>;
export type ProfessionProgress = typeof professionProgress.$inferSelect;
export type CraftingRecipe = typeof craftingRecipes.$inferSelect;
export type InsertCraftingRecipe = z.infer<typeof insertCraftingRecipeSchema>;
export type IslandState = typeof islandState.$inferSelect;
export type UserProfile = typeof userProfiles.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AchievementDef = typeof achievementsDef.$inferSelect;
export type CloudSave = typeof cloudSaves.$inferSelect;
export type PvpLobby = typeof pvpLobbies.$inferSelect;
export type PvpMatch = typeof pvpMatches.$inferSelect;
export type PvpRating = typeof pvpRatings.$inferSelect;
export type MobaHero = typeof mobaHeroes.$inferSelect;
export type InsertMobaHero = z.infer<typeof insertMobaHeroSchema>;
export type MobaAbility = typeof mobaAbilities.$inferSelect;
export type MobaItem = typeof mobaItems.$inferSelect;
export type DungeonRun = typeof dungeonRuns.$inferSelect;
export type MobaMatchResult = typeof mobaMatchResults.$inferSelect;
export type PlayerIsland = typeof playerIslands.$inferSelect;
export type LauncherVersion = typeof launcherVersions.$inferSelect;
export type ComputerRegistration = typeof computerRegistrations.$inferSelect;
export type GrudgeDevice = typeof grudgeDevices.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type ArenaTeam = typeof arenaTeams.$inferSelect;
export type ArenaBattle = typeof arenaBattles.$inferSelect;
export type CharacterNft = typeof characterNfts.$inferSelect;
export type InsertCharacterNft = z.infer<typeof insertCharacterNftSchema>;
