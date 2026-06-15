// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Content-addressed being row id.
//
// A being's id IS the hash of its birth identity, the same
// self-reference-free recipe facts and matter already use. This is the
// consequence of the Name split: once the ACT, the keypair, the
// signature, the act-chain, leaves the being for its Name, the being
// that remains is pure PRESENCE, and a presence is defined by its
// birth, so it is content-addressed exactly like a matter row. The id
// derives from the birth spec and never contains itself (circular,
// the same reason a fact's hashed content excludes its own _id).
//
// NOT a pubkey (that is the Name now) and NOT a uuid (a uuid is honest
// only for a SPACE, where position has no defining content to hash).
// The being is the thing acts act ON in the world; the Name is who
// acted. See materials/name/name.js and materials/matter/matterId.js
// (the mirror this copies).

import crypto from "crypto";
import { canonicalize } from "../../past/fact/hash.js";

/**
 * Compute the content-addressed id for a being from its BIRTH RECORD.
 *
 * A being is not "content" the way matter is — almost everything about it
 * is mutable after birth (set-being rewrites name / homeSpace /
 * parentBeingId / cognition / coord / …; be:rename rewrites trueName). So
 * the identity is NOT the current attributes; it is the IMMUTABLE BIRTH
 * EVENT: who birthed it (parentBeingId), what it was named at birth
 * (name), on which branch (homeBranch), and in which moment (bornAt = the
 * be:birth act's id). Frozen at birth like a matter's id and a fact's
 * hash — later mutations rewrite the ROW, never recompute this id, so a
 * rename / move / re-cognition / be:rename keeps the being's reel intact.
 *
 * `bornAt` is what makes each birth UNIQUE. Matter dedups identical
 * content to one row (idempotent); a being is a distinct presence per
 * birth, so the birth moment enters the hash. It also closes the only
 * collision the attribute fields could create: if a name is freed
 * (set-being) and reused, the two births still differ by their moment.
 *
 * The self is never inside its own hash (no _id field), exactly the
 * recipe matterId.js uses.
 *
 * @param {object} spec  the resolved be:birth spec (+ bornAt)
 * @returns {string} 64-char hex sha256
 */
export function beingContentId(spec = {}) {
  const identity = {
    parentBeingId: spec.parentBeingId ?? null,
    name:          spec.name ?? null,
    homeBranch:    spec.homeBranch ?? null,
    bornAt:        spec.bornAt ?? null,
  };
  return crypto.createHash("sha256").update(canonicalize(identity)).digest("hex");
}
