import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db.js";
import { craftingJobs, characters } from "../../shared/schema.js";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";
import { applyGold } from "./economy.js";

const router = Router();

// ============================================
// Static recipe data (loaded from ObjectStore in production)
// ============================================

const CRAFTING_DURATIONS: Record<number, number> = {
  1: 30,    // T1: 30 seconds
  2: 120,   // T2: 2 minutes
  3: 300,   // T3: 5 minutes
  4: 600,   // T4: 10 minutes
  5: 1800,  // T5: 30 minutes
  6: 3600,  // T6: 1 hour
};

const CRAFTING_GOLD_COSTS: Record<number, number> = {
  1: 50,
  2: 150,
  3: 400,
  4: 1000,
  5: 2500,
  6: 6000,
};

// ============================================
// GET /recipes — All recipes (?class=warrior&tier=3)
// ============================================

router.get("/recipes", async (req, res) => {
  try {
    // Proxy to ObjectStore for recipe data
    const classFilter = req.query.class as string;
    const tierFilter = req.query.tier ? parseInt(req.query.tier as string) : null;

    const objectStoreUrl = "https://molochdagod.github.io/ObjectStore/api/v1";
    
    // Fetch from ObjectStore
    let recipes: any[] = [];
    try {
      const weaponsRes = await fetch(`${objectStoreUrl}/weapons.json`);
      const armorRes = await fetch(`${objectStoreUrl}/armor.json`);
      
      if (weaponsRes.ok) {
        const weaponData = await weaponsRes.json() as any;
        if (weaponData.categories) {
          for (const [cat, data] of Object.entries(weaponData.categories as Record<string, any>)) {
            if (data.items) {
              recipes.push(...data.items.map((item: any) => ({
                ...item,
                category: cat,
                craftable: true,
              })));
            }
          }
        }
      }
    } catch {
      // Fallback: return empty with note
    }

    // Apply filters
    if (tierFilter) {
      recipes = recipes.filter((r: any) => r.tier === tierFilter);
    }

    res.json({
      success: true,
      count: recipes.length,
      recipes,
      goldCosts: CRAFTING_GOLD_COSTS,
      durations: CRAFTING_DURATIONS,
    });
  } catch (error) {
    console.error("Get recipes error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// GET /queue — Player's active crafting queue
// ============================================

router.get("/queue", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const charId = req.query.char_id as string;
    if (!charId) return res.status(400).json({ error: "char_id required" });

    const queue = await db
      .select()
      .from(craftingJobs)
      .where(
        and(
          eq(craftingJobs.characterId, charId),
          eq(craftingJobs.status, "pending")
        )
      )
      .orderBy(craftingJobs.completesAt);

    // Check and mark completed jobs
    const now = new Date();
    const updated = [];
    for (const job of queue) {
      if (job.completesAt && new Date(job.completesAt) <= now) {
        await db
          .update(craftingJobs)
          .set({ status: "completed" })
          .where(eq(craftingJobs.id, job.id));
        updated.push({ ...job, status: "completed" });
      } else {
        updated.push(job);
      }
    }

    res.json({ success: true, queue: updated });
  } catch (error) {
    console.error("Get queue error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /start — Start crafting (validates gold, creates queue entry)
// ============================================

router.post("/start", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { characterId, recipeId, tier = 1, profession, quantity = 1 } = req.body;
    if (!characterId || !recipeId) {
      return res.status(400).json({ error: "characterId and recipeId required" });
    }

    // Check queue limit (max 3 concurrent)
    const activeJobs = await db
      .select()
      .from(craftingJobs)
      .where(
        and(
          eq(craftingJobs.characterId, characterId),
          eq(craftingJobs.status, "pending")
        )
      );

    if (activeJobs.length >= 3) {
      return res.status(400).json({ error: "Crafting queue full (max 3)" });
    }

    // Calculate cost and duration
    const goldCost = (CRAFTING_GOLD_COSTS[tier] || 50) * quantity;
    const duration = (CRAFTING_DURATIONS[tier] || 30) * quantity;

    // Deduct gold
    try {
      await applyGold(characterId, req.user!.userId, -goldCost, "craft_cost", recipeId, `Craft T${tier} x${quantity}`);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    const completesAt = new Date(Date.now() + duration * 1000);

    const [job] = await db
      .insert(craftingJobs)
      .values({
        characterId,
        recipeId,
        quantity,
        duration,
        completesAt,
        profession: profession || null,
        tier,
      })
      .returning();

    res.status(201).json({ success: true, job, goldSpent: goldCost });
  } catch (error) {
    console.error("Start craft error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// PATCH /:id/complete — Complete a craft, deliver item (internal)
// ============================================

router.patch("/:id/complete", async (req, res) => {
  try {
    const internalKey = req.headers["x-internal-key"];
    const isInternal = internalKey && internalKey === process.env.INTERNAL_API_KEY;
    if (!isInternal) return res.status(403).json({ error: "Internal access only" });

    const [job] = await db
      .select()
      .from(craftingJobs)
      .where(eq(craftingJobs.id, req.params.id))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found" });

    await db
      .update(craftingJobs)
      .set({ status: "completed" })
      .where(eq(craftingJobs.id, job.id));

    res.json({ success: true, job: { ...job, status: "completed" } });
  } catch (error) {
    console.error("Complete craft error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// DELETE /:id — Cancel craft, refund gold
// ============================================

router.delete("/:id", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const [job] = await db
      .select()
      .from(craftingJobs)
      .where(eq(craftingJobs.id, req.params.id))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.status !== "pending") return res.status(400).json({ error: "Can only cancel pending jobs" });

    // Verify ownership
    const [char] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, job.characterId))
      .limit(1);

    if (!char || char.userId !== req.user!.userId) {
      return res.status(403).json({ error: "Not your crafting job" });
    }

    // Refund 50% gold
    const refund = Math.floor(((CRAFTING_GOLD_COSTS[job.tier || 1] || 50) * (job.quantity || 1)) / 2);
    await applyGold(job.characterId, req.user!.userId, refund, "craft_refund", job.id, "Cancelled craft refund (50%)");

    await db
      .update(craftingJobs)
      .set({ status: "cancelled" })
      .where(eq(craftingJobs.id, job.id));

    res.json({ success: true, refunded: refund });
  } catch (error) {
    console.error("Cancel craft error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
