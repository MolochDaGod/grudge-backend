import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { db, pool } from "./db.js";
import { users, characters, islands } from "../shared/schema.js";
import { mintCharacterCNFT, mintIslandCNFT } from "./lib/crossmint.js";
import {
  authMiddleware,
  registerUser,
  loginUser,
  guestLogin,
  puterLogin,
  discordLogin,
  googleLogin,
  githubLogin,
  verifyJwt,
  generateGrudgeId,
  buildAuthResponse,
  cleanupExpiredTokens,
  type AuthenticatedRequest,
} from "./auth.js";
import walletRouter from "./routes/wallet.js";
import walletAuthRouter from "./routes/wallet-auth.js";
import studioSyncRouter from "./routes/studio-sync.js";
import assetsRouter from "./routes/assets.js";
import economyRouter from "./routes/economy.js";
import missionsRouter from "./routes/missions.js";
import combatRouter from "./routes/combat.js";
import crewsRouter from "./routes/crews.js";
import craftingRouter from "./routes/crafting.js";
import aiRouter from "./routes/ai.js";

// ============================================
// GAME CONSTANTS
// ============================================

// ── Canonical Game Data (shared with all frontends) ──
import {
  RACES, FACTIONS, RACE_LIST, VALID_RACE_IDS,
  type RaceId, type FactionId, type AttributeKey,
} from "../shared/gameData/races.js";
import {
  CLASSES, CLASS_LIST, VALID_CLASS_IDS, CLASS_TIERS,
  buildPrefabId, type ClassId,
} from "../shared/gameData/classes.js";

const SPAWN_LOCATIONS = {
  naboo: { theed: { x: -4856, y: 6, z: 4162 }, moenia: { x: 4732, y: 4, z: -4677 } },
  tatooine: { mos_eisley: { x: 3528, y: 5, z: -4804 }, bestine: { x: -1290, y: 12, z: -3590 } },
  tutorial: { start: { x: -4, y: 0, z: -4 } },
};

// OAuth configs
const GOOGLE_CONFIG = {
  clientId: process.env.GOOGLE_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  redirectUri: process.env.GOOGLE_REDIRECT_URI || "https://api.grudge-studio.com/auth/google/callback",
};

const GITHUB_CONFIG = {
  clientId: process.env.GITHUB_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  redirectUri: process.env.GITHUB_REDIRECT_URI || "https://api.grudge-studio.com/auth/github/callback",
};

const DISCORD_CONFIG = {
  clientId: process.env.DISCORD_CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  redirectUri: process.env.DISCORD_REDIRECT_URI || "http://localhost:5000/auth/discord/callback",
};

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ============================================
// REGISTER ALL ROUTES
// ============================================

export async function registerRoutes(app: Express): Promise<Server> {
  // ---------- AUTH ROUTES ----------

  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password)
        return res.status(400).json({ error: "Username and password required" });
      const result = await registerUser(username, password, email);
      res.status(201).json(await buildAuthResponse(result.user, result.token));
    } catch (error: any) {
      if (error.message === "Username already exists")
        return res.status(409).json({ error: error.message });
      console.error("Register error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password)
        return res.status(400).json({ error: "Username and password required" });
      const result = await loginUser(username, password);
      res.json(await buildAuthResponse(result.user, result.token));
    } catch (error: any) {
      if (error.message === "Invalid credentials")
        return res.status(401).json({ error: error.message });
      console.error("Login error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/auth/guest", async (_req, res) => {
    try {
      const result = await guestLogin();
      res.status(201).json(await buildAuthResponse(result.user, result.token));
    } catch (error) {
      console.error("Guest login error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/auth/puter", async (req, res) => {
    try {
      const { puterId, displayName } = req.body;
      if (!puterId) return res.status(400).json({ error: "puterId required" });
      const result = await puterLogin(puterId, displayName);
      res.json(await buildAuthResponse(result.user, result.token, ["puter"]));
    } catch (error) {
      console.error("Puter login error:", error);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.post("/api/auth/verify", (req, res) => {
    const { token } = req.body;
    const decoded = verifyJwt(token);
    if (!decoded) {
      return res.status(401).json({ valid: false });
    }
    res.json({ valid: true, user: decoded });
  });

  // GET /api/auth/user — return profile from Bearer token (used by Grudge SDK)
  app.get(
    "/api/auth/user",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const [user] = await db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            email: users.email,
            avatarUrl: users.avatarUrl,
            isGuest: users.isGuest,
            isPremium: users.isPremium,
            faction: users.faction,
            hasHomeIsland: users.hasHomeIsland,
          })
          .from(users)
          .where(eq(users.id, req.user!.userId))
          .limit(1);

        if (!user) return res.status(404).json({ error: "User not found" });
        const grudgeId = generateGrudgeId(user.id);
        res.json({ success: true, ...user, grudgeId });
      } catch (error) {
        console.error("Get auth user error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  // POST /api/auth/logout — revoke token
  app.post("/api/auth/logout", (req, res) => {
    // JWT is stateless; client drops the token.
    // If a db token was tracked it would be revoked here.
    res.json({ success: true, message: "Logged out" });
  });

  // ---------- /auth/* ALIASES (id-domain compat) ----------
  // Allows id.grudge-studio.com (CNAME → api.grudge-studio.com) to serve
  // auth requests without the /api prefix.
  app.post("/auth/login",    (req, res) => res.redirect(307, "/api/auth/login"));
  app.post("/auth/register", (req, res) => res.redirect(307, "/api/auth/register"));
  app.post("/auth/guest",    (req, res) => res.redirect(307, "/api/auth/guest"));
  app.post("/auth/puter",    (req, res) => res.redirect(307, "/api/auth/puter"));
  app.post("/auth/verify",   (req, res) => res.redirect(307, "/api/auth/verify"));
  app.get("/auth/user",      (req, res) => res.redirect(307, "/api/auth/user"));
  app.post("/auth/logout",   (req, res) => res.redirect(307, "/api/auth/logout"));
  app.post("/auth/wallet",   (req, res) => res.redirect(307, "/api/auth/wallet"));
  app.get("/auth/nonce",     (req, res) => res.redirect(307, "/api/auth/nonce"));
  // Google + GitHub use their own full callback handlers above (not redirected)

  // ---------- DISCORD OAUTH ----------

  app.get("/auth/discord", (_req, res) => {
    if (!DISCORD_CONFIG.clientId) {
      return res.status(503).json({ error: "Discord not configured" });
    }
    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: DISCORD_CONFIG.clientId,
      redirect_uri: DISCORD_CONFIG.redirectUri,
      response_type: "code",
      scope: "identify email",
      state,
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  app.get("/auth/discord/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.redirect(`${FRONTEND_URL}/auth/error?msg=no_code`);
    }

    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: DISCORD_CONFIG.clientId,
          client_secret: DISCORD_CONFIG.clientSecret,
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: DISCORD_CONFIG.redirectUri,
        }),
      });

      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error("No access token");

      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const discordUser = await userRes.json();

      const result = await discordLogin(discordUser);
      res.redirect(`${FRONTEND_URL}/auth/callback?token=${result.token}`);
    } catch (error) {
      console.error("Discord auth error:", error);
      res.redirect(`${FRONTEND_URL}/auth/error?msg=auth_failed`);
    }
  });

  // ---------- GOOGLE OAUTH ----------

  app.get("/auth/google", (_req, res) => {
    if (!GOOGLE_CONFIG.clientId)
      return res.status(503).json({ error: "Google auth not configured. Set GOOGLE_CLIENT_ID." });
    const params = new URLSearchParams({
      client_id: GOOGLE_CONFIG.clientId,
      redirect_uri: GOOGLE_CONFIG.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`${FRONTEND_URL}/auth/error?msg=no_code`);
    try {
      // Exchange code for access token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(code),
          client_id: GOOGLE_CONFIG.clientId,
          client_secret: GOOGLE_CONFIG.clientSecret,
          redirect_uri: GOOGLE_CONFIG.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) throw new Error("No access token");

      // Fetch user profile
      const userRes = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      const googleUser = (await userRes.json()) as {
        id: string; email?: string; name?: string; picture?: string;
      };

      const result = await googleLogin(googleUser);
      res.redirect(`${FRONTEND_URL}/auth/callback?token=${result.token}&provider=google`);
    } catch (error) {
      console.error("Google auth error:", error);
      res.redirect(`${FRONTEND_URL}/auth/error?msg=auth_failed`);
    }
  });

  // ---------- GITHUB OAUTH ----------

  app.get("/auth/github", (_req, res) => {
    if (!GITHUB_CONFIG.clientId)
      return res.status(503).json({ error: "GitHub auth not configured. Set GITHUB_CLIENT_ID." });
    const params = new URLSearchParams({
      client_id: GITHUB_CONFIG.clientId,
      redirect_uri: GITHUB_CONFIG.redirectUri,
      scope: "user:email read:user",
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  app.get("/auth/github/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`${FRONTEND_URL}/auth/error?msg=no_code`);
    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: GITHUB_CONFIG.clientId,
          client_secret: GITHUB_CONFIG.clientSecret,
          code: String(code),
          redirect_uri: GITHUB_CONFIG.redirectUri,
        }),
      });
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) throw new Error("No access token");

      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "GrudgeStudio" },
      });
      const githubUser = (await userRes.json()) as {
        id: number; login: string; email?: string | null; name?: string | null; avatar_url?: string;
      };

      // GitHub may hide email — fetch primary email separately
      if (!githubUser.email) {
        const emailRes = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "GrudgeStudio" },
        });
        const emails = (await emailRes.json()) as { email: string; primary: boolean; verified: boolean }[];
        const primary = emails.find((e) => e.primary && e.verified);
        if (primary) githubUser.email = primary.email;
      }

      const result = await githubLogin(githubUser);
      res.redirect(`${FRONTEND_URL}/auth/callback?token=${result.token}&provider=github`);
    } catch (error) {
      console.error("GitHub auth error:", error);
      res.redirect(`${FRONTEND_URL}/auth/error?msg=auth_failed`);
    }
  });

  // ---------- CHARACTERS ----------

  app.get(
    "/api/characters",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const charList = await db
          .select()
          .from(characters)
          .where(eq(characters.userId, req.user!.userId));
        res.json({ success: true, characters: charList });
      } catch (error) {
        console.error("Get characters error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  app.post(
    "/api/characters",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const {
          name,
          classId = "warrior",
          raceId = "human",
          profession,
          manualAttributes,  // Optional: player-allocated points from creation UI
        } = req.body;
        const userId = req.user!.userId;

        if (!name) {
          return res.status(400).json({ error: "Character name required" });
        }

        // Validate race + class against canonical data
        if (!VALID_RACE_IDS.includes(raceId as RaceId)) {
          return res.status(400).json({ error: `Invalid race: ${raceId}. Valid: ${VALID_RACE_IDS.join(", ")}` });
        }
        if (!VALID_CLASS_IDS.includes(classId as ClassId)) {
          return res.status(400).json({ error: `Invalid class: ${classId}. Valid: ${VALID_CLASS_IDS.join(", ")}` });
        }

        // Check character limit (5 per user)
        const existing = await db
          .select()
          .from(characters)
          .where(eq(characters.userId, userId));

        if (existing.length >= 5) {
          return res.status(400).json({ error: "Character limit (5) reached" });
        }

        // Calculate attributes: base(10) + race bonuses + class starting + manual allocation
        const raceDef = RACES[raceId as RaceId];
        const classDef = CLASSES[classId as ClassId];
        const BASE = 10;
        const attrKeys: AttributeKey[] = ["Strength", "Vitality", "Endurance", "Intellect", "Wisdom", "Dexterity", "Agility", "Tactics"];
        const computedAttributes: Record<string, number> = {};
        for (const key of attrKeys) {
          computedAttributes[key] = BASE
            + (raceDef.bonuses[key] || 0)
            + (classDef.startingAttributes[key] || 0)
            + ((manualAttributes && manualAttributes[key]) || 0);
        }

        const defaultEquipment = {
          head: null, chest: null, legs: null, feet: null,
          hands: null, shoulders: null,
          mainHand: null, offHand: null,
          accessory1: null, accessory2: null,
        };

        const prefabId = buildPrefabId(raceId, classId);

        const [character] = await db
          .insert(characters)
          .values({
            userId,
            name,
            classId,
            raceId,
            profession: profession || null,
            attributes: computedAttributes,
            equipment: defaultEquipment,
            factionId: raceDef.faction,
            prefabId,
            gameOrigin: req.body.gameOrigin || "grudge-wars",
            weaponSkills: {},
          })
          .returning();

        // Auto-mint cNFT (non-blocking — don't fail creation if mint fails)
        let cnft = null;
        if (process.env.CROSSMINT_API_KEY) {
          try {
            cnft = await mintCharacterCNFT(character.id);
          } catch (mintError) {
            console.error("Auto-mint character cNFT failed (non-fatal):", mintError);
          }
        }

        const grudgeId = generateGrudgeId(userId);
        res.status(201).json({
          success: true,
          character: { ...character, prefabId },
          cnft,
          faction: raceDef.faction,
          grudgeId,
        });
      } catch (error) {
        console.error("Create character error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  // ---------- CHARACTER UPDATE ----------

  app.patch(
    "/api/characters/:id",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const [char] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, req.params.id))
          .limit(1);

        if (!char) return res.status(404).json({ error: "Character not found" });
        if (char.userId !== req.user!.userId) return res.status(403).json({ error: "Not your character" });

        const updates: Record<string, any> = {};

        // Attribute allocation (spend attribute points)
        if (req.body.attributes && req.body.allocatePoints) {
          const newAttrs = req.body.attributes;
          const currentAttrs = (char.attributes as any) || {};
          let pointsSpent = 0;
          for (const [key, val] of Object.entries(newAttrs)) {
            const diff = (val as number) - (currentAttrs[key] || 0);
            if (diff > 0) pointsSpent += diff;
          }
          if (pointsSpent > (char.attributePoints || 0)) {
            return res.status(400).json({ error: `Not enough attribute points. Have ${char.attributePoints}, need ${pointsSpent}` });
          }
          updates.attributes = { ...currentAttrs, ...newAttrs };
          updates.attributePoints = (char.attributePoints || 0) - pointsSpent;
        } else if (req.body.attributes) {
          updates.attributes = req.body.attributes;
        }

        // Equipment changes
        if (req.body.equipment) {
          const currentEquip = (char.equipment as any) || {};
          updates.equipment = { ...currentEquip, ...req.body.equipment };
        }

        // Name change
        if (req.body.name) updates.name = req.body.name;

        // Profession
        if (req.body.profession) updates.profession = req.body.profession;

        // Level / XP (admin or internal)
        if (req.body.level !== undefined) updates.level = req.body.level;
        if (req.body.experience !== undefined) updates.experience = req.body.experience;
        if (req.body.attributePoints !== undefined) updates.attributePoints = req.body.attributePoints;

        // Avatar
        if (req.body.avatarUrl) updates.avatarUrl = req.body.avatarUrl;

        // Health/Mana/Stamina
        if (req.body.currentHealth !== undefined) updates.currentHealth = req.body.currentHealth;
        if (req.body.currentMana !== undefined) updates.currentMana = req.body.currentMana;
        if (req.body.currentStamina !== undefined) updates.currentStamina = req.body.currentStamina;

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: "No valid fields to update" });
        }

        const [updated] = await db
          .update(characters)
          .set(updates)
          .where(eq(characters.id, req.params.id))
          .returning();

        res.json({ success: true, character: updated });
      } catch (error) {
        console.error("Update character error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  app.delete(
    "/api/characters/:id",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const [char] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, req.params.id))
          .limit(1);

        if (!char) {
          return res.status(404).json({ error: "Character not found" });
        }
        if (char.userId !== req.user!.userId) {
          return res.status(403).json({ error: "Not your character" });
        }

        await db.delete(characters).where(eq(characters.id, req.params.id));
        res.json({ success: true });
      } catch (error) {
        console.error("Delete character error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  // ---------- CHARACTER MINT ----------

  app.post(
    "/api/characters/:id/mint",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const characterId = req.params.id;
        const [char] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, characterId))
          .limit(1);

        if (!char) {
          return res.status(404).json({ error: "Character not found" });
        }
        if (char.userId !== req.user!.userId) {
          return res.status(403).json({ error: "Not your character" });
        }

        const result = await mintCharacterCNFT(characterId);
        res.json({ success: true, ...result });
      } catch (error: any) {
        console.error("Mint character error:", error);
        res.status(500).json({ error: error.message || "Mint failed" });
      }
    }
  );

  // ---------- GAME DATA (public, no auth needed) ----------

  app.get("/api/game-data/races", (_req, res) => {
    res.json({ success: true, races: RACE_LIST, factions: FACTIONS });
  });

  app.get("/api/game-data/classes", (_req, res) => {
    res.json({ success: true, classes: CLASS_LIST, tiers: CLASS_TIERS });
  });

  app.get("/api/game-data/all", (_req, res) => {
    res.json({
      success: true,
      races: RACE_LIST,
      classes: CLASS_LIST,
      factions: FACTIONS,
      tiers: CLASS_TIERS,
      validRaceIds: VALID_RACE_IDS,
      validClassIds: VALID_CLASS_IDS,
    });
  });

  // ---------- ISLANDS ----------

  app.get(
    "/api/islands",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const islandList = await db
          .select()
          .from(islands)
          .where(eq(islands.userId, req.user!.userId));
        res.json({ success: true, islands: islandList });
      } catch (error) {
        console.error("Get islands error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  app.post(
    "/api/islands",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const { name, islandType = "starter", seed } = req.body;
        const userId = req.user!.userId;

        if (!name) {
          return res.status(400).json({ error: "Island name required" });
        }

        // Limit: 3 islands per user
        const existing = await db
          .select()
          .from(islands)
          .where(eq(islands.userId, userId));

        if (existing.length >= 3) {
          return res.status(400).json({ error: "Island limit (3) reached" });
        }

        const [island] = await db
          .insert(islands)
          .values({
            userId,
            name,
            islandType,
            seed: seed || Math.floor(Math.random() * 999999),
            width: 130,
            height: 105,
          })
          .returning();

        // Mark user as having a home island
        if (existing.length === 0) {
          await db
            .update(users)
            .set({ hasHomeIsland: true })
            .where(eq(users.id, userId));
        }

        // Auto-mint island cNFT (non-blocking)
        let cnft = null;
        if (process.env.CROSSMINT_API_KEY) {
          try {
            cnft = await mintIslandCNFT(island.id);
          } catch (mintError) {
            console.error("Auto-mint island cNFT failed (non-fatal):", mintError);
          }
        }

        res.status(201).json({ success: true, island, cnft });
      } catch (error) {
        console.error("Create island error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  app.get(
    "/api/islands/:id",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const [island] = await db
          .select()
          .from(islands)
          .where(eq(islands.id, req.params.id))
          .limit(1);

        if (!island) {
          return res.status(404).json({ error: "Island not found" });
        }
        res.json({ success: true, island });
      } catch (error) {
        console.error("Get island error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  app.delete(
    "/api/islands/:id",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const [island] = await db
          .select()
          .from(islands)
          .where(eq(islands.id, req.params.id))
          .limit(1);

        if (!island) {
          return res.status(404).json({ error: "Island not found" });
        }
        if (island.userId !== req.user!.userId) {
          return res.status(403).json({ error: "Not your island" });
        }

        await db.delete(islands).where(eq(islands.id, req.params.id));
        res.json({ success: true });
      } catch (error) {
        console.error("Delete island error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  // ---------- ISLAND MINT ----------

  app.post(
    "/api/islands/:id/mint",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const islandId = req.params.id;
        const [island] = await db
          .select()
          .from(islands)
          .where(eq(islands.id, islandId))
          .limit(1);

        if (!island) {
          return res.status(404).json({ error: "Island not found" });
        }
        if (island.userId !== req.user!.userId) {
          return res.status(403).json({ error: "Not your island" });
        }

        const result = await mintIslandCNFT(islandId);
        res.json({ success: true, ...result });
      } catch (error: any) {
        console.error("Mint island error:", error);
        res.status(500).json({ error: error.message || "Mint failed" });
      }
    }
  );

  // ---------- WALLET ROUTES ----------

  app.use("/api/wallet", walletRouter);

  // Wallet auth (nonce + Phantom/Web3Auth/Solflare verify)
  app.get("/api/auth/nonce", (req, res, next) => walletAuthRouter(req, res, next));
  app.post("/api/auth/wallet", (req, res, next) => walletAuthRouter(req, res, next));
  app.use("/api/wallet", walletAuthRouter); // /api/wallet/link, /api/wallet/all

  // ---------- GAME SYSTEMS ----------

  app.use("/api/economy", economyRouter);
  app.use("/api/crafting", craftingRouter);
  app.use("/api/missions", missionsRouter);
  app.use("/api/combat", combatRouter);
  app.use("/api/crews", crewsRouter);

  // ---------- AI AGENT ----------

  app.use("/api/ai", aiRouter);
  app.use("/ai", aiRouter); // legacy compat: /ai/* without /api prefix

  // ---------- STUDIO SYNC ----------

  app.use("/api/studio/sync", studioSyncRouter);

  // ---------- ASSET STORAGE (R2) ----------

  app.use("/api/assets", assetsRouter);

  // ---------- METADATA ----------

  app.get("/api/metadata", (_req, res) => {
    res.json({
      success: true,
      classes: CLASSES,
      races: RACES,
      weaponTypes: WEAPON_TYPES,
      factions: FACTIONS,
      spawnLocations: SPAWN_LOCATIONS,
    });
  });

  // ---------- PROFILE ----------

  app.get(
    "/api/profile",
    authMiddleware,
    async (req: AuthenticatedRequest, res) => {
      try {
        const [user] = await db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            email: users.email,
            avatarUrl: users.avatarUrl,
            isPremium: users.isPremium,
            isGuest: users.isGuest,
            faction: users.faction,
            factionReputation: users.factionReputation,
            hasHomeIsland: users.hasHomeIsland,
            walletAddress: users.walletAddress,
            walletType: users.walletType,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.id, req.user!.userId))
          .limit(1);

        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const grudgeId = generateGrudgeId(user.id);
        res.json({ success: true, user: { ...user, grudgeId } });
      } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({ error: "Server error" });
      }
    }
  );

  // ---------- HEALTH ----------

  app.get("/api/health", async (_req, res) => {
    let dbOk = false;
    let dbLatencyMs = 0;
    try {
      const t0 = Date.now();
      await pool.query("SELECT 1");
      dbLatencyMs = Date.now() - t0;
      dbOk = true;
    } catch { /* db unreachable */ }

    const healthy = dbOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "degraded",
      service: "Grudge Studio Unified Backend",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      checks: {
        database: { ok: dbOk, latencyMs: dbLatencyMs },
        websocket: { ok: true },
      },
      features: {
        api: true,
        auth: {
          password: true,
          guest: true,
          puter: true,
          discord: !!DISCORD_CONFIG.clientId,
          google: !!GOOGLE_CONFIG.clientId,
          github: !!GITHUB_CONFIG.clientId,
          wallet: true,
          web3auth: true,
          crossmint: !!process.env.CROSSMINT_API_KEY,
        },
        ai: !!process.env.GEMINI_API_KEY,
        walletAuth: true,
        studioSync: true,
        objectStorage: !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID),
        puterSync: !!process.env.PUTER_API_TOKEN,
      },
    });
  });

  // ---------- PERIODIC CLEANUP ----------

  setInterval(
    () => {
      cleanupExpiredTokens().catch(console.error);
    },
    6 * 60 * 60 * 1000 // every 6 hours
  );

  // ============================================
  // WEBSOCKET GAME BRIDGE
  // ============================================

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const wsClients = new Map<
    string,
    {
      ws: WebSocket;
      userId: string | null;
      username: string | null;
      zone: string | null;
      position: { x: number; y: number; z: number };
    }
  >();

  const zones = new Map<string, Set<string>>();

  function broadcastToZone(
    zone: string,
    message: object,
    excludeId: string | null = null
  ) {
    const zoneClients = zones.get(zone);
    if (!zoneClients) return;
    const data = JSON.stringify(message);
    for (const sid of zoneClients) {
      if (sid === excludeId) continue;
      const c = wsClients.get(sid);
      if (c?.ws.readyState === WebSocket.OPEN) {
        c.ws.send(data);
      }
    }
  }

  wss.on("connection", (ws) => {
    const socketId = `ws_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    wsClients.set(socketId, {
      ws,
      userId: null,
      username: null,
      zone: null,
      position: { x: 0, y: 0, z: 0 },
    });

    ws.send(JSON.stringify({ type: "connected", socketId, serverTime: Date.now() }));

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        const client = wsClients.get(socketId);
        if (!client) return;

        switch (msg.type) {
          case "auth": {
            const decoded = verifyJwt(msg.token);
            if (decoded) {
              client.userId = decoded.userId;
              client.username = decoded.username;
              ws.send(
                JSON.stringify({ type: "auth_success", userId: decoded.userId })
              );
            }
            break;
          }

          case "join_zone": {
            if (!client.userId) return;
            // Leave old zone
            if (client.zone) {
              broadcastToZone(
                client.zone,
                { type: "player_left", userId: client.userId },
                socketId
              );
              zones.get(client.zone)?.delete(socketId);
            }
            // Join new zone
            client.zone = msg.zone;
            client.position = msg.position || { x: 0, y: 0, z: 0 };
            if (!zones.has(msg.zone)) zones.set(msg.zone, new Set());
            zones.get(msg.zone)!.add(socketId);
            broadcastToZone(
              msg.zone,
              {
                type: "player_joined",
                userId: client.userId,
                username: client.username,
                position: client.position,
              },
              socketId
            );
            break;
          }

          case "position": {
            if (!client.zone) return;
            client.position = msg.position;
            broadcastToZone(
              client.zone,
              {
                type: "player_position",
                userId: client.userId,
                position: msg.position,
                state: msg.state,
              },
              socketId
            );
            break;
          }

          case "chat": {
            if (!client.zone) return;
            broadcastToZone(client.zone, {
              type: "chat",
              senderId: client.userId,
              senderName: client.username,
              message: msg.message,
            });
            break;
          }

          case "ping": {
            ws.send(JSON.stringify({ type: "pong", serverTime: Date.now() }));
            break;
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      const client = wsClients.get(socketId);
      if (client?.zone) {
        broadcastToZone(
          client.zone,
          { type: "player_left", userId: client.userId },
          socketId
        );
        zones.get(client.zone)?.delete(socketId);
      }
      wsClients.delete(socketId);
    });
  });

  return httpServer;
}
