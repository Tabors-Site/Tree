// TreeOS IBP — BE verb (wire adapter).
//
// Consumes the unified envelope:
//
//   { id, verb: "be", address (stance or place), payload, identity? }
//
// `payload.op` is one of "register" | "claim" | "release" | "switch".
// Remaining payload fields carry operation-specific credentials/state.
// `payload.correlation` is the client-generated idempotency key —
// retries with the same correlation collapse to one moment.
//
// ── Cherub as actor ──────────────────────────────────────────────
// Every BE rides cherub's reel. A being is always born from an
// existing being's act, and cherub is the gatekeeper: register
// summons a being forth, claim authenticates them, release/switch
// move identity between holders. That's not three different actors,
// it's one — the cherub doing the gatekeeping.
//
// Concretely: the wire adapter doesn't call `beVerb` directly. It
// enqueues a transport-act on the cherub's intake; the stamper
// opens a Act framing cherub's moment, momentum runs `beVerb`
// inside that frame so the auto-Fact rides cherub's actId. The
// result pushes back to the originating socket via the SUMMON push
// envelope (matched on correlation).
//
// This subsumes the "register from arrival" bootstrap question. A
// fresh socket with no identity is asking cherub to perform a BE
// on its behalf — cherub is the actor, the new being is the
// target. After register / claim succeeds, subsequent BEs from
// the now-authed socket still route through cherub (cherub is the
// only legitimate processor of identity ops).

import log from "../../../seed/parentReality/log.js";
import Being from "../../../seed/materials/being/being.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError } from "../envelope.js";
import { dispatchTransportAct } from "../../../seed/present/intake/transportAct.js";
import { emitToBeingRoom, emitToBeing } from "../../../seed/ibp/pushChannel.js";
import { IBP_EVENT, buildTransportActReply } from "../events.js";

// Cherub's beingId. Looked up lazily on first BE; cached for the
// rest of the process lifetime. Cherub is a scripted place-being
// planted by seedDelegates.js at boot.
let _cherubBeingIdCache = null;
async function getCherubBeingId() {
  if (_cherubBeingIdCache) return _cherubBeingIdCache;
  const row = await Being.findOne({ name: "cherub", operatingMode: "scripted" })
    .select("_id homeSpace")
    .lean();
  if (!row?._id) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      "Cherub being not found — place is not properly bootstrapped",
    );
  }
  _cherubBeingIdCache = String(row._id);
  return _cherubBeingIdCache;
}

export async function handleBe(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;
    const operation = payload?.op || payload?.operation;
    if (!operation) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "BE payload must include `op`");
    }

    const { op: _op, operation: _operation, identity: _identityField, correlation: clientCorrelation, ...opPayload } = payload || {};

    const callerIdentity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;

    const cherubBeingId = await getCherubBeingId();

    // The act runs on cherub's reel. beVerb signature accepts the
    // payload + the address-bearing ctx; we pack everything into
    // the act's args so runTransportAct can hand them back to
    // beVerb identically.
    const { correlation: momentCorrelation, awaitResult } = await dispatchTransportAct({
      beingId:     cherubBeingId,
      correlation: clientCorrelation,
      act: {
        verb:   "be",
        target: operation,           // BE.beVerb's first arg is the operation name
        action: operation,           // descriptive; runTransportAct passes target as the verb op
        args:   {
          opPayload,
          address,
          addressKind,
          callerIdentity,
        },
      },
      identity: callerIdentity || { beingId: cherubBeingId, name: "cherub" },
    });

    // Push the result back. If the caller had an authed beingId we
    // push to their room; otherwise (register from arrival, where
    // no being is bound yet) we push to the originating socket
    // directly.
    const pushReply = (envelope) => {
      const recipientBeingId = socket?.beingId || null;
      if (recipientBeingId) {
        try { emitToBeingRoom(recipientBeingId, IBP_EVENT, envelope); return; } catch {}
      }
      try { if (socket?.connected) socket.emit(IBP_EVENT, envelope); } catch {}
    };

    awaitResult
      .then(({ result, actId }) => {
        pushReply(buildTransportActReply({
          correlation: momentCorrelation,
          actId,
          result,
        }));
      })
      .catch((err) => {
        pushReply(buildTransportActReply({
          correlation: momentCorrelation,
          result: { error: { message: err?.message || "BE failed", code: err?.code } },
        }));
      });

    return ackOk(ack, id, { correlation: momentCorrelation, status: "accepted" });
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `BE failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
