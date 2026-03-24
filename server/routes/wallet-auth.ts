/**
 * Wallet Authentication Routes
 *
 * GET  /api/auth/nonce          — generate a one-time nonce for wallet challenge
 * POST /api/auth/wallet         — verify Ed25519 signature (Phantom, Solflare, Backpack, Web3Auth)
 */

import { Router } from "express";
import crypto from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db.js";
import { users, wallets, walletNonces, authProviders } from "../../shared/schema.js";
import {
  generateGrudgeId,
  generateJwt,
  createDbToken,
  type AuthenticatedRequest,
  authMiddleware,
} from "../auth.js";

const router = Router();

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// GET /api/auth/nonce
// Returns a one-time challenge nonce for the given wallet address.
// Frontend signs this with their wallet, then calls POST /api/auth/wallet.
// ============================================================

router.get("/nonce", async (req, res) => {
  const { wallet } = req.query as { wallet?: string };
  if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return res.status(400).json({ error: "Valid Solana wallet address required" });
  }

  const nonce = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + NONCE_TTL_MS;

  await db.insert(walletNonces).values({ walletAddress: wallet, nonce, expiresAt });

  return res.json({
    success: true,
    nonce,
    message: `Sign this message to authenticate with Grudge Studio:\n\nNonce: ${nonce}\nExpires in 5 minutes.`,
    expiresAt,
  });
});

// ============================================================
// POST /api/auth/wallet
// Body: { walletAddress, signature, nonce, walletType?, network? }
//
// signature can be:
//   - base58 string (Phantom)
//   - base64 string (Web3Auth / Solflare)
//   - uint8array serialized as array
// ============================================================

router.post("/wallet", async (req, res) => {
  const {
    walletAddress,
    signature,
    nonce,
    walletType = "phantom",
    network = "mainnet",
    displayName,
    web3authVerifier,
  } = req.body;

  if (!walletAddress || !signature || !nonce) {
    return res.status(400).json({ error: "walletAddress, signature, and nonce are required" });
  }

  try {
    // 1. Verify nonce exists, not used, not expired
    const [nonceRow] = await db
      .select()
      .from(walletNonces)
      .where(
        and(
          eq(walletNonces.nonce, nonce),
          eq(walletNonces.walletAddress, walletAddress),
          gt(walletNonces.expiresAt, Date.now())
        )
      )
      .limit(1);

    if (!nonceRow || nonceRow.usedAt) {
      return res.status(401).json({ error: "Invalid or expired nonce. Request a new one." });
    }

    // 2. Verify Ed25519 signature
    const message = `Sign this message to authenticate with Grudge Studio:\n\nNonce: ${nonce}\nExpires in 5 minutes.`;
    const messageBytes = new TextEncoder().encode(message);

    // Decode signature (base58, base64, or array)
    let sigBytes: Uint8Array;
    if (typeof signature === "string") {
      try {
        sigBytes = bs58.decode(signature);
      } catch {
        sigBytes = Buffer.from(signature, "base64");
      }
    } else if (Array.isArray(signature)) {
      sigBytes = new Uint8Array(signature);
    } else {
      return res.status(400).json({ error: "Invalid signature format" });
    }

    // Decode public key from base58 wallet address
    let pubKeyBytes: Uint8Array;
    try {
      pubKeyBytes = bs58.decode(walletAddress);
    } catch {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
    if (!valid) {
      return res.status(401).json({ error: "Signature verification failed" });
    }

    // 3. Mark nonce as used
    await db
      .update(walletNonces)
      .set({ usedAt: Date.now() })
      .where(eq(walletNonces.id, nonceRow.id));

    // 4. Find or create user by wallet address
    const [existingWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.walletAddress, walletAddress))
      .limit(1);

    let userId: string;

    if (existingWallet) {
      userId = existingWallet.userId;
      // Update wallet verification status
      await db
        .update(wallets)
        .set({ isVerified: true })
        .where(eq(wallets.id, existingWallet.id));
    } else {
      // Create new user
      const username = `${walletType}_${walletAddress.slice(0, 8).toLowerCase()}`;
      const [newUser] = await db
        .insert(users)
        .values({
          username,
          displayName: displayName || username,
          walletAddress,
          walletType,
          isGuest: false,
        })
        .returning();
      userId = newUser.id;

      // Store in wallets table
      await db.insert(wallets).values({
        userId,
        walletAddress,
        walletType,
        walletNetwork: network,
        isPrimary: true,
        isVerified: true,
        web3authVerifier: web3authVerifier || null,
      });

      // Link auth provider
      await db.insert(authProviders).values({
        accountId: userId,
        provider: walletType,
        providerId: walletAddress,
        profileData: { walletType, network, web3authVerifier },
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return res.status(500).json({ error: "User not found after wallet auth" });

    // Store grudgeId
    const grudgeId = generateGrudgeId(userId);
    await db.update(users).set({ grudgeId, walletAddress, walletType }).where(eq(users.id, userId));

    const token = generateJwt({
      userId,
      username: user.username,
      grudgeId,
      isGuest: false,
    });
    await createDbToken(userId, "wallet");

    return res.json({
      success: true,
      token,
      user: { id: userId, username: user.username, grudgeId, walletAddress, walletType, isGuest: false },
    });
  } catch (error) {
    console.error("Wallet auth error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ============================================================
// POST /api/wallet/link  (authenticated)
// Link an additional wallet to an existing Grudge account.
// ============================================================

router.post(
  "/link",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    const { walletAddress, walletType = "phantom", network = "mainnet", label } = req.body;
    if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });

    try {
      // Check not already linked to another account
      const [existing] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.walletAddress, walletAddress))
        .limit(1);

      if (existing && existing.userId !== req.user!.userId) {
        return res.status(409).json({ error: "This wallet is linked to a different account" });
      }

      if (existing) {
        return res.json({ success: true, message: "Wallet already linked", wallet: existing });
      }

      const [wallet] = await db
        .insert(wallets)
        .values({
          userId: req.user!.userId,
          walletAddress,
          walletType,
          walletNetwork: network,
          isPrimary: false,
          isVerified: false,
          label: label || null,
        })
        .returning();

      return res.status(201).json({ success: true, wallet });
    } catch (error) {
      console.error("Link wallet error:", error);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

// ============================================================
// GET /api/wallet/all  (authenticated)
// Return all wallets for the current user.
// ============================================================

router.get(
  "/all",
  authMiddleware,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userWallets = await db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, req.user!.userId));
      return res.json({ success: true, wallets: userWallets });
    } catch (error) {
      console.error("Get wallets error:", error);
      return res.status(500).json({ error: "Server error" });
    }
  }
);

export default router;
