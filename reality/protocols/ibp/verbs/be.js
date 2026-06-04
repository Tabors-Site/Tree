// TreeOS IBP — BE verb (wire adapter).
//
// Consumes the unified envelope:
//
//   { id, verb: "be", address (stance or place), payload }
//
// Identity is NOT in the envelope. See do.js for the address-as-actor
// doctrine. BE has one special case: arrival flows (birth, connect
// from an unauthenticated socket) legitimately have socket.beingId
// === null. The impersonation gate only fires when BOTH sides are
// set, so arrival-cherub flows are unaffected.
//
// `payload.op` is one of "birth" | "connect" | "release".
// Remaining payload fields carry operation-specific credentials/state.
// `payload.correlation` is the client-generated idempotency key —
// retries with the same correlation collapse to one moment.
//
// ── The transport is the postman, not the originator ────────────
//
// The wire never acts. Only beings act. When a BE envelope arrives,
// the wire's job is to convert "a keystroke reached me" into "a being
// is acting" — and the only honest way to do that is to summon the
// being-being-bound-to on its own behalf with the BE op as the
// pre-decided act. The transport delivers; the being acts.
//
// The wire adapter does NOT call `beVerb` directly. It enqueues a
// transport-summon (kind:"transport-act") on cherub's intake; the
// scheduler picks it; assign opens cherub's moment; momentum runs
// `beVerb` from inside that moment so the auto-Fact rides the
// moment's actId. The result pushes back to the originating socket
// via the IBP push envelope (matched on correlation).
//
// Cherub is the HANDLER of identity-binding summons, not the
// originator. Cherub knows how to fulfill birth/connect/release —
// minting beings, verifying credentials, signing tokens. But the
// originator of every BE is the being-being-bound-to: for birth,
// the prospective new being (delivered through the socket before
// its row exists); for connect, the being asking to bind a session;
// for release, the already-authenticated being.
//
// This subsumes the "birth from arrival" bootstrap question. A
// fresh socket with no identity is the prospective-being's only
// available delivery channel before its row exists. Cherub processes
// the summon, mints the being, and signs the token. The being is the
// originator throughout; cherub is the handler.
//
// Why route through cherub at all (instead of opening the moment on
// the new being's reel directly): the pre-being case has no reel
// yet — there's no actor row, no inbox, no stamp surface. Cherub is
// the seed-shipped handler that owns the identity-binding protocol;
// every reality has exactly one. Subsequent BEs from authed sockets
// could in principle open on the authed being's own reel, but
// routing them all through cherub keeps the identity-binding code
// path uniform (one handler, one place to gate birth_enabled /
// connect_enabled, one place to verify credentials).

import log from "../../../seed/seedReality/log.js";
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
  const { findByName } = await import("../../../seed/materials/projections.js");
  const slot = await findByName("being", "cherub", "0");
  if (!slot?.id) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      "Cherub being not found — place is not properly bootstrapped",
    );
  }
  _cherubBeingIdCache = String(slot.id);
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
    // Branch the moment runs in = the socket's first-person frame.
    // BE on an arrival socket (no prior SEE) defaults to main, which
    // is what unauthenticated visitors expect. Cross-branch gate: if
    // the target address explicitly carries a different branch
    // qualifier, refuse before opening the moment.
    const callerBranch = socket.currentBranch || "0";
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

      // Impersonation refusal . see do.js for the doctrine. BE is the
      // narrow exception case: arrival flows (birth, connect from no
      // identity) legitimately have socket.beingId === null. The check
      // only fires when BOTH sides are set, so arrival-cherub flows are
      // unaffected.
      if (
        expanded.left?.beingId &&
        socket?.beingId &&
        expanded.left.beingId !== socket.beingId
      ) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          `Address actor (@${expanded.left.being}) does not match ` +
          `authenticated being. Caller cannot impersonate.`,
          { addressBeingId: expanded.left.beingId, socketBeingId: socket.beingId },
        );
      }

      const targetBranch = expanded?.right?.branch || "0";
      if (callerBranch !== targetBranch) {
        throw new IbpError(IBP_ERR.CROSS_BRANCH_FORBIDDEN,
          `BE across branches forbidden: caller is on #${callerBranch}, ` +
          `target is on #${targetBranch}. Navigate to the target's branch first.`,
          { callerBranch, targetBranch });
      }
    } catch (err) {
      // Re-throw structured IBP errors; swallow parse failures so the
      // downstream beVerb owns address validation.
      if (err && (err.code === IBP_ERR.CROSS_BRANCH_FORBIDDEN
                || err.code === IBP_ERR.FORBIDDEN)) throw err;
    }
    const branch = callerBranch;

    // Pause / delete gate. BE is a write surface (birth/connect/
    // release); paused or deleted branches refuse every BE op so a
    // frozen or hidden world stays structurally that way. SEE remains
    // open at its own layer so historians can still walk the chain.
    {
      const { isBranchPaused, isBranchDeleted } =
        await import("../../../seed/materials/branch/branches.js");
      if (await isBranchPaused(branch)) {
        throw new IbpError(IBP_ERR.REALITY_PAUSED,
          `BE refused: branch #${branch} is paused.`,
          { branch });
      }
      if (await isBranchDeleted(branch)) {
        throw new IbpError(IBP_ERR.REALITY_PAUSED,
          `BE refused: branch #${branch} is deleted.`,
          { branch, deleted: true });
      }
    }

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
      branch,
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
