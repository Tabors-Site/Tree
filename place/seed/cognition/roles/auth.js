// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// auth-being.
//
// The auth-being is the place's welcome character. It is the only stance
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
// On every other place, a different auth-being can be installed by an
// extension. The contract above is what the protocol layer expects.

import log from "../../system/log.js";
import { hooks } from "../../system/hooks.js";
import Being from "../../models/being.js";
import {
  createBeingWithHome,
  createFirstBeing,
  isFirstBeing,
  findBeingByName,
  verifyPassword,
  generateToken,
} from "../../place/being/identity.js";
import { getPlaceRootId } from "../../placeRoot.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { getPlaceDomain } from "../../ibp/address.js";

const TREEOS_AUTH_WELCOME =
  "Welcome to TreeOS. This place is open to anyone who wants to inhabit it. Pick a username and password; you will receive an identity token immediately and start at your home.";

export const authBeing = Object.freeze({
  name: "auth",
  description: "The place's welcome character. Processes register, claim, release, switch, and create-being.",
  honoredOperations: ["register", "claim", "release", "switch", "create-being"],
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
    // The I_AM already exists (created by ensurePlaceRoot at
    // boot). The very first human registration parents under the
    // I_AM, becoming the place's root operator. Every subsequent
    // human registration parents under @auth, which itself parents
    // under the I_AM. The chain walks human → auth → I_AM
    // → null.
    //
    // Bypasses beforeRegister hook intentionally: on first boot the
    // hook listeners (email verification, invite-code checks) aren't
    // loaded yet, and the place needs an operator before anything else.
    const first = await isFirstBeing();
    if (first) {
      const { findIAm } = await import("../../place/being/placeBeings.js");
      const iAm = await findIAm();
      let being;
      try {
        being = await createFirstBeing(name, password, {
          parentBeingId: iAm ? String(iAm._id) : null,
        });
      } catch (err) {
        throw mapKernelError(err);
      }
      hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

      // Detached: spawn system beings under the root. Response should
      // not block on these writes.
      (async () => {
        try {
          const { ensurePlaceBeings } = await import("../being/placeBeings.js");
          await ensurePlaceBeings(getPlaceRootId());
        } catch (err) {
          log.warn("auth-being", `post-first-register system-being setup failed: ${err.message}`);
        }
      })();

      const identityToken = generateToken(being);
      return {
        identityToken,
        beingAddress: `${getPlaceDomain()}/@${being.name}`,
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
    const authParent = await Being.findOne({ name: "auth", operatingMode: "scripted" })
      .select("_id").lean();
    const parentBeingId = authParent ? String(authParent._id) : null;

    let being;
    try {
      // Use the home-creating primitive so the human gets a home
      // territory Space at registration. The home is the user's
      // tree-root; their personal space hierarchy grows from there.
      const result = await createBeingWithHome({
        operatingMode: "human",
        name,
        password,
        homeParent:    getPlaceRootId(),
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
      beingAddress: `${getPlaceDomain()}/@${being.name}`,
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
      beingAddress: `${getPlaceDomain()}/@${user.name}`,
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

  // create-being: spawn a being under an existing parent in the being
  // tree. BE rather than DO because creating a being is an identity
  // operation, not a state mutation on space or matter. Identity is
  // BE's domain (see philosophy notes: BE acts on the being calling
  // it; identity creation belongs here).
  //
  // The caller's beingId defaults the new being's parentBeingId
  // (lineage captures "who created whom"). Explicit parentBeingId in
  // the payload overrides. Stance authorization runs in the verb
  // dispatcher before this method is invoked.
  async createBeing(payload, ctx) {
    const {
      name,
      password,
      operatingMode = "llm",
      role          = null,
      homeSpace     = null,
      homeParent    = null,
      llmDefault    = null,
      isRemote      = false,
      homePlace      = null,
    } = payload || {};

    if (operatingMode !== "human" && operatingMode !== "llm" && operatingMode !== "scripted" && operatingMode !== "mixed") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `invalid operatingMode "${operatingMode}"; must be "human" | "llm" | "scripted" | "mixed"`,
      );
    }
    if (operatingMode !== "human" && !role) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "non-human beings require a `role`");
    }
    if (!homeSpace && !homeParent) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "create-being requires `homeSpace` (existing) or `homeParent` (creates new)",
      );
    }

    // Lineage default: the caller is the being doing the creation.
    // The being-tree captures who created whom; null is reserved for
    // the place's root being only.
    const parentBeingId =
      payload?.parentBeingId
      || ctx?.identity?.beingId
      || null;

    let being;
    try {
      const result = await createBeingWithHome({
        operatingMode,
        role,
        name,
        password,
        homeSpace,
        homeParent,
        parentBeingId,
        llmDefault,
        isRemote,
        homePlace,
      });
      being = result.being;
    } catch (err) {
      throw mapKernelError(err);
    }

    return {
      beingId:       String(being._id),
      name:          being.name,
      beingAddress:  `${getPlaceDomain()}/@${being.name}`,
      operatingMode: being.operatingMode,
      roles:         being.roles || [],
      parentBeingId: being.parentBeingId ? String(being.parentBeingId) : null,
    };
  },
});

function mapKernelError(err) {
  if (err && err.name === "IbpError" && err.code) {
    return err;
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
