import {
  Keypair,
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
import crypto from "crypto";
import Node from "../db/models/node.js";

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

const MASTER_KEY = Buffer.from(process.env.NODE_WALLET_MASTER_KEY, "hex");
if (MASTER_KEY.length !== 32) {
  throw new Error("NODE_WALLET_MASTER_KEY must be 32 bytes (hex)");
}

/* ------------------------------------------------------------------ */
/*  Encryption helpers (INTERNAL)                                      */
/* ------------------------------------------------------------------ */

function encryptSecretKey(secretKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(secretKey)),
    cipher.final(),
  ]);

  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptSecretKey(enc) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    MASTER_KEY,
    Buffer.from(enc.iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc.data, "base64")),
    decipher.final(),
  ]);

  return Uint8Array.from(decrypted);
}

/* ------------------------------------------------------------------ */
/*  Wallet creation (PUBLIC, SAFE)                                     */
/* ------------------------------------------------------------------ */

export async function ensureVersionWallet(nodeId, versionIndex) {
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  const version = node.versions[versionIndex];
  if (!version) throw new Error("Version not found");

  if (version.wallet?.publicKey) {
    return {
      publicKey: version.wallet.publicKey,
      created: false,
    };
  }

  const keypair = Keypair.generate();
  const encryptedPrivateKey = encryptSecretKey(keypair.secretKey);

  version.wallet = {
    publicKey: keypair.publicKey.toBase58(),
    encryptedPrivateKey,
    createdAt: new Date(),
  };

  node.markModified("versions");
  await node.save();

  return {
    publicKey: version.wallet.publicKey,
    created: true,
  };
}

/* ------------------------------------------------------------------ */
/*  INTERNAL signing access                                            */
/* ------------------------------------------------------------------ */

async function getVersionKeypair(node, versionIndex) {
  const version = node?.versions?.[versionIndex];

  if (!version?.wallet?.encryptedPrivateKey) {
    throw new Error("Version wallet does not exist");
  }

  const secretKey = decryptSecretKey(version.wallet.encryptedPrivateKey);
  return Keypair.fromSecretKey(secretKey);
}

/* ------------------------------------------------------------------ */
/*  Balance sync (SOL only)                                            */
/* ------------------------------------------------------------------ */

export async function syncVersionSOLBalance(node, versionIndex) {
  const version = node?.versions?.[versionIndex];

  if (!version?.wallet?.publicKey) {
    // No wallet yet → balance is zero
    version?.values?.set("_auto__sol", 0);
    node.markModified("versions");
    await node.save();
    return 0;
  }

  const pubkey = new PublicKey(version.wallet.publicKey);
  const lamports = await connection.getBalance(pubkey);

  version.values.set("_auto__sol", lamports);
  node.markModified("versions");
  await node.save();

  return lamports;
}

/* ------------------------------------------------------------------ */
/*  Public wallet info (READ ONLY)                                     */
/* ------------------------------------------------------------------ */

export async function getVersionWalletInfo(nodeId, versionIndex) {
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    throw new Error("Invalid version index");
  }

  const node = await Node.findById(nodeId);
  const version = node?.versions?.[versionIndex];

  if (!version?.wallet?.publicKey) {
    return { exists: false };
  }

  return {
    exists: true,
    publicKey: version.wallet.publicKey,
    solBalance: version.values?.get("_auto__sol") ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Send SOL                                                          */
/* ------------------------------------------------------------------ */

async function resolveDestinationPublicKey({ toAddress, toNodeId }) {
  // Case 1: direct address
  if (toAddress) {
    return new PublicKey(toAddress);
  }

  // Case 2: node → latest version (auto-create wallet if missing)
  if (toNodeId) {
    const node = await Node.findById(toNodeId);
    if (!node) throw new Error("Destination node not found");

    const versionIndex = node.prestige;

    // ✅ ENSURE wallet exists on destination node latest version
    await ensureVersionWallet(toNodeId, versionIndex);

    // Reload to get the newly created wallet
    const updated = await Node.findById(toNodeId);
    const walletPubkey = updated?.versions?.[versionIndex]?.wallet?.publicKey;

    if (!walletPubkey) {
      throw new Error("Failed to resolve destination wallet");
    }

    return new PublicKey(walletPubkey);
  }

  throw new Error("Must provide either toAddress or toNodeId");
}

export async function sendSOLFromVersion({
  nodeId,
  versionIndex,
  toAddress,
  toNodeId,
  lamports,
}) {
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    throw new Error("Invalid version index");
  }
  if (toNodeId === nodeId) {
    throw new Error("Cannot send SOL to the same node");
  }
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Invalid lamports");
  }

  await ensureVersionWallet(nodeId, versionIndex);

  const node = await Node.findById(nodeId);
  const signer = await getVersionKeypair(node, versionIndex);

  const destinationPubkey = await resolveDestinationPublicKey({
    toAddress,
    toNodeId,
  });

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: destinationPubkey,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [signer]);

  await syncVersionSOLBalance(node, versionIndex);

  node.markModified("versions");
  await node.save();

  return {
    signature: sig,
    from: signer.publicKey.toBase58(),
    to: destinationPubkey.toBase58(),
    lamports,
  };
}

/* ------------------------------------------------------------------ */
/*  Send SPL token                                                     */
/* ------------------------------------------------------------------ */

export async function sendSPLTokenFromVersion({
  nodeId,
  versionIndex,
  mintAddress,
  toAddress,
  amount,
}) {
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    throw new Error("Invalid version index");
  }

  await ensureVersionWallet(nodeId, versionIndex);

  const node = await Node.findById(nodeId);
  const signer = await getVersionKeypair(node, versionIndex);

  const mint = new PublicKey(mintAddress);
  const owner = signer.publicKey;
  const recipient = new PublicKey(toAddress);

  const fromATA = await getAssociatedTokenAddress(mint, owner);
  const toATA = await getAssociatedTokenAddress(mint, recipient);

  const ix = createTransferInstruction(fromATA, toATA, owner, amount);

  const tx = new Transaction().add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [signer]);

  await syncVersionSOLBalance(node, versionIndex);

  node.markModified("versions");
  await node.save();

  return {
    signature: sig,
    tokenMint: mintAddress,
    amount,
  };
}
