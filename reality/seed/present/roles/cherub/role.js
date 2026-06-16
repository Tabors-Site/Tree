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
//   release  . drop a session's binding. The result carries the
//              being's homeBranch as seatBranch so the transport
//              resets the session's currentBranch.
//   switch   . change THIS session's branch on the same being.
//              Per-session — does not touch other sockets of the
//              same being. Stamps an audit fact on the new branch.
//   death    . close a being's lifecycle (I_AM-only today).
//
// Branch seating: handlers never touch the socket (the moment path
// can't carry one — acts are records). Handlers that change which
// branch the session rides return `seatBranch`; the WS transport,
// the only layer that owns the socket, applies it after the moment
// seals. Stamp-then-seat: a refused stamp leaves the session's
// branch untouched.
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
  findBeingCandidatesByName,
  findHomeBranchOfBeing,
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
  // `importKey` is an optional imported identity: the exported
  // private-key PEM or its 24-word paper form. The field name matters:
  // the secret stash holds it OUT of the chain by that name (a generic
  // `key` would ride the transport-act fact raw). birthBeing turns it
  // back into the keypair so the being is born WITH that identity
  // (recovery / moving your identity onto a reality you control).
  const { password, importKey } = payload || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }
  // Password is OPTIONAL. You can only reach cherub from INSIDE the world,
  // which means you already hold a NAME — and the Name is the auth. A being's
  // password is just for SHARED inhabitation (letting another person be:connect
  // to this being); when absent, birthBeing auto-generates a credential. So
  // birth never requires a password.
  if (password !== undefined && password !== null && typeof password !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`password`, if given, must be a string");
  }

  // ── First-being bootstrap ──
  // The I_AM already exists (planted by ensureSpaceRoot at boot) and
  // I (cherub) was summoned forth by the I_AM at genesis. The very
  // first human registration is admitted through me like every other
  // one . I mint them via the BE birth pathway (birthBeing). Two things
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
        importKey,
        parentBeingId: iAm ? String(iAm._id) : null,
        cherubIdentity: { name: "cherub", beingId: cherubBeingId },
        summonCtx: ctx?.summonCtx || null,
        // The being belongs to the signed-in NAME (its trueName), not i-am.
        ownerNameId: (ctx?.nameId && String(ctx.nameId) !== "i-am") ? String(ctx.nameId) : null,
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
    // Open the signing session keyed by the being's NAME (its trueName) —
    // loadSigningKey reads the session by nameId, not being id. A fresh
    // being's trueName is its mother's (e.g. i-am), which system-signs
    // regardless; a pw-locked sovereign name unlocks via name:connect.
    {
      const { unlockSigning } = await import("../../../materials/name/signingSession.js");
      if (being.trueName) unlockSigning(String(being.trueName));
    }
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${being.name}`,
      // First-being birth: the transport seats the session's
      // currentBranch to the new being's homeBranch (which the birth
      // fact set to this moment's branch).
      seatBranch:   ctx?.summonCtx?.actorAct?.branch || null,
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
      importKey,
      parentBeingId,
      cherubIdentity: { name: "cherub", beingId: parentBeingId },
      summonCtx: ctx?.summonCtx || null,
      // The being belongs to the signed-in NAME (its trueName), not i-am.
      ownerNameId: (ctx?.nameId && String(ctx.nameId) !== "i-am") ? String(ctx.nameId) : null,
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
  // Open the signing session keyed by the being's NAME (its trueName), not
  // the being id (loadSigningKey reads the session by nameId).
  {
    const { unlockSigning } = await import("../../../materials/name/signingSession.js");
    if (being.trueName) unlockSigning(String(being.trueName));
  }
  return {
    identityToken,
    beingAddress: `${getRealityDomain()}/@${being.name}`,
    // Subsequent-user birth: the transport seats the session's
    // currentBranch to the new being's homeBranch (the moment's
    // branch). Same shape as the first-user return above.
    seatBranch:   ctx?.summonCtx?.actorAct?.branch || null,
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
    // Connect runs before the session has a branch seated, so the
    // lookup is a cross-branch identity sweep: a being born on branch
    // #7a must be findable from a fresh socket. Name uniqueness is per-branch, so
    // the same name can be different beings on different branches; the
    // password disambiguates. Candidate count is capped to bound the
    // bcrypt cost per attempt.
    const candidates = (await findBeingCandidatesByName(name)).slice(0, 5);
    let being = null;
    for (const candidate of candidates) {
      if (candidate.isRemote) continue;
      if (await verifyPassword(candidate, password)) { being = candidate; break; }
    }
    if (!being) {
      // Constant-time rejection: when nothing matched, still run one
      // bcrypt so timing doesn't disclose existence.
      const DUMMY_HASH = "$2b$12$0000000000000000000000000000000000000000000000000000";
      await verifyPassword({ password: DUMMY_HASH }, password);
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "Invalid credentials");
    }
    const identityToken = generateToken(being);
    // Password verified: open the signing session keyed by the being's NAME
    // (its trueName), not the being id (loadSigningKey reads it by nameId).
    {
      const { unlockSigning } = await import("../../../materials/name/signingSession.js");
      if (being.trueName) unlockSigning(String(being.trueName));
    }
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${being.name}`,
      beingId:      String(being._id),
      name:         being.name,
      // The branch this being owns as their present. The transport
      // (the only layer that holds the socket) seats
      // socket.currentBranch from this after the moment seals. Same
      // model for birth/connect/release/switch: BE results are the
      // only writers of socket.currentBranch.
      seatBranch:   being.homeBranch || null,
    };
  }

  // Mode "owned": a logged-in NAME drives a being it OWNS — no password.
  // Placed BEFORE the `if (identity)` block on purpose: an arrival socket is
  // NOT identity-null (the wire binds it to @arrival's beingId), so without
  // this the owned connect would fall into the descendant/father gate below
  // and be refused. The driving name is `ctx.nameId`, set ONLY from the
  // server-verified socket.nameId (the HMAC-minted JWT or a name:login) —
  // NEVER the client payload (the wire strips payload.nameId, and we read ctx,
  // not payload). Ownership = exact equality against the target being's
  // CURRENT trueName, re-read fresh from its projection at connect time (not
  // the candidate sweep's spread, which can lag a be:truename re-point). This
  // is the portal-name model: once your name is signed in you attach to your
  // own beings freely; the per-being password (Mode 1, @cherub) survives only
  // for SHARED beings you do not own.
  const ownerNameId = ctx?.nameId || null;
  if (ownerNameId && !isCherubAddress) {
    const ownedTargetName = extractTargetName(address);
    if (ownedTargetName) {
      const { loadProjection } = await import("../../../materials/projections.js");
      const candidates = (await findBeingCandidatesByName(ownedTargetName))
        .filter((c) => !c.isRemote)
        .slice(0, 5);
      for (const candidate of candidates) {
        const fresh = await loadProjection(
          "being", String(candidate._id), candidate.homeBranch || "0",
        );
        const currentTrueName = fresh?.state?.trueName ?? null;
        if (currentTrueName && String(currentTrueName) === String(ownerNameId)) {
          // The token carries the VERIFIED current trueName as its nameId, so
          // the new session's portal identity matches what we just checked.
          const identityToken = generateToken({ ...candidate, trueName: currentTrueName });
          return {
            identityToken,
            beingAddress: `${getRealityDomain()}/@${candidate.name}`,
            beingId:      String(candidate._id),
            name:         candidate.name,
            owned:        true,
            // Seat the session on the being's home branch, same as the
            // credential/inherit connects.
            seatBranch:   candidate.homeBranch || null,
          };
        }
      }
    }
    // Not owned: fall through. A shared being is reached via the @cherub
    // password path (Mode 1) or the ancestor/father path (Mode 3) below.
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
    // Cross-branch candidate sweep, same reasoning as Mode 1: the
    // target being may be born on any branch, and per-branch name
    // uniqueness means one name can be several beings. The lineage
    // (or father) relationship is the credential, so eligibility
    // picks the candidate: the first being of that name the caller
    // is actually allowed to inhabit.
    const targetCandidates = (await findBeingCandidatesByName(targetName))
      .filter((c) => !c.isRemote)
      .slice(0, 5);
    if (targetCandidates.length === 0) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "No such being on this reality");
    }
    const { isAncestorOf } = await import(
      "../../../materials/being/identity/lookups.js"
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
    let targetBeing = null;
    let canInhabit = false;
    let canInhabitAsFather = false;
    for (const candidate of targetCandidates) {
      const asAncestor = await isAncestorOf(
        String(identity.beingId),
        String(candidate._id),
      );
      let asFather = false;
      const candidateFather = candidate.qualities?.father || null;
      if (candidateFather?.reality) {
        const requesterReality = identity?.reality || getRealityDomain();
        const realityMatches = String(candidateFather.reality) === String(requesterReality);
        const isCrossReality = String(candidateFather.reality) !== String(getRealityDomain());
        if (realityMatches && isCrossReality) {
          // CROSS-REALITY father: match on the NAME (the cryptographically
          // PROVEN id — verifyEnvelopeBeingSig checked the father's own
          // envelope sig against this nameId, setting beingSigVerified), and
          // NEVER on the client-supplied beingId. Matching beingId would
          // DECOUPLE the authorized id from the proven id: a malicious peer
          // could present the victim father's PUBLIC beingId (passing a
          // beingId match) plus a valid sig over his OWN name (passing
          // beingSigVerified) and seize the vessel. So the vessel takeover
          // demands the father's own KEY over the matched name, full stop.
          if (
            candidateFather.nameId &&
            identity?.nameId &&
            String(candidateFather.nameId) === String(identity.nameId) &&
            identity?.beingSigVerified === true
          ) {
            asFather = true;
          } else {
            log.warn(
              "Cherub",
              `father-admit refused for @${targetName}: cross-reality father must match the ` +
              `stored father NAME and arrive with his own verified envelope signature ` +
              `(nameId match + beingSigVerified). Peer vouch / a beingId match is not enough.`,
            );
          }
        } else if (realityMatches) {
          // LOCAL father: authenticated by the live session; the local
          // being-tree id is the credential (no foreign key to verify).
          if (candidateFather.beingId && String(candidateFather.beingId) === String(identity.beingId)) {
            asFather = true;
          }
        }
      }
      if (asAncestor || asFather) {
        targetBeing = candidate;
        canInhabit = asAncestor;
        canInhabitAsFather = asFather;
        break;
      }
    }

    if (!targetBeing) {
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

    // SIGNER = THE INHABITOR. When the FATHER drives the mother's vessel
    // (father-admit), his acts must sign as HIM, not as the vessel's trueName
    // (the mother). So the token's nameId becomes the FATHER's name while
    // beingId/name stay the vessel's (he drives THROUGH it; the mother still
    // OWNS it and keeps the kill power). His name is: his LOCAL trueName if he
    // is a local being, else his own foreign id — which has NO local Name key,
    // so his acts seal UNSIGNED here (his home reality signs + vouches them
    // via federation later) rather than ever falling back to the mother.
    // CRITICAL: never default a foreign father to targetBeing.trueName, or a
    // cross-reality father would sign as the mother. The ancestor/inherit
    // (non-father) connect keeps the vessel's own trueName.
    let driverTrueName = targetBeing.trueName;
    if (canInhabitAsFather) {
      const { loadProjection } = await import("../../../materials/projections.js");
      const fatherSlot = await loadProjection(
        "being", String(identity.beingId), targetBeing.homeBranch || "0",
      );
      driverTrueName = fatherSlot?.state?.trueName || String(identity.beingId);
    }
    const identityToken = generateToken({ ...targetBeing, trueName: driverTrueName });
    return {
      identityToken,
      beingAddress: `${getRealityDomain()}/@${targetBeing.name}`,
      beingId:      String(targetBeing._id),
      name:         targetBeing.name,
      inherited:    true,
      // Surface father-admit on the response so the wire layer / UX
      // can render the connect lifecycle correctly (vessel-mode).
      asFather:     canInhabitAsFather,
      // Inherit-connect (or father-admit): the transport seats the
      // session's currentBranch to the target being's homeBranch,
      // same model as credentials connect.
      seatBranch:   targetBeing.homeBranch || null,
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

async function releaseHandler({ identity }) {
  // Frame reset. The session unbinds the being; the transport seats
  // the socket's currentBranch back to the being's homeBranch (the
  // branch they were birthed on, what they own as their present).
  // findHomeBranchOfBeing falls back to the default branch for
  // unknown ids and legacy rows.
  //
  // Sign-out closes the signing session: a released identity must not
  // keep an open unlock latch behind it (secondary unlock re-locks on
  // sign out, per IDENTITY.md).
  //
  // RELEASE DROPS THE BEING, NOT THE NAME. This locks only the
  // transitional being-keyed latch (lockSigning(beingId)); it must NEVER
  // clear the connection's NAME session (socket.nameId / lockSigning(nameId)
  // / nameRelease). In the portal-name model one name drives many beings
  // across tabs, so releasing one being leaves you logged in at the auth
  // floor (still your name), free to connect another owned being or birth
  // one. Logging the name out is name:logout's job alone (nameSession.js).
  if (identity?.beingId) {
    const { lockSigning } = await import("../../../materials/name/signingSession.js");
    lockSigning(String(identity.beingId));
  }
  const seatBranch = await findHomeBranchOfBeing(identity?.beingId);
  return { released: true, seatBranch };
}

// ────────────────────────────────────────────────────────────────────
// switch . Change this session's branch on the same being.
// The fifth BE op — branch-switch is identity-binding-state (which
// reel my acts ride), so it lives in BE alongside connect/release/
// birth/death.
//
// Per-session isolation: only THIS socket's currentBranch changes.
// The same being can have N concurrent sockets, each with its own
// branch; switching one doesn't touch the others. Identity is
// invariant across branches; only the per-session "which branch am
// I acting from" view differs.
//
// The handler validates and returns; it never touches the socket.
// Stamp-then-seat: beVerb stamps the be:switch audit fact on the
// NEW branch (so that branch's view of this being's biography
// records the switch-in event at T), and only after the moment
// seals does the transport seat socket.currentBranch from
// result.seatBranch. A refused stamp leaves the session's branch
// untouched. The old branch's reel naturally shows "no more acts
// after T" without an explicit terminator.
// ────────────────────────────────────────────────────────────────────

async function switchHandler({ payload, identity, summonCtx }) {
  const targetBranch = String(payload?.branch || "").trim();
  if (!targetBranch) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "be:switch requires `branch`");
  }

  const { isMain, loadBranch } = await import("../../../materials/branch/branches.js");
  if (!isMain(targetBranch)) {
    // The destination must exist and be live. The wire's pause/delete
    // gate checks the moment's branch (which handleBe points at the
    // destination for switch); these checks are the seed-level
    // authority for callers that don't come through the wire.
    const row = await loadBranch(targetBranch);
    if (!row) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `be:switch: branch "${targetBranch}" not found`);
    }
    if (row.deleted) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `be:switch: branch "${targetBranch}" is deleted`);
    }
    if (row.paused) {
      throw new IbpError(IBP_ERR.REALITY_PAUSED, `be:switch: branch "${targetBranch}" is paused`);
    }
  }

  // The caller must exist on the destination: their reel must fold to
  // a birthed state in that branch's lineage view. Without this gate
  // a being born on #1 switching to a sibling (or to a branch forked
  // before their birth) would stamp be:switch as the first fact of an
  // orphan reel — a biography with no be:birth, folding to a nameless,
  // grantless state.
  const { loadOrFold } = await import("../../../materials/projections.js");
  const destSlot = await loadOrFold("being", String(identity.beingId), targetBranch);
  if (!destSlot?.state?.name) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `be:switch: @${identity?.name || identity?.beingId} does not exist on branch ` +
        `"${targetBranch}" (born after the fork, or on a different lineage). ` +
        `A session can only be seated on a branch where the being's reel folds to a birth.`,
    );
  }
  if (destSlot.state?.qualities?.death?.time) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `be:switch: @${identity?.name || identity?.beingId} is dead on branch "${targetBranch}"`,
    );
  }

  // The pre-switch branch. On the wire path handleBe threads it in
  // the payload (the moment itself rides the DESTINATION branch, so
  // actorAct.branch is not the old branch there). In-moment
  // self-switches have no wire hint; the actor's act branch IS the
  // branch they were seated on.
  const fromBranch =
    (typeof payload?.fromBranch === "string" && payload.fromBranch) ||
    summonCtx?.actorAct?.branch ||
    null;

  return {
    switched:   true,
    fromBranch,
    toBranch:   targetBranch,
    seatBranch: targetBranch,
    beingId:    identity?.beingId || null,
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

// be:truename — hand a being to a (declared) Name: re-point its trueName.
// Inert, like deathHandler: beVerb owns the lookups (target being exists,
// target Name exists + not banished) and threads the resolved ids through
// authResult; this just returns a summary.
async function truenameHandler({ address, identity, payload }) {
  return {
    granted:  true,
    address:  address || null,
    trueName: payload?.trueName || null,
    byActor:  identity?.beingId || null,
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
    description: "Create a top-level being owned by your name (cherub is right below I_AM). You're already signed in as your name — no password needed.",
    label: "Create a top-level being",
    args: {
      name:     { type: "text",     label: "Name your being", required: true },
      password: { type: "password", label: "Password (optional — only for sharing this being)", required: false },
    },
    handler: birthHandler,
    bootstrap: true,   // arrival has no identity yet; assertVerbCaller skipped
  },
  connect: {
    description: "Connect to a being you already own (no password — your name owns it).",
    label: "Connect to one of your beings",
    args: {
      name:     { type: "text",     label: "Being name", required: true },
      password: { type: "password", label: "Password (only for a shared being you don't own)", required: false },
    },
    handler: connectHandler,
    bootstrap: true,
  },
  release: {
    description: "Stop driving this being (close it). Your name stays signed in.",
    label: "Release this being",
    args: {},
    handler: releaseHandler,
  },
  switch: {
    description: "Change this session's branch on the same being. " +
                 "Per-session — switching one socket's branch doesn't touch other sockets.",
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
  truename: {
    description: "Hand this being to a Name: set its trueName to a declared Name id. " +
                 "Anyone for now; owner-only later.",
    label: "Set true name",
    args: {
      trueName: { type: "text", label: "Target Name id", required: true },
    },
    handler: truenameHandler,
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
  importKey = null,       // optional imported identity (PEM or 24 words)
  parentBeingId,
  cherubIdentity,
  summonCtx,
  fatherBeingId = null,   // who REQUESTED the mint (arrival for register, parent for sub-births)
  ownerNameId = null,     // the connected NAME this being belongs to (its trueName); null -> mother's default (i-am)
}) {
  const { randomUUID: uuidv4 } = await import("node:crypto");
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
      ...(importKey ? { importKey } : {}),
      // OWNED BY THE CONNECTED NAME. A being cherub mints for a signed-in name
      // is that NAME's own (sovereign trueName), NOT a child of i-am. Without
      // this, a name's being defaults to the mother's trueName (i-am) — the
      // funk where the being shows as I_AM and its key-export would surface the
      // reality key. Null only for the anonymous/pre-name path (no connected
      // name), where the mother's default is correct.
      ...(ownerNameId ? { trueName: String(ownerNameId) } : {}),
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
    "The gate, right below I_AM. Processes the three BE ops (birth/connect/release) AND summon:mate — a connected name births its first TOP-LEVEL being through cherub (owned by the name). Down the chain, names reuse summon:mate on @birther / be:birth on their own beings.",
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
      description: "Birth your first being through your name — a top-level being, owned by you (cherub is right below I_AM)",
    },
  ],

  // License declaration. The descriptor's enrichBeings reads this list,
  // cross-references the seed's static BE_OPS table for each name, and
  // builds the per-being `actions[]` block the portal renders as
  // menu + form. Schemas live in the seed (cherubBeOps above + BE_OPS
  // at ibp/beOps.js), not here . canBe names the license, not the
  // shape.
  canBe: ["birth", "connect", "release"],

  // summon:mate — a connected NAME, acting through @arrival, asks cherub to
  // birth its FIRST being. Cherub is right below I_AM, so it mints TOP-LEVEL
  // beings; the child is OWNED by the summoner's name (sovereign trueName),
  // not a vessel of cherub. Down the chain the name reuses summon:mate against
  // @birther / be:birth on its own beings. (A name CAN be given beings without
  // ever using cherub; this is just the typical first-being path on land.)
  async summon(message, ctx) {
    const intent = (typeof message === "object" && message !== null)
      ? (message.intent || message.kind || null)
      : null;
    if (intent === "mate") return await handleCherubMate(message, ctx);
    return null;
  },
});

// summon:mate → cherub births the name's first TOP-LEVEL being, owned by the
// summoner's NAME (its trueName = the connected name). The name then
// be:connects to it passwordless (owned connect). Mirrors birther's
// handleMateRequest, but the child is the name's OWN (sovereign), not a vessel.
async function handleCherubMate(message, ctx) {
  const askerNameId = ctx?.askerNameId ? String(ctx.askerNameId) : null;
  if (!askerNameId || askerNameId === "i-am") {
    return ctx.failure?.("refused", "summon:mate against cherub needs a connected name — sign in your name first")
      || { kind: "failure", ok: false, shape: "refused", reason: "no name" };
  }
  const messageObj = (typeof message === "object" && message !== null) ? message : {};
  const beingName = (typeof messageObj.name === "string" && messageObj.name.trim())
    ? messageObj.name.trim()
    : null;
  if (!beingName) {
    return ctx.failure?.("refused", "give your first being a name (message.name)")
      || { kind: "failure", ok: false, shape: "refused", reason: "no being name" };
  }
  const cherubBeingId = ctx?.toBeing?._id || ctx?.toBeing?.id || null;
  if (!cherubBeingId) {
    return ctx.failure?.("internal", "cherub beingId unresolved in ctx")
      || { kind: "failure", ok: false, shape: "internal", reason: "no cherub id" };
  }
  // Top-level: at the reality root, parented under cherub (right below I_AM).
  let homeSpaceId = messageObj.homeSpaceId || null;
  if (!homeSpaceId) {
    try {
      const { findRoot } = await import("../../../materials/projections.js");
      const branch = ctx?.actorAct?.branch || "0";
      const roots = await findRoot("space", branch);
      homeSpaceId = roots?.[0]?.id || null;
    } catch { homeSpaceId = null; }
  }
  if (!homeSpaceId) {
    return ctx.failure?.("internal", "cannot resolve the reality root for the new being")
      || { kind: "failure", ok: false, shape: "internal", reason: "no home space" };
  }

  let result;
  try {
    result = await birthBeing({
      spec: {
        name: beingName,
        // SOVEREIGN: trueName = the summoner's name, so the being is the
        // name's OWN top-level being (not a vessel of cherub). Owned connect
        // (passwordless) follows from the name owning it.
        trueName: askerNameId,
        cognition: messageObj.cognition || "human",
        defaultRole: messageObj.defaultRole || "global",
        parentBeingId: cherubBeingId,
        homeId: homeSpaceId,
      },
      identity: { beingId: cherubBeingId, name: "cherub" },
      summonCtx: ctx,
    });
  } catch (err) {
    log.warn("Cherub", `summon:mate first-being birth failed: ${err.message}`);
    return ctx.failure?.("internal", `birth failed: ${err.message}`)
      || { kind: "failure", ok: false, shape: "internal", reason: err.message };
  }

  const summary = `your first being "${result?.name || beingName}" is born — ` +
    `top-level under cherub, owned by your name`;
  return ctx.act?.(summary) || {
    kind: "act", ok: true, content: summary,
    childBeingId: result?.beingId, childName: result?.name, trueName: askerNameId,
  };
}
