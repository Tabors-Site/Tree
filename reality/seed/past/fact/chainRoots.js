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
//   branch  — sha256(canonical({ branch, parent, branchPoint,
//             reels: sorted [reelKey, headHash] of the branch's OWN
//             rows })). Commits to the branch's divergence AND its
//             anchor in the parent; comparing roots parent-first
//             compares whole worlds.
//   story — sha256(canonical({ story, branches: sorted
//             [path, branchRoot] })). One fingerprint for the whole
//             substrate's chain state. Two realities compare state
//             in a single round-trip; on mismatch, walk down
//             (branch roots → reel heads → facts) to the exact
//             divergence. Git's trick, applied to worlds.
//
// A being's complete biography across branches/realities is a
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
import ReelHead from "../reel/reelHead.js";
import Fact from "./fact.js";
import { canonicalize, GENESIS_PREV } from "./hash.js";

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
export async function reelRoot(type, id, branch = "0") {
  const { reelKey } = await import("../reel/reelHeads.js");
  const row = await ReelHead.findById(reelKey(branch, type, id))
    .select("head headHash").lean();
  if (!row) return GENESIS_PREV;
  if (row.headHash) return row.headHash;
  const headFact = await Fact.findOne(
    { branch, "of.kind": type, "of.id": String(id), seq: row.head },
    { _id: 1 },
  ).lean();
  return headFact?._id || GENESIS_PREV;
}

// The ONE branch roll-up shape — DB reads and bundle parts both flow
// through here, so a captured bundle and a live substrate with the
// same chain produce byte-identical roots. Covers BOTH chain
// families: the fact reels AND the act-chains (acts are content-
// addressed too — Tabor 2026-06-11: "the story root would
// literally cover everything").
function branchRollup(path, meta, reelRows, actRows) {
  const reels = (reelRows || [])
    .map((r) => [String(r._id), r.headHash || `seq:${r.head}`])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const acts = (actRows || [])
    .map((r) => [String(r._id), r.headHash || null])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const branchPoint = meta?.branchPoint
    ? (meta.branchPoint instanceof Map
        ? Object.fromEntries(meta.branchPoint)
        : meta.branchPoint)
    : {};
  return rollup({
    branch: path,
    parent: meta?.parent ?? null,
    branchPoint,
    reels,
    acts,
  });
}

/**
 * PURE story root over chain parts (branch rows + reelHead rows) —
 * no DB, no clock. This is the bundle fingerprint: captureGraft
 * computes it over the exact arrays it captured (race-free) and
 * plantGraft recomputes it over what landed. The live storyRoot()
 * below builds the same shapes from the DB.
 */
export function storyRootFromParts({ story, branches = [], reelHeads = [], actHeads = [] }) {
  const metaByPath = new Map(
    branches.map((b) => [String(b._id ?? b.path), b]),
  );
  const rowsByBranch = new Map();
  for (const r of reelHeads) {
    const b = String(r.branch ?? "0");
    if (!rowsByBranch.has(b)) rowsByBranch.set(b, []);
    rowsByBranch.get(b).push(r);
  }
  const actsByBranch = new Map();
  for (const r of actHeads) {
    const b = String(r.branch ?? "0");
    if (!actsByBranch.has(b)) actsByBranch.set(b, []);
    actsByBranch.get(b).push(r);
  }
  const paths = new Set(["0", ...metaByPath.keys(), ...rowsByBranch.keys(), ...actsByBranch.keys()]);
  const out = [];
  for (const path of [...paths].sort()) {
    const meta = path === "0" ? null : metaByPath.get(path) || null;
    out.push([path, branchRollup(path, meta, rowsByBranch.get(path) || [], actsByBranch.get(path) || [])]);
  }
  return rollup({ story: story ?? null, branches: out });
}

/**
 * PURE scoped fingerprint for a GRAFT extract — a commitment to exactly
 * the reels and act-chains a being's graft carries, at the heads it
 * carries them, plus the being's id. Unlike storyRootFromParts (which
 * folds the whole-story branch set AND the story domain — wrong for a
 * scoped extract that crosses host realities), this folds ONLY the
 * in-scope heads, so captureGraft and applyGraft recompute a byte-
 * identical fingerprint over the same extract with no dependence on the
 * host story's other branches. The reelHead/actHead `_id` already
 * encodes the branch, so a flat sorted list is branch-aware. Same rollup
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
 * A branch's root hash over its OWN divergence + its anchor.
 * Inherited prefix is committed via parent + branchPoint (the
 * parent's root covers the shared facts; recursive comparison
 * parent-first compares full worlds without recounting the prefix).
 */
export async function branchRoot(branchPath) {
  return memoized(`branch:${branchPath}`, async () => {
    const { loadBranch } = await import("../../materials/branch/branches.js");
    const { default: ActHead } = await import("../act/actHead.js");
    const meta = branchPath === "0" ? null : await loadBranch(branchPath);
    const [rows, actRows] = await Promise.all([
      ReelHead.find({ branch: branchPath }).select("_id head headHash").lean(),
      ActHead.find({ branch: branchPath }).select("_id headHash").lean(),
    ]);
    return branchRollup(branchPath, meta, rows, actRows);
  });
}

/**
 * The story's root hash: one fingerprint of the entire chain
 * state, all branches. Same root = bit-identical chain.
 */
export async function storyRoot() {
  return memoized("story", async () => {
    const { default: Branch } = await import("../../materials/branch/branch.js");
    const { default: ActHead } = await import("../act/actHead.js");
    const { getStoryDomain } = await import("../../ibp/address.js");
    const [branchRows, headRows, actHeadRows] = await Promise.all([
      Branch.find({}).lean(),
      ReelHead.find({}).select("_id branch head headHash").lean(),
      ActHead.find({}).select("_id branch headHash").lean(),
    ]);
    return storyRootFromParts({
      story: getStoryDomain(),
      branches: branchRows,
      reelHeads: headRows,
      actHeads: actHeadRows,
    });
  });
}

/**
 * The story root, SIGNED by the story (= I_AM) key. A peer given
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
    const { getStoryIdentity, signData } = await import("../../storyIdentity.js");
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
    return crypto.verify(null, Buffer.from(String(storyRoot), "utf8"), pub, Buffer.from(sig, "base64"));
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
  description: "Walk a reel's hash chain (branch-aware) and report intact/broken with the exact break position.",
  args: {
    type:   { type: "text", label: "Reel kind (being|space|matter)", required: true },
    id:     { type: "text", label: "Aggregate id", required: true },
    branch: { type: "text", label: "Branch (default main)", required: false },
  },
  handler: async ({ args, branch: ctxBranch }) => {
    const { verifyReel } = await import("./verifyReel.js");
    return verifyReel(args.type, args.id, args.branch || ctxBranch || "0");
  },
});

registerSeeOperation("verify-act", {
  description: "Verify one act's seal signature self-certifyingly (the signer id IS the key; \"i-am\" verifies against the story key). The wire form of the signed-act badge.",
  args: {
    actId: { type: "text", label: "Act id", required: true },
  },
  handler: async ({ args }) => {
    const actId = String(args?.actId || "");
    const notFound = { actId, found: false, signed: false, verified: false, reason: "not-found" };
    if (!actId) return notFound;
    const { default: Act } = await import("../act/act.js");
    const act = await Act.findById(actId).lean();
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
  description: "The chain's root hashes: the story root, or one branch's root.",
  args: {
    branch: { type: "text", label: "Branch path (omit for the story root + all branches)", required: false },
  },
  handler: async ({ args }) => {
    if (typeof args?.branch === "string" && args.branch.length) {
      return { branch: args.branch, rootHash: await branchRoot(args.branch) };
    }
    const { default: Branch } = await import("../../materials/branch/branch.js");
    const rows = await Branch.find({}).select("_id").lean();
    const paths = [...new Set(["0", ...rows.map((b) => String(b._id))])].sort();
    const branches = {};
    for (const p of paths) branches[p] = await branchRoot(p);
    return { storyRoot: await storyRoot(), branches };
  },
});
