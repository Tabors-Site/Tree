// TreeOS IBP — SUMMON verb (wire adapter).
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "summon", address (stance), payload: { message, ...threading } }
//
// Identity is NOT in the envelope. See do.js for the address-as-actor
// doctrine.
//
// `payload.message` is the inbox payload: `{ from, content,
// correlation?, inReplyTo?, attachments?, sentAt?, activeRole? }`.
// `activeRole` may live on `message` OR at the top level of payload.
// The wire normalizes it onto message before delegating.
//
// Thin wire adapter: extracts envelope fields, composes the async-reply
// broadcaster, delegates to `summonVerb` in seed/ibp/verbs/summon.js. The
// scheduler invokes the broadcaster when async summoning completes;
// the reply places on every socket the asker has connected (via the
// being-room). See [[project_four_verbs_one_execution]] and
// [[project_protocol_transport_separation]].

import log from "../../../seed/seedReality/log.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { assertNoImpersonation } from "./_shared.js";
import { ackOk, ackError } from "../envelope.js";
import { summonVerb } from "../../../seed/ibp/verbs/summon.js";
import { emitToBeingRoom } from "../../../seed/ibp/pushChannel.js";
import { IBP_EVENT } from "../events.js";

/**
 * Broadcast an out-of-band SUMMON push (async reply or unsolicited
 * inbox arrival) to every socket the recipient being has connected.
 * Falls back to the originating socket when beingId isn't tracked.
 *
 * The push rides the unified `ibp` event:
 *
 *   { verb: "summon", payload: <inbox entry> }
 *
 * Direction (server → client) is implicit. The client routes by
 * envelope.verb and uses `payload.inReplyTo` / `payload.correlation`
 * to match against whatever it's awaiting.
 */
function emitUpdateForSocket(socket) {
  return (entry) => {
    const envelope = { verb: "summon", payload: entry };
    const beingId = socket?.beingId;
    if (beingId) {
      try {
        emitToBeingRoom(beingId, IBP_EVENT, envelope);
        return;
      } catch {}
    }
    try {
      if (socket?.connected) socket.emit(IBP_EVENT, envelope);
    } catch {}
  };
}

export async function handleSummon(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, payload } = env;
    if (!payload?.message || typeof payload.message !== "object") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "SUMMON payload must include a `message` object");
    }

    // Normalize threading: activeRole may live at payload.activeRole or
    // inside message.activeRole. summonVerb reads from message.
    const message = {
      ...payload.message,
      activeRole: payload.message.activeRole || payload.activeRole || null,
    };

    const identity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    // Cross-branch gate at the wire boundary. The caller's first-person
    // frame is the socket's tracked branch; the target stance's branch
    // is what the address carries. Mismatch is forbidden until
    const callerBranch = socket.currentBranch || "0";
    let _targetBranchResolved = null;
    try {
      const { parseFromSocket, expand, resolveBeingIds, resolveBranchPointers, getRealityDomain } =
        await import("../../../seed/ibp/address.js");
      const parsed = parseFromSocket(socket, address);
      const expandCtx = {
        currentReality: getRealityDomain(),
        currentUser:    socket.name,
        currentBranch:  callerBranch,
        currentPath:    socket.currentPath || null,
      };
      const expandedWithPointers = await resolveBranchPointers(
        expand(parsed, expandCtx), expandCtx);
      const expanded = await resolveBeingIds(expandedWithPointers, expandCtx);

      // Impersonation refusal — see _shared.js for the doctrine.
      assertNoImpersonation(expanded, socket);

      // Cross-branch dispatch: the summon record lands on the target
      // being's inbox-reel on the TARGET'S branch; crossOrigin marks
      // the caller's branch. emitFact attaches it. CROSS-WORLD.md.
      _targetBranchResolved = expanded?.right?.branch || "0";
    } catch (err) {
      if (err && err.code === IBP_ERR.FORBIDDEN) throw err;
      // Parse failures fall through; summonVerb owns address validation.
    }
    const targetBranch = _targetBranchResolved || callerBranch;

    // Pause / delete gate. SUMMON ALWAYS produces a summon Fact
    // (writes the recipient's inbox); paused or deleted branches
    // refuse so the frozen / hidden world accumulates no new work.
    {
      const { isBranchPaused, isBranchDeleted } =
        await import("../../../seed/materials/branch/branches.js");
      if (await isBranchPaused(callerBranch)) {
        throw new IbpError(IBP_ERR.REALITY_PAUSED,
          `SUMMON refused: branch #${callerBranch} is paused.`,
          { branch: callerBranch });
      }
      if (await isBranchDeleted(callerBranch)) {
        throw new IbpError(IBP_ERR.REALITY_PAUSED,
          `SUMMON refused: branch #${callerBranch} is deleted.`,
          { branch: callerBranch, deleted: true });
      }
    }

    const result = await summonVerb(address, message, {
      identity,
      currentUser:   socket.name,
      // currentBranch is the FACT's branch (where the summon record
      // lands on the recipient's inbox-reel) — that's the target's
      // branch. emitFact attaches crossOrigin when actor.branch
      // (callerBranch) differs. See seed/CROSS-WORLD.md.
      currentBranch: targetBranch,
      currentPath:   socket.currentPath || null,
      onResponse:    emitUpdateForSocket(socket),
    });

    return ackOk(ack, id, result);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `SUMMON failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
