/**
 * Asset Upload Routes — Cloudflare R2 presigned URLs
 *
 * POST /api/assets/upload  — get a signed PUT URL for direct browser upload
 * GET  /api/assets/list    — list user's uploaded assets
 *
 * R2 is S3-compatible. Set these env vars:
 *   R2_ACCOUNT_ID        — your Cloudflare account ID
 *   R2_ACCESS_KEY_ID     — R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY — R2 API token Secret Access Key
 *   R2_BUCKET            — bucket name (e.g. grudge-assets)
 *   R2_PUBLIC_URL        — public bucket URL (e.g. https://assets.grudge-studio.com)
 */

import { Router } from "express";
import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import { authMiddleware, type AuthenticatedRequest } from "../auth.js";

const router = Router();

// Allowed asset types and their MIME types
const ALLOWED_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
  vox: "application/octet-stream",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function getR2Client(): S3Client | null {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
  } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;

  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

// ── POST /api/assets/upload ───────────────────────────────────────────────

router.post("/upload", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { filename, contentType, category = "general", size } = req.body;

  if (!filename) return res.status(400).json({ error: "filename required" });

  const ext = path.extname(filename).slice(1).toLowerCase();
  const resolvedType = contentType || ALLOWED_TYPES[ext];

  if (!resolvedType || !ALLOWED_TYPES[ext]) {
    return res.status(400).json({ error: `File type .${ext} not allowed` });
  }

  if (size && size > MAX_FILE_SIZE) {
    return res.status(400).json({ error: `File too large. Max 20 MB.` });
  }

  const r2 = getR2Client();
  if (!r2) {
    return res.status(503).json({
      error: "Object storage not configured",
      hint: "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in your .env",
    });
  }

  const bucket = process.env.R2_BUCKET || "grudge-assets";
  const publicUrl = process.env.R2_PUBLIC_URL || `https://assets.grudge-studio.com`;
  const grudgeId = req.user!.grudgeId;

  // Key: players/<grudgeId>/<category>/<timestamp>-<filename>
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `players/${grudgeId}/${category}/${Date.now()}-${safeFilename}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: resolvedType,
      ...(size ? { ContentLength: size } : {}),
      Metadata: {
        grudgeId,
        category,
        originalFilename: filename,
      },
    });

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min

    return res.json({
      success: true,
      uploadUrl,
      key,
      publicUrl: `${publicUrl}/${key}`,
      expiresIn: 300,
      instructions: "PUT your file directly to uploadUrl with the correct Content-Type header.",
    });
  } catch (error) {
    console.error("Presign error:", error);
    return res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ── GET /api/assets/list ─────────────────────────────────────────────────

router.get("/list", authMiddleware, async (req: AuthenticatedRequest, res) => {
  const r2 = getR2Client();
  if (!r2) return res.json({ success: true, assets: [], configured: false });

  const bucket = process.env.R2_BUCKET || "grudge-assets";
  const publicUrl = process.env.R2_PUBLIC_URL || `https://assets.grudge-studio.com`;
  const grudgeId = req.user!.grudgeId;
  const { category } = req.query as { category?: string };

  const prefix = `players/${grudgeId}/${category || ""}`;

  try {
    const result = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const assets = (result.Contents || []).map((obj) => ({
      key: obj.Key,
      url: `${publicUrl}/${obj.Key}`,
      size: obj.Size,
      lastModified: obj.LastModified,
    }));
    return res.json({ success: true, assets });
  } catch (error) {
    console.error("List assets error:", error);
    return res.status(500).json({ error: "Failed to list assets" });
  }
});

export default router;
