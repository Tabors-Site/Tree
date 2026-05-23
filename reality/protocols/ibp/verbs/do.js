// TreeOS IBP — DO verb (wire adapter).
//
// Consumes the unified envelope:
//
//   { id, verb: "do", address, payload: { action, args?, correlation? }, identity? }
//
// `address` is a position; a stance shape is accepted but its @being
// qualifier is informational (stripped). The world is data at positions;
// beings are not data targets.
//
// `payload.action` names the registered DO operation. `payload.args`
// carries the operation's arguments (legacy: any non-reserved field).
// `payload.correlation` is the client-generated idempotency key — a
// retry with the same correlation collapses to one moment.
//
// ── Async by design ──────────────────────────────────────────────
// Every DO rides ambient actId, and assign is the sole legitimate
// Act opener. So the wire adapter does NOT call `doVerb` directly.
// It enqueues a transport-act on the actor's intake; the stamper
// picks it up, opens the frame, momentum runs the wrapped verb. The
// adapter acks with the correlation immediately and pushes the
// result through the `ibp` channel as a `moment` envelope when the
// moment seals.
//
// Two ack modes per transport's needs:
//   WS  → ack { correlation, status: "accepted" }; result pushes
//         to the being-room when sealed.
//   HTTP → await the moment (no push channel for HTTP), then
//          ack the result inline. Reserved for an HTTP shim that
//          chooses long-poll semantics. The seed helper supports
//          both — it returns both correlation and awaitResult.
//
// ── Auth ─────────────────────────────────────────────────────────
// Unauth DO is rejected. The model is "no act without a being." A
// DO with no actor has no reel, no stamp, no fact — a contradiction.
// Pre-auth flows (register / claim from arrival) are BE, not DO,
// and ride the cherub-as-actor path in be.js.

import log from "../../../seed/parentReality/log.js";
import { parseFromSocket, expand, getRealityDomain } from "../../../seed/ibp/address.js";
import { resolveStance } from "../../../seed/ibp/resolver.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError, stripBeingQualifier } from "../envelope.js";
import { getOperation, listOperations } from "../../../seed/ibp/operations.js";
import { dispatchTransportAct } from "../../../seed/present/intake/transportAct.js";
import { emitToBeingRoom } from "../../../seed/ibp/pushChannel.js";
import { IBP_EVENT, buildTransportActReply } from "../events.js";

export async function handleDo(socket, env, ack) {
  const id = env?.id || null;
  try {
    // ── Auth gate ─────────────────────────────────────────────
    // No acting being → no moment. Reject before anything else.
    const beingId = socket?.beingId || null;
    if (!beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "DO requires an authenticated being. BE.claim or BE.register first.",
      );
    }

    const { address, payload } = env;
    const action = typeof payload?.action === "string" ? payload.action : null;
    if (!action) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "ibp DO payload must include `action`");
    }
    if (!getOperation(action)) {
      throw new IbpError(
        IBP_ERR.ACTION_NOT_SUPPORTED,
        `Unknown DO action: "${action}"`,
        { action, available: listOperations().map(op => op.name) },
      );
    }

    // DO targets positions; strip any @being qualifier on stance addresses.
    const positionString = stripBeingQualifier(address);

    const parsed = parseFromSocket(socket, positionString);
    const expanded = expand(parsed, {
      currentPlace: getRealityDomain(),
      currentUser: socket.name,
    });
    const resolved = await resolveStance(expanded.right);

    // Resolve operation args. Canonical: payload.args. Fallback: every
    // payload field except reserved keys.
    const args = payload.args !== undefined
      ? payload.args
      : (() => {
          const { action: _a, identity: _i, correlation: _c, ...rest } = payload;
          return rest;
        })();

    const identity = { beingId, name: socket.name };
    const correlation = typeof payload?.correlation === "string" ? payload.correlation : null;

    // Enqueue the transport-act. Returns immediately with the
    // moment's correlation; the moment runs on the scheduler's
    // own time. The handoff attached inside dispatchTransportAct
    // fires when the moment seals; we hook it to push the result.
    const { correlation: momentCorrelation, awaitResult } = await dispatchTransportAct({
      beingId,
      act: {
        verb:   "do",
        target: resolved,
        action,
        args,
      },
      correlation,
      identity,
    });

    // Fire-and-forget: when the moment seals, push the result to
    // every socket the being holds. The originating socket gets it
    // through the room; other sockets the being has open also see
    // it. Failures push as well so clients can unblock awaiters.
    // Reuses the SUMMON push envelope — "summon" already names the
    // server reaching out to a being; transport-act results ride
    // the same channel, matched on correlation.
    awaitResult
      .then(({ result, actId }) => {
        const envelope = buildTransportActReply({
          correlation: momentCorrelation,
          actId,
          result,
        });
        try { emitToBeingRoom(beingId, IBP_EVENT, envelope); } catch {}
      })
      .catch((err) => {
        const envelope = buildTransportActReply({
          correlation: momentCorrelation,
          result:      { error: { message: err?.message || "transport-act failed" } },
        });
        try { emitToBeingRoom(beingId, IBP_EVENT, envelope); } catch {}
      });

    return ackOk(ack, id, { correlation: momentCorrelation, status: "accepted" });
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `DO failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }
}
