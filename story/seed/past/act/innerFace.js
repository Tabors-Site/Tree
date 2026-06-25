// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// attachInnerFace . store the target world's descriptor snapshot
// on the actor's Act as a hashable observation artifact.
//
// Per CROSS-WORLD.md "The Inner Face" + philosophy/names/innerFace.md:
//
//   The descriptor returned from the receiving substrate (the cansee
//   / cando / cansummon / canbe shape at that position in that
//   moment) is captured by the receiving substrate's normal
//   descriptor pipeline. The cross-world transport ships it back to
//   the actor over the wire. The actor attaches it to their Act,
//   normalized into the canonical inner face shape so it supersedes
//   the local face under the SAME field that every other consumer
//   reads:
//
//     Act.innerFace = {
//       orientation, able, position, capabilities, blocks,
//       origin: "foreign",
//       hash,
//     }
//
//   Hashable for tamper-detection: if the foreign story later
//   returns a different descriptor for the same position at the same
//   time, the hash proves the change.
//
//   The hash is the canonical identifier from day one, even when
//   storage is inline. Future migration to content-addressed blob
//   storage references the same hash, so consumers don't break.

import crypto from "crypto";
import { patchActStatus } from "./actChain.js";
import { normalizeForeignDescriptor } from "../../present/stamper/2-fold/innerFace.js";

/**
 * Attach the target world's descriptor as an inner-face observation
 * on the actor's Act. Computes the hash; stores both inline.
 *
 * Inner-face attachment is a permitted exception to act-row
 * immutability for the same reason status is: it's a derived
 * correlation between the act and the target world's reply, not a
 * rewrite of what happened. The Act remains sealed; the inner face
 * is the observation the act produced.
 *
 * @param {string} actId
 * @param {object} descriptor   the target world's descriptor object
 *                              (cansee/cando/cansummon/canbe shape)
 * @returns {Promise<{hash: string, attached: boolean}>}
 */
export async function attachInnerFace(actId, descriptor) {
  if (typeof actId !== "string" || !actId.length) {
    throw new Error("attachInnerFace: actId is required");
  }
  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("attachInnerFace: descriptor must be a non-null object");
  }
  const hash = hashDescriptor(descriptor);
  const normalized = normalizeForeignDescriptor(descriptor);
  // innerFace is a post-seal-mutable closure field (the act's hash is
  // over its OPENING, so this never changes its identity). patchActStatus
  // writes the overlay merged on every act-log read; it returns false
  // when the act doesn't exist (attached:false).
  const attached = patchActStatus(String(actId), { innerFace: { ...normalized, hash } });
  return { hash, attached };
}

/**
 * Compute the canonical hash of a descriptor object. Stable across
 * serialization variation: keys are sorted, strings are normalized.
 * The hash is the inner face's canonical identifier — when storage
 * migrates from inline to content-addressed blob, this hash is the
 * lookup key.
 *
 * @param {object} descriptor
 * @returns {string} sha256 hex
 */
export function hashDescriptor(descriptor) {
  const canon = canonicalize(descriptor);
  return crypto.createHash("sha256").update(canon).digest("hex");
}

// Stable JSON serialization: arrays preserve order; object keys sort
// alphabetically; primitives stringify normally. This is what makes
// the hash byte-identical across serialization-implementation
// differences.
function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}
