import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db.js";
import { missions, characters } from "../../shared/schema.js";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";
import { applyGold } from "./economy.js";

const router = Router();

// ============================================
// GET / — List active missions for user
// ============================================

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const charId = req.query.char_id as string;
    const where = charId
      ? and(eq(missions.userId, req.user!.userId), eq(missions.characterId, charId))
      : eq(missions.userId, req.user!.userId);

    const list = await db
      .select()
      .from(missions)
      .where(where)
      .orderBy(desc(missions.createdAt))
      .limit(50);

    res.json({ success: true, missions: list });
  } catch (error) {
    console.error("Get missions error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST / — Create a new mission
// ============================================

router.post("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { characterId, title, description, missionType, objectives, rewards, difficulty, expiresInHours } = req.body;
    if (!title || !missionType) {
      return res.status(400).json({ error: "title and missionType required" });
    }

    // Check active mission limit (11 per day per character, as per game design)
    const activeMissions = await db
      .select()
      .from(missions)
      .where(
        and(
          eq(missions.userId, req.user!.userId),
          eq(missions.status, "active")
        )
      );

    if (activeMissions.length >= 11) {
      return res.status(400).json({ error: "Active mission limit (11) reached" });
    }

    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // default 24h

    const [mission] = await db
      .insert(missions)
      .values({
        userId: req.user!.userId,
        characterId: characterId || null,
        title,
        description: description || null,
        missionType,
        objectives: objectives || [],
        rewards: rewards || { gold: 100, xp: 50 },
        difficulty: difficulty || 1,
        expiresAt,
      })
      .returning();

    res.status(201).json({ success: true, mission });
  } catch (error) {
    console.error("Create mission error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// PATCH /:id/complete — Complete a mission, award rewards
// ============================================

router.patch("/:id/complete", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, req.params.id))
      .limit(1);

    if (!mission) return res.status(404).json({ error: "Mission not found" });
    if (mission.userId !== req.user!.userId) return res.status(403).json({ error: "Not your mission" });
    if (mission.status !== "active") return res.status(400).json({ error: `Mission is ${mission.status}` });

    // Mark completed
    await db
      .update(missions)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(missions.id, mission.id));

    // Award gold if character is assigned and rewards include gold
    const rewards = (mission.rewards as any) || {};
    let goldAwarded = null;

    if (mission.characterId && rewards.gold && rewards.gold > 0) {
      try {
        goldAwarded = await applyGold(
          mission.characterId,
          req.user!.userId,
          rewards.gold,
          "mission_reward",
          mission.id,
          `Mission: ${mission.title}`
        );
      } catch (e) {
        console.error("Mission gold award failed:", e);
      }
    }

    // Award XP
    if (mission.characterId && rewards.xp && rewards.xp > 0) {
      const [char] = await db
        .select()
        .from(characters)
        .where(eq(characters.id, mission.characterId))
        .limit(1);

      if (char) {
        const newXp = (char.experience || 0) + rewards.xp;
        // Simple leveling: every 1000 XP = 1 level
        const newLevel = Math.floor(newXp / 1000) + 1;
        const leveledUp = newLevel > (char.level || 1);

        await db
          .update(characters)
          .set({
            experience: newXp,
            level: newLevel,
            // Award attribute points on level up
            attributePoints: (char.attributePoints || 0) + (leveledUp ? 2 : 0),
          })
          .where(eq(characters.id, mission.characterId));
      }
    }

    res.json({ success: true, rewards, goldAwarded });
  } catch (error) {
    console.error("Complete mission error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// DELETE /:id — Abandon a mission
// ============================================

router.delete("/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, req.params.id))
      .limit(1);

    if (!mission) return res.status(404).json({ error: "Mission not found" });
    if (mission.userId !== req.user!.userId) return res.status(403).json({ error: "Not your mission" });

    await db
      .update(missions)
      .set({ status: "abandoned" })
      .where(eq(missions.id, mission.id));

    res.json({ success: true });
  } catch (error) {
    console.error("Abandon mission error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
