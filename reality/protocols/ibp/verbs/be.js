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
// `payload.act` is one of "birth" | "connect" | "release" | "switch"
// | "death" (the operation in flight; the seal records it as fact.act).
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
// every story has exactly one. Subsequent BEs from authed sockets
// could in principle open on the authed being's own reel, but
// routing them all through cherub keeps the identity-binding code
// path uniform (one handler, one place to gate birth_enabled /
// connect_enabled, one place to verify credentials).

import log from "../../../seed/seedStory/log.js";
import Being from "../../../seed/materials/being/being.js";
import { IbpError, IBP_ERR, isIbpError } from "../../../seed/ibp/protocol.js";
import { assertNoImpersonation } from "./_shared.js";
import { ackOk, ackError } from "../envelope.js";
import { dispatchTransportAct } from "../../../seed/present/intake/transportAct.js";
import { emitToBeingRoom, emitToBeing } from "../../../seed/ibp/pushChannel.js";
import { IBP_EVENT, buildTransportActReply } from "../events.js";

// WS-side throttle for the unauthenticated entry ops, mirroring the
// HTTP auth limiter (transports/http/auth.js): connect 10 attempts
// per 15 minutes, birth 5 per hour, keyed per IP. Without this the
// HTTP limits were a fiction — the same bcrypt brute force and
// registration flooding ran unthrottled over the socket, and every
// birth writes permanent facts into the append-only chain. Fixed
// window per (op, ip); entries expire lazily on the next check.
const BE_RATE = {
  connect: { max: 10, windowMs: 15 * 60 * 1000 },
  birth:   { max: 5,  windowMs: 60 * 60 * 1000 },
};
const _beRateBuckets = new Map(); // "op:ip" -> { count, resetAt }
function checkBeRate(op, ip) {
  const rule = BE_RATE[op];
  if (!rule) return true;
  const key = `${op}:${ip}`;
  const now = Date.now();
  let b = _beRateBuckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + rule.windowMs };
    _beRateBuckets.set(key, b);
    // Lazy sweep so the map doesn't grow unboundedly across IPs.
    if (_beRateBuckets.size > 10000) {
      for (const [k, v] of _beRateBuckets) {
        if (now >= v.resetAt) _beRateBuckets.delete(k);
      }
    }
  }
  b.count += 1;
  return b.count <= rule.max;
}

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
    const operation = payload?.act;
    if (!operation) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "BE payload must include `act`");
    }

    if (operation === "connect" || operation === "birth") {
      const ip = socket?.handshake?.address
        || socket?.request?.socket?.remoteAddress || "unknown";
      if (!checkBeRate(operation, ip)) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          `Too many ${operation} attempts from this address; retry later`,
        );
      }
    }

    // `nameId` is STRIPPED here: ownership of a being is proved by the
    // server-side socket.nameId (the HMAC-verified portal identity), NEVER by
    // a client-supplied field. Dropping it from opPayload means a forged
    // { act:"connect", nameId:"<victimTrueName>" } cannot reach the handler as
    // payload; the only nameId the handler ever sees is callerNameId below.
    const { act: _act, op: _op, operation: _operation, identity: _identityField, nameId: _nameIdField, correlation: clientCorrelation, ...opPayload } = payload || {};

    const callerIdentity = socket.beingId ? { beingId: socket.beingId, name: socket.name } : null;
    // The connection's signed-in Name (server ground truth from the verified
    // JWT / name:login). Threaded as a first-class act-arg so the connect
    // handler can let a name drive a being it OWNS without a password.
    const callerNameId = socket.nameId || null;

    const cherubBeingId = await getCherubBeingId();

    // The act runs on cherub's reel. beVerb signature accepts the
    // payload + the address-bearing ctx; we pack everything into
    // the act's args so runTransportAct can hand them back to
    // beVerb identically.
    // Branch the moment runs in = the socket's first-person branch.
    // BE on an arrival socket (no prior SEE) defaults to main, which
    // is what unauthenticated visitors expect. Cross-branch gate: if
    // the target address explicitly carries a different branch
    // qualifier, refuse before opening the moment.
    const callerBranch = socket.currentBranch || "0";
    let _targetBranchResolved = null;
    try {
      const { parseFromSocket, expand, resolveBeingIds, resolveBranchPointers, getStoryDomain } =
        await import("../../../seed/ibp/address.js");
      const parsed = parseFromSocket(socket, address);
      const expandCtx = {
        currentStory: getStoryDomain(),
        currentUser:    socket.name,
        currentBranch:  callerBranch,
        currentPath:    socket.currentPath || null,
      };
      const expandedWithPointers = await resolveBranchPointers(
        expand(parsed, expandCtx), expandCtx);
      const expanded = await resolveBeingIds(expandedWithPointers, expandCtx);

      // Impersonation refusal — see _shared.js for the doctrine. BE
      // arrival flows (birth, connect from no identity) legitimately
      // have socket.beingId === null; the helper's both-sides-set
      // guard lets those pass through.
      assertNoImpersonation(expanded, socket);

      _targetBranchResolved = expanded?.right?.branch || "0";
      // Cross-branch dispatch: the caller's BE acts on the target's
      // branch with a crossOrigin block pointing at the caller's
      // branch. emitFact attaches the provenance automatically. See
      // CROSS-WORLD.md.
    } catch (err) {
      // Re-throw structured IBP errors; swallow parse failures so the
      // downstream beVerb owns address validation.
      if (err && err.code === IBP_ERR.FORBIDDEN) throw err;
    }
    // Fact lands on the target's branch (parsed from the address by
    // beVerb); the actor's Act lives on callerBranch. Same-world calls
    // have caller==target and produce no crossOrigin.
    //
    // BE:switch rides the DESTINATION branch: its audit fact lands on
    // the new branch (the switch-in is part of that branch's
    // biography), so the moment opens there too. That points the
    // pause/delete gate below at the destination — switching INTO a
    // frozen world refuses, switching AWAY from one never writes to
    // it (a session seated on a paused branch stays escapable). The
    // pre-switch branch rides the payload for the audit fact, because
    // inside the moment actorAct.branch is the destination, not the
    // old branch.
    const switchDest =
      operation === "switch" &&
      typeof opPayload?.branch === "string" &&
      opPayload.branch.trim()
        ? opPayload.branch.trim()
        : null;
    if (switchDest) opPayload.fromBranch = callerBranch;
    const branch = switchDest || callerBranch;
    const targetBranch = switchDest || _targetBranchResolved || callerBranch;

    // Pause / delete gate. BE is a write surface (birth/connect/
    // release); paused or deleted branches refuse every BE op so a
    // frozen or hidden world stays structurally that way. SEE remains
    // open at its own layer so historians can still walk the chain.
    {
      const { isBranchPaused, isBranchDeleted, isMain, loadBranch } =
        await import("../../../seed/materials/branch/branches.js");
      // Switch destination must exist before the moment opens — the
      // moment itself rides the destination, so a bogus path would
      // otherwise surface as an internal intake error instead of a
      // clean refusal. (Deleted/paused destinations fall through to
      // the shared gate below, which now checks the destination
      // because `branch` IS the destination for switch.)
      if (switchDest && !isMain(switchDest) && !(await loadBranch(switchDest))) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `be:switch: branch "${switchDest}" not found`,
          { branch: switchDest },
        );
      }
      if (await isBranchPaused(branch)) {
        throw new IbpError(IBP_ERR.STORY_PAUSED,
          `BE refused: branch #${branch} is paused.`,
          { branch });
      }
      if (await isBranchDeleted(branch)) {
        throw new IbpError(IBP_ERR.STORY_PAUSED,
          `BE refused: branch #${branch} is deleted.`,
          { branch, deleted: true });
      }
    }

    const { correlation: momentCorrelation, awaitResult } = await dispatchTransportAct({
      beingId:     cherubBeingId,
      correlation: clientCorrelation,
      act: {
        verb: "be",
        act:  operation,             // the operation in flight (birth/connect/...); the seal records it as fact.act
        args: {
          opPayload,
          address,
          addressKind,
          callerIdentity,
          callerNameId,
        },
      },
      identity: callerIdentity || { beingId: cherubBeingId, name: "cherub" },
      branch,
      targetBranch,
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
        // Branch seating. BE results are the only writers of
        // socket.currentBranch: a handler that changes which branch
        // this session rides returns `seatBranch`, and the transport
        // — the only layer that owns the socket — applies it here,
        // after the moment sealed. Stamp-then-seat: a refused moment
        // rejects into the catch below and the session's branch stays
        // where it was. The moment path cannot carry the socket
        // itself (acts are records), which is why the handlers return
        // the branch instead of seating it.
        if (typeof result?.seatBranch === "string" && result.seatBranch.length > 0) {
          socket.currentBranch = result.seatBranch;
          // Mirror the branch to the client so its address display
          // stays truthful (the handshake emitted the initial branch;
          // this keeps it current across switches).
          try { socket.emit("branch", { branch: result.seatBranch }); } catch { /* fake sockets */ }
          // Host observation: keep this connection's matter truthful
          // about which world the session rides.
          import("../../../seed/materials/host/host.js")
            .then((m) => m.noteSocketBranchRebound({ socketId: socket.id, branch: result.seatBranch }))
            .catch(() => {});
        }
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
