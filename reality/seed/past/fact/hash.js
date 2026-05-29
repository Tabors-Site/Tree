// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Hash utility for per-reel Fact chains (INTEGRITY).
//
// Each reel-bearing Fact carries two hash fields:
//   p — prev-hash. The previous fact's `h` on the same reel.
//   h — self-hash. SHA-256 of (p || canonical(content)).
//
// `p` folds in the previous fact's hash, so every fact is bound to
// the whole history behind it. Alter any past fact and its `h`
// changes, breaking the `p` link of the next fact, and the next.
// The reel fails verification at the altered position.
//
// Per-reel, not global. There is no global chain. Genesis prev is
// a fixed sentinel — used for the first fact on every reel.
//
// Canonical content includes every Fact field that defines the deed
// and excludes `p`/`h` themselves (folded in separately). Reels
// composed of `_id`, `seq`, target, params, result, actor, verb,
// action, etc. — every datum a future reader would need to recover
// the fact.

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
 * Extract the hashable content from a Fact row. Excludes `p`, `h`,
 * and mongoose internals (`__v`). Includes every domain field so the
 * digest captures the whole deed.
 *
 * `foldSeq` (PARALLEL FACTS §1.3) is included WHEN PRESENT so the
 * chain commits to the stale-detection key. Pre-PARALLEL-FACTS rows
 * have foldSeq null and the key is omitted (matching the digest they
 * originally landed with). New facts with a numeric foldSeq include
 * the key; mutating that value on a stored row breaks `h` and
 * verifyReel trips.
 */
export function contentOf(fact) {
  const out = {
    _id:         fact._id,
    date:        fact.date,
    beingId:     fact.beingId,
    verb:        fact.verb,
    action:      fact.action,
    target:      fact.target,
    seq:         fact.seq,
    params:      fact.params,
    result:      fact.result,
    truncated:   fact.truncated,
    actId:       fact.actId,
    sessionId:   fact.sessionId,
    homeReality: fact.homeReality,
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
