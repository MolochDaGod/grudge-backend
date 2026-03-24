import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users, characters, islands } from "../../shared/schema.js";
import { generateGrudgeId } from "../auth.js";

// ============================================
// CROSSMINT CONFIG
// ============================================

const CROSSMINT_BASE_URL =
  process.env.CROSSMINT_BASE_URL || "https://www.crossmint.com/api/v1-alpha2";

const CROSSMINT_COLLECTION_CHARACTERS =
  process.env.CROSSMINT_COLLECTION_CHARACTERS || "grudge-characters";

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

  // Mark as pending
  await db
    .update(characters)
    .set({ cnftStatus: "pending" })
    .where(eq(characters.id, characterId));

  const metadata = {
    name: `${char.name} — Grudge Warlord`,
    symbol: "GRUDGE",
    description: `${char.raceId} ${char.classId} of the Grudge Warlords. Level ${char.level || 1}.`,
    image: char.avatarUrl || `https://molochdagod.github.io/ObjectStore/icons/races/${char.raceId || "human"}.png`,
    attributes: [
      { trait_type: "Race", value: char.raceId || "unknown" },
      { trait_type: "Class", value: char.classId || "unknown" },
      { trait_type: "Level", value: String(char.level || 1) },
      { trait_type: "Profession", value: char.profession || "none" },
      { trait_type: "Type", value: "Character" },
    ],
    properties: {
      category: "character",
      grudgeId: characterId,
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
