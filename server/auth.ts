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

// ============================================
// AUTH RESPONSE BUILDER
// ============================================

/** Single canonical shape returned by every auth endpoint */
export interface AuthResponse {
  success: true;
  token: string;
  user: {
    id: string;
    grudgeId: string;
    username: string;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
    isGuest: boolean;
    isPremium: boolean;
    faction: string | null;
    walletAddress: string | null;
    hasHomeIsland: boolean;
    providers: string[]; // e.g. ["discord", "puter", "phantom"]
  };
}

export async function buildAuthResponse(
  user: typeof import("../shared/schema.js").users.$inferSelect,
  token: string,
  providers: string[] = []
): Promise<AuthResponse> {
  return {
    success: true,
    token,
    user: {
      id: user.id,
      grudgeId: user.grudgeId || generateGrudgeId(user.id),
      username: user.username,
      displayName: user.displayName ?? null,
      email: user.email ?? null,
      avatarUrl: user.avatarUrl ?? null,
      isGuest: user.isGuest ?? false,
      isPremium: user.isPremium ?? false,
      faction: user.faction ?? null,
      walletAddress: user.walletAddress ?? null,
      hasHomeIsland: user.hasHomeIsland ?? false,
      providers,
    },
  };
}

export async function createDbToken(
  userId: string,
  tokenType: "standard" | "guest" | "wallet" | "puter" | "discord" | "google" | "github",
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

  const grudgeId = generateGrudgeId(
    // We need the UUID first — insert then update grudgeId
    crypto.randomUUID() // placeholder; overwritten after insert
  );

  const [user] = await db
    .insert(users)
    .values({
      username,
      password: hashedPassword,
      email: email || null,
      isGuest: false,
    })
    .returning();

  const realGrudgeId = generateGrudgeId(user.id);
  await db.update(users).set({ grudgeId: realGrudgeId }).where(eq(users.id, user.id));

  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId: realGrudgeId,
    isGuest: false,
  });

  await createDbToken(user.id, "standard");

  return { user: { ...user, grudgeId: realGrudgeId }, token };
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
  await db.update(users).set({ grudgeId, lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  return { user: { ...user, grudgeId }, token };
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
  await db.update(users).set({ grudgeId }).where(eq(users.id, user.id));

  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: true,
  });

  await createDbToken(user.id, "guest");

  return { user: { ...user, grudgeId }, token };
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
  await db.update(users).set({ grudgeId, lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  await createDbToken(user.id, "puter");

  return { user: { ...user, grudgeId }, token };
}

/**
 * Discord OAuth
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
  await db.update(users).set({ grudgeId, lastLoginAt: new Date() }).where(eq(users.id, user.id));

  const token = generateJwt({
    userId: user.id,
    username: user.username,
    grudgeId,
    isGuest: false,
  });

  await createDbToken(user.id, "discord");

  return { user: { ...user, grudgeId }, token };
}

// ============================================
// OAUTH PROVIDER HELPER
// ============================================

async function oauthFindOrCreate(opts: {
  provider: string;
  providerId: string;
  username: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  profileData?: Record<string, unknown>;
  tokenType: "discord" | "google" | "github";
}): Promise<{ user: typeof users.$inferSelect; token: string }> {
  const [existingProvider] = await db
    .select()
    .from(authProviders)
    .where(
      and(
        eq(authProviders.provider, opts.provider),
        eq(authProviders.providerId, opts.providerId)
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
  } else {
    // Check if email already has an account — link instead of duplicate
    let existing: typeof users.$inferSelect | undefined;
    if (opts.email) {
      const [byEmail] = await db.select().from(users).where(eq(users.email, opts.email)).limit(1);
      existing = byEmail;
    }

    if (existing) {
      user = existing;
    } else {
      const [created] = await db
        .insert(users)
        .values({
          username: opts.username,
          email: opts.email || null,
          displayName: opts.displayName || opts.username,
          avatarUrl: opts.avatarUrl || null,
          isGuest: false,
          emailVerified: !!opts.email,
        })
        .returning();
      user = created;
    }

    await db.insert(authProviders).values({
      accountId: user.id,
      provider: opts.provider,
      providerId: opts.providerId,
      profileData: opts.profileData,
    });
  }

  const grudgeId = generateGrudgeId(user.id);
  await db
    .update(users)
    .set({ grudgeId, lastLoginAt: new Date(),
      ...(opts.avatarUrl && !user.avatarUrl ? { avatarUrl: opts.avatarUrl } : {}),
      ...(opts.email && !user.email ? { email: opts.email, emailVerified: true } : {}),
    })
    .where(eq(users.id, user.id));

  const token = generateJwt({ userId: user.id, username: user.username, grudgeId, isGuest: false });
  await createDbToken(user.id, opts.tokenType);

  return { user: { ...user, grudgeId }, token };
}

/**
 * Google/Gmail OAuth — find or create user from Google OIDC profile
 */
export async function googleLogin(googleUser: {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
}): Promise<{ user: typeof users.$inferSelect; token: string }> {
  return oauthFindOrCreate({
    provider: "google",
    providerId: googleUser.id,
    username: `google_${googleUser.id.substring(0, 10)}`,
    email: googleUser.email,
    displayName: googleUser.name,
    avatarUrl: googleUser.picture,
    profileData: googleUser,
    tokenType: "google",
  });
}

/**
 * GitHub OAuth — find or create user from GitHub profile
 */
export async function githubLogin(githubUser: {
  id: number;
  login: string;
  email?: string | null;
  name?: string | null;
  avatar_url?: string;
}): Promise<{ user: typeof users.$inferSelect; token: string }> {
  return oauthFindOrCreate({
    provider: "github",
    providerId: String(githubUser.id),
    username: `github_${githubUser.login}`,
    email: githubUser.email,
    displayName: githubUser.name || githubUser.login,
    avatarUrl: githubUser.avatar_url,
    profileData: { ...githubUser, id: String(githubUser.id) },
    tokenType: "github",
  });
}
