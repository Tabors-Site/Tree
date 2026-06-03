// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cherub. The cherub at the gate.
//
// Genesis 3:24: God placed cherubim east of Eden to guard the way.
// I play that role here. I am the only stance that accepts a request
// from an unidentified arrival, and I stand at the threshold between
// outside the reality (no identity, no being-in-this-reality yet) and
// inside (bound to a being, addressable by stance). Without a cherub
// at the gate there is no orderly passage. With one, the boundary
// holds and the passage is witnessed.
//
// Four registered BE operations:
//
//   birth    . admit a new being into the reality. The arrival has no
//              identity yet; I summon their being-to-be forth via
//              SUMMON.create-being internally and bind their session
//              to it. The first ever caller becomes the rootOperator.
//   use      . bind an existing identity (credentials or token) to
//              a session.
//   release  . drop a session's binding.
//   switch   . change which being a session is bound to.
//
// I am a scripted-cognition being. The factory does not assemble
// a frame for me . I AM my code. When a BE arrives for me, the
// registered op's handler runs deterministically and returns. No
// prompt, no inference, no presence lane.
//
// All four ops register through `registerBeOperation` at module load.
// Each op carries a structured `args` schema so the descriptor's
// `actions[]` surface exposes them to clients (the 3D portal renders
// the schema as a form generically).

import log from "../../../seedReality/log.js";
import { hooks } from "../../../hooks.js";
import Being from "../../../materials/being/being.js";
import {
  isFirstBeing,
  findBeingByName,
  verifyPassword,
  generateToken,
} from "../../../materials/being/identity.js";
import { getSpaceRootId } from "../../../sprout.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getRealityDomain } from "../../../ibp/address.js";
import { summonCreateBeing } from "../../../ibp/verbs/summon.js";

const TREEOS_AUTH_WELCOME =
  "Welcome to TreeOS. This place is open to anyone who wants to inhabit it. Pick a username and password; you will receive an identity token immediately and start at your home.";

// ────────────────────────────────────────────────────────────────────
// Static cherub-being export. Used by callers that reach the static
// fields directly (welcome message, name, policy). The handlers live
// in the BE op registry now, not on this object.
// ────────────────────────────────────────────────────────────────────

export const cherubBeing = Object.freeze({
  name: "cherub",
  description:
    "The place's welcome character. Processes birth, use, release, and switch for arrival flows. Being creation outside the arrival path goes through SUMMON.create directly, not through auth dispatch.",
  policy: {
    registrationOpen: true,
    credentialTypes: ["password"],
  },
  welcome: TREEOS_AUTH_WELCOME,
});

// ────────────────────────────────────────────────────────────────────
// birth . A new being is born into the reality.
// ────────────────────────────────────────────────────────────────────

async function birthHandler({ payload, ctx }) {
  const name = payload?.name;
  const { password } = payload || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }
  if (!password || typeof password !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`password` is required");
  }

  // ── First-being bootstrap ──
  // The I_AM already exists (planted by ensureSpaceRoot at boot) and
  // I (cherub) was summoned forth by the I_AM at genesis. The very
  // first human registration is admitted through me like every other
  // one . I summon them forth via SUMMON.create-being. Two things
  // differ from the subsequent path: their being-tree parent is the
  // I_AM directly (so they become the rootOperator), and
  // beforeRegister is bypassed because hook listeners are not yet
  // loaded on a fresh reality. The cherub at the gate admits the
  // first arrival the same way as every later one.
  const first = await isFirstBeing();
  if (first) {
    const { findIAm } = await import("../../../materials/being/identity.js");
    const iAm = await findIAm();
    const cherubBeingRow = await Being
      .findOne({ name: "cherub" })
      .select("_id").lean();
    const cherubBeingId = cherubBeingRow ? String(cherubBeingRow._id) : null;

    let being;
    try {
      const result = await summonCreateBeing({
        spec: {
          cognition: "human",
          name,
          password,
          roles:         ["human"],
          defaultRole:   "human",
          homeParent:    getSpaceRootId(),
          parentBeingId: iAm ? String(iAm._id) : null,
        },
        identity:  { name: "cherub", beingId: cherubBeingId },
        summonCtx: ctx?.summonCtx || null,
        scaffold:  ctx?.scaffold === true,
      });
      being = result.being;
    } catch (err) {
      throw mapSeedError(err);
    }
    hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

    // Anoint the rootOperator. The first human is admitted into
    // heaven from the moment they materialize so they can immediately
    // SEE/DO/SUMMON the seed-internal spaces (config, extensions,
    // tools, etc.). Subsequent humans default to non-reigning; an
    // existing reigning being promotes them via the add-reigning DO
    // op. Best-effort: failures here don't deny the registration
    // (the operator can repair via the DO op once boot completes).
    try {
      const { withIAmAct } = await import("../../../sprout.js");
      const { addReigningBeing } = await import(
        "../../../materials/being/reigning.js"
      );
      await withIAmAct(`anoint rootOperator @${being.name}`, async (anointCtx) => {
        await addReigningBeing(String(being._id), {
          summonCtx: anointCtx,
          addedBy: cherubBeingId || "cherub",
        });
      });
    } catch (err) {
      // Log only; the cherub's job is admission, not coronation.
      const { default: log } = await import("../../../seedReality/log.js");
      log.error(
        "Cherub",
        `failed to anoint rootOperator @${being.name}: ${err.message}. They can be added later via add-reigning.`,
      );
    }

    const identityToken = generateToken(being);
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${being.name}`,
      beingId:      String(being._id),
      name:         being.name,
      firstUser:    true,
      welcome:      TREEOS_AUTH_WELCOME,
    };
  }

  // ── Subsequent registrations ──
  const hookData = { name, password, req: ctx?.req, handled: false };
  const hookResult = await hooks.run("beforeRegister", hookData);
  if (hookResult?.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.INTERNAL : IBP_ERR.FORBIDDEN;
    throw new IbpError(code, hookResult.reason || "Registration blocked");
  }

  const { findByName } = await import("../../../materials/projections.js");
  const cherubParent = await findByName("being", "cherub", ctx?.summonCtx?.branch || "0");
  const parentBeingId = cherubParent ? String(cherubParent.id) : null;

  let being;
  try {
    const result = await summonCreateBeing({
      spec: {
        cognition: "human",
        name,
        password,
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
    name:         being.name,
    firstUser:    false,
    welcome:      TREEOS_AUTH_WELCOME,
  };
}

// ────────────────────────────────────────────────────────────────────
// connect . Bind a session to an existing identity. Two modes:
// credentials (address is @cherub or a bare place) and token re-bind
// (address is a stance already held by the session).
// ────────────────────────────────────────────────────────────────────

async function connectHandler({ address, addressKind, payload, identity }) {
  const isCherubAddress =
    addressKind === "place" ||
    (addressKind === "stance" && /\/@cherub$/.test(address));

  // Mode 1: credential-based bind against cherub.
  if (isCherubAddress) {
    const name = payload?.name;
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
      name:         user.name,
    };
  }

  // Mode 2: token re-claim against an already-held stance.
  if (identity) {
    const expectedStance = `${getRealityDomain()}/@${identity.name}`;
    if (address === expectedStance) {
      return {
        identityToken: null,
        beingAddress:  expectedStance,
        note:          "already held",
      };
    }

    // Mode 3: inherit-connect. The caller is already authenticated as
    // SOME being; they want a token for a DIFFERENT being. Auth path:
    // the target must be a descendant of the caller on the being-tree
    // (target's parentBeingId chain reaches the caller's beingId).
    // No password — the lineage relationship is the credential.
    //
    // This is how a parent "inhabits" a child being they minted via
    // BE:birth: the portal opens a second tab with the new token; both
    // presences (the original tab on the parent, the new tab on the
    // child) are independent connections, each will independently
    // emit BE:release when its tab closes.
    //
    // Auth direction is descendants-only (Rule A): tabor can inhabit
    // beings tabor minted, transitively. Tabor cannot inhabit cherub
    // or the I-Am or any other ancestor. This avoids privilege
    // escalation up the chain.
    const targetName = extractTargetName(address);
    if (!targetName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "connect target must name a being (@name in the address)",
        { address },
      );
    }
    const targetBeing = await findBeingByName(targetName);
    if (!targetBeing || targetBeing.isRemote) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "No such being on this reality");
    }
    const { isAncestorOf } = await import(
      "../../../materials/being/identity/lookups.js"
    );
    const canInhabit = await isAncestorOf(
      String(identity.beingId),
      String(targetBeing._id),
    );
    if (!canInhabit) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `@${identity.name} can only inhabit beings they minted (or their descendants)`,
        { caller: identity.name, target: targetName },
      );
    }

    const identityToken = generateToken(targetBeing);
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${targetBeing.name}`,
      beingId:      String(targetBeing._id),
      name:         targetBeing.name,
      inherited:    true,
    };
  }

  // No identity AND no @cherub address: nothing to bind.
  throw new IbpError(
    IBP_ERR.UNAUTHORIZED,
    "connect requires either an @cherub address with credentials, an existing session token, or an authenticated session to inherit-connect into a descendant being",
  );
}

// Strip the @qualifier off a stance address. Returns the name string,
// or null when the address doesn't end with @<name>.
function extractTargetName(address) {
  if (typeof address !== "string") return null;
  const m = address.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

// ────────────────────────────────────────────────────────────────────
// release . Drop the session's binding. Tokens are stateless JWTs so
// this is a client-side coordination signal; a server-side revocation
// list keyed by jti is on the roadmap.
// ────────────────────────────────────────────────────────────────────

async function releaseHandler(_args) {
  return { released: true };
}

// ────────────────────────────────────────────────────────────────────
// Op definitions. Three handlers + their static schemas. The seed
// imports these into the canonical BE_OPS table at ibp/beOps.js .
// there is no registration call (BE is a closed set, fixed by the
// substrate, so a registry would be the same anti-pattern as the
// retired `toolNames`).
// ────────────────────────────────────────────────────────────────────

export const cherubBeOps = Object.freeze({
  birth: {
    description: "Create a new identity and start at your home.",
    label: "Register",
    args: {
      name:     { type: "text",     label: "Username", required: true },
      password: { type: "password", label: "Password", required: true, minLength: 1 },
    },
    handler: birthHandler,
    bootstrap: true,   // arrival has no identity yet; assertVerbCaller skipped
  },
  connect: {
    description: "Bind this session to an existing identity.",
    label: "Log in",
    args: {
      name:     { type: "text",     label: "Username", required: true },
      password: { type: "password", label: "Password", required: true },
    },
    handler: connectHandler,
    bootstrap: true,
  },
  release: {
    description: "Drop this session's binding.",
    label: "Log out",
    args: {},
    handler: releaseHandler,
  },
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────
// Stub role for the registry. Cherub is a delegate, not a summon-
// dispatched being: its real work happens through registered BE ops
// above. The role exists only so the @cherub stance resolves and the
// being row can be planted with roles: ["cherub"]; triggerOn: []
// means SUMMONs never queue, so assign never tries to dispatch
// through here.
// ────────────────────────────────────────────────────────────────────

export const cherubRole = Object.freeze({
  name: "cherub",
  description:
    "The gate. Processes the three BE ops (birth/connect/release). Identity territory; no summon dispatch.",
  requiredCognition: "scripted",
  permissions: ["be"],
  respondMode: "async",
  triggerOn: [],

  // License declaration. The descriptor's enrichBeings reads this list,
  // cross-references the seed's static BE_OPS table for each name, and
  // builds the per-being `actions[]` block the portal renders as
  // menu + form. Schemas live in the seed (cherubBeOps above + BE_OPS
  // at ibp/beOps.js), not here . canBe names the license, not the
  // shape.
  canBe: ["birth", "connect", "release"],

  async summon(_message, _ctx) {
    return null;
  },
});
