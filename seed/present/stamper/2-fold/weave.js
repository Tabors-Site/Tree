// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// weave.js . canonical shape and helpers for the inner-face
// weaving.
//
// What it is.
//   The weave is the audited list of reels the fold actually read
//   when producing one inner face. It is the residue of canSee
//   resolution and foldPlace's occupant gating, captured at fold
//   build time and sealed alongside the face on Act.innerFace (field
//   renamed to .weave).
//   Subscription dispatch, audit, and replay all key off the same
//   object so they can never drift.
//
// Shape (one entry).
//   { reelKind: "being" | "space" | "matter",
//     reelId:   string,
//     history:  string }
//
// Ables are not reel-backed today (the able registry is an in-memory
// Map populated by registerAble, not a fact-chain). Able flips
// manifest as facts on the being's reel via qualities.flow, so
// the self being-reel entry already covers able-change wakeups. If a
// Able primitive ever becomes reel-backed, the shape accepts a "able"
// reelKind without code change.
//
// Ordering (stable for deterministic hashing).
//   . foldPlace contributes the position-space reel during forward /
//     half folds.
//   . the canSee resolver appends the reels each block actually read,
//     in resolution order: address-shape entries land their
//     descriptor's space + qualifier + beings[] + matters[]; named-see
//     handlers whose payload is descriptor-shaped get the same
//     auto-detection via recordDescriptorReels.
//   . buildInnerFace's defensive minimum is the self-being reel: if
//     foldPlace produced nothing and canSee was empty, the self
//     entry is added so a self-fact wakes the subscriber.
//   Within each contributor entries are appended in encounter order;
//   mergeWeaves preserves the union without resorting.
//
// History is included on every entry because the same (kind, id) can
// live on multiple histories and a fact lands on exactly one.
//
// Canonical key.
//   reelKey({ reelKind, reelId, history }) = `${history}|${reelKind}|${reelId}`
//
// Entries are deduplicated by reelKey on insert. Encoded for wire as
// the same JSON array; no canonicalization beyond stable ordering.
//
// Lifecycle.
//   . Captured at fold build time (buildInnerFace owns the merge).
//   . Carried on moment.innerFace.weave during the moment.
//   . Sealed immutably on Act.innerFace.weave at stamped.
//   . Subscription registry rotates the indexed entry by subId on
//     refold; the prior weave is replaced atomically, never mutated.

/**
 * Build a new empty weave. Always returns a fresh array so callers
 * can mutate without cross-contamination.
 */
export function emptyWeave() {
  return [];
}

/**
 * Compute the canonical key for one reel in the weave. Subscription
 * registries and reverse indexes hash on this string.
 */
export function reelKey(entry) {
  if (!entry || typeof entry !== "object") return "";
  const history  = typeof entry.history  === "string" ? entry.history  : "";
  const reelKind = typeof entry.reelKind === "string" ? entry.reelKind : "";
  const reelId   = entry.reelId != null ? String(entry.reelId) : "";
  return `${history}|${reelKind}|${reelId}`;
}

/**
 * Validate one entry. Returns the normalized entry on success or null
 * if the shape is incomplete. Stays permissive (any string reelKind)
 * so future reel kinds drop in without code change here.
 */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const reelKind = typeof entry.reelKind === "string" ? entry.reelKind : null;
  const reelId   = entry.reelId != null ? String(entry.reelId) : null;
  const history  = typeof entry.history === "string" ? entry.history : null;
  if (!reelKind || !reelId || !history) return null;
  return { reelKind, reelId, history };
}

/**
 * Push one reel into the weave if reelKey is not already present.
 * Mutates weave for efficiency in the fold's hot path and returns
 * it so call sites can chain.
 */
export function addReel(weave, entry) {
  if (!Array.isArray(weave)) return weave;
  const normalized = normalizeEntry(entry);
  if (!normalized) return weave;
  const key = reelKey(normalized);
  for (const existing of weave) {
    if (reelKey(existing) === key) return weave;
  }
  weave.push(normalized);
  return weave;
}

/**
 * Merge two weaves, preserving the order of `a` then appending any
 * new entries from `b` (in `b`'s order). Returns a NEW array; neither
 * input is mutated.
 *
 * Used by buildInnerFace to combine the canSee-side weave (reels the
 * resolver read) with the foldedFace-side weave (reels foldPlace
 * read) into one record.
 */
export function mergeWeaves(a, b) {
  const out = [];
  const seen = new Set();
  const pushAll = (list) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const normalized = normalizeEntry(entry);
      if (!normalized) continue;
      const key = reelKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
  };
  pushAll(a);
  pushAll(b);
  return out;
}

/**
 * Encode for the wire / for store persistence. weave is already a plain
 * JSON array; this hook exists so encoding can evolve (canonicalization,
 * compression) without touching call sites.
 */
export function encodeWeave(weave) {
  return Array.isArray(weave) ? weave.slice() : [];
}

/**
 * Decode an incoming payload (wire or stored Act). Defensive: any
 * malformed entry drops out; the returned array always satisfies the
 * shape invariants.
 */
export function decodeWeave(payload) {
  if (!Array.isArray(payload)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of payload) {
    const normalized = normalizeEntry(raw);
    if (!normalized) continue;
    const key = reelKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}
