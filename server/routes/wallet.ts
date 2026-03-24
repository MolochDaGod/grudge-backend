import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users } from "../../shared/schema.js";
import {
  authMiddleware,
  type AuthenticatedRequest,
  generateGrudgeId,
} from "../auth.js";

const router = Router();

const CROSSMINT_BASE_URL =
  process.env.CROSSMINT_BASE_URL || "https://www.crossmint.com/api/v1-alpha2";

// ============================================
// POST /api/wallet/create — Provision Crossmint wallet for user
// ============================================

router.post(
  "/create",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.userId;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Already has a wallet
      if (user.crossmintWalletId) {
        return res.json({
          success: true,
          walletId: user.crossmintWalletId,
          walletAddress: user.walletAddress,
          walletType: user.walletType,
          message: "Wallet already exists",
        });
      }

      const crossmintApiKey = process.env.CROSSMINT_API_KEY;
      if (!crossmintApiKey) {
        return res.status(503).json({ error: "Crossmint not configured" });
      }

      const grudgeId = generateGrudgeId(userId);

      // Create Crossmint wallet via v1-alpha2 API
      const crossmintRes = await fetch(`${CROSSMINT_BASE_URL}/wallets`, {
        method: "POST",
        headers: {
          "X-API-KEY": crossmintApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "solana-mpc-wallet",
          linkedUser: user.email || user.crossmintEmail || `user:${grudgeId}`,
        }),
      });

      if (!crossmintRes.ok) {
        const errorText = await crossmintRes.text();
        console.error("Crossmint API error:", crossmintRes.status, errorText);
        return res.status(502).json({ error: "Failed to create wallet" });
      }

      const walletData = await crossmintRes.json();

      // Store wallet info on user record
      await db
        .update(users)
        .set({
          crossmintWalletId: walletData.id || walletData.walletId,
          walletAddress: walletData.address || walletData.publicKey,
          walletType: "crossmint",
          crossmintEmail: user.email || null,
        })
        .where(eq(users.id, userId));

      return res.status(201).json({
        success: true,
        walletId: walletData.id || walletData.walletId,
        walletAddress: walletData.address || walletData.publicKey,
        walletType: "crossmint",
        message: "Crossmint wallet created",
      });
    } catch (error) {
      console.error("Create wallet error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ============================================
// GET /api/wallet — Get wallet info and balance
// ============================================

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;

    const [user] = await db
      .select({
        crossmintWalletId: users.crossmintWalletId,
        walletAddress: users.walletAddress,
        walletType: users.walletType,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.crossmintWalletId) {
      return res.json({
        success: true,
        hasWallet: false,
        message: "No wallet provisioned. POST /api/wallet/create to create one.",
      });
    }

    // Optionally fetch balance from Crossmint
    let balance = null;
    const crossmintApiKey = process.env.CROSSMINT_API_KEY;

    if (crossmintApiKey && user.crossmintWalletId) {
      try {
        const balanceRes = await fetch(
          `${CROSSMINT_BASE_URL}/wallets/${user.crossmintWalletId}/balances`,
          {
            headers: { "X-API-KEY": crossmintApiKey },
          }
        );
        if (balanceRes.ok) {
          balance = await balanceRes.json();
        }
      } catch {
        // Non-fatal: return wallet info without balance
      }
    }

    return res.json({
      success: true,
      hasWallet: true,
      walletId: user.crossmintWalletId,
      walletAddress: user.walletAddress,
      walletType: user.walletType,
      balance,
    });
  } catch (error) {
    console.error("Get wallet error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
