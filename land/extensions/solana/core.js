import log from "../../seed/log.js";
import {
  Keypair,
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  sendAndConfirmTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
import crypto from "crypto";

// Node model wired from init via setModels
let Node = null;
let _metadata = null;
export function setModels(models) { Node = models.Node; }
export function setMetadata(metadata) { _metadata = metadata; }

/* ------------------------------------------------------------------ */
/*  Wallet metadata helpers                                            */
/* ------------------------------------------------------------------ */

function getWallet(node, versionIndex) {
  const meta = _metadata.getExtMeta(node, "solana");
  return meta.wallets?.[versionIndex] || null;
}

async function setWallet(node, versionIndex, walletData) {
  const meta = _metadata.getExtMeta(node, "solana");
  if (!meta.wallets) meta.wallets = {};
  meta.wallets[versionIndex] = walletData;
  await _metadata.setExtMeta(node, "solana", meta);
}

const JUP_BASE = "https://api.jup.ag/ultra/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

const SOLANA_ENABLED = !!(process.env.SOLANA_RPC_URL && process.env.NODE_WALLET_MASTER_KEY);

const connection = SOLANA_ENABLED ? new Connection(process.env.SOLANA_RPC_URL, "confirmed") : null;

const MASTER_KEY = SOLANA_ENABLED ? Buffer.from(process.env.NODE_WALLET_MASTER_KEY, "hex") : null;
if (MASTER_KEY && MASTER_KEY.length !== 32) {
  throw new Error("NODE_WALLET_MASTER_KEY must be 32 bytes (hex)");
}

function requireSolana() {
  if (!SOLANA_ENABLED) throw new Error("Solana is not configured (missing SOLANA_RPC_URL or NODE_WALLET_MASTER_KEY)");
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
    Buffer.from(enc.iv, "base64"),
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
  requireSolana();
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  const version = { values: {} };
  if (!version) throw new Error("Version not found");

  const existing = getWallet(node, versionIndex);
  if (existing?.publicKey) {
    return { publicKey: existing.publicKey, created: false };
  }

  const keypair = Keypair.generate();
  const encryptedPrivateKey = encryptSecretKey(keypair.secretKey);

  setWallet(node, versionIndex, {
    publicKey: keypair.publicKey.toBase58(),
    encryptedPrivateKey,
    createdAt: new Date(),
  });

  return {
    publicKey: keypair.publicKey.toBase58(),
    created: true,
  };
}

/* ------------------------------------------------------------------ */
/*  INTERNAL signing access                                            */
/* ------------------------------------------------------------------ */

async function getVersionKeypair(node, versionIndex) {
  const wallet = getWallet(node, versionIndex);

  if (!wallet?.encryptedPrivateKey) {
    throw new Error("Version wallet does not exist");
  }

  const secretKey = decryptSecretKey(wallet.encryptedPrivateKey);
  return Keypair.fromSecretKey(secretKey);
}

/* ------------------------------------------------------------------ */
/*  Balance sync (SOL only)                                            */
/* ------------------------------------------------------------------ */

export async function syncVersionSOLBalance(node, versionIndex) {
  requireSolana();
  const wallet = getWallet(node, versionIndex);

  if (!wallet?.publicKey) {
    return null;
  }

  const pubkey = new PublicKey(wallet.publicKey);
  const lamports = await connection.getBalance(pubkey);

  // Store SOL balance in metadata.values
  const values = _metadata.getExtMeta(node, "values") || {};
  values._auto__sol = lamports;
  // Note: cross-namespace write to "values" for auto-SOL balance display.
  // Uses _auto__ prefix convention to distinguish from user-set values.
  await _metadata.setExtMeta(node, "values", values);

  return lamports;
}

/* ------------------------------------------------------------------ */
/*  Public wallet info (READ ONLY)                                     */
/* ------------------------------------------------------------------ */

export async function getVersionWalletInfo(nodeId, versionIndex) {
  requireSolana();
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    throw new Error("Invalid version index");
  }

  const node = await Node.findById(nodeId);
  const wallet = getWallet(node, versionIndex);

  if (!wallet?.publicKey) {
    return { exists: false };
  }

  // Read values from metadata
  const values = _metadata.getExtMeta(node, "values") || {};

  const tokens = [];

  for (const [key, value] of Object.entries(values)) {
    if (
      key.startsWith("_auto__sol_") &&
      !key.endsWith("_usd") &&
      !key.endsWith("_dec") &&
      key !== "_auto__sol"
    ) {
      const mint = key.replace("_auto__sol_", "");
      const uiAmount = value;
      const usd = values[`_auto__sol_${mint}_usd`] ?? null;

      tokens.push({
        mint,
        uiAmount,
        usd,
      });
    }
  }

  return {
    exists: true,
    publicKey: wallet.publicKey,
    solBalance: values._auto__sol ?? 0,
    tokens,
  };
}

/* ------------------------------------------------------------------ */
/*  Send SOL                                                          */
/* ------------------------------------------------------------------ */

async function resolveDestinationPublicKey({ toAddress, toNodeId }) {
  // Case 1: direct Solana address
  if (toAddress) {
    return {
      pubkey: new PublicKey(toAddress),
      node: null,
      versionIndex: null,
    };
  }

  // Case 2: node → latest version (auto-create wallet if missing)
  if (toNodeId) {
    const node = await Node.findById(toNodeId);
    if (!node) throw new Error("Destination node not found");

    const versionIndex = 0;

    // Ensure destination wallet exists
    await ensureVersionWallet(toNodeId, versionIndex);

    // Reload to get the wallet
    const updated = await Node.findById(toNodeId);
    const destWallet = getWallet(updated, versionIndex);
    const walletPubkey = destWallet?.publicKey;

    if (!walletPubkey) {
      throw new Error("Failed to resolve destination wallet");
    }

    return {
      pubkey: new PublicKey(walletPubkey),
      node: updated,
      versionIndex,
    };
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
  requireSolana();
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    throw new Error("Invalid version index");
  }

  if (toNodeId && toNodeId === nodeId) {
    throw new Error("Cannot send SOL to the same node");
  }

  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Invalid lamports");
  }

  // Ensure sender wallet exists
  await ensureVersionWallet(nodeId, versionIndex);

  const node = await Node.findById(nodeId);
  const signer = await getVersionKeypair(node, versionIndex);

  const dest = await resolveDestinationPublicKey({
    toAddress,
    toNodeId,
  });
  const destinationPubkey = dest.pubkey;

  /* -------------------------------------------------- */
  /*  Fee + rent aware auto-adjust                      */
  /* -------------------------------------------------- */

  const [senderBalance, destInfo] = await Promise.all([
    connection.getBalance(signer.publicKey),
    connection.getAccountInfo(destinationPubkey),
  ]);

  let overhead = 0;

  // Destination account doesn't exist → must be rent exempt
  if (!destInfo) {
    overhead += await connection.getMinimumBalanceForRentExemption(0);
  }

  // Conservative fee buffer
  const FEE_BUFFER = 10_000; // ~0.00001 SOL
  overhead += FEE_BUFFER;

  const maxSendable = senderBalance - overhead;

  if (maxSendable <= 0) {
    throw new Error("Insufficient SOL to cover fees and rent");
  }

  // Reject if requested amount exceeds available balance after fees
  if (lamports > maxSendable) {
    throw new Error(
      `Requested ${lamports} lamports but only ${maxSendable} sendable after fees and rent. ` +
      `Reduce the amount or add more SOL.`
    );
  }
  const finalLamports = lamports;

  /* -------------------------------------------------- */
  /*  Build + send transaction                          */
  /* -------------------------------------------------- */

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: destinationPubkey,
      lamports: finalLamports,
    }),
  );

  let signature;

  try {
    signature = await sendAndConfirmTransaction(connection, tx, [signer]);
  } catch (err) {
    // Surface Solana logs if available
    if (typeof err?.getLogs === "function") {
      const logs = await err.getLogs();
 log.error("Solana", "Solana tx logs:", logs);
    }
    throw err;
  }

  /* -------------------------------------------------- */
  /*  Sync + persist                                   */
  /* -------------------------------------------------- */

  await syncVersionSOLBalance(node, versionIndex);
  if (dest.node) {
    await syncVersionSOLBalance(dest.node, dest.versionIndex);
  }

  return {
    signature,
    from: signer.publicKey.toBase58(),
    to: destinationPubkey.toBase58(),
    lamports: finalLamports,
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
  requireSolana();
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
  await syncVersionTokenHoldings(node, versionIndex);

  return {
    signature: sig,
    tokenMint: mintAddress,
    amount,
  };
}

//==============JUPITER===================//

const JUP_HOLDINGS_URL = "https://api.jup.ag/ultra/v1/holdings";
const JUP_PRICE_URL = "https://api.jup.ag/price/v3";

async function fetchHoldings(address) {
  const res = await fetch(`${JUP_HOLDINGS_URL}/${address}`, {
    headers: {
      "x-api-key": process.env.JUP_API_KEY,
    },
  });

  const bodyText = await res.text(); // read ONCE

  if (!res.ok) {
    throw new Error(`Jupiter holdings error: ${res.status} ${bodyText}`);
  }

  const data = JSON.parse(bodyText);
  return data;
}

export async function syncVersionTokenHoldings(node, versionIndex) {
  requireSolana();
  const wallet = getWallet(node, versionIndex);
  if (!wallet?.publicKey) return null;

  const values = _metadata.getExtMeta(node, "values") || {};

  const pubkey = wallet.publicKey;
  const holdings = await fetchHoldings(pubkey);

  const seenMints = [];
  const seenKeys = new Set();

  /* ---------------------------------- */
  /* 1. Aggregate SPL balances           */
  /* ---------------------------------- */

  const balances = {}; // mint -> { uiAmount, decimals }

  for (const [mint, accounts] of Object.entries(holdings.tokens)) {
    let totalUi = 0;
    let decimals = null;

    for (const acct of accounts) {
      totalUi += acct.uiAmount;
      decimals ??= acct.decimals;
    }

    if (totalUi <= 0) continue;

    balances[mint] = { uiAmount: totalUi, decimals };
    seenMints.push(mint);

    const baseKey = `_auto__sol_${mint}`;
    seenKeys.add(baseKey);
    seenKeys.add(`${baseKey}_usd`);
    seenKeys.add(`${baseKey}_dec`);

    // balance
    values[baseKey] = totalUi;
    // decimals
    values[`${baseKey}_dec`] = decimals;
  }

  /* ---------------------------------- */
  /* 2. Fetch USD prices                 */
  /* ---------------------------------- */

  let prices = {};
  try {
    prices = await fetchPrices(seenMints);
  } catch (err) {
 log.warn("Solana", "Price fetch failed, skipping USD valuation:", err.message);
  }

  for (const mint of seenMints) {
    const price = prices[mint]?.usdPrice;
    if (price == null) continue;

    const uiAmount = balances[mint].uiAmount;
    const usdValue = uiAmount * price;

    values[`_auto__sol_${mint}_usd`] = Number(usdValue.toFixed(6));
  }

  /* ---------------------------------- */
  /* 3. Cleanup stale entries            */
  /* ---------------------------------- */

  for (const key of Object.keys(values)) {
    if (
      key.startsWith("_auto__sol_") &&
      key !== "_auto__sol" &&
      !seenKeys.has(key)
    ) {
      delete values[key];
    }
  }

  await _metadata.setExtMeta(node, "values", values);

  return {
    tokens: seenMints.length,
  };
}

async function createJupiterOrder({
  inputMint,
  outputMint,
  amount, // RAW units (string or number)
  taker,
  slippageBps = 50, // 0.5%
}) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    taker,
    slippageBps: slippageBps.toString(),
  });

  const res = await fetch(`${JUP_BASE}/order?${params}`, {
    headers: {
      "x-api-key": process.env.JUP_API_KEY,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jupiter order error: ${text}`);
  }

  return JSON.parse(text);
}
function signJupiterTransaction(base64Tx, signer) {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));

  tx.sign([signer]);

  return Buffer.from(tx.serialize()).toString("base64");
}
async function executeJupiterSwap({ signedTransaction, requestId }) {
  const res = await fetch(`${JUP_BASE}/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.JUP_API_KEY,
    },
    body: JSON.stringify({
      signedTransaction,
      requestId,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jupiter execute error: ${text}`);
  }

  return JSON.parse(text);
}

export async function swapFromVersion({
  nodeId,
  versionIndex,
  inputMint,
  outputMint,
  amountUi,
  slippageBps,
}) {
  requireSolana();
  await ensureVersionWallet(nodeId, versionIndex);

  if (inputMint === SOL_MINT && outputMint === SOL_MINT) {
    throw new Error("SOL to SOL swap is not allowed");
  }

  const node = await Node.findById(nodeId);
  const values = _metadata.getExtMeta(node, "values") || {};
  const signer = await getVersionKeypair(node, versionIndex);
  const taker = signer.publicKey.toBase58();

  /* ------------------------------ */
  /* 1. Resolve raw amount           */
  /* ------------------------------ */

  const decimals = getStoredDecimals(values, inputMint);
  const amountRaw = uiToRaw(amountUi, decimals);

  const availableUi = getAvailableUiBalance(values, inputMint);

  if (amountUi > availableUi) {
    throw new Error("Insufficient balance");
  }

  if (amountRaw <= 0) {
    throw new Error("Amount too small after conversion");
  }

  /* ------------------------------ */
  /* 2. Create Jupiter order         */
  /* ------------------------------ */

  const order = await createJupiterOrder({
    inputMint,
    outputMint,
    amount: amountRaw,
    taker,
    slippageBps,
  });

  if (!order.transaction) {
    throw new Error(order.errorMessage || "No transaction returned");
  }

  /* ------------------------------ */
  /* 3. Sign transaction             */
  /* ------------------------------ */

  const signedTx = signJupiterTransaction(order.transaction, signer);

  /* ------------------------------ */
  /* 4. Execute                      */
  /* ------------------------------ */

  const result = await executeJupiterSwap({
    signedTransaction: signedTx,
    requestId: order.requestId,
  });

  if (result.status !== "Success") {
    throw new Error(result.error || "Swap failed");
  }

  /* ------------------------------ */
  /* 5. Sync balances                */
  /* ------------------------------ */

  await syncVersionSOLBalance(node, versionIndex);
  await syncVersionTokenHoldings(node, versionIndex);

  return {
    signature: result.signature,
    inputMint,
    outputMint,
    inputAmountRaw: result.totalInputAmount,
    outputAmountRaw: result.totalOutputAmount,
  };
}

function getAvailableUiBalance(values, mint) {
  if (isSolMint(mint)) {
    const lamports = values["_auto__sol"] ?? 0;
    return lamports / 1e9;
  }

  return values[`_auto__sol_${mint}`] ?? 0;
}

async function fetchPrices(mints) {
  if (!mints.length) return {};

  const params = new URLSearchParams({
    ids: mints.join(","),
  });

  const res = await fetch(`${JUP_PRICE_URL}?${params}`, {
    headers: {
      "x-api-key": process.env.JUP_API_KEY,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jupiter price error: ${text}`);
  }

  return JSON.parse(text);
}
const SOL_DECIMALS = 9;

function isSolMint(mint) {
  return mint === SOL_MINT;
}

function getStoredDecimals(values, mint) {
  if (isSolMint(mint)) return SOL_DECIMALS;

  const dec = values?.[`_auto__sol_${mint}_dec`];
  if (typeof dec !== "number") {
    throw new Error(`Missing decimals for token ${mint}`);
  }
  return dec;
}

function uiToRaw(uiAmount, decimals) {
  if (typeof uiAmount !== "number" || uiAmount <= 0) {
    throw new Error("Invalid UI amount");
  }

  const [whole, frac = ""] = uiAmount.toString().split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);

  return Number(BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded));
}
