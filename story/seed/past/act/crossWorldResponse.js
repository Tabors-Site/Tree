// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Cross-world response handler. The actor's Act seals locally at
// status="attempted" when the cross-world call dispatches. When the
// foreign substrate replies — via canopy for cross-story, or
// directly for same-story cross-branch (which has no async wait
// today) — this function transitions the Act's status and attaches
// the foreign descriptor as inner face.
//
// Per CROSS-WORLD.md "Act lifecycle and status" + "The Inner Face":
//
//   Local-seal-with-status: the Act records WHAT the actor attempted
//   and CARRIES the foreign reply alongside. The status answers "did
//   it happen?" and the inner face answers "what did I see when it
//   did?"
//
// The two updates are independent — a denied call still has an inner
// face (the descriptor the foreign side returned when refusing), and
// a landed call without a descriptor (rare) still moves to landed
// without an inner face. Both update paths are idempotent: status
// transitions atomically only when current=attempted; inner face is
// a single overwrite that's safe to retry.

import { updateActStatus } from "./status.js";
import { attachInnerFace } from "./innerFace.js";

/**
 * Apply a cross-world response to the actor's local Act. Updates
 * status to the indicated terminal state and (optionally) attaches
 * the foreign descriptor as inner face. Both are independent; either
 * may be a no-op if the data is missing.
 *
 * @param {string} actId  the actor's local Act id (Act._id)
 * @param {object} response  the foreign substrate's reply
 * @param {("landed"|"denied"|"timeout"|"unreachable"|"malformed")} response.status
 * @param {object} [response.descriptor]  the foreign world's descriptor
 *                                         snapshot (cansee/cando/...
 *                                         shape) at the moment of the
 *                                         foreign reply
 * @param {object} [response.meta]  diagnostic block — denial reason,
 *                                   foreign actId, error body, etc.
 * @returns {Promise<{ status: string|null, innerFaceHash: string|null }>}
 */
export async function handleCrossWorldResponse(actId, response) {
  if (typeof actId !== "string" || !actId.length) {
    throw new Error("handleCrossWorldResponse: actId is required");
  }
  if (!response || typeof response !== "object") {
    throw new Error("handleCrossWorldResponse: response is required");
  }

  let statusResult = null;
  if (response.status) {
    try {
      const updated = await updateActStatus(actId, response.status, response.meta || null);
      statusResult = updated ? response.status : null;
    } catch (err) {
      // updateActStatus throws on bad inputs; bubble up so the caller
      // sees malformed-response failures rather than silently dropping
      // the update.
      throw err;
    }
  }

  let innerFaceHash = null;
  if (response.descriptor && typeof response.descriptor === "object") {
    const { hash, attached } = await attachInnerFace(actId, response.descriptor);
    innerFaceHash = attached ? hash : null;
  }

  return { status: statusResult, innerFaceHash };
}
