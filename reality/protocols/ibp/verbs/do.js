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

import log from "../../../seed/seedReality/log.js";
import { parseFromSocket, expand, getRealityDomain } from "../../../seed/ibp/address.js";
import { resolveStance } from "../../../seed/ibp/resolver.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { ackOk, ackError, stripBeingQualifier, extractBeingQualifier } from "../envelope.js";
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

    // DO targets positions OR a being homed at a position. When the
    // op is being-targeting, the @qualifier names the target and the
    // path resolves only the auth context. When the op is space- or
    // matter-targeting, the @qualifier is informational and gets
    // stripped before path resolution.
    const op = getOperation(action);
    const beingTargetedOnly = Array.isArray(op?.targets)
      && op.targets.length > 0
      && op.targets.every((t) => t === "being");
    const qualifier = extractBeingQualifier(address);
    const positionString = stripBeingQualifier(address);

    const parsed = parseFromSocket(socket, positionString);
    const expanded = expand(parsed, {
      currentReality: getRealityDomain(),
      currentUser:    socket.name,
      currentBranch:  socket.currentBranch || "0",
      currentPath:    socket.currentPath   || null,
    });

    // Cross-branch gate at the wire boundary. The caller's first-person
    // frame is the socket's tracked branch; the target's branch is the
    // expanded right stance. Mismatch is a cross-reality call (different
    // fold-chains), refused until cross-branch portals exist.
    const callerBranch = socket.currentBranch || "0";
    const targetBranch = expanded.right?.branch || "0";
    if (callerBranch !== targetBranch) {
      throw new IbpError(IBP_ERR.CROSS_BRANCH_FORBIDDEN,
        `DO across branches forbidden: caller is on #${callerBranch}, ` +
        `target is on #${targetBranch}. Navigate to the target's branch first.`,
        { callerBranch, targetBranch });
    }

    const resolved = await resolveStance(expanded.right, {
      identity: { beingId, name: socket.name },
    });

    // Hand the verb layer a typed identity, not a Mongoose row. The
    // IBP boundary speaks { kind, id }; raw rows are storage, and
    // storage doesn't cross this boundary. The seed verb dispatcher
    // and op handlers normalize from typed input — fetching rows
    // only when they need row contents (qualities, position, name
    // uniqueness checks), and only inside the handler that needs them.
    //
    // For being-targeting ops with an @qualifier, the typed target
    // names the being directly. The resolved space is the auth
    // context (via resolveAuthSpaceId at the seed gate) — separate
    // concern, separate carrier.
    //
    // For everything else, the resolved stance points at a space;
    // pass the typed space identity. (Stance-aware ops that need
    // the resolver's chain detect that via the result, not the
    // target.)
    let target;
    if (beingTargetedOnly && qualifier) {
      const { findByName } = await import("../../../seed/materials/projections.js");
      const beingSlot = await findByName("being", qualifier, callerBranch);
      if (!beingSlot) {
        throw new IbpError(
          IBP_ERR.BEING_NOT_FOUND,
          `No being named "${qualifier}" on this reality`,
          { qualifier },
        );
      }
      target = { kind: "being", id: String(beingSlot.id) };
    } else if (resolved?.spaceId) {
      target = { kind: "space", id: String(resolved.spaceId) };
    } else {
      // Stance with no spaceId is rare (a bare-place address with no
      // resolved leaf); pass the resolver object through so any
      // stance-aware op can read the chain. The audit-target resolver
      // recognizes this shape and derives kind="space" via spaceId
      // when present.
      target = resolved;
    }

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
        target,
        action,
        args,
      },
      correlation,
      identity,
      // Branch the moment lives in. Sourced from the socket's
      // first-person stance (the caller's frame). The cross-branch
      // gate above already enforced that this equals the target's
      // branch, so they're guaranteed consistent here.
      branch: callerBranch,
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
