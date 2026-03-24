import { Router } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db.js";
import { combatLog, characters, battleArenaStats } from "../../shared/schema.js";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";

const router = Router();

// ============================================
// POST /log — Record combat result (internal or authenticated)
// ============================================

router.post("/log", async (req, res) => {
  try {
    // Allow internal key OR Bearer token
    const internalKey = req.headers["x-internal-key"];
    const isInternal = internalKey && internalKey === process.env.INTERNAL_API_KEY;

    if (!isInternal) {
      // Must be authenticated
      const authHeader = req.headers["authorization"];
      if (!authHeader) return res.status(401).json({ error: "Auth required" });
    }

    const { attackerId, defenderId, outcome, combatType, combatData, islandId } = req.body;
    if (!outcome || !combatType) {
      return res.status(400).json({ error: "outcome and combatType required" });
    }

    const [entry] = await db
      .insert(combatLog)
      .values({
        attackerId: attackerId || null,
        defenderId: defenderId || null,
        outcome,
        combatType,
        combatData: combatData || null,
        islandId: islandId || null,
      })
      .returning();

    // Update battle arena stats for PvP kills
    if (combatType === "pvp" || combatType === "duel" || combatType === "arena") {
      if (attackerId && outcome === "kill") {
        // Get attacker's user to update stats
        const [attacker] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, attackerId))
          .limit(1);

        if (attacker?.userId) {
          const [existing] = await db
            .select()
            .from(battleArenaStats)
            .where(eq(battleArenaStats.userId, attacker.userId))
            .limit(1);

          if (existing) {
            await db
              .update(battleArenaStats)
              .set({
                totalKills: (existing.totalKills || 0) + 1,
                totalMatches: (existing.totalMatches || 0) + 1,
                updatedAt: Date.now(),
              })
              .where(eq(battleArenaStats.id, existing.id));
          } else {
            await db.insert(battleArenaStats).values({
              userId: attacker.userId,
              totalKills: 1,
              totalMatches: 1,
            });
          }
        }
      }

      if (defenderId && outcome === "kill") {
        const [defender] = await db
          .select()
          .from(characters)
          .where(eq(characters.id, defenderId))
          .limit(1);

        if (defender?.userId) {
          const [existing] = await db
            .select()
            .from(battleArenaStats)
            .where(eq(battleArenaStats.userId, defender.userId))
            .limit(1);

          if (existing) {
            await db
              .update(battleArenaStats)
              .set({
                totalDeaths: (existing.totalDeaths || 0) + 1,
                totalMatches: (existing.totalMatches || 0) + 1,
                updatedAt: Date.now(),
              })
              .where(eq(battleArenaStats.id, existing.id));
          } else {
            await db.insert(battleArenaStats).values({
              userId: defender.userId,
              totalDeaths: 1,
              totalMatches: 1,
            });
          }
        }
      }
    }

    res.status(201).json({ success: true, combatEntry: entry });
  } catch (error) {
    console.error("Combat log error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// GET /history?char_id=X — Combat history for character
// ============================================

router.get("/history", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const charId = req.query.char_id as string;
    if (!charId) return res.status(400).json({ error: "char_id required" });

    const history = await db
      .select()
      .from(combatLog)
      .where(
        sql`${combatLog.attackerId} = ${charId} OR ${combatLog.defenderId} = ${charId}`
      )
      .orderBy(desc(combatLog.createdAt))
      .limit(50);

    res.json({ success: true, history });
  } catch (error) {
    console.error("Combat history error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// GET /leaderboard — Top 25 by kills
// ============================================

router.get("/leaderboard", async (_req, res) => {
  try {
    const leaders = await db
      .select()
      .from(battleArenaStats)
      .orderBy(desc(battleArenaStats.totalKills))
      .limit(25);

    res.json({ success: true, leaderboard: leaders });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
