/**
 * Studio Sync Routes
 *
 * POST /api/studio/sync/push  — save game state to DB checkpoint + Puter KV
 * GET  /api/studio/sync/pull  — get latest game state checkpoint
 * GET  /api/studio/sync/archives — list save snapshots
 */

import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db.js";
import { gameSessions, islands, users } from "../../shared/schema.js";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";

const router = Router();

const PUTER_API = "https://api.puter.com";

// ── Puter KV helpers ──────────────────────────────────────────────────────

function resolveToken(req: AuthenticatedRequest): string | null {
  const hdr = req.headers["x-puter-token"] as string | undefined;
  if (hdr) return hdr.startsWith("Bearer ") ? hdr.slice(7) : hdr;
  return process.env.PUTER_API_TOKEN || null;
}

async function puterKvSet(key: string, value: unknown, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${PUTER_API}/drivers/call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        interface: "puter-kvstore",
        method: "set",
        args: { key, value: typeof value === "string" ? value : JSON.stringify(value) },
      }),
    });
    return res.ok;
  } catch { return false; }
}

async function puterKvGet(key: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${PUTER_API}/drivers/call`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ interface: "puter-kvstore", method: "get", args: { key } }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result?: string };
    const raw = data.result ?? null;
    if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return raw; } }
    return raw;
  } catch { return null; }
}

// ── POST /api/studio/sync/push ────────────────────────────────────────────

router.post("/push", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { gameState, islandId } = req.body;
  if (!gameState) return res.status(400).json({ error: "gameState required" });

  const userId = req.user!.userId;
  const grudgeId = req.user!.grudgeId;
  const timestamp = Date.now();

  try {
    // Save to DB: upsert active game session checkpoint
    const targetIslandId = islandId || null;
    const existing = targetIslandId
      ? await db
          .select()
          .from(gameSessions)
          .where(eq(gameSessions.userId, userId))
          .limit(1)
          .then((r) => r[0])
      : null;

    if (existing) {
      await db
        .update(gameSessions)
        .set({ checkpoint: { ...gameState, _savedAt: timestamp }, isActive: true })
        .where(eq(gameSessions.id, existing.id));
    } else if (targetIslandId) {
      await db.insert(gameSessions).values({
        userId,
        islandId: targetIslandId,
        checkpoint: { ...gameState, _savedAt: timestamp },
        isActive: true,
      });
    }

    // Mirror to Puter KV if token available
    let puterSynced = false;
    const puterToken = resolveToken(req);
    if (puterToken) {
      const key = `grudge:save:${grudgeId}`;
      puterSynced = await puterKvSet(
        key,
        { ...gameState, _syncMeta: { pushedAt: timestamp, version: (gameState._syncMeta?.version || 0) + 1 } },
        puterToken
      );
    }

    return res.json({
      success: true,
      timestamp,
      saved: { db: true, puter: puterSynced },
    });
  } catch (error) {
    console.error("Sync push error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/studio/sync/pull ─────────────────────────────────────────────

router.get("/pull", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const grudgeId = req.user!.grudgeId;

  try {
    // Try Puter KV first (most up to date)
    const puterToken = resolveToken(req);
    if (puterToken) {
      const puterData = await puterKvGet(`grudge:save:${grudgeId}`, puterToken);
      if (puterData) {
        return res.json({ success: true, data: puterData, source: "puter" });
      }
    }

    // Fall back to DB checkpoint
    const [session] = await db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.userId, userId))
      .orderBy(desc(gameSessions.startedAt))
      .limit(1);

    if (session?.checkpoint) {
      return res.json({ success: true, data: session.checkpoint, source: "db" });
    }

    return res.json({ success: true, data: null, source: "empty" });
  } catch (error) {
    console.error("Sync pull error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/studio/sync/status ────────────────────────────────────────────

router.get("/status", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const [session] = await db
    .select({ id: gameSessions.id, startedAt: gameSessions.startedAt, isActive: gameSessions.isActive })
    .from(gameSessions)
    .where(eq(gameSessions.userId, userId))
    .orderBy(desc(gameSessions.startedAt))
    .limit(1);

  return res.json({
    success: true,
    hasDbSave: !!session,
    lastSavedAt: session?.startedAt || null,
    puterAvailable: !!(resolveToken(req) || process.env.PUTER_API_TOKEN),
  });
});

export default router;
