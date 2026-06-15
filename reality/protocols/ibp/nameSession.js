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
// Four pre-world ops — the Name Form's whole surface:
//   declare  mint a name (the unauthed bootstrap; the fact's actor is
//            I_AM, every name being a facet of the reality's I_AM). FACT.
//   login    real-name + password -> decrypt the key into the signing
//            session + bind socket.nameId. SESSION, not a fact. Login is
//            the portal's convenience for using a name without presenting
//            the private key each act; a holder can always act with the
//            raw key over the API instead.
//   logout   wipe the held key + clear socket.nameId. SESSION.
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
// `login` is a password surface, so it is rate-limited like `connect` to
// blunt brute force. Fixed window per (op, ip); entries expire lazily.
const NAME_RATE = {
  declare: { max: 5,  windowMs: 60 * 60 * 1000 },
  login:   { max: 10, windowMs: 15 * 60 * 1000 },
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
      case "login":   return await doLogin(socket, msg, ack, id);
      case "logout":  return await doLogout(socket, msg, ack, id);
      case "whoami":  return ackOk(ack, id, { nameId: socket.nameId || null });
      default:
        return ackError(
          ack, id, IBP_ERR.ACTION_NOT_SUPPORTED,
          `name: unknown session op "${op}" (declare | login | logout | whoami)`,
        );
    }
  } catch (err) {
    if (err?.code) return ackError(ack, id, err.code, err.message, err.detail);
    log.error("IBP", `name session "${op}" failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "name session error");
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

// login — resolve the name (real-name or pubkey), decrypt its key with
// the password into the signing session, and BIND the connection to it.
// socket.nameId is the session's identity from here on.
async function doLogin(socket, msg, ack, id) {
  if (!checkNameRate("login", socketIp(socket))) {
    return ackError(ack, id, IBP_ERR.FORBIDDEN,
      "Too many login attempts from this address; retry later");
  }
  const src = msg?.payload || msg || {};
  const token = src.token ?? src.name ?? null;
  const password = src.password ?? null;
  if (!token || !password) {
    return ackError(ack, id, IBP_ERR.INVALID_INPUT,
      "name login requires { token (real-name or pubkey), password }");
  }
  const { nameLogin } = await import("../../seed/materials/name/login.js");
  const result = await nameLogin(token, password);
  if (!result.ok) {
    // Uniform failure surface — never leak whether the name exists vs the
    // password is wrong (both read as a refused login to the client).
    return ackError(ack, id, IBP_ERR.UNAUTHORIZED, `login refused: ${result.reason}`);
  }
  socket.nameId = result.nameId;
  log.debug("IBP", `socket ${socket.id} logged in as name ${result.nameId}`);
  return ackOk(ack, id, { ok: true, nameId: result.nameId });
}

// logout — wipe the held key and unbind the connection.
async function doLogout(socket, msg, ack, id) {
  const nameId = socket.nameId || null;
  if (nameId) {
    const { nameLogout } = await import("../../seed/materials/name/login.js");
    nameLogout(nameId);
    socket.nameId = null;
  }
  return ackOk(ack, id, { ok: true, nameId });
}
