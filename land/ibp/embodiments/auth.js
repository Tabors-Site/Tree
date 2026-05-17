// TreeOS IBP — auth-being.
//
// The auth-being is the land's welcome character. It is the only stance
// that accepts requests from unestablished requesters. It processes
// register, claim, release, and switch operations.
//
// On every other land, a different auth-being can be installed by an
// extension. The contract:
//
//   - honoredOperations: ["register", "claim", "release", "switch"]
//   - register(payload, ctx) -> { identityToken, beingAddress, welcome? }
//   - claim(payload, ctx)    -> { identityToken, beingAddress, welcome? }
//   - release(payload, ctx)  -> { released: true }
//   - switch(payload, ctx)   -> { active }
//
// The auth-being is also a real being. SEE on its stance returns a
// Position Description describing the land's identity policies (whether
// registration is open, required credential types, the welcome message
// that newcomers see).

import {
  createUser,
  findUserByUsername,
  verifyPassword,
  generateToken,
} from "../../seed/auth.js";
import { PortalError, PORTAL_ERR } from "../errors.js";
import { getLandDomain } from "../address.js";

const TREEOS_AUTH_WELCOME =
  "Welcome to TreeOS. This land is open to anyone who wants to inhabit it. Pick a username and password; you will receive an identity token immediately and start at your home.";

export const authBeing = Object.freeze({
  name: "auth",
  description: "The land's welcome character. Processes register, claim, release, and switch.",
  honoredOperations: ["register", "claim", "release", "switch"],
  policy: {
    registrationOpen: true,
    credentialTypes: ["password"],
  },
  welcome: TREEOS_AUTH_WELCOME,

  async register(payload, _ctx) {
    const { username, password } = payload || {};
    if (!username || typeof username !== "string") {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`username` is required");
    }
    if (!password || typeof password !== "string") {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`password` is required");
    }
    let user;
    try {
      user = await createUser(username, password);
    } catch (err) {
      throw mapKernelError(err);
    }
    const identityToken = generateToken(user);
    return {
      identityToken,
      beingAddress: `${getLandDomain()}/@${user.username}`,
      welcome: TREEOS_AUTH_WELCOME,
    };
  },

  async claim(payload, _ctx) {
    const { username, password } = payload || {};
    if (!username || typeof username !== "string") {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`username` is required");
    }
    if (!password || typeof password !== "string") {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`password` is required");
    }
    const user = await findUserByUsername(username);
    if (!user) {
      throw new PortalError(PORTAL_ERR.USER_NOT_FOUND, "No such user on this land");
    }
    const ok = await verifyPassword(user, password);
    if (!ok) {
      throw new PortalError(PORTAL_ERR.UNAUTHORIZED, "Invalid credentials");
    }
    const identityToken = generateToken(user);
    return {
      identityToken,
      beingAddress: `${getLandDomain()}/@${user.username}`,
    };
  },

  async release(_payload, _ctx) {
    // Tokens are stateless JWTs in Pass 1; release is client-side
    // (drop the token). A later phase may add a server-side revocation
    // list keyed by jti. The protocol-level contract is honored: a
    // released token should not be used again by the client.
    return { released: true };
  },

  async switch(payload, ctx) {
    const { from, to } = payload || {};
    if (!from || typeof from !== "string") {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`from` (current stance) is required");
    }
    if (!to || typeof to !== "string") {
      throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`to` (target stance) is required");
    }
    // Switch is purely a client-coordination signal in Pass 1. The server
    // verifies the requester is authenticated (handled by the BE handler
    // before dispatch) and returns the new active. A held-stance roster
    // lives on the client; the server has no per-session state to update.
    return { active: to, from };
  },
});

function mapKernelError(err) {
  if (err && err.name === "ProtocolError" && err.errCode) {
    return new PortalError(err.errCode, err.message || "auth operation failed");
  }
  const msg = err?.message || "auth operation failed";
  if (/already taken|conflict/i.test(msg)) {
    return new PortalError(PORTAL_ERR.RESOURCE_CONFLICT, msg, { field: "username" });
  }
  if (/Invalid username|Invalid password|Username|Password/i.test(msg)) {
    return new PortalError(PORTAL_ERR.INVALID_INPUT, msg);
  }
  return new PortalError(PORTAL_ERR.INTERNAL, msg);
}
