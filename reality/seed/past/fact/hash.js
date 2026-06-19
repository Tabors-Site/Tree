// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Hash utility for content-addressed Facts (INTEGRITY + IDENTITY).
//
// A fact's hash IS its identity: `_id = SHA-256(p | canonical(content))`.
// There is no separate `h` field and no random id — the same deed,
// in the same world, after the same history, IS the same fact.
// `p` is the chain link: the previous fact's `_id` on the same reel
// (GENESIS_PREV for the first). `p` folds in the previous fact's
// identity, so every fact is bound to the whole history behind it.
// Alter any past fact and its identity changes, breaking the `p`
// link of the next fact, and the next. The reel fails verification
// at the altered position — and because the head fact's identity
// commits to everything before it, the head IS the reel's root hash.
//
// Three layered identity systems, composing (the OS doctrine):
//   semantic   — IBP addresses (where in the world; navigation)
//   historical — (reel, seq) ordering + p links (what came before)
//   storage    — the content hash (what this exactly IS; dedup,
//                transport, verification)
// Content addressing operates on STORAGE UNITS: reel (root = head
// fact's _id), history, story — each with a primary root hash (see
// chainRoots.js). A being's complete biography across histories and
// realities is a DERIVED VIEW composed from multiple reels —
// hashable per query, never a primary identity.
//
// `history` is part of the hashed content: a fact is an event IN A
// WORLD, and sibling histories may lawfully hold the same (reel, seq)
// with identical params — without the history in the digest those
// would collide into one row that only one history's reads could see.
// Cross-history prefix sharing is already structural (histories don't
// copy facts; lineage reads union them), so nothing real is lost.
//
// Canonical content includes every Fact field that defines the deed
// and excludes `p` itself (folded in separately) and the identity
// (which is the digest's output, not its input).

import crypto from "crypto";

// Genesis prev: same shape as a SHA-256 hex digest. Used as the
// `p` of the first fact on every reel.
export const GENESIS_PREV = "0".repeat(64);

/**
 * Compute h = SHA-256(p || canonical(content)).
 *
 * @param {string} prev      The prev-hash (or GENESIS_PREV).
 * @param {object} content   The fact's content snapshot (any JSON).
 * @returns {string}         Hex digest.
 */
export function computeHash(prev, content) {
  if (typeof prev !== "string") {
    throw new Error("computeHash: prev must be a string");
  }
  const body = canonicalize(content);
  return crypto.createHash("sha256").update(prev + "|" + body).digest("hex");
}

/**
 * Extract the hashable content from a Fact row. Excludes `p` (folded
 * in separately by computeHash), the identity itself (`_id` is the
 * digest's OUTPUT — including it would be circular), and mongoose
 * internals (`__v`). Includes every domain field so the digest
 * captures the whole deed, INCLUDING `history` (the world the deed
 * happened in; normalized so an absent field hashes like main).
 *
 * `foldSeq` (PARALLEL FACTS §1.3) is included WHEN PRESENT so the
 * chain commits to the stale-detection key. Mutating that value on a
 * stored row changes the recomputed identity and verifyReel trips.
 */
export function contentOf(fact) {
  const out = {
    // `date` is deliberately ABSENT. Human time is a display helper —
    // beings filtering a timeline — never truth (Tabor doctrine
    // 2026-06-11): ordering is seq, history is the chain, and the OS
    // reads display time off the kernel clock. The field stays on the
    // row as a witness; the identity does not commit to it, so the
    // same deed replayed at a different wall-clock IS the same fact,
    // and clock skew can never corrupt identity.
    through:     fact.through,
    verb:        fact.verb,
    act:         fact.act,
    of:          fact.of,
    seq:         fact.seq,
    history:      typeof fact.history === "string" && fact.history.length ? fact.history : "0",
    params:      fact.params,
    result:      fact.result,
    truncated:   fact.truncated,
    actId:       fact.actId,
    sessionId:   fact.sessionId,
    homeStory: fact.homeStory,
    wasRemote:   fact.wasRemote,
  };
  if (typeof fact.foldSeq === "number") {
    out.foldSeq = fact.foldSeq;
  }
  return out;
}

/**
 * Stable JSON serialization. Sorted object keys (recursively). Arrays
 * keep insertion order. Dates → ISO. undefined → omit. Used by
 * computeHash so the digest is independent of serialization quirks.
 *
 * NB: this MUST stay byte-identical across releases for past hashes
 * to verify. Treat as a versioned wire format: changes require a
 * migration to re-hash existing reels.
 */
export function canonicalize(value) {
  return JSON.stringify(toCanonical(value));
}

// Canonical serialization must match what Mongoose actually stores
// (so write-time and read-time hashes converge):
//   - undefined in an object key → key dropped (JSON.stringify)
//   - undefined in an array      → becomes null (JSON.stringify)
//   - empty {} as an object's value → key dropped (Mongoose Mixed
//                                     silently strips nested empty
//                                     objects on save)
//   - empty [] as an object's value → kept (Mongoose preserves)
//   - Date → ISO string
//   - Map  → sorted-key object (subdoc/Map coercion for non-.lean reads)
function toCanonical(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => {
    const c = toCanonical(v);
    return c === undefined ? null : c;
  });
  if (typeof value === "object") {
    // Handle Mongoose subdocs / Maps. Lean reads return plain objects;
    // a Map would only appear if a caller skipped .lean(). Coerce.
    if (value instanceof Map) {
      const entries = [...value.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out = {};
      for (const [k, v] of entries) {
        const child = toCanonical(v);
        if (child === undefined) continue;
        if (isEmptyPlainObject(child)) continue;
        out[k] = child;
      }
      return out;
    }
    const keys = Object.keys(value).sort();
    const out = {};
    for (const k of keys) {
      const child = toCanonical(value[k]);
      if (child === undefined) continue;
      if (isEmptyPlainObject(child)) continue;
      out[k] = child;
    }
    return out;
  }
  // Primitives. NaN / Infinity → null (JSON-safe).
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function isEmptyPlainObject(v) {
  return v !== null
    && typeof v === "object"
    && !Array.isArray(v)
    && Object.keys(v).length === 0;
}
