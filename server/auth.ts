import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { eq, and, lt } from "drizzle-orm";
import { db } from "./db.js";
import { users, authTokens, authProviders } from "../shared/schema.js";

// ============================================
// CONFIG
// ============================================

const JWT_SECRET = process.env.JWT_SECRET || "grudge-studio-jwt-secret-change-me";
const JWT_EXPIRY = "7d";
const BCRYPT_ROUNDS = 12;

// ============================================
// GRUDGE ID GENERATION
// ============================================

export function generateGrudgeId(userId: string): string {
  return `GRUDGE_${userId.replace(/-/g, "").substring(0, 12).toUpperCase()}`;
}

// ============================================
// JWT HELPERS
// ============================================

export interface JwtPayload {
  userId: string;
  username: string;
  grudgeId: string;
  isGuest: boolean;
}

export function generateJwt(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    res.status(401).json({ error: "Authorization token required" });
    return;
  }

  const decoded = verifyJwt(token);
  if (!decoded) {
    res.status(403).json({ error: "Invalid or expired token" });
    return;
  }

  req.user = decoded;
  next();
}

// ============================================
// DB TOKEN MANAGEMENT
// ============================================

export async function createDbToken(
  userId: string,
  tokenType: "standard" | "guest" | "wallet" | "puter",
  expiryDays = 7
): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = Date.now() + expiryDays * 24 * 60 * 60 * 1000;

  await db.insert(authTokens).values({
    userId,
    token,
    tokenType,
    expiresAt,
    createdAt: Date.now(),
  });

  return token;
}

export async function revokeDbToken(token: string): Promise<boolean> {
  try {
    await db.delete(authTokens).where(eq(authTokens.token, token));
    return true;
  } catch {
    return false;
  }
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await db.delete(authTokens).where(eq(authTokens.userId, userId));
}

export async function cleanupExpiredTokens(): Promise<void> {
  // Delete tokens where expiresAt < now (token is expired)
  await db.delete(authTokens).where(lt(authTokens.expiresAt, Date.now()));
}

// ============================================
// AUTH FLOWS
// ============================================

/**
 * Register a new user with email/password
 */
export async function registerUser(
  username: string,
  password: string,
  email?: string
): Promise<{ user: typeof users.$inferSelect; token: string }> {
  // Check existing
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing) {
    throw new Error("Username already exists");
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({
      username,
      password: hashedPassword,
      email: email || null,
      isGuest: false,
    })
    .returning();

  const grudgeId = generateGrudgeId(user.id);
  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  await createDbToken(user.id, "standard");

  return { user, token };
}

/**
 * Login with email/password
 */
export async function loginUser(
  username: string,
  password: string
): Promise<{ user: typeof users.$inferSelect; token: string }> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!user || !user.password) {
    throw new Error("Invalid credentials");
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new Error("Invalid credentials");
  }

  // Update last login
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  const grudgeId = generateGrudgeId(user.id);
  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  return { user, token };
}

/**
 * Guest login — auto-creates a guest account with a Grudge ID
 */
export async function guestLogin(): Promise<{
  user: typeof users.$inferSelect;
  token: string;
}> {
  const guestId = crypto.randomBytes(4).toString("hex");
  const username = `guest_${guestId}`;

  const [user] = await db
    .insert(users)
    .values({
      username,
      isGuest: true,
      puterId: `puter_guest_${guestId}`,
    })
    .returning();

  const grudgeId = generateGrudgeId(user.id);
  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: true,
  });

  await createDbToken(user.id, "guest");

  return { user, token };
}

/**
 * Puter login — validates puter ID and links/creates Grudge account
 */
export async function puterLogin(
  puterId: string,
  displayName?: string
): Promise<{ user: typeof users.$inferSelect; token: string }> {
  // Check if puter ID already linked
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.puterId, puterId))
    .limit(1);

  let user: typeof users.$inferSelect;

  if (existing) {
    user = existing;
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
  } else {
    const username = `puter_${puterId.substring(0, 12)}`;
    const [created] = await db
      .insert(users)
      .values({
        username,
        puterId,
        displayName: displayName || username,
        isGuest: false,
      })
      .returning();
    user = created;

    // Link auth provider
    await db.insert(authProviders).values({
      accountId: user.id,
      provider: "puter",
      providerId: puterId,
    });
  }

  const grudgeId = generateGrudgeId(user.id);
  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  await createDbToken(user.id, "puter");

  return { user, token };
}

/**
 * Discord OAuth — find or create user from Discord profile
 */
export async function discordLogin(discordUser: {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
}): Promise<{ user: typeof users.$inferSelect; token: string }> {
  // Check if Discord ID already linked
  const [existingProvider] = await db
    .select()
    .from(authProviders)
    .where(
      and(
        eq(authProviders.provider, "discord"),
        eq(authProviders.providerId, discordUser.id)
      )
    )
    .limit(1);

  let user: typeof users.$inferSelect;

  if (existingProvider) {
    const [found] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingProvider.accountId))
      .limit(1);
    user = found;
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
  } else {
    const username = `discord_${discordUser.username}`;
    const [created] = await db
      .insert(users)
      .values({
        username,
        email: discordUser.email || null,
        displayName: discordUser.username,
        avatarUrl: discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : null,
        isGuest: false,
      })
      .returning();
    user = created;

    await db.insert(authProviders).values({
      accountId: user.id,
      provider: "discord",
      providerId: discordUser.id,
      profileData: discordUser,
    });
  }

  const grudgeId = generateGrudgeId(user.id);
  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  await createDbToken(user.id, "standard");

  return { user, token };
}
