import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../db.js";
import { characters, goldTransactions } from "../../shared/schema.js";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";

const router = Router();

// ============================================
// Shared: apply gold change and log transaction
// ============================================

async function applyGold(
  characterId: string,
  userId: string,
  amount: number,
  txType: string,
  refId?: string,
  note?: string
): Promise<{ newBalance: number; txId: string }> {
  const [char] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  if (!char) throw new Error("Character not found");
  if (char.userId !== userId) throw new Error("Not your character");

  const currentGold = char.gold || 0;
  const newBalance = currentGold + amount;

  if (newBalance < 0) {
    throw new Error(`Insufficient gold. Have ${currentGold}, need ${Math.abs(amount)}`);
  }

  // Update character gold
  await db
    .update(characters)
    .set({ gold: newBalance })
    .where(eq(characters.id, characterId));

  // Log transaction
  const [tx] = await db
    .insert(goldTransactions)
    .values({
      userId,
      characterId,
      amount,
      balanceAfter: newBalance,
      txType,
      refId: refId || null,
      note: note || null,
    })
    .returning();

  return { newBalance, txId: tx.id };
}

// ============================================
// GET /economy/balance?char_id=X
// ============================================

router.get("/balance", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const charId = req.query.char_id as string;
    if (!charId) return res.status(400).json({ error: "char_id required" });

    const [char] = await db
      .select({ id: characters.id, gold: characters.gold, name: characters.name })
      .from(characters)
      .where(eq(characters.id, charId))
      .limit(1);

    if (!char) return res.status(404).json({ error: "Character not found" });

    // Last 20 transactions
    const recent = await db
      .select()
      .from(goldTransactions)
      .where(eq(goldTransactions.characterId, charId))
      .orderBy(desc(goldTransactions.createdAt))
      .limit(20);

    res.json({ success: true, gold: char.gold || 0, characterName: char.name, transactions: recent });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /economy/spend — Deduct gold (purchase, craft cost)
// ============================================

router.post("/spend", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { characterId, amount, reason, refId } = req.body;
    if (!characterId || !amount || amount <= 0) {
      return res.status(400).json({ error: "characterId and positive amount required" });
    }

    const result = await applyGold(
      characterId,
      req.user!.userId,
      -Math.abs(amount),
      reason || "purchase",
      refId
    );

    res.json({ success: true, ...result });
  } catch (error: any) {
    if (error.message.includes("Insufficient gold")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Spend error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================
// POST /economy/transfer — Player-to-player gold transfer (max 100k)
// ============================================

router.post("/transfer", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { fromCharId, toCharId, amount } = req.body;
    if (!fromCharId || !toCharId || !amount || amount <= 0) {
      return res.status(400).json({ error: "fromCharId, toCharId, and positive amount required" });
    }
    if (amount > 100000) {
      return res.status(400).json({ error: "Transfer limit is 100,000 gold" });
    }

    // Debit sender
    const debit = await applyGold(
      fromCharId,
      req.user!.userId,
      -amount,
      "transfer_out",
      toCharId,
      `Transfer to ${toCharId}`
    );

    // Credit receiver (use receiver's userId)
    const [receiver] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, toCharId))
      .limit(1);

    if (!receiver || !receiver.userId) {
      // Rollback sender
      await applyGold(fromCharId, req.user!.userId, amount, "transfer_refund", toCharId, "Refund: receiver not found");
      return res.status(404).json({ error: "Receiving character not found" });
    }

    await applyGold(
      toCharId,
      receiver.userId,
      amount,
      "transfer_in",
      fromCharId,
      `Transfer from ${fromCharId}`
    );

    res.json({ success: true, sent: amount, senderBalance: debit.newBalance });
  } catch (error: any) {
    console.error("Transfer error:", error);
    res.status(500).json({ error: error.message || "Server error" });
  }
});

// ============================================
// POST /economy/award — Internal-only: award gold (missions, events, loot)
// ============================================

router.post("/award", async (req, res) => {
  try {
    // Internal key check
    const internalKey = req.headers["x-internal-key"];
    if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
      return res.status(403).json({ error: "Internal access only" });
    }

    const { characterId, userId, amount, reason, refId, note } = req.body;
    if (!characterId || !userId || !amount || amount <= 0) {
      return res.status(400).json({ error: "characterId, userId, and positive amount required" });
    }

    const result = await applyGold(characterId, userId, amount, reason || "mission_reward", refId, note);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Award error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
export { applyGold };
