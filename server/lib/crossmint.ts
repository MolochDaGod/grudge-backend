import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users, characters, islands } from "../../shared/schema.js";
import { generateGrudgeId } from "../auth.js";
import { RACES, FACTIONS, type RaceId, type FactionId } from "../../shared/gameData/races.js";
import { CLASSES, type ClassId } from "../../shared/gameData/classes.js";
import { generateHeroAvatar, getFallbackAvatarUrl } from "./avatar-gen.js";

// ============================================
// CROSSMINT CONFIG
// ============================================

const CROSSMINT_BASE_URL =
  process.env.CROSSMINT_BASE_URL || "https://www.crossmint.com/api/2022-06-09";

/** Crossmint project: 8410e23e-d003-4061-9b65-7c886a6c46ec */
const CROSSMINT_COLLECTION_CHARACTERS =
  process.env.CROSSMINT_COLLECTION_CHARACTERS || "5061318d-ff65-4893-ac4b-9b28efb18ace";

const CROSSMINT_COLLECTION_ISLANDS =
  process.env.CROSSMINT_COLLECTION_ISLANDS || "grudge-islands";

function getApiKey(): string | null {
  return process.env.CROSSMINT_API_KEY || null;
}

function headers(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("CROSSMINT_API_KEY not configured");
  return {
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
  };
}

// ============================================
// ENSURE WALLET — Auto-provision Crossmint wallet if missing
// ============================================

export async function ensureWallet(userId: string): Promise<{
  walletId: string;
  walletAddress: string;
}> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) throw new Error("User not found");

  // Already has a wallet
  if (user.crossmintWalletId && user.walletAddress) {
    return {
      walletId: user.crossmintWalletId,
      walletAddress: user.walletAddress,
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) throw new Error("CROSSMINT_API_KEY not configured");

  const grudgeId = generateGrudgeId(userId);

  const res = await fetch(`${CROSSMINT_BASE_URL}/wallets`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      type: "solana-mpc-wallet",
      linkedUser: user.email || user.crossmintEmail || `user:${grudgeId}`,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Crossmint wallet creation failed:", res.status, errorText);
    throw new Error(`Wallet creation failed: ${res.status}`);
  }

  const data = await res.json();
  const walletId = data.id || data.walletId;
  const walletAddress = data.address || data.publicKey;

  await db
    .update(users)
    .set({
      crossmintWalletId: walletId,
      walletAddress,
      walletType: "crossmint",
      crossmintEmail: user.email || null,
    })
    .where(eq(users.id, userId));

  return { walletId, walletAddress };
}

// ============================================
// MINT CHARACTER cNFT
// ============================================

export async function mintCharacterCNFT(characterId: string): Promise<{
  mintId: string;
  status: string;
}> {
  const [char] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  if (!char) throw new Error("Character not found");
  if (!char.userId) throw new Error("Character has no owner");

  // Already minted
  if (char.cnftMintId && char.cnftStatus === "minted") {
    return { mintId: char.cnftMintId, status: "already_minted" };
  }

  // Ensure user has a wallet
  const wallet = await ensureWallet(char.userId);
  const grudgeId = generateGrudgeId(char.userId);

  // Mark as pending
  await db
    .update(characters)
    .set({ cnftStatus: "pending" })
    .where(eq(characters.id, characterId));

  // Resolve race → faction
  const raceId = (char.raceId || "human") as RaceId;
  const raceDef = RACES[raceId];
  const factionId = raceDef?.faction || "crusade";
  const factionName = FACTIONS[factionId]?.name || "Crusade";
  const classId = (char.classId || "warrior") as ClassId;
  const classDef = CLASSES[classId];

  // Get or generate avatar
  let imageUrl = char.avatarUrl;
  if (!imageUrl) {
    imageUrl = await generateHeroAvatar(
      char.name,
      raceDef?.name || raceId,
      classDef?.name || classId,
      factionId,
    );
    if (imageUrl) {
      await db.update(characters).set({ avatarUrl: imageUrl }).where(eq(characters.id, characterId));
    } else {
      imageUrl = getFallbackAvatarUrl(raceId);
    }
  }

  // Read attributes
  const attrs = (char.attributes as Record<string, number>) || {};
  const getAttr = (key: string) => attrs[key] || 0;

  // Build complete cNFT metadata (front = image, back = data sheet)
  const metadata = {
    name: `${char.name} — Grudge Warlord`,
    symbol: "GRUDGE",
    description: `${raceDef?.name || raceId} ${classDef?.name || classId} of the ${factionName}. Level ${char.level || 1}. Created by Racalvin The Pirate King.`,
    image: imageUrl,
    attributes: [
      // Identity
      { trait_type: "Race", value: raceDef?.name || raceId },
      { trait_type: "Class", value: classDef?.name || classId },
      { trait_type: "Faction", value: factionName },
      { trait_type: "Level", value: char.level || 1 },
      // Core 8 attributes
      { trait_type: "Strength", value: getAttr("Strength") },
      { trait_type: "Vitality", value: getAttr("Vitality") },
      { trait_type: "Endurance", value: getAttr("Endurance") },
      { trait_type: "Intellect", value: getAttr("Intellect") },
      { trait_type: "Wisdom", value: getAttr("Wisdom") },
      { trait_type: "Dexterity", value: getAttr("Dexterity") },
      { trait_type: "Agility", value: getAttr("Agility") },
      { trait_type: "Tactics", value: getAttr("Tactics") },
      // Profession & progression
      { trait_type: "Profession", value: char.profession || "none" },
      { trait_type: "Experience", value: char.experience || 0 },
      { trait_type: "Gold", value: char.gold || 0 },
      // Model
      { trait_type: "Prefab", value: `${raceId}_${classId}` },
      { trait_type: "Type", value: "Character" },
    ],
    properties: {
      files: [{ uri: imageUrl, type: "image/png" }],
      category: "character",
      grudgeId: grudgeId,
      characterId: characterId,
      creator: "Racalvin The Pirate King",
      studio: "Grudge Studio",
    },
  };

  try {
    const res = await fetch(
      `${CROSSMINT_BASE_URL}/collections/${CROSSMINT_COLLECTION_CHARACTERS}/nfts`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          recipient: `solana:${wallet.walletAddress}`,
          metadata,
          compressed: true,
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Character cNFT mint failed:", res.status, errorText);
      await db
        .update(characters)
        .set({ cnftStatus: "failed" })
        .where(eq(characters.id, characterId));
      throw new Error(`Mint failed: ${res.status}`);
    }

    const mintData = await res.json();
    const mintId = mintData.id || mintData.actionId || mintData.mintId;

    await db
      .update(characters)
      .set({
        cnftMintId: mintId,
        cnftMetadataUri: JSON.stringify(metadata),
        cnftStatus: "minted",
      })
      .where(eq(characters.id, characterId));

    return { mintId, status: "minted" };
  } catch (error) {
    await db
      .update(characters)
      .set({ cnftStatus: "failed" })
      .where(eq(characters.id, characterId));
    throw error;
  }
}

// ============================================
// MINT ISLAND cNFT
// ============================================

export async function mintIslandCNFT(islandId: string): Promise<{
  mintId: string;
  status: string;
}> {
  const [island] = await db
    .select()
    .from(islands)
    .where(eq(islands.id, islandId))
    .limit(1);

  if (!island) throw new Error("Island not found");

  // Already minted
  if (island.cnftMintId && island.cnftStatus === "minted") {
    return { mintId: island.cnftMintId, status: "already_minted" };
  }

  // Ensure user has a wallet
  const wallet = await ensureWallet(island.userId);

  // Mark as pending
  await db
    .update(islands)
    .set({ cnftStatus: "pending" })
    .where(eq(islands.id, islandId));

  const metadata = {
    name: `${island.name} — Grudge Island`,
    symbol: "GRUDGE",
    description: `A ${island.islandType} island in the Grudge Warlords world. ${island.width}x${island.height} terrain.`,
    image: `https://molochdagod.github.io/ObjectStore/icons/islands/${island.islandType || "default"}.png`,
    attributes: [
      { trait_type: "Island Type", value: island.islandType },
      { trait_type: "Width", value: String(island.width || 130) },
      { trait_type: "Height", value: String(island.height || 105) },
      { trait_type: "Seed", value: String(island.seed || 0) },
      { trait_type: "Type", value: "Island" },
    ],
    properties: {
      category: "island",
      grudgeId: islandId,
    },
  };

  try {
    const res = await fetch(
      `${CROSSMINT_BASE_URL}/collections/${CROSSMINT_COLLECTION_ISLANDS}/nfts`,
      {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          recipient: `solana:${wallet.walletAddress}`,
          metadata,
          compressed: true,
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Island cNFT mint failed:", res.status, errorText);
      await db
        .update(islands)
        .set({ cnftStatus: "failed" })
        .where(eq(islands.id, islandId));
      throw new Error(`Mint failed: ${res.status}`);
    }

    const mintData = await res.json();
    const mintId = mintData.id || mintData.actionId || mintData.mintId;

    await db
      .update(islands)
      .set({
        cnftMintId: mintId,
        cnftMetadataUri: JSON.stringify(metadata),
        cnftStatus: "minted",
      })
      .where(eq(islands.id, islandId));

    return { mintId, status: "minted" };
  } catch (error) {
    await db
      .update(islands)
      .set({ cnftStatus: "failed" })
      .where(eq(islands.id, islandId));
    throw error;
  }
}
