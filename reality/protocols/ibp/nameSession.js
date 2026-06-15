// TreeOS IBP — the pre-world NAME session channel.
//
// The Name layer is OUTSIDE the world and PRE all panels. You need a
// name before you can do anything; minting the first name therefore
// can't itself require one. So a fresh connection — no token, no being,
// landed at the bare realityDomain — speaks THIS channel (socket event
// "name"), not the world-verb "ibp" channel and not cherub. (The four
// world verbs ride "ibp" through the act pipeline; BE routes through
// cherub. The Name layer answers to neither: it is the gate in front of
// the world, so a being can act at all.)
//
// The NAME ops mirror BE (declare = the name's "birth", connect/release bind/
// unbind the session, banish = its death). This channel carries the pre-world
// surface — the Name Form's whole reach:
//   declare  mint a name (the unauthed bootstrap; the fact's actor is
//            I_AM, every name being a facet of the reality's I_AM). FACT.
//   connect  real-name + password -> decrypt the key into the signing
//            session + bind socket.nameId (the identity-layer be:connect).
//            SESSION, not a fact. It is the portal's convenience for using a
//            name without presenting the private key each act; a holder can
//            always act with the raw key over the API instead.
//   release  wipe the held key + clear socket.nameId (the identity-layer
//            be:release — "the name calling its own release"). SESSION.
//   whoami   report the connection's bound nameId (or null).
//
// declare is the only fact-producing op here, and it opens an I_AM
// moment directly (withIAmAct — the genesis/bootstrap mechanism)
// because a pre-world connection has no being to route a transport-act
// through. login/logout/whoami are pure session control on the socket.

import log from "../../seed/seedReality/log.js";
import { ackOk, ackError } from "./envelope.js";
import { IBP_ERR } from "../../seed/ibp/protocol.js";

// Per-IP throttle, mirroring the BE wire's unauthenticated-entry limiter
// (protocols/ibp/verbs/be.js). `declare` writes a permanent fact + a new
// keypair into the append-only chain, so it is rate-limited like `birth`;
// `connect` is a password surface, so it is rate-limited like be:connect to
// blunt brute force. Fixed window per (op, ip); entries expire lazily.
const NAME_RATE = {
  declare: { max: 5,  windowMs: 60 * 60 * 1000 },
  connect: { max: 10, windowMs: 15 * 60 * 1000 },
};
const _nameRateBuckets = new Map(); // "op:ip" -> { count, resetAt }
function checkNameRate(op, ip) {
  const rule = NAME_RATE[op];
  if (!rule) return true;
  const key = `${op}:${ip}`;
  const now = Date.now();
  let b = _nameRateBuckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + rule.windowMs };
    _nameRateBuckets.set(key, b);
    if (_nameRateBuckets.size > 10000) {
      for (const [k, v] of _nameRateBuckets) {
        if (now >= v.resetAt) _nameRateBuckets.delete(k);
      }
    }
  }
  b.count += 1;
  return b.count <= rule.max;
}

function socketIp(socket) {
  return socket?.handshake?.address
    || socket?.request?.socket?.remoteAddress
    || "unknown";
}

/**
 * Wire the pre-world NAME channel onto every connection. Called once by
 * initIBPWS, alongside attachIbpHandlers.
 */
export function attachNameSession(io) {
  io.on("connection", (socket) => {
    socket.on("name", (msg, ack) => handleNameSession(socket, msg, ack));
  });
  log.info("IBP", "Pre-world NAME session channel attached");
}

export async function handleNameSession(socket, msg, ack) {
  const id = msg?.id || null;
  const op = msg?.op;
  if (typeof op !== "string" || !op.length) {
    return ackError(ack, id, IBP_ERR.INVALID_INPUT, "name: requires { op }");
  }
  try {
    switch (op) {
      case "declare": return await doDeclare(socket, msg, ack, id);
      case "connect": return await doConnect(socket, msg, ack, id);
      case "release": return await doRelease(socket, msg, ack, id);
      case "see":     return await doSee(socket, msg, ack, id);
      case "whoami":  return ackOk(ack, id, { nameId: socket.nameId || null });
      default:
        return ackError(
          ack, id, IBP_ERR.ACTION_NOT_SUPPORTED,
          `name: unknown session op "${op}" (declare | connect | release | see | whoami)`,
        );
    }
  } catch (err) {
    // Intentional IbpErrors carry safe, client-facing messages (kept). A bare
    // Error is an internal fault: log the detail server-side, return a GENERIC
    // message — this is an unauthenticated pre-world channel, so never echo
    // raw error text (DB strings, paths) back to the client.
    if (err?.code) return ackError(ack, id, err.code, err.message, err.detail);
    log.error("IBP", `name session "${op}" failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, "name session error");
  }
}

// declare — the pre-world bootstrap. Opens an I_AM moment (no being
// needed) and mints the name as a facet of the reality's I_AM. Both
// real-name and password are OPTIONAL.
async function doDeclare(socket, msg, ack, id) {
  if (!checkNameRate("declare", socketIp(socket))) {
    return ackError(ack, id, IBP_ERR.FORBIDDEN,
      "Too many name declarations from this address; retry later");
  }
  const src = msg?.payload || msg || {};
  const payload = {
    name:     src.name ?? null,
    password: src.password ?? null,
    soulType: src.soulType ?? null,
  };
  const { withIAmAct } = await import("../../seed/sprout.js");
  const { nameVerb } = await import("../../seed/ibp/verbs/name.js");
  let nameId = null;
  await withIAmAct("name:declare (pre-world)", async (ctx) => {
    const r = await nameVerb("declare", payload, { summonCtx: ctx, currentBranch: "0" });
    nameId = r.nameId;
  });
  return ackOk(ack, id, { ok: true, nameId });
}

// Stamp a name:connect / name:release fact on the name's reel via an I_AM
// moment (the pre-world bootstrap path, same as declare). The NAME op handler
// gates the transition (already-connected for connect, not-connected for
// release) and THROWS on a bad one — that throw propagates to the caller, who
// decides what to do with the live session.
async function stampNameSession(op, nameId) {
  const { withIAmAct } = await import("../../seed/sprout.js");
  const { nameVerb } = await import("../../seed/ibp/verbs/name.js");
  const { getRealityDomain } = await import("../../seed/ibp/address.js");
  const realityDomain = getRealityDomain();
  await withIAmAct(`name:${op}`, async (ctx) => {
    await nameVerb(op, {}, {
      address:       `${nameId}@${realityDomain}`,
      summonCtx:     ctx,
      currentBranch: "0",
    });
  });
}

// connect — resolve the name (real-name or pubkey), decrypt its key with
// the password into the signing session, and BIND the connection to it.
// socket.nameId is the session's identity from here on (the identity-layer
// be:connect).
async function doConnect(socket, msg, ack, id) {
  if (!checkNameRate("connect", socketIp(socket))) {
    return ackError(ack, id, IBP_ERR.FORBIDDEN,
      "Too many connect attempts from this address; retry later");
  }
  const src = msg?.payload || msg || {};
  const token = src.token ?? src.name ?? null;
  const password = src.password ?? null;
  if (!token || !password) {
    return ackError(ack, id, IBP_ERR.INVALID_INPUT,
      "name connect requires { token (real-name or pubkey), password }");
  }
  // PRE-CHECK the reel: a name can't connect twice (one active session per
  // name). Check BEFORE unlocking, because the signing session is nameId-keyed
  // and SHARED — if another session already holds this name connected, the
  // undo below would lock the key out from under THEM. Refusing here never
  // touches the shared session. (The op gate re-checks authoritatively.)
  const { resolveNameId } = await import("../../seed/materials/name/registry.js");
  const preNameId = await resolveNameId(token);
  if (preNameId) {
    const { loadProjection } = await import("../../seed/materials/projections.js");
    const pre = await loadProjection("name", preNameId, "0");
    if (pre?.state?.connected === true) {
      return ackError(ack, id, IBP_ERR.RESOURCE_CONFLICT,
        "name is already connected — release it first (one active session per name)");
    }
  }
  const { nameConnect } = await import("../../seed/materials/name/login.js");
  const result = await nameConnect(token, password);
  if (!result.ok) {
    // Uniform failure surface — never leak whether the name exists vs the
    // password is wrong (both read as a refused connect to the client).
    return ackError(ack, id, IBP_ERR.UNAUTHORIZED, `connect refused: ${result.reason}`);
  }
  // Stamp the name:connect fact (folds connected:true on the name's reel). The
  // op gate refuses a DOUBLE connect (one active session per name); the
  // pre-check above means no OTHER session is connected here, so undoing the
  // unlock on a (racy) refusal only locks what THIS attempt just unlocked.
  try {
    await stampNameSession("connect", result.nameId);
  } catch (err) {
    const { nameRelease } = await import("../../seed/materials/name/login.js");
    nameRelease(result.nameId);
    if (err?.code) return ackError(ack, id, err.code, err.message, err.detail);
    log.error("IBP", `name connect fact failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, "name connect error");
  }
  socket.nameId = result.nameId;
  log.debug("IBP", `socket ${socket.id} connected as name ${result.nameId}`);
  return ackOk(ack, id, { ok: true, nameId: result.nameId });
}

// release — stamp the name:release fact (folds connected:false), wipe the held
// key, and unbind the connection (the name releasing itself; back to the bare
// reality / the Name menu).
async function doRelease(socket, msg, ack, id) {
  const nameId = socket.nameId || null;
  if (nameId) {
    // Record the release on the reel; the gate refuses release-when-not-
    // connected, but we still unbind the live session either way (a socket
    // must never be left holding a name the reel says isn't connected).
    try {
      await stampNameSession("release", nameId);
    } catch (err) {
      log.warn("IBP", `name release fact refused for ${nameId}: ${err.message}; unbinding session anyway`);
    }
    const { nameRelease } = await import("../../seed/materials/name/login.js");
    nameRelease(nameId);
    socket.nameId = null;
  }
  return ackOk(ack, id, { ok: true, nameId });
}

// see — the Name Form's READ surface: resolve a token (real-name or pubkey)
// and return the name's BIOGRAPHIC descriptor ("who is this name"). Read-only,
// session-only: no moment, no fact, no authorize (a biographic name is public
// so a user can pick which name to log into). The descriptor never carries the
// private key (buildNameDescriptor field-picks).
async function doSee(socket, msg, ack, id) {
  const src = msg?.payload || msg || {};
  const token = src.token ?? src.name ?? src.nameId ?? null;
  if (!token) {
    return ackError(ack, id, IBP_ERR.INVALID_INPUT,
      "name see requires { token (real-name or pubkey) }");
  }
  const { resolveNameId } = await import("../../seed/materials/name/registry.js");
  const nameId = await resolveNameId(token);
  if (!nameId) {
    return ackError(ack, id, IBP_ERR.NAME_NOT_FOUND, `no such name: ${token}`);
  }
  const { buildNameDescriptor } = await import("../../seed/ibp/descriptor.js");
  const descriptor = await buildNameDescriptor(nameId);
  if (!descriptor) {
    return ackError(ack, id, IBP_ERR.NAME_NOT_FOUND, `no such name: ${token}`);
  }
  return ackOk(ack, id, descriptor);
}
