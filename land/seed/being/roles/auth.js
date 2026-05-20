// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// auth-being.
//
// The auth-being is the land's welcome character. It is the only stance
// that accepts requests from unestablished requesters. It processes
// register, claim, release, and switch operations.
//
// One canonical implementation, reached through `ibp:be` from every
// transport (WebSocket, HTTP adapter, CLI). The HTTP /auth/register +
// /auth/login + /auth/logout routes are thin shims that dispatch
// through here and set browser cookies.
//
// Contract:
//
//   - honoredOperations: ["register", "claim", "release", "switch"]
//   - register(payload, ctx) -> { identityToken, beingAddress, beingId,
//                                 username, firstUser, welcome }
//   - claim(payload, ctx)    -> { identityToken, beingAddress, beingId,
//                                 username, welcome? }
//   - release(payload, ctx)  -> { released: true }
//   - switch(payload, ctx)   -> { active }
//
// On every other land, a different auth-being can be installed by an
// extension. The contract above is what the protocol layer expects.

import log from "../core/log.js";
import { hooks } from "../core/hooks.js";
import Being from "../models/being.js";
import {
  createBeingWithHome,
  createFirstBeing,
  isFirstBeing,
  findBeingByName,
  verifyPassword,
  generateToken,
} from "../core/identity.js";
import { getLandRootId } from "../landRoot.js";
import { IbpError, IBP_ERR } from "../core/errors.js";
import { getLandDomain } from "../addressing/address.js";

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

  async register(payload, ctx) {
    // `name` is the canonical wire field; `username` accepted as a
    // legacy alias during the transition.
    const name = payload?.name ?? payload?.username;
    const { password } = payload || {};
    if (!name || typeof name !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
    }
    if (!password || typeof password !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`password` is required");
    }

    // ── First-being bootstrap ──
    // The very first registration on a fresh land creates the root
    // being: it carries the admin role and parentBeingId null. Every
    // subsequent being chains back to this root through parentBeingId.
    // Right after, ensureSystemBeings spawns auth + land-manager +
    // citizen as the root's children so the being-tree is intact
    // before any other registration flows through.
    //
    // Bypasses beforeRegister hook intentionally: on first boot the
    // hook listeners (email verification, invite-code checks) aren't
    // loaded yet, and the land needs an operator before anything else.
    const first = await isFirstBeing();
    if (first) {
      let being;
      try {
        being = await createFirstBeing(name, password);
      } catch (err) {
        throw mapKernelError(err);
      }
      hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

      // Detached: spawn system beings under the root. Response should
      // not block on these writes.
      (async () => {
        try {
          const { ensureSystemBeings } = await import("../core/systemBeings.js");
          await ensureSystemBeings(getLandRootId());
        } catch (err) {
          log.warn("auth-being", `post-first-register system-being setup failed: ${err.message}`);
        }
      })();

      const identityToken = generateToken(being);
      return {
        identityToken,
        beingAddress: `${getLandDomain()}/@${being.name}`,
        beingId:      String(being._id),
        name:     being.name,
        firstUser:    true,
        welcome:      TREEOS_AUTH_WELCOME,
      };
    }

    // ── Subsequent registrations ──
    // Run beforeRegister so extensions can gate (email verification,
    // invite codes, rate limits).
    const hookData = { name, password, req: ctx?.req, handled: false };
    const hookResult = await hooks.run("beforeRegister", hookData);
    if (hookResult?.cancelled) {
      const code = hookResult.timedOut ? IBP_ERR.INTERNAL : IBP_ERR.FORBIDDEN;
      throw new IbpError(code, hookResult.reason || "Registration blocked");
    }

    // Subsequent humans register via the auth-being's flow: they
    // become being-tree children of the auth-being. The auth-being
    // is itself a child of the root being, so the chain walks
    // human → auth → root → null.
    const authParent = await Being.findOne({ name: "auth", operatingMode: "ai" })
      .select("_id").lean();
    const parentBeingId = authParent ? String(authParent._id) : null;

    let being;
    try {
      // Use the home-creating primitive so the human gets a home
      // territory Node at registration. The home is the user's
      // tree-root; their personal node hierarchy grows from there.
      const result = await createBeingWithHome({
        operatingMode: "human",
        name,
        password,
        homeParent:    getLandRootId(),
        parentBeingId,
      });
      being = result.being;
    } catch (err) {
      throw mapKernelError(err);
    }

    if (!parentBeingId) {
      log.warn("auth-being",
        `human "${name}" registered without auth-being parent; system beings may be missing`);
    }

    hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

    const identityToken = generateToken(being);
    return {
      identityToken,
      beingAddress: `${getLandDomain()}/@${being.name}`,
      beingId:      String(being._id),
      name:     being.name,
      firstUser:    false,
      welcome:      TREEOS_AUTH_WELCOME,
    };
  },

  async claim(payload, _ctx) {
    // `name` is canonical; `username` is the legacy alias.
    const name = payload?.name ?? payload?.username;
    const { password } = payload || {};
    if (!name || typeof name !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
    }
    if (!password || typeof password !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`password` is required");
    }
    const user = await findBeingByName(name);

    // Constant-time rejection: always run bcrypt even when the user
    // doesn't exist or is remote, so timing doesn't disclose existence.
    const DUMMY_HASH = "$2b$12$0000000000000000000000000000000000000000000000000000";
    const ok = await verifyPassword(
      user && !user.isRemote ? user : { password: DUMMY_HASH },
      password,
    );
    if (!user || user.isRemote || !ok) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "Invalid credentials");
    }

    const identityToken = generateToken(user);
    return {
      identityToken,
      beingAddress: `${getLandDomain()}/@${user.name}`,
      beingId:      String(user._id),
      name:     user.name,
    };
  },

  async release(_payload, _ctx) {
    // Tokens are stateless JWTs; release is client-side (drop the
    // token, clear the cookie). A server-side revocation list keyed
    // by jti is on the roadmap. The protocol-level contract is
    // honored: a released token should not be used again by the
    // client.
    return { released: true };
  },

  async switch(payload, _ctx) {
    const { from, to } = payload || {};
    if (!from || typeof from !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`from` (current stance) is required");
    }
    if (!to || typeof to !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`to` (target stance) is required");
    }
    // Switch is purely a client-coordination signal. The server has
    // no per-session state to update.
    return { active: to, from };
  },
});

function mapKernelError(err) {
  if (err && err.name === "ProtocolError" && err.errCode) {
    return new IbpError(err.errCode, err.message || "auth operation failed");
  }
  const msg = err?.message || "auth operation failed";
  if (/already taken|conflict/i.test(msg)) {
    return new IbpError(IBP_ERR.RESOURCE_CONFLICT, msg, { field: "username" });
  }
  if (/Invalid username|Invalid password|Username|Password/i.test(msg)) {
    return new IbpError(IBP_ERR.INVALID_INPUT, msg);
  }
  return new IbpError(IBP_ERR.INTERNAL, msg);
}
