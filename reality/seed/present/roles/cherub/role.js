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
// Five registered BE operations:
//
//   birth    . admit a new being into the reality. The arrival has no
//              identity yet; I mint their being-to-be via birthBeing
//              internally and bind their session to it. The first ever
//              caller becomes the first heaven authority.
//   connect  . bind an existing identity (credentials or token) to
//              a session.
//   release  . drop a session's binding. Resets session.currentBranch
//              to the being's homeBranch before unbinding.
//   switch   . change THIS session's branch frame on the same being.
//              Per-session — does not touch other sockets of the
//              same being. Stamps an audit fact on the new branch.
//   death    . close a being's lifecycle (I_AM-only today).
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
import { birthBeing } from "../../../materials/being/identity/birth.js";

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
  // I_AM directly (so they become the first heaven authority), and
  // beforeRegister is bypassed because hook listeners are not yet
  // loaded on a fresh reality. The cherub at the gate admits the
  // first arrival the same way as every later one.
  const first = await isFirstBeing();
  if (first) {
    const { findIAm } = await import("../../../materials/being/identity.js");
    const iAm = await findIAm();
    // Beings live in the unified projections collection; the legacy
    // `beings` Mongoose collection is empty. findByName walks the
    // projections by (type, name, branch) — the same path every other
    // by-name lookup uses post-projection-unification.
    const { findByName } = await import("../../../materials/projections.js");
    const cherubSlot = await findByName("being", "cherub", "0");
    const cherubBeingId = cherubSlot ? String(cherubSlot.id) : null;

    let being;
    try {
      being = await _registerHumanWithFreshHome({
        name,
        password,
        parentBeingId: iAm ? String(iAm._id) : null,
        cherubIdentity: { name: "cherub", beingId: cherubBeingId },
        summonCtx: ctx?.summonCtx || null,
      });
    } catch (err) {
      throw mapSeedError(err);
    }
    hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

    // Anoint as a heaven angel. The first human gets the angel ROLE
    // granted at heaven, so they can immediately SEE/DO/SUMMON the
    // seed-internal spaces (config, extensions, tools, etc.) under
    // the angel role's canX. Under RolesAreAuth, authority is
    // delegated via grant-role; the I-Am holds angel + can grant it
    // (canDo: grant-role:*) so the grant chain is honest. Subsequent
    // humans default to NOT-angels and an existing angel can grant
    // them angel later via the same op.
    //
    // Timing: must run AFTER cherub's compound act seals. The new
    // being's `be:birth` fact is still pending in cherub's
    // summonCtx.deltaF; opening a separate `withIAmAct` here from a
    // pre-seal moment can't see the not-yet-sealed being.
    // summonCtx.afterSeal queues for post-commit when the being's
    // projection has materialized.
    const beingName = being.name;
    const newBeingId = String(being._id);
    if (ctx?.summonCtx?.afterSeal) {
      ctx.summonCtx.afterSeal.push(async () => {
        try {
          const { withIAmAct } = await import("../../../sprout.js");
          const { findByHeavenSpace } = await import("../../../materials/projections.js");
          const { HEAVEN_SPACE } = await import("../../../materials/space/heavenSpaces.js");
          const { doVerb } = await import("../../../ibp/verbs/do.js");
          const { I_AM } = await import("../../../materials/being/seedBeings.js");
          const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
          if (heaven) {
            await withIAmAct(`I grant angel to @${beingName} at heaven`, async (anointCtx) => {
              await doVerb(
                { kind: "being", id: newBeingId },
                "grant-role",
                {
                  role:          "angel",
                  anchorSpaceId: String(heaven.id),
                  anchorBeingId: null,
                },
                { identity: { beingId: I_AM, name: "I-Am" }, summonCtx: anointCtx },
              );
            });
          }
        } catch (err) {
          const { default: log } = await import("../../../seedReality/log.js");
          log.error(
            "Cherub",
            `failed to grant angel to @${beingName} at heaven: ${err.message}. ` +
            `Grant later as an existing angel: do(@<theBeing>, "grant-role", { role: "angel", anchorSpaceId: "<heavenId>" })`,
          );
        }
      });
    }

    const identityToken = generateToken(being);
    // First-being birth — seat the session frame to the new being's
    // homeBranch (which the birth fact set to this moment's branch).
    if (ctx?.socket && ctx.summonCtx?.actorAct?.branch) {
      ctx.socket.currentBranch = ctx.summonCtx.actorAct.branch;
    }
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${being.name}`,
      // The new being is placed inside this home space (with a coord).
      // Surface it so the portal can land the camera at home directly,
      // without waiting for the post-seal projection fold to expose
      // identity.position/homeSpace (that race is why a freshly-
      // registered being used to spawn at the reality root).
      homeSpaceId:  being.homeSpace ? String(being.homeSpace) : null,
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
  const cherubParent = await findByName("being", "cherub", ctx?.summonCtx?.actorAct?.branch || "0");
  const parentBeingId = cherubParent ? String(cherubParent.id) : null;

  let being;
  try {
    being = await _registerHumanWithFreshHome({
      name,
      password,
      parentBeingId,
      cherubIdentity: { name: "cherub", beingId: parentBeingId },
      summonCtx: ctx?.summonCtx || null,
    });
  } catch (err) {
    throw mapSeedError(err);
  }

  if (!parentBeingId) {
    log.warn("cherub",
      `human "${name}" registered without cherub parent; system beings may be missing`);
  }

  hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

  const identityToken = generateToken(being);
  // Subsequent-user birth — seat the session frame to the new being's
  // homeBranch (the moment's branch). Same shape as the first-user
  // branch above.
  if (ctx?.socket && ctx.summonCtx?.actorAct?.branch) {
    ctx.socket.currentBranch = ctx.summonCtx.actorAct.branch;
  }
  return {
    identityToken,
    beingAddress: `${getRealityDomain()}/@${being.name}`,
    // See first-user branch above: lets the portal land at home directly
    // and dodge the post-seal projection-fold race.
    homeSpaceId:  being.homeSpace ? String(being.homeSpace) : null,
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

async function connectHandler({ address, addressKind, payload, identity, ctx }) {
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
    // Seat the session frame to this being's homeBranch — the branch
    // they own as their present. Same model for birth/connect/release/
    // switch: BE ops are the only paths that touch socket.currentBranch.
    if (ctx?.socket) {
      ctx.socket.currentBranch = await _readBeingHomeBranch(String(user._id));
    }
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

    // Father-admit (cross-world citizenship). When the target is a
    // vessel-child commissioned via summon:mate, its qualities.father
    // names the being that became father at birth. That being holds
    // BE:connect eligibility into this vessel — the whole point of
    // the mate-vessel pattern. Father-admit fires when the requester
    // matches the stored father tuple.
    //
    // Local-reality fathers: identity.reality (if set) or the local
    // domain must match qualities.father.reality. Cross-reality
    // fathers: identity.reality comes from req.canopySender via the
    // wire layer's actorTupleFromRequest — same trusted ground truth
    // that lives in the wire-side carrier.crossWorldActor.
    let canInhabitAsFather = false;
    const targetFather = targetBeing.qualities?.father || null;
    if (targetFather?.beingId && targetFather?.reality) {
      const requesterReality = identity?.reality || getRealityDomain();
      if (
        String(targetFather.beingId) === String(identity.beingId) &&
        String(targetFather.reality) === String(requesterReality)
      ) {
        canInhabitAsFather = true;
      }
    }

    if (!canInhabit && !canInhabitAsFather) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `@${identity.name} can only inhabit beings they birthed (or descendants). ` +
          `You must be the mother or father.`,
        { caller: identity.name, target: targetName },
      );
    }

    // Single-connector invariant with father-priority. When a vessel
    // is already inhabited (qualities.connection.inhabitedBy set), the
    // father connecting AS THE FATHER displaces the existing connector
    // (typically the mother, but any current connector). This is the
    // whole point of the mate-vessel pattern — the foreign actor takes
    // over the vessel to act through it. The rule applies even when
    // the father is locally homed; father-priority is the natural rule.
    //
    // Mother-side connects use the ancestor-descendant path and don't
    // displace an existing father. The father-vs-mother arbitration
    // is asymmetric: father always wins if eligible, regardless of
    // who's currently connected.
    //
    // Displacement stamps a be:release fact on the vessel before the
    // be:connect lands so the projection's inhabitedBy reflects the
    // latest state cleanly. See seed/CROSS-WORLD.md + FEDERATION.md.
    if (canInhabitAsFather) {
      const currentInhabitor =
        targetBeing.qualities?.connection?.inhabitedBy || null;
      if (currentInhabitor && String(currentInhabitor) !== String(identity.beingId)) {
        try {
          const { emitFact } = await import("../../../past/fact/facts.js");
          const summonCtx = ctx?.summonCtx || null;
          await emitFact(
            {
              verb:    "be",
              action:  "release",
              beingId: String(currentInhabitor),
              target:  { kind: "being", id: String(targetBeing._id) },
              params:  {
                releasedBy: "father-priority",
                fatherBeingId: String(identity.beingId),
                fatherReality: targetBeing.qualities.father?.reality || getRealityDomain(),
              },
              actId:   summonCtx?.actId || null,
              branch:  summonCtx?.actorAct?.branch || "0",
            },
            summonCtx,
          );
        } catch (err) {
          log.warn(
            "Cherub",
            `father-priority displacement release failed for vessel @${targetBeing.name}: ${err.message}. Proceeding with connect; the projection may briefly show both inhabitors until the next be:release lands.`,
          );
        }
      }
    }

    const identityToken = generateToken(targetBeing);
    // Inherit-connect (or father-admit): seat the session frame to the
    // target being's homeBranch — same model as credentials connect.
    if (ctx?.socket) {
      ctx.socket.currentBranch = await _readBeingHomeBranch(String(targetBeing._id));
    }
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${targetBeing.name}`,
      beingId:      String(targetBeing._id),
      name:         targetBeing.name,
      inherited:    true,
      // Surface father-admit on the response so the wire layer / UX
      // can render the connect lifecycle correctly (vessel-mode).
      asFather:     canInhabitAsFather,
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

async function releaseHandler({ ctx, identity }) {
  // Frame reset. Session unbinds the being; before doing so reset the
  // socket's currentBranch to the being's homeBranch (the branch they
  // were birthed on — what they own as their present). Falls back to
  // "0" only when the being row has no homeBranch (legacy data).
  if (ctx?.socket) {
    const home = await _readBeingHomeBranch(identity?.beingId);
    ctx.socket.currentBranch = home;
  }
  return { released: true };
}

async function _readBeingHomeBranch(beingId) {
  if (!beingId) return "0";
  const { loadOrFold } = await import("../../../materials/projections.js");
  const slot = await loadOrFold("being", String(beingId), "0");
  return slot?.state?.homeBranch || "0";
}

// ────────────────────────────────────────────────────────────────────
// switch . Change this session's branch frame on the same being.
// The fifth BE op — branch-switch is identity-binding-state (which
// reel my acts ride), so it lives in BE alongside connect/release/
// birth/death.
//
// Per-session isolation: mutates ONLY this socket's currentBranch.
// The same being can have N concurrent sockets, each with its own
// frame; switching one doesn't touch the others. The same Being row
// is shared (identity is invariant across branches); only the
// per-session "which branch am I acting from" view differs.
//
// Audit fact: stamped on the actor's reel on the NEW branch (so
// that branch's view of this being's biography records the switch-in
// event at T). The old branch's reel naturally shows "no more acts
// after T" without an explicit terminator.
// ────────────────────────────────────────────────────────────────────

async function switchHandler({ payload, identity, ctx }) {
  const targetBranch = String(payload?.branch || "").trim();
  if (!targetBranch) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "be:switch requires `branch`");
  }
  // Validate the target branch exists. "0" (main) is always valid;
  // other paths must have a Branch row.
  if (targetBranch !== "0") {
    const { default: Branch } = await import("../../../materials/branch/branch.js");
    const exists = await Branch.findById(targetBranch).select("_id").lean();
    if (!exists) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `be:switch: branch "${targetBranch}" not found`);
    }
  }
  const fromBranch = ctx?.socket?.currentBranch || "0";
  if (ctx?.socket) ctx.socket.currentBranch = targetBranch;
  return {
    switched: true,
    fromBranch,
    toBranch:  targetBranch,
    beingId:   identity?.beingId || null,
  };
}

// ────────────────────────────────────────────────────────────────────
// death . The being's final act. Locks the act-chain; no new BE ops
// will be accepted on this being, summons refuse, role grants refuse.
// Past acts + past grants remain valid (facts at the time stand).
// See seed/done/DualBeingParents — "WORRY ABOUT LAST."
//
// The handler returns the closing summary; beVerb's dispatch path
// (death branch in be.js) stamps the be:death fact on the dying
// being's reel. The reducer's applyDeath in reducerHelpers.js
// projects qualities.death = { time, byActor }.
//
// Authority gate: today only I_AM may perform be:death. The authorize
// step in beVerb's dispatch routes through the role-walk which
// short-circuits true for I_AM and refuses everyone else (no role
// today declares canBe:["death"]). Future doctrine may extend the
// authority list (mother + governance roles); for now, I_AM only.
// ────────────────────────────────────────────────────────────────────

async function deathHandler({ address, identity }) {
  return {
    closed:  true,
    address: address || null,
    byActor: identity?.beingId || null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Op definitions. Five handlers + their static schemas. The seed
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
  switch: {
    description: "Change this session's branch frame on the same being. " +
                 "Per-session — switching one socket's frame doesn't touch other sockets.",
    label: "Switch branch",
    args: {
      branch: { type: "text", label: "Target branch path", required: true },
    },
    handler: switchHandler,
  },
  death: {
    description: "Close this being's lifecycle. One-way; the chain locks. " +
                 "Past acts + grants remain valid. Today I_AM only.",
    label: "Close being",
    args: {},
    handler: deathHandler,
  },
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Register a human: create their fresh home space under the place
 * root, birth the being into it, set the new being as the home's
 * owner. Three facts (do:create-space, be:birth, do:set-space)
 * all ride the same `summonCtx.deltaF` so they seal atomically.
 *
 * Inlined from the retired `createBeingWithHome` orchestrator —
 * cherub is the only register flow that needs the "fresh child
 * home" pattern, so the steps live where they're used rather than
 * hiding inside the birth primitive.
 *
 * Returns the new being row (pending view during seal).
 */
async function _registerHumanWithFreshHome({
  name,
  password,
  parentBeingId,
  cherubIdentity,
  summonCtx,
  fatherBeingId = null,   // who REQUESTED the mint (arrival for register, parent for sub-births)
}) {
  const { v4: uuidv4 } = await import("uuid");
  const { emitFact } = await import("../../../past/fact/facts.js");
  const { I_AM } = await import("../../../materials/being/seedBeings.js");

  // ── 1. Create the home space ──
  // Human homes are 100×100 grid bounded territories under the place
  // root. The home's owner class lands in step 3 (after the being
  // exists to reference); step 1 stamps the space with no owner.
  const homeId = uuidv4();
  const placeRootId = getSpaceRootId();
  const actorId = cherubIdentity?.beingId || I_AM;
  await emitFact({
    verb:   "do",
    action: "create-space",
    beingId: String(actorId),
    target: { kind: "space", id: homeId },
    params: {
      name,                           // home space is named for the user
      type: "home-territory",
      parent: String(placeRootId),
      // members.owner gets set in step 3 (the new being doesn't
      // exist yet; can't reference them here).
      size: { x: 100, y: 100 },
      qualities: {},
    },
    actId:  summonCtx?.actId || null,
    branch: summonCtx?.actorAct?.branch || "0",
  }, summonCtx);

  // ── 2. Birth the being into the new home ──
  const result = await birthBeing({
    spec: {
      cognition:     "human",
      name,
      password,
      defaultRole:   "human",
      homeId:        String(homeId),
      parentBeingId: parentBeingId ? String(parentBeingId) : null,
      // birthHere stays false (default): the being appears at their
      // own home, which is what registration semantically means.
    },
    identity:  cherubIdentity,
    summonCtx,
  });

  // ── 3. Set the new being as owner of the home ──
  // The home is a tree root they own. Stamped as I_AM because cherub
  // already authorized the whole compound act; doing it under the new
  // being's identity faces a chicken-and-egg with stance auth (they're
  // becoming the owner; auth needs them to already be one).
  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "space", id: homeId },
    "set-space",
    { field: "owner", value: String(result.beingId) },
    { identity: I_AM, summonCtx },
  );

  // ── 4. Anoint the new human with the human role ──
  // Roles-Are-Auth bootstrap (seed/RolesAreAuth.md). The new being
  // already holds `global` via _anointGlobal in birth.js (every being
  // gets global at the reality root, universal single-gate doctrine).
  // Here cherub adds the registration-specific role:
  //   - human: the "root founder" canX (do whatever you want here)
  // Anchored at the place root with reality-wide reach via descendants.
  // Cherub holds canDo:grant-role:human (declared in cherubRole.canDo)
  // so authorize permits this emit. grantedBy is cherub for forensics.
  await doVerb(
    { kind: "being", id: String(result.beingId) },
    "grant-role",
    {
      role:          "human",
      anchorSpaceId: String(placeRootId),
      anchorBeingId: null,
    },
    { identity: cherubIdentity, summonCtx },
  );

  // ── 5. Record lineage (mother + father). ──
  // Cherub is the MOTHER — the being who did the minting work.
  // The FATHER is whoever requested the mint:
  //   - Anonymous registration → arrival (the shared visitor being)
  //   - Authenticated be:birth via cherub → the requesting parent
  // Recorded as qualities.lineage on the new being so the chain of
  // who-birthed-who is forensic-traceable. Doesn't gate anything;
  // pure record-keeping. The being-tree `parentBeingId` field stays
  // for hierarchical lookups (descendants walks); lineage is the
  // social-history shape.
  const motherBeingId = cherubIdentity?.beingId
    ? String(cherubIdentity.beingId)
    : null;
  let resolvedFatherId = fatherBeingId ? String(fatherBeingId) : null;
  if (!resolvedFatherId) {
    // Default to arrival when no explicit requester (the cherub register
    // path with no parent context — first-being bootstrap, etc.).
    try {
      const { findByName } = await import("../../../materials/projections.js");
      const arrivalSlot = await findByName("being", "arrival", "0");
      resolvedFatherId = arrivalSlot ? String(arrivalSlot.id) : null;
    } catch { resolvedFatherId = null; }
  }
  await doVerb(
    { kind: "being", id: String(result.beingId) },
    "set-being",
    {
      field: "qualities.lineage",
      value: { mother: motherBeingId, father: resolvedFatherId },
      merge: false,
    },
    { identity: I_AM, summonCtx },
  );

  return result.being;
}

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
  // Seed delegate role — hosted on the reality root. The cherub being
  // gets this role granted at boot by the I-Am. canDo includes
  // grant-role:human + grant-role:global so cherub can anoint new
  // humans on registration. Cherub is the only grantor of the human
  // and global roles in a default reality.
  requiredCognition: "scripted",
  respondMode: "async",
  triggerOn: [],

  // DO actions cherub can perform. The registration flow needs to
  // emit grant-role facts on the freshly-birthed human (giving them
  // global + human at the place root). canDo:["grant-role:<role>"]
  // is the canX entry that lets authorize permit those grants.
  canDo: [
    { action: "grant-role:human",  description: "anoint a new human at the place root" },
    { action: "grant-role:global", description: "give the baseline role to a new human" },
  ],

  // canSummon participation. `as: "receiver"` declares this role
  // ACCEPTS summon:mate from anonymous arrivals (the registration
  // flow): summon @cherub:mate → cherub mints a new being with the
  // visitor's chosen credentials, grants global + human at the place
  // root, and binds the session. The summoner RECEIVES the new being.
  // Mirrors birther's same shape; FEDERATION.md for the federation
  // counterpart.
  canSummon: [
    {
      intent: "mate",
      as: "receiver",
      description: "Accepts arrival's registration request; mints a new human being and binds the session",
    },
  ],

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
