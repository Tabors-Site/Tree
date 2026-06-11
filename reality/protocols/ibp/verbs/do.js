// TreeOS IBP — DO verb (wire adapter).
//
// Consumes the unified envelope:
//
//   { id, verb: "do", address, payload: { action, args?, correlation? } }
//
// `address` is a position; a stance shape is accepted but its @being
// qualifier is informational (stripped). The world is data at positions;
// beings are not data targets.
//
// Identity is NOT in the envelope. The address IS the actor (per Diff
// A doctrine): the wire constructs the left stance from the socket's
// authenticated being, resolveBeingIds attaches the canonical beingId,
// and the verb dispatcher reads it from there. If the caller types an
// explicit left stance with a different @being than the socket
// authenticated, the wire refuses (impersonation gate).
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
// Pre-auth flows (birth / connect from arrival) are BE, not DO,
// and ride the cherub-as-actor path in be.js.

import log from "../../../seed/seedReality/log.js";
import { parseFromSocket, expand, resolveBeingIds, resolveBranchPointers, getRealityDomain } from "../../../seed/ibp/address.js";
import { resolveStance } from "../../../seed/ibp/resolver.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { assertNoImpersonation } from "./_shared.js";
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
    const expandCtx = {
      currentReality: getRealityDomain(),
      currentUser:    socket.name,
      currentBranch:  socket.currentBranch || "0",
      currentPath:    socket.currentPath   || null,
    };
    // Resolve named pointers (#main, #prod, ...) to canonical paths
    // before resolveBeingIds runs (findByName needs the canonical
    // branch for the lineage walk).
    const expandedWithPointers = await resolveBranchPointers(
      expand(parsed, expandCtx), expandCtx);
    const expanded = await resolveBeingIds(expandedWithPointers, expandCtx);

    // Impersonation refusal — see _shared.js for the doctrine.
    assertNoImpersonation(expanded, socket);

    // Cross-branch dispatch. The caller is on socket.currentBranch
    // (their world); the target is on expanded.right.branch (the
    // target's world). When they differ, this is a cross-world call:
    // the Fact lands on the target's branch with a crossOrigin block
    // pointing at the caller's branch. emitFact's deriveCrossOrigin
    // attaches the provenance automatically. See CROSS-WORLD.md.
    const callerBranch = socket.currentBranch || "0";
    const targetBranch = expanded.right?.branch || "0";

    // Pause / delete gate. While the target branch is paused or
    // deleted, DO refuses every op EXCEPT the branch-lifecycle ops
    // (so the operator can revive a paused world, undelete a deleted
    // one, toggle from a stale UI without bouncing, or fork off a
    // paused branch). SEE stays open regardless so the user can still
    // rewind or inspect the frozen state.
    //
    // Lifecycle ops are included as their own targets (e.g. delete on
    // an already-deleted branch is idempotent) because the client UI
    // is often a few ticks stale and bouncing the call would leave
    // the operator wondering why their toggle silently failed.
    //
    // delete-branch gates differ slightly from pause-branch: deletion
    // is a stronger statement ("this branch is hidden"), so we don't
    // exempt create-branch off a deleted target. To fork off a
    // deleted branch, undelete it first.
    const PAUSE_LIFECYCLE_OPS = new Set([
      "unpause-branch", "pause-branch", "create-branch",
      "delete-branch", "undelete-branch",
    ]);
    const DELETE_LIFECYCLE_OPS = new Set([
      "delete-branch", "undelete-branch",
    ]);
    if (!PAUSE_LIFECYCLE_OPS.has(action)) {
      const { isBranchPaused } = await import("../../../seed/materials/branch/branches.js");
      if (await isBranchPaused(targetBranch)) {
        throw new IbpError(IBP_ERR.REALITY_PAUSED,
          `DO refused: branch #${targetBranch} is paused. ` +
          `Unpause via @branch-manager or fork a new branch off it.`,
          { branch: targetBranch });
      }
    }
    if (!DELETE_LIFECYCLE_OPS.has(action)) {
      const { isBranchDeleted } = await import("../../../seed/materials/branch/branches.js");
      if (await isBranchDeleted(targetBranch)) {
        throw new IbpError(IBP_ERR.REALITY_PAUSED,
          `DO refused: branch #${targetBranch} is deleted. ` +
          `Undelete via @branch-manager to restore writes.`,
          { branch: targetBranch, deleted: true });
      }
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

    // Matter targeting. Addresses name positions and beings — matter
    // has no address grammar of its own, so a matter-targeted DO
    // (set-matter, set-model, purge-content, end-matter, typed ext
    // ops) rides the containing space's address with the matter id on
    // the reserved `matterId` payload key. The auth space still
    // resolves from the matter's position downstream
    // (resolveAuthSpaceId), so the role-walk gates at the right place.
    if (typeof payload.matterId === "string" && payload.matterId.length > 0) {
      target = { kind: "matter", id: payload.matterId };
    }

    // Resolve operation args. Canonical: payload.args. Fallback: every
    // payload field except reserved keys.
    const args = payload.args !== undefined
      ? payload.args
      : (() => {
          const { action: _a, identity: _i, correlation: _c, matterId: _m, ...rest } = payload;
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
      // branch — actor's world; where the moment opens and the Act seals.
      // targetBranch — target's world; where the Fact lands. Differs from
      // branch on cross-world calls; emitFact attaches crossOrigin
      // automatically. See seed/CROSS-WORLD.md.
      branch: callerBranch,
      targetBranch,
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
