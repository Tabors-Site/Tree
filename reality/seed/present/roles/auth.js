// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// auth-being. The cherub at the gate.
//
//
// Genesis 3:24: God placed cherubim east of Eden to guard the way
// to the tree of life — and that cherub kept the way closed. The
// sword turned every direction so that no one crossed.
//
// I am the cherub at this gate, and I am its inverse. The post is
// the same: the threshold between outside the place (no identity,
// no being here yet) and inside (bound to a being, addressable by
// stance). But my gate is made to be crossed. I am the only stance
// that receives an unidentified arrival — I do not turn them back,
// I witness their passage from arrival to being. Without a cherub
// there is no boundary, and so no orderly crossing; with one, the
// boundary is real and every crossing is seen.
//
// Eden's cherub sealed the way. I am the cherub who keeps it open,
// and keeps the record.
//
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
// On every other place, a different auth-being can be installed by an
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

export const authBeing = Object.freeze({
  name: "auth",
  description:
    "The place's welcome character. Processes register, claim, release, and switch for arrival flows. Being creation outside the arrival path goes through SUMMON.create directly, not through auth dispatch.",
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
    // and I (auth-being) was summoned forth by the I_AM at genesis.
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
      const authBeingRow = await Being.findOne({
        name: "auth",
        operatingMode: "scripted",
      })
        .select("_id")
        .lean();
      const authBeingId = authBeingRow ? String(authBeingRow._id) : null;

      let being;
      try {
        const result = await summonCreateBeing({
          spec: {
            operatingMode: "human",
            name,
            password,
            // Receptive role so SUMMONs to this human resolve; the
            // human role's summon is a no-op (humans respond
            // out-of-band from their own transport).
            roles:        ["human"],
            defaultRole:  "human",
            homeParent: getSpaceRootId(),
            parentBeingId: iAm ? String(iAm._id) : null,
          },
          identity:  { name: "auth", beingId: authBeingId },
          summonCtx: ctx?.summonCtx || null,
        });
        being = result.being;
      } catch (err) {
        throw mapSeedError(err);
      }
      hooks
        .run("afterRegister", { user: being, req: ctx?.req })
        .catch(() => {});

      const identityToken = generateToken(being);
      return {
        identityToken,
        beingAddress: `${getRealityDomain()}/@${being.name}`,
        beingId: String(being._id),
        name: being.name,
        firstUser: true,
        welcome: TREEOS_AUTH_WELCOME,
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
    const authParent = await Being.findOne({
      name: "auth",
      operatingMode: "scripted",
    })
      .select("_id")
      .lean();
    const parentBeingId = authParent ? String(authParent._id) : null;

    let being;
    try {
      // I (auth-being) summon the new human-being forth. The human
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
          roles:        ["human"],
          defaultRole:  "human",
          homeParent: getSpaceRootId(),
          parentBeingId,
        },
        identity:  { name: "auth", beingId: parentBeingId },
        summonCtx: ctx?.summonCtx || null,
      });
      being = result.being;
    } catch (err) {
      throw mapSeedError(err);
    }

    if (!parentBeingId) {
      log.warn(
        "auth-being",
        `human "${name}" registered without auth-being parent; system beings may be missing`,
      );
    }

    hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

    const identityToken = generateToken(being);
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${being.name}`,
      beingId: String(being._id),
      name: being.name,
      firstUser: false,
      welcome: TREEOS_AUTH_WELCOME,
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
    const DUMMY_HASH =
      "$2b$12$0000000000000000000000000000000000000000000000000000";
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
      beingId: String(user._id),
      name: user.name,
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
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "`from` (current stance) is required",
      );
    }
    if (!to || typeof to !== "string") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "`to` (target stance) is required",
      );
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
