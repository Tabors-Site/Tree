// TreeOS — auth HTTP adapters.
//
// These routes are thin shims over the IBP BE verb. The canonical
// registration / claim / release logic lives in ibp/roles/auth.js
// (the auth-being). Per [[project_protocol_transport_separation]],
// HTTP is just a transport carrier; the protocol is the protocol.
//
// Per-route work that remains here is HTTP-specific:
//   - parse request body
//   - dispatch through the IBP layer with verb=be + the right op
//   - set or clear the browser cookie on the response
//   - translate the IBP ack shape into HTTP status + JSON body

import log from "../../seed/core/log.js";
import { sendOk, sendError, ERR } from "../../seed/core/protocol.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import { dispatchIbp } from "../../protocols/ibp/protocol.js";
import { getLandDomain } from "../../seed/addressing/address.js";

function cookieDomain(req) {
  const host = (req.hostname || req.headers?.host || "").replace(/:\d+$/, "");
  const landDomain = process.env.LAND_DOMAIN || "";
  const configDomain = getLandConfigValue("cookieDomain");
  if (configDomain) return configDomain;
  if (landDomain && host.endsWith(landDomain)) return "." + landDomain;
  return undefined;
}

function isLocalRequest(req) {
  const host = req.hostname || "";
  return !host || host === "localhost" || host.startsWith("127.") || host.startsWith("192.168.");
}

/**
 * Build the minimal socket-shaped carrier the IBP verb handlers expect
 * when a request arrives from HTTP. JWT-bearing requests (logout)
 * carry their identity; arrival requests (register/claim) carry none.
 */
function makeHttpCarrier(req) {
  return {
    beingId:  req.beingId  || null,
    name: req.name || null,
    handshake: { headers: req.headers, address: req.ip },
    connected: false,
    emit:    () => {},
    join:    () => {},
    leave:   () => {},
    to:      () => ({ emit: () => {} }),
    // Pass the express req through to the auth-being via ctx — the
    // beforeRegister / afterRegister hooks expect to read it.
    _req: req,
  };
}

/**
 * Dispatch an IBP envelope and resolve with the ack payload. Lets us
 * await the result of a verb call from an Express handler.
 */
function dispatchAndWait(carrier, msg) {
  return new Promise((resolve) => {
    let settled = false;
    const ack = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    Promise.resolve()
      .then(() => dispatchIbp(carrier, msg, ack))
      .catch((err) => {
        if (!settled) {
          settled = true;
          resolve({
            id:     msg.id || null,
            status: "error",
            error:  { code: "INTERNAL", message: err.message || "Internal portal error" },
          });
        }
      });
  });
}

function setAuthCookie(res, req, token) {
  const isLocal = isLocalRequest(req);
  const expiryDays = Math.max(1, Math.min(Number(getLandConfigValue("jwtExpiryDays")) || 30, 365));
  res.cookie("token", token, {
    httpOnly: true,
    secure:   !isLocal,
    sameSite: isLocal ? "Lax" : "None",
    domain:   cookieDomain(req),
    maxAge:   expiryDays * 24 * 60 * 60 * 1000,
    path:     "/",
  });
}

function clearAuthCookie(res, req) {
  const isLocal = isLocalRequest(req);
  res.clearCookie("token", {
    httpOnly: true,
    secure:   !isLocal,
    sameSite: isLocal ? "Lax" : "None",
    domain:   cookieDomain(req),
    path:     "/",
  });
}

// ─────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────

const register = async (req, res) => {
  try {
    // Accept `name` (canonical) or `username` (legacy alias) from the body.
    const name = req.body?.name ?? req.body?.username;
    const { password } = req.body || {};
    const carrier = makeHttpCarrier(req);
    const ack = await dispatchAndWait(carrier, {
      verb:    "be",
      address: getLandDomain(),
      payload: { op: "register", name, password },
    });

    if (ack.status === "error") {
      const httpStatus = errCodeToHttpStatus(ack.error?.code || "INTERNAL");
      return sendError(res, httpStatus, ack.error?.code || ERR.INTERNAL,
        ack.error?.message || "Registration failed", ack.error?.detail);
    }

    const data = ack.data || {};
    setAuthCookie(res, req, data.identityToken);
    return sendOk(res, {
      firstUser: !!data.firstUser,
      token:     data.identityToken,
      beingId:   data.beingId,
      name:  data.name,
    }, 201);
  } catch (error) {
    log.error("Auth", `Registration error: ${error.message}`);
    sendError(res, 500, ERR.INTERNAL, "Internal server error");
  }
};

const login = async (req, res) => {
  try {
    const name = req.body?.name ?? req.body?.username;
    const { password } = req.body || {};
    if (!name || !password) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Name and password are required");
    }
    const carrier = makeHttpCarrier(req);
    const ack = await dispatchAndWait(carrier, {
      verb:    "be",
      address: getLandDomain(),
      payload: { op: "claim", name, password },
    });

    if (ack.status === "error") {
      const httpStatus = errCodeToHttpStatus(ack.error?.code || "INTERNAL");
      return sendError(res, httpStatus, ack.error?.code || ERR.INTERNAL,
        ack.error?.message || "Invalid credentials", ack.error?.detail);
    }

    const data = ack.data || {};
    setAuthCookie(res, req, data.identityToken);
    return sendOk(res, {
      token:    data.identityToken,
      beingId:  data.beingId,
      name: data.name,
    });
  } catch (error) {
    log.error("Auth", `Login error: ${error.message}`);
    sendError(res, 500, ERR.INTERNAL, "Server is down");
  }
};

const logout = async (req, res) => {
  try {
    // The HTTP-side authenticate middleware sets req.beingId/req.name.
    // The IBP BE release op for an already-authenticated session just
    // signals "drop the token"; the server clears the cookie.
    const carrier = makeHttpCarrier(req);
    if (req.beingId && req.name) {
      const heldStance = `${getLandDomain()}/@${req.name}`;
      await dispatchAndWait(carrier, {
        verb:    "be",
        address: heldStance,
        payload: { op: "release" },
      });
    }
    clearAuthCookie(res, req);
    return sendOk(res, { message: "Logged out successfully" });
  } catch (error) {
    log.error("Auth", `Logout error: ${error.message}`);
    return sendError(res, 500, ERR.INTERNAL, "Logout failed");
  }
};

// IBP-error-code → HTTP-status mapping. Matches routes/api/ibp.js.
const ERR_HTTP_MAP = {
  INVALID_INPUT:        400,
  ACTION_NOT_SUPPORTED: 400,
  UNAUTHORIZED:         401,
  FORBIDDEN:            403,
  SESSION_EXPIRED:      403,
  NODE_NOT_FOUND:       404,
  USER_NOT_FOUND:       404,
  ROLE_UNAVAILABLE:     404,
  VERB_NOT_SUPPORTED:   405,
  RESOURCE_CONFLICT:    409,
  RATE_LIMITED:         429,
  TIMEOUT:              500,
  LLM_FAILED:           503,
  INTERNAL:             500,
};
function errCodeToHttpStatus(code) { return ERR_HTTP_MAP[code] || 500; }

export { register, login, logout };
