CREATE TABLE "afk_jobs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"island_id" varchar(36) NOT NULL,
	"session_id" varchar(36),
	"character_id" varchar(36),
	"job_type" varchar(50) NOT NULL,
	"target_node_id" varchar(50),
	"target_building_id" varchar(50),
	"projected_yield" jsonb,
	"actual_yield" jsonb,
	"started_at" timestamp DEFAULT now(),
	"ends_at" timestamp,
	"completed_at" timestamp,
	"is_completed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"character_id" varchar(36),
	"island_id" varchar(36),
	"name" varchar(100) NOT NULL,
	"agent_type" varchar(50) DEFAULT 'npc',
	"personality" text NOT NULL,
	"system_prompt" text NOT NULL,
	"temperature" integer DEFAULT 70,
	"max_tokens" integer DEFAULT 150,
	"game_knowledge" jsonb,
	"behavior_flags" jsonb,
	"units" jsonb,
	"memory" jsonb,
	"status" varchar(50) DEFAULT 'idle',
	"last_action_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_providers" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"account_id" varchar(36) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_id" varchar(255) NOT NULL,
	"profile_data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"token" varchar(255) NOT NULL,
	"token_type" varchar(20) NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"device_info" jsonb,
	"ip_address" varchar(45),
	CONSTRAINT "auth_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "battle_arena_stats" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"total_kills" bigint DEFAULT 0,
	"total_deaths" bigint DEFAULT 0,
	"total_matches" bigint DEFAULT 0,
	"total_playtime_minutes" integer DEFAULT 0,
	"highest_killstreak" integer DEFAULT 0,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36),
	"name" varchar(100) NOT NULL,
	"class_id" varchar(50),
	"race_id" varchar(50),
	"profession" varchar(50),
	"level" integer DEFAULT 1,
	"experience" integer DEFAULT 0,
	"gold" integer DEFAULT 1000,
	"skill_points" integer DEFAULT 5,
	"attribute_points" integer DEFAULT 0,
	"attributes" jsonb,
	"equipment" jsonb,
	"profession_progression" jsonb,
	"current_health" integer,
	"current_mana" integer,
	"current_stamina" integer,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crafted_items" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"character_id" varchar(36) NOT NULL,
	"item_name" varchar(100) NOT NULL,
	"profession" varchar(50),
	"item_type" varchar(50) NOT NULL,
	"tier" integer NOT NULL,
	"equipped" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crafting_jobs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"character_id" varchar(36) NOT NULL,
	"recipe_id" varchar(50) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"duration" integer NOT NULL,
	"completes_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"input_items" jsonb,
	"station_instance_id" varchar(50),
	"profession" varchar(50),
	"tier" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"island_id" varchar(36) NOT NULL,
	"character_id" varchar(36),
	"checkpoint" jsonb,
	"pending_resources" jsonb,
	"started_at" timestamp DEFAULT now(),
	"ended_at" timestamp,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"character_id" varchar(36) NOT NULL,
	"item_type" varchar(50) NOT NULL,
	"item_name" varchar(100) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "islands" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"name" varchar(100) NOT NULL,
	"island_type" varchar(50) NOT NULL,
	"seed" integer,
	"width" integer DEFAULT 130,
	"height" integer DEFAULT 105,
	"terrain" jsonb,
	"buildings" jsonb,
	"harvest_nodes" jsonb,
	"camp_position" jsonb,
	"data" jsonb,
	"last_visited" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "resource_ledger" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"account_id" varchar(36) NOT NULL,
	"character_id" varchar(36),
	"resource_name" varchar(100) NOT NULL,
	"quantity" integer NOT NULL,
	"source" varchar(50) NOT NULL,
	"source_id" varchar(50),
	"is_committed" boolean DEFAULT false,
	"committed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shop_transactions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"character_id" varchar(36) NOT NULL,
	"transaction_type" varchar(20) NOT NULL,
	"item_category" varchar(50) NOT NULL,
	"item_id" varchar(50) NOT NULL,
	"item_name" varchar(100) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"total_price" integer NOT NULL,
	"tier" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unlocked_recipes" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"character_id" varchar(36) NOT NULL,
	"recipe_id" varchar(50) NOT NULL,
	"source" varchar(50),
	"unlocked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unlocked_skills" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"character_id" varchar(36) NOT NULL,
	"node_id" varchar(50) NOT NULL,
	"profession" varchar(50) NOT NULL,
	"skill_name" varchar(100) NOT NULL,
	"tier" integer NOT NULL,
	"unlocked_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"email" varchar(255),
	"password" varchar(255),
	"display_name" varchar(100),
	"avatar_url" text,
	"puter_id" varchar(100),
	"wallet_address" varchar(100),
	"crossmint_wallet_id" varchar(100),
	"crossmint_email" varchar(255),
	"wallet_type" varchar(20),
	"faction" varchar(20),
	"faction_reputation" integer DEFAULT 0,
	"has_home_island" boolean DEFAULT false,
	"is_premium" boolean DEFAULT false,
	"premium_until" timestamp,
	"is_guest" boolean DEFAULT false,
	"email_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_login_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "uuid_ledger" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"grudge_uuid" varchar(50) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"account_id" varchar(36),
	"character_id" varchar(36),
	"related_uuids" jsonb,
	"output_uuid" varchar(50),
	"previous_state" jsonb,
	"new_state" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "afk_jobs" ADD CONSTRAINT "afk_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "afk_jobs" ADD CONSTRAINT "afk_jobs_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "afk_jobs" ADD CONSTRAINT "afk_jobs_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "afk_jobs" ADD CONSTRAINT "afk_jobs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_providers" ADD CONSTRAINT "auth_providers_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_arena_stats" ADD CONSTRAINT "battle_arena_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafted_items" ADD CONSTRAINT "crafted_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crafting_jobs" ADD CONSTRAINT "crafting_jobs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_island_id_islands_id_fk" FOREIGN KEY ("island_id") REFERENCES "public"."islands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "islands" ADD CONSTRAINT "islands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD CONSTRAINT "resource_ledger_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_ledger" ADD CONSTRAINT "resource_ledger_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_transactions" ADD CONSTRAINT "shop_transactions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlocked_recipes" ADD CONSTRAINT "unlocked_recipes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unlocked_skills" ADD CONSTRAINT "unlocked_skills_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uuid_ledger" ADD CONSTRAINT "uuid_ledger_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uuid_ledger" ADD CONSTRAINT "uuid_ledger_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;