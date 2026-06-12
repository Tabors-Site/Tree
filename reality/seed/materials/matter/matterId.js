// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Content-addressed matter row id.
//
// A matter's id IS the hash of its birth identity, the same
// self-reference-free recipe facts already use: the id derives from the
// spec, it never contains itself (that would be circular, exactly why a
// fact's hashed content excludes its own _id). Deterministic and
// verifiable, replacing the random uuid: the same matter born the same
// way gets the same id, and nothing random enters the identity layer.
//
// The bytes a matter carries are already content-addressed in the
// content store (a cas ref's hash). This is the ROW id, the wrapper's
// own identity: where it lives, what it is, what it carries, who made it.

import crypto from "crypto";
import { canonicalize } from "../../past/fact/hash.js";

/**
 * Compute the content-addressed id for a matter from its birth spec.
 * Only the identity-defining fields enter the hash; later mutations
 * (qualities writes, moves) never change the id, which is fixed at
 * birth the way a fact's hash is fixed at seal.
 *
 * @param {object} spec  the resolved create spec (spaceId, name, type,
 *                       content ref, coord, parentMatterId, beingId, qualities)
 * @returns {string} 64-char hex sha256
 */
export function matterContentId(spec = {}) {
  const identity = {
    spaceId:        spec.spaceId ?? null,
    parentMatterId: spec.parentMatterId ?? null,
    name:           spec.name ?? null,
    type:           spec.type ?? "generic",
    content:        spec.content ?? null,
    coord:          spec.coord ?? null,
    beingId:        spec.beingId ?? null,
    qualities:      spec.qualities ?? {},
  };
  return crypto.createHash("sha256").update(canonicalize(identity)).digest("hex");
}
