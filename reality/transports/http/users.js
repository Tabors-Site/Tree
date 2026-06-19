// Auth HTTP adapters.
//
// Thin shims over the IBP BE verb. The canonical registration /
// claim / release logic lives in seed/present/roles/cherub/role.js
// (the cherub handles identity-binding); HTTP is just a transport
// carrier — the user is the originator, HTTP delivers their
// self-summon, cherub processes it.
//
// Per-route work that remains here is HTTP-specific:
//   - parse request body
//   - dispatch through the IBP layer with verb=be + the right op
//   - set or clear the browser cookie on the response
//   - translate the IBP ack into HTTP status + JSON body
//
// Shared dispatch helpers (makeHttpCarrier / dispatchAndWait) live
// in transports/http/dispatch.js. HTTP status derives from the IBP
// code via httpStatusFor() in seed/ibp/protocol.js — one canonical
// mapping.

import log from "../../seed/seedStory/log.js";
import { sendOk, sendError, IBP_ERR, httpStatusFor } from "../../seed/ibp/protocol.js";
import { getStoryConfigValue } from "../../seed/storyConfig.js";
import { getStoryDomain } from "../../seed/ibp/address.js";
import { makeHttpCarrier, dispatchAndWait, dispatchAndAwaitResult } from "./dispatch.js";

function cookieDomain(req) {
  const host = (req.hostname || req.headers?.host || "").replace(/:\d+$/, "");
  const storyDomain = process.env.STORY_DOMAIN || "";
  const configDomain = getStoryConfigValue("cookieDomain");
  if (configDomain) return configDomain;
  if (storyDomain && host.endsWith(storyDomain)) return "." + storyDomain;
  return undefined;
}

function isLocalRequest(req) {
  const host = req.hostname || "";
  return !host || host === "localhost" || host.startsWith("127.") || host.startsWith("192.168.");
}

function setAuthCookie(res, req, token) {
  const isLocal = isLocalRequest(req);
  const expiryDays = Math.max(1, Math.min(Number(getStoryConfigValue("jwtExpiryDays")) || 30, 365));
  res.cookie("token", token, {
    httpOnly: true,
    secure:   !isLocal,
    // Lax everywhere. The portal is same-origin (served by this
    // story), so None bought nothing except sending the session
    // cookie on every cross-site request — the CSWSH ingredient.
    // Programmatic cross-origin clients authenticate with the
    // handshake/bearer token, never the cookie.
    sameSite: "Lax",
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
    sameSite: "Lax",
    domain:   cookieDomain(req),
    path:     "/",
  });
}

/**
 * Forward an ack error onto the HTTP response, using the canonical
 * code→status mapping. Wraps the common "ack.status === 'error'" tail.
 */
function sendAckError(res, ack, fallbackMessage) {
  const code    = ack.error?.code    || IBP_ERR.INTERNAL;
  const message = ack.error?.message || fallbackMessage;
  return sendError(res, httpStatusFor(code), code, message, ack.error?.detail);
}

// ── Route handlers ──

const register = async (req, res) => {
  try {
    // Accept `name` (canonical) or `username` (legacy alias) from the body.
    const name = req.body?.name ?? req.body?.username;
    const { password } = req.body || {};
    // Cherub's beforeRegister / afterRegister hooks expect to read
    // the Express request from the carrier.
    const carrier = makeHttpCarrier(req, { _req: req });
    // Await the MOMENT'S result, not the "accepted" ack — the cherub's
    // birth return (token, beingId, name) arrives as the async push a
    // WS caller would receive. See dispatchAndAwaitResult.
    const ack = await dispatchAndAwaitResult(carrier, {
      verb:    "be",
      address: getStoryDomain(),
      payload: { act: "birth", name, password },
    });

    if (ack.status === "error") return sendAckError(res, ack, "Registration failed");

    const data = ack.data || {};
    setAuthCookie(res, req, data.identityToken);
    return sendOk(res, {
      firstUser: !!data.firstUser,
      token:     data.identityToken,
      beingId:   data.beingId,
      name:      data.name,
    }, 201);
  } catch (error) {
    log.error("Auth", `Registration error: ${error.message}`);
    sendError(res, 500, IBP_ERR.INTERNAL, "Internal server error");
  }
};

const login = async (req, res) => {
  try {
    const name = req.body?.name ?? req.body?.username;
    const { password } = req.body || {};
    if (!name || !password) {
      return sendError(res, 400, IBP_ERR.INVALID_INPUT, "Name and password are required");
    }
    const carrier = makeHttpCarrier(req, { _req: req });
    const ack = await dispatchAndAwaitResult(carrier, {
      verb:    "be",
      address: getStoryDomain(),
      payload: { act: "connect", name, password },
    });

    if (ack.status === "error") return sendAckError(res, ack, "Invalid credentials");

    const data = ack.data || {};
    setAuthCookie(res, req, data.identityToken);
    return sendOk(res, {
      token:   data.identityToken,
      beingId: data.beingId,
      name:    data.name,
    });
  } catch (error) {
    log.error("Auth", `Login error: ${error.message}`);
    sendError(res, 500, IBP_ERR.INTERNAL, "Server is down");
  }
};

const logout = async (req, res) => {
  try {
    // The HTTP-side authenticate middleware sets req.beingId/req.name.
    // The IBP BE release op for an already-authenticated session just
    // signals "drop the token"; the server clears the cookie.
    const carrier = makeHttpCarrier(req, { _req: req });
    if (req.beingId && req.name) {
      const heldStance = `${getStoryDomain()}/@${req.name}`;
      await dispatchAndWait(carrier, {
        verb:    "be",
        address: heldStance,
        payload: { act: "release" },
      });
    }
    clearAuthCookie(res, req);
    return sendOk(res, { message: "Logged out successfully" });
  } catch (error) {
    log.error("Auth", `Logout error: ${error.message}`);
    return sendError(res, 500, IBP_ERR.INTERNAL, "Logout failed");
  }
};

export { register, login, logout };
