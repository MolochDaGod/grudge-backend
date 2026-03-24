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

  // cNFT Integration
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
// INSERT SCHEMAS (Zod validation)
// ============================================

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCharacterSchema = createInsertSchema(characters).omit({ id: true, createdAt: true });
export const insertAuthTokenSchema = createInsertSchema(authTokens).omit({ id: true });
export const insertAuthProviderSchema = createInsertSchema(authProviders).omit({ id: true, createdAt: true });
export const insertWalletSchema = createInsertSchema(wallets).omit({ id: true, createdAt: true });

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
