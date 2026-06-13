// Pointer claims and listing hashes for the horizon catalog.
//
// Everything the catalog stores is named by content: a listing IS the
// hash of its canonical manifest, and the mutable "current version"
// layer is a CHAIN of pointer claims, each referencing the hash of the
// claim before it. Two claims with one parent are a visible fork,
// provable the same way a forked act-chain is (HORIZON.md: a publisher
// can lie only about pointers, and provably).

import crypto from "node:crypto";

/**
 * Canonical JSON: keys sorted at every depth, no whitespace. Stable
 * across processes so the same object always hashes the same.
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function sha256Hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** The listing's identity: hash of its canonical manifest. */
export function listingHashOf(manifest) {
  return sha256Hex(canonicalJson(manifest));
}

/**
 * Build a pointer claim. `prev` is the claimHash of the previous claim
 * for this (publisher, name), null for the first. The claimHash is
 * computed over the claim body and never includes itself.
 *
 * state: "current" (this version is the one) or "retired" (the
 * publisher sunset the name; `successor` optionally points onward).
 */
export function buildClaim({
  publisher, name, version, listingHash,
  state = "current", successor = null, prev = null, seq = 0,
}) {
  const body = {
    kind: "horizon-pointer-claim",
    publisher, name, version, listingHash, state, successor, prev, seq,
  };
  return { ...body, claimHash: sha256Hex(canonicalJson(body)) };
}
