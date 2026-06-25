// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// chainRoots — root hashes at every scale.
//
// Content addressing operates on STORAGE UNITS, each with a primary
// root hash:
//
//   reel    — the head fact's identity. Every fact's _id commits to
//             all priors via p, so the head IS the rolling root.
//             Denormalized as ReelHead.headHash by the stamper.
//   history — sha256(canonical({ history, parent, branchPoint,
//             reels: sorted [reelKey, headHash] of the history's OWN
//             rows })). Commits to the history's divergence AND its
//             anchor in the parent; comparing roots parent-first
//             compares whole worlds.
//   story — sha256(canonical({ story, histories: sorted
//             [path, historyRoot] })). One fingerprint for the whole
//             substrate's chain state. Two realities compare state
//             in a single round-trip; on mismatch, walk down
//             (history roots → reel heads → facts) to the exact
//             divergence. Git's trick, applied to worlds.
//
// A being's complete biography across histories/realities is a
// DERIVED VIEW composed from multiple reels — hashable per query,
// never a primary identity. The primary identities are these
// storage units.
//
// Computation is on demand with a short TTL memo (discovery fetches
// the story root on every portal connect; a few seconds of
// staleness is free, a reelHeads rescan per connect is not).
// Incremental maintenance (roll up at stamp time) is the noted
// follow-up when scale asks for it.

import crypto from "crypto";
import * as fileStore from "../fileStore.js";
import { getFactsOnReelWhere } from "./facts.js";
import { canonicalize, GENESIS_PREV } from "./hash.js";

// CHAIN-STRUCTURE roll-ups, now FileStore-native. This module fingerprints the
// whole chain: per-reel head hashes, per-being act-chain tips, and the history
// registry. The curated FACT/ACT/ENTITY seam models facts, acts, and entity
// projections — not reel-heads or act-heads — so the cross-aggregate enumerators
// these roll-ups need (every reel head / act head in a history) live on the
// storage primitive: fileStore.listReelHeads(history?) and listActHeads(story,
// history?) scan the reel/act file trees and return rows shaped EXACTLY like the
// old ReelHead/ActHead docs (so the rollup stays byte-identical). The history
// registry reads go through the curated histories.js helpers (loadHistory /
// listAllHistories).

// EVERY roll-up flows through this one helper — no ad-hoc
// serialization anywhere in this module. Determinism across
// substrates is the whole point.
function rollup(obj) {
  return crypto.createHash("sha256").update(canonicalize(obj)).digest("hex");
}

const TTL_MS = 3000;
const _memo = new Map(); // key → { at, value }

async function memoized(key, fn) {
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fn();
  _memo.set(key, { at: Date.now(), value });
  return value;
}

/** Drop the memo (tests, post-plant recompute). */
export function invalidateChainRootCache() {
  _memo.clear();
}

/**
 * The reel's root hash: its head fact's identity. Reads the
 * denormalized ReelHead.headHash; falls back to the head fact when
 * the denormalization is null (reel untouched since before CAS).
 * GENESIS_PREV for an empty/unknown reel.
 *
 * Staleness window: a standalone (non-transactional) append that
 * crashes between the fact insert and the headHash $set leaves
 * headHash one fact behind until the next append self-heals it.
 * verifyReel's returned headHash is the walked truth when exactness
 * matters; sealFacts appends update headHash inside the transaction.
 */
export async function reelRoot(type, id, history = "0") {
  // FileStore swap: the reel's .head carries { head, headHash } — the seq
  // counter + chain root the denormalized ReelHead.headHash held. An untouched
  // reel reads head 0 / headHash GENESIS_PREV.
  const row = fileStore.readReelHead(history, type, String(id));
  if (!row || !row.head) return GENESIS_PREV;
  if (row.headHash && row.headHash !== GENESIS_PREV) return row.headHash;
  // headHash denormalization fell behind (a crash between the fact
  // append and the $set). STORAGE SWAP: read the head fact from the
  // reel via the curated layer instead of the Fact collection. The
  // head fact is the one at seq=row.head; its _id is the reel's walked
  // root. getFactsOnReelWhere is history-aware (unlike getReel, which
  // is pinned to main), so it reads the right history's reel.
  const at = getFactsOnReelWhere(
    history,
    type,
    String(id),
    (f) => f.seq === row.head,
  );
  return at.length ? at[at.length - 1]._id : GENESIS_PREV;
}

// The ONE history roll-up shape — DB reads and bundle parts both flow
// through here, so a captured bundle and a live substrate with the
// same chain produce byte-identical roots. Covers BOTH chain
// families: the fact reels AND the act-chains (acts are content-
// addressed too — Tabor 2026-06-11: "the story root would
// literally cover everything").
function historyRollup(path, meta, reelRows, actRows) {
  const reels = (reelRows || [])
    .map((r) => [String(r._id), r.headHash || `seq:${r.head}`])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const acts = (actRows || [])
    .map((r) => [String(r._id), r.headHash || null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const branchPoint = meta?.branchPoint
    ? meta.branchPoint instanceof Map
      ? Object.fromEntries(meta.branchPoint)
      : meta.branchPoint
    : {};
  return rollup({
    history: path,
    parent: meta?.parent ?? null,
    branchPoint,
    reels,
    acts,
  });
}

/**
 * PURE story root over chain parts (history rows + reelHead rows) —
 * no DB, no clock. This is the bundle fingerprint: captureGraft
 * computes it over the exact arrays it captured (race-free) and
 * plantGraft recomputes it over what landed. The live storyRoot()
 * below builds the same shapes from the DB.
 */
export function storyRootFromParts({
  story,
  histories = [],
  reelHeads = [],
  actHeads = [],
}) {
  const metaByPath = new Map(
    histories.map((b) => [String(b._id ?? b.path), b]),
  );
  const rowsByHistory = new Map();
  for (const r of reelHeads) {
    const b = String(r.history ?? "0");
    if (!rowsByHistory.has(b)) rowsByHistory.set(b, []);
    rowsByHistory.get(b).push(r);
  }
  const actsByHistory = new Map();
  for (const r of actHeads) {
    const b = String(r.history ?? "0");
    if (!actsByHistory.has(b)) actsByHistory.set(b, []);
    actsByHistory.get(b).push(r);
  }
  const paths = new Set([
    "0",
    ...metaByPath.keys(),
    ...rowsByHistory.keys(),
    ...actsByHistory.keys(),
  ]);
  const out = [];
  for (const path of [...paths].sort()) {
    const meta = path === "0" ? null : metaByPath.get(path) || null;
    out.push([
      path,
      historyRollup(
        path,
        meta,
        rowsByHistory.get(path) || [],
        actsByHistory.get(path) || [],
      ),
    ]);
  }
  return rollup({ story: story ?? null, histories: out });
}

/**
 * PURE scoped fingerprint for a GRAFT extract — a commitment to exactly
 * the reels and act-chains a being's graft carries, at the heads it
 * carries them, plus the being's id. Unlike storyRootFromParts (which
 * folds the whole-story history set AND the story domain — wrong for a
 * scoped extract that crosses host realities), this folds ONLY the
 * in-scope heads, so captureGraft and applyGraft recompute a byte-
 * identical fingerprint over the same extract with no dependence on the
 * host story's other histories. The reelHead/actHead `_id` already
 * encodes the history, so a flat sorted list is history-aware. Same rollup
 * discipline (one serializer) as every other root in this module.
 */
export function graftRootFromParts({ beingId, reelHeads = [], actHeads = [] }) {
  const reels = (reelHeads || [])
    .map((r) => [String(r._id), r.headHash || `seq:${r.head}`])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const acts = (actHeads || [])
    .map((r) => [String(r._id), r.headHash || null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rollup({ beingId: beingId ?? null, reels, acts });
}

/**
 * A history's root hash over its OWN divergence + its anchor.
 * Inherited prefix is committed via parent + branchPoint (the
 * parent's root covers the shared facts; recursive comparison
 * parent-first compares full worlds without recounting the prefix).
 */
export async function historyRoot(historyPath) {
  return memoized(`history:${historyPath}`, async () => {
    const { loadHistory } =
      await import("../../materials/history/histories.js");
    const { getStoryDomain } = await import("../../ibp/address.js");
    const meta = historyPath === "0" ? null : await loadHistory(historyPath);
    // FileStore swap: scan this history's reel heads + act heads from the file
    // tree (the peers of ReelHead.find/ActHead.find), rows shaped as before.
    const rows = fileStore.listReelHeads(historyPath);
    const actRows = fileStore.listActHeads(getStoryDomain(), historyPath);
    return historyRollup(historyPath, meta, rows, actRows);
  });
}

/**
 * The story's root hash: one fingerprint of the entire chain
 * state, all histories. Same root = bit-identical chain.
 */
export async function storyRoot() {
  return memoized("story", async () => {
    const { listAllHistories } =
      await import("../../materials/history/histories.js");
    const { getStoryDomain } = await import("../../ibp/address.js");
    const story = getStoryDomain();
    // FileStore swap: every reel head + act head across every history, from the
    // file tree (peers of ReelHead.find({})/ActHead.find({})). History registry
    // stays on the curated histories.js helper.
    const historyRows = await listAllHistories();
    const headRows = fileStore.listReelHeads();
    const actHeadRows = fileStore.listActHeads(story);
    return storyRootFromParts({
      story,
      histories: historyRows,
      reelHeads: headRows,
      actHeads: actHeadRows,
    });
  });
}

/**
 * The story root, SIGNED by the story (= I) key. A peer given
 * only `storyId` (which IS the story public key) plus `storyRoot`
 * and `sig` can verify the root self-certifyingly, with no directory:
 * decode the key from storyId, check the signature over the root.
 * This is the federation provenance — "this whole chain is what the
 * holder of this key is vouching for, signed since genesis."
 *
 * @returns {Promise<{storyRoot: string, storyId: string, sig: string|null}>}
 */
export async function signedStoryRoot() {
  // Memoized (same short TTL as storyRoot) so a hot SEE path does not
  // re-sign every call; ed25519 over the same root is deterministic.
  return memoized("story-signed", async () => {
    const root = await storyRoot();
    const { getStoryIdentity, signData } =
      await import("../../storyIdentity.js");
    const id = getStoryIdentity();
    return {
      storyRoot: root,
      storyId: id.storyId,
      sig: root ? signData(root) : null,
    };
  });
}

/**
 * Verify a signed story root against the storyId (the public key).
 * Self-certifying: the verifier needs nothing but these three values.
 */
export async function verifyStoryRootSig(storyRoot, storyId, sig) {
  if (!storyRoot || !sig) return false;
  try {
    const { keyIdToPublicKey } = await import("../../materials/name/keys.js");
    const pub = keyIdToPublicKey(storyId);
    return crypto.verify(
      null,
      Buffer.from(String(storyRoot), "utf8"),
      pub,
      Buffer.from(sig, "base64"),
    );
  } catch {
    return false;
  }
}

// ── SEE ops ──────────────────────────────────────────────────────────
// Pure reads over the chain — verification and fingerprints. SEE is
// the verb that never stamps facts; these are the wire form of "is
// this chain intact?" and "what state are you at?".
import { registerSeeOperation } from "../../ibp/seeOps.js";

registerSeeOperation("verify-reel", {
  description:
    "Walk a reel's hash chain (history-aware) and report intact/broken with the exact break position.",
  args: {
    type: {
      type: "text",
      label: "Reel kind (being|space|matter)",
      required: true,
    },
    id: { type: "text", label: "Aggregate id", required: true },
    history: { type: "text", label: "History (default main)", required: false },
  },
  handler: async ({ args, history: ctxHistory }) => {
    const { verifyReel } = await import("./verifyReel.js");
    return verifyReel(args.type, args.id, args.history || ctxHistory || "0");
  },
});

registerSeeOperation("verify-act", {
  description:
    'Verify one act\'s seal signature self-certifyingly (the signer id IS the key; "i-am" verifies against the story key). The wire form of the signed-act badge.',
  args: {
    actId: { type: "text", label: "Act id", required: true },
  },
  handler: async ({ args }) => {
    const actId = String(args?.actId || "");
    const notFound = {
      actId,
      found: false,
      signed: false,
      verified: false,
      reason: "not-found",
    };
    if (!actId) return notFound;
    const { getActById } = await import("../act/actChain.js");
    const act = getActById(actId);
    if (!act) return notFound;
    const { verifyActSig } = await import("../act/actSig.js");
    const { getStoryDomain } = await import("../../ibp/address.js");
    const v = await verifyActSig(act, { localStory: getStoryDomain() });
    return {
      actId,
      found: true,
      signed: !!act.sig?.value,
      by: act.sig?.by || null,
      alg: act.sig?.alg || null,
      verified: v.ok,
      reason: v.reason,
    };
  },
});

registerSeeOperation("chain-root", {
  description:
    "The chain's root hashes: the story root, or one history's root.",
  args: {
    history: {
      type: "text",
      label: "History path (omit for the story root + all histories)",
      required: false,
    },
  },
  handler: async ({ args }) => {
    if (typeof args?.history === "string" && args.history.length) {
      return {
        history: args.history,
        rootHash: await historyRoot(args.history),
      };
    }
    const { listAllHistories } =
      await import("../../materials/history/histories.js");
    const rows = await listAllHistories();
    const paths = [...new Set(["0", ...rows.map((b) => String(b._id))])].sort();
    const histories = {};
    for (const p of paths) histories[p] = await historyRoot(p);
    return { storyRoot: await storyRoot(), histories };
  },
});
