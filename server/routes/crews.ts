import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { crews, crewMembers, users, islands } from "../../shared/schema.js";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";

const router = Router();

// ============================================
// GET / — Get player's current crew
// ============================================

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const membership = await db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.userId, req.user!.userId))
      .limit(1);

    if (membership.length === 0) {
      return res.json({ success: true, crew: null, message: "Not in a crew" });
    }

    const [crew] = await db
      .select()
      .from(crews)
      .where(eq(crews.id, membership[0].crewId))
      .limit(1);

    const members = await db
      .select({
        id: crewMembers.id,
        userId: crewMembers.userId,
        role: crewMembers.role,
        joinedAt: crewMembers.joinedAt,
        username: users.username,
        displayName: users.displayName,
      })
      .from(crewMembers)
      .innerJoin(users, eq(crewMembers.userId, users.id))
      .where(eq(crewMembers.crewId, crew.id));

    res.json({ success: true, crew, members, myRole: membership[0].role });
  } catch (error) {
    console.error("Get crew error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /create — Create a crew (3-5 members)
// ============================================

router.post("/create", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { name, faction } = req.body;
    if (!name) return res.status(400).json({ error: "Crew name required" });

    // Check if already in a crew
    const existing = await db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.userId, req.user!.userId))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: "Already in a crew. Leave first." });
    }

    const [crew] = await db
      .insert(crews)
      .values({
        name,
        leaderId: req.user!.userId,
        faction: faction || null,
        maxMembers: 5,
      })
      .returning();

    // Add leader as member
    await db.insert(crewMembers).values({
      crewId: crew.id,
      userId: req.user!.userId,
      role: "leader",
    });

    res.status(201).json({ success: true, crew });
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Crew name already taken" });
    }
    console.error("Create crew error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /:id/join — Request to join crew
// ============================================

router.post("/:id/join", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    // Check if already in a crew
    const existing = await db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.userId, req.user!.userId))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: "Already in a crew" });
    }

    const [crew] = await db
      .select()
      .from(crews)
      .where(eq(crews.id, req.params.id))
      .limit(1);

    if (!crew) return res.status(404).json({ error: "Crew not found" });
    if (!crew.isRecruiting) return res.status(400).json({ error: "Crew is not recruiting" });

    // Check member count
    const members = await db
      .select()
      .from(crewMembers)
      .where(eq(crewMembers.crewId, crew.id));

    if (members.length >= (crew.maxMembers || 5)) {
      return res.status(400).json({ error: "Crew is full" });
    }

    await db.insert(crewMembers).values({
      crewId: crew.id,
      userId: req.user!.userId,
      role: "member",
    });

    res.json({ success: true, message: `Joined crew: ${crew.name}` });
  } catch (error) {
    console.error("Join crew error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /:id/leave — Leave crew
// ============================================

router.post("/:id/leave", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const [crew] = await db
      .select()
      .from(crews)
      .where(eq(crews.id, req.params.id))
      .limit(1);

    if (!crew) return res.status(404).json({ error: "Crew not found" });

    // Leaders can't leave — they must disband
    if (crew.leaderId === req.user!.userId) {
      // Delete the crew entirely
      await db.delete(crewMembers).where(eq(crewMembers.crewId, crew.id));
      await db.delete(crews).where(eq(crews.id, crew.id));
      return res.json({ success: true, message: "Crew disbanded (you were the leader)" });
    }

    await db
      .delete(crewMembers)
      .where(
        and(
          eq(crewMembers.crewId, crew.id),
          eq(crewMembers.userId, req.user!.userId)
        )
      );

    res.json({ success: true, message: "Left crew" });
  } catch (error) {
    console.error("Leave crew error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /:id/claim-base — Claim an island as crew base (Pirate Claim)
// ============================================

router.post("/:id/claim-base", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { islandId } = req.body;
    if (!islandId) return res.status(400).json({ error: "islandId required" });

    const [crew] = await db
      .select()
      .from(crews)
      .where(eq(crews.id, req.params.id))
      .limit(1);

    if (!crew) return res.status(404).json({ error: "Crew not found" });
    if (crew.leaderId !== req.user!.userId) {
      return res.status(403).json({ error: "Only the crew leader can claim a base" });
    }

    // Verify island exists
    const [island] = await db
      .select()
      .from(islands)
      .where(eq(islands.id, islandId))
      .limit(1);

    if (!island) return res.status(404).json({ error: "Island not found" });

    await db
      .update(crews)
      .set({ baseIslandId: islandId })
      .where(eq(crews.id, crew.id));

    res.json({ success: true, message: `Base claimed on island: ${island.name}` });
  } catch (error) {
    console.error("Claim base error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
