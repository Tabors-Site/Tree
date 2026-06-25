// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Cross-world response handler. The actor's Act seals locally at
// status="attempted" when the cross-world call dispatches. When the
// foreign substrate replies — via canopy for cross-story, or
// directly for same-story cross-history (which has no async wait
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

/**
 * Carry a cross-world reply's reported outcome back to the caller. Records NOTHING on the act: an act
 * is PRESENT and a fact is PAST, so "done" is whether a FACT was stamped for the act (not a status
 * column), and the inner face was loaded + rasterized BEFORE the act and saved through its opening
 * (beat 2 → plannedAct.innerFace) — you can't act blind — so the foreign descriptor is already on the
 * act, with nothing to patch post-seal. Recording the reply itself as a local FACT (the past-tense
 * proof the cross-story act completed, foldable via getFactsByActId) is the flagged TODO.
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

  // Nothing is written onto the act (see the doc above): the reported outcome rides back as-is, and the
  // foreign descriptor was already on the act's opening (loaded before acting). innerFaceHash stays null
  // — there is no post-seal attach. TODO: record the reply as a local FACT so "done" folds from it.
  return { status: response.status || null, innerFaceHash: null };
}
