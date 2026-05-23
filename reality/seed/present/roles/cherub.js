// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cherub. The cherub at the gate.
//
// Genesis 3:24: God placed cherubim east of Eden to guard the way.
// I play that role here. I am the only stance that accepts a request
// from an unidentified arrival, and I stand at the threshold between
// outside the place (no identity, no being-in-this-place yet) and
// inside (bound to a being, addressable by stance). Without a cherub
// at the gate there is no orderly passage. With one, the boundary
// holds and the passage is witnessed.
//
// Four operations:
//
//   register — admit a new being into the place. The arrival has no
//              identity yet; I summon their being-to-be forth via
//              SUMMON.create-being internally and bind their session
//              to it. The first ever caller becomes the rootOperator.
//   claim    — bind an existing identity (credentials or token) to
//              a session.
//   release  — drop a session's binding.
//   switch   — change which being a session is bound to.
//
// I am a scripted-cognition being. The factory does not assemble
// a frame for me — I AM my code. When a SUMMON arrives for me, my
// summon() runs deterministically and returns. No prompt, no
// inference, no presence lane. The being-IS-its-code branch of
// the architecture.
//
// I hold no authority of my own. My one privilege is the place-root
// default for be:create-being that lets me admit arrivals. Beyond
// arrival I do nothing special; identified beings spawn their own
// children directly through SUMMON.create-being, not through me.
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
// On every other place, a different cherub can be installed by an
// extension. The contract above is what the protocol layer expects.

import log from "../../parentReality/log.js";
import { hooks } from "../../hooks.js";
import Being from "../../materials/being/being.js";
import {
  isFirstBeing,
  findBeingByName,
  verifyPassword,
  generateToken,
} from "../../materials/being/identity.js";
import { getSpaceRootId } from "../../seedRoot.js";
import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { getRealityDomain } from "../../ibp/address.js";
import { summonCreateBeing } from "../../ibp/verbs.js";

const TREEOS_AUTH_WELCOME =
  "Welcome to TreeOS. This place is open to anyone who wants to inhabit it. Pick a username and password; you will receive an identity token immediately and start at your home.";

export const cherubBeing = Object.freeze({
  name: "cherub",
  description: "The place's welcome character. Processes register, claim, release, and switch for arrival flows. Being creation outside the arrival path goes through SUMMON.create directly, not through auth dispatch.",
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
    // The I_AM already exists (planted by ensureSpaceRoot at boot)
    // and I (cherub) was summoned forth by the I_AM at genesis.
    // The very first human registration is admitted through me like
    // every other one — I summon them forth via SUMMON.create-being.
    // Two things differ from the subsequent path: their being-tree
    // parent is the I_AM directly (so they become the rootOperator),
    // and beforeRegister is bypassed because hook listeners are not
    // yet loaded on a fresh place. The cherub at the gate admits the
    // first arrival the same way as every later one.
    const first = await isFirstBeing();
    if (first) {
      const { findIAm } = await import("../../materials/being/identity.js");
      const iAm = await findIAm();
      const cherubBeingRow = await Being
        .findOne({ name: "cherub", operatingMode: "scripted" })
        .select("_id").lean();
      const cherubBeingId = cherubBeingRow ? String(cherubBeingRow._id) : null;

      let being;
      try {
        const result = await summonCreateBeing({
          spec: {
            operatingMode: "human",
            name,
            password,
            homeParent:    getSpaceRootId(),
            parentBeingId: iAm ? String(iAm._id) : null,
          },
          identity:  { name: "cherub", beingId: cherubBeingId },
          summonCtx: ctx?.summonCtx || null,
          // Genesis-time mint (plant gathered creds before any
          // moment existed): ctx.scaffold=true bypasses the
          // presentism stampId guard. Wire-side first registers
          // don't pass scaffold; they ride the cherub-as-actor
          // transport-act path which carries a real ambient
          // stampId.
          scaffold:  ctx?.scaffold === true,
        });
        being = result.being;
      } catch (err) {
        throw mapSeedError(err);
      }
      hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

      const identityToken = generateToken(being);
      return {
        identityToken,
        beingAddress: `${getRealityDomain()}/@${being.name}`,
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

    // Subsequent humans register via the cherub's flow: they
    // become being-tree children of the cherub. The cherub
    // is itself a child of the root being, so the chain walks
    // human → auth → root → null.
    const cherubParent = await Being.findOne({ name: "cherub", operatingMode: "scripted" })
      .select("_id").lean();
    const parentBeingId = cherubParent ? String(cherubParent._id) : null;

    let being;
    try {
      // I (cherub) summon the new human-being forth. The human
      // arrived as an arrival stance and asked to be registered; my
      // act is the SUMMON.create on their behalf. The new being's
      // first BE.register Fact is stamped by summonCreateBeing,
      // witnessed by me — preserving the symmetry that every being's
      // first act is its own first BE, even though I sign it.
      const result = await summonCreateBeing({
        spec: {
          operatingMode: "human",
          name,
          password,
          // The human role is the addressable contract every human
          // carries. Its summon handler is a no-op — humans respond
          // out-of-band from their own transport. Without a role,
          // SUMMONs to the new human would reject with ROLE_UNAVAILABLE.
          roles:         ["human"],
          defaultRole:   "human",
          homeParent:    getSpaceRootId(),
          parentBeingId,
        },
        identity:  { name: "cherub", beingId: parentBeingId },
        summonCtx: ctx?.summonCtx || null,
      });
      being = result.being;
    } catch (err) {
      throw mapSeedError(err);
    }

    if (!parentBeingId) {
      log.warn("cherub",
        `human "${name}" registered without cherub parent; system beings may be missing`);
    }

    hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

    const identityToken = generateToken(being);
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${being.name}`,
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
      beingAddress: `${getRealityDomain()}/@${user.name}`,
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

  // Note: there is no `createBeing` BE operation. Being creation is a
  // SUMMON act, not a BE act. Any being with permission calls SUMMON
  // against the not-yet-existing @qualifier carrying a creation spec
  // in message.content; the verb routes to summonCreateBeing. Auth-
  // being's role in creation is only the arrival flow above (humans
  // signing up via BE.register, where auth's register handler
  // internally calls summonCreateBeing on their behalf because the
  // human has no identity yet to be the summoner).
});

function mapSeedError(err) {
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
