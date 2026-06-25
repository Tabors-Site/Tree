// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cherub. The cherub at the gate.
//
// Genesis 3:24: God placed cherubim east of Eden to guard the way.
// I play that able here. I am the only stance that accepts a request
// from an unidentified arrival, and I stand at the threshold between
// outside the story (no identity, no being-in-this-story yet) and
// inside (bound to a being, addressable by stance). Without a cherub
// at the gate there is no orderly passage. With one, the boundary
// holds and the passage is witnessed.
//
// Five registered BE operations:
//
//   birth    . admit a new being into the story. The arrival has no
//              identity yet; I mint their being-to-be via birthBeing
//              internally and bind their session to it. The first ever
//              caller becomes the first heaven authority.
//   connect  . bind an existing identity (credentials or token) to
//              a session.
//   release  . drop a session's binding. The result carries the
//              being's homeHistory as seatHistory so the transport
//              resets the session's currentHistory.
//   switch   . change THIS session's history on the same being.
//              Per-session — does not touch other sockets of the
//              same being. Stamps an audit fact on the new history.
//   death    . close a being's lifecycle (I-only today).
//
// History seating: handlers never touch the socket (the moment path
// can't carry one — acts are records). Handlers that change which
// history the session rides return `seatHistory`; the WS transport,
// the only layer that owns the socket, applies it after the moment
// seals. Stamp-then-seat: a refused stamp leaves the session's
// history untouched.
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

import log from "../../../seedStory/log.js";
import { hooks } from "../../../hooks.js";
import {
  isFirstBeing,
  findBeingCandidatesByName,
  findHomeHistoryOfBeing,
  verifyPassword,
  generateToken,
} from "../../../materials/being/identity.js";
import { getSpaceRootId } from "../../../sprout.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getStoryDomain } from "../../../ibp/address.js";
import { birthBeing } from "../../../materials/being/identity/birth.js";
import { hashPassword } from "../../../materials/being/identity/credentials.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";

// Cherub is now a store-word bundle: self-register its co-located `.word` slices
// (CONVERTING.md / the credentialOps pattern) at module load — BEFORE genesis, so
// the sync resolveAbleWord finds the world strand the moment this file imports.
// This replaces the engine's last hardcoded built-in REGISTRY entries (the engine
// is now WORDLESS; every word self-registers via registerAbleWord).
registerAbleWord("cherub", "birth", new URL("./cherub.word", import.meta.url));
registerAbleWord(
  "cherub",
  "connect",
  new URL("./cherub-connect.word", import.meta.url),
);
// be:truename's world strand — the rung-3 verb-op worked example. The .word
// reproduces the gate ordering + builds the fact params (truenameHost.js wires the
// four floor see-ops); the BE dispatcher stamps the one fact from its factParams.
registerAbleWord(
  "cherub",
  "truename",
  new URL("./truename.word", import.meta.url),
);
// be:death's world strand — the rung-3 verb-op #2 (a pure fact-lay; the kill authority is the
// verb-level authorize() in be.js). The .word owns the op gates + builds the fact params.
registerAbleWord("cherub", "death", new URL("./death.word", import.meta.url));
// be:release's world strand — the rung-3 verb-op #3 (the first fact-vs-session split: the .word
// authors the be:release FACT; the handler keeps the HOST session effects — lockSigning + seatHistory).
registerAbleWord(
  "cherub",
  "release",
  new URL("./release.word", import.meta.url),
);
// be:switch's world strand — verb-op #4 (the CROSS-HISTORY fact: the .word authors be:switch on the
// destination history; the transport seats socket.currentHistory from seatHistory after the seal).
registerAbleWord("cherub", "switch", new URL("./switch.word", import.meta.url));

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
// birth . A new being is born into the story.
// ────────────────────────────────────────────────────────────────────

async function birthHandler({ payload, ctx }) {
  const name = payload?.name;
  // `importKey` is an optional imported identity: the exported
  // private-key PEM or its 24-word paper form. The field name matters:
  // the secret stash holds it OUT of the chain by that name (a generic
  // `key` would ride the transport-act fact raw). birthBeing turns it
  // back into the keypair so the being is born WITH that identity
  // (recovery / moving your identity onto a story you control).
  const { password, importKey } = payload || {};
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`name` is required");
  }
  // Password is OPTIONAL. You can only reach cherub from INSIDE the world,
  // which means you already hold a NAME — and the Name is the auth. A being's
  // password is just for SHARED inhabitation (letting another person be:connect
  // to this being); when absent, birthBeing auto-generates a credential. So
  // birth never requires a password.
  if (
    password !== undefined &&
    password !== null &&
    typeof password !== "string"
  ) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "`password`, if given, must be a string",
    );
  }

  // ── First-being bootstrap ──
  // The I already exists (planted by ensureSpaceRoot at boot) and
  // I (cherub) was summoned forth by the I at genesis. The very
  // first human registration is admitted through me like every other
  // one . I mint them via the BE birth pathway (birthBeing). Two things
  // differ from the subsequent path: their being-tree parent is the
  // I directly (so they become the first heaven authority), and
  // beforeRegister is bypassed because hook listeners are not yet
  // loaded on a fresh story. The cherub at the gate admits the
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
        moment: ctx?.moment || null,
        // The being belongs to the signed-in NAME (its trueName), not i-am.
        ownerNameId:
          ctx?.nameId && String(ctx.nameId) !== "i-am"
            ? String(ctx.nameId)
            : null,
      });
    } catch (err) {
      throw mapSeedError(err);
    }
    hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

    // Anoint as a heaven angel. The first human gets the angel ABLE
    // granted at heaven, so they can immediately SEE/DO/SUMMON the
    // seed-internal spaces (config, extensions, tools, etc.) under
    // the angel able's canX. Under AblesAreAuth, authority is
    // delegated via grant-able; the I-Am holds angel + can grant it
    // (canDo: grant-able:*) so the grant chain is honest. Subsequent
    // humans default to NOT-angels and an existing angel can grant
    // them angel later via the same op.
    //
    // Timing: must run AFTER cherub's compound act seals. The new
    // being's `be:birth` fact is still pending in cherub's
    // moment.deltaF; opening a separate `withIAmAct` here from a
    // pre-seal moment can't see the not-yet-sealed being.
    // moment.afterSeal queues for post-commit when the being's
    // projection has materialized.
    const beingName = being.name;
    const newBeingId = String(being._id);
    if (ctx?.moment?.afterSeal) {
      ctx.moment.afterSeal.push(async () => {
        try {
          const { withIAmAct } = await import("../../../sprout.js");
          const { findByHeavenSpace } =
            await import("../../../materials/projections.js");
          const { HEAVEN_SPACE } =
            await import("../../../materials/space/heavenSpaces.js");
          const { doVerb } = await import("../../../ibp/verbs/do.js");
          const { I } = await import("../../../materials/being/seedBeings.js");
          const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
          if (heaven) {
            await withIAmAct(
              `I grant angel to @${beingName} at heaven`,
              async (anointCtx) => {
                await doVerb(
                  { kind: "being", id: newBeingId },
                  "grant-able",
                  {
                    able: "angel",
                    anchorSpaceId: String(heaven.id),
                    anchorBeingId: null,
                  },
                  {
                    identity: { beingId: I, name: "I-Am" },
                    moment: anointCtx,
                  },
                );
              },
            );
          }
        } catch (err) {
          const { default: log } = await import("../../../seedStory/log.js");
          log.error(
            "Cherub",
            `failed to grant angel to @${beingName} at heaven: ${err.message}. ` +
              `Grant later as an existing angel: do(@<theBeing>, "grant-able", { able: "angel", anchorSpaceId: "<heavenId>" })`,
          );
        }
      });
    }

    const identityToken = await generateToken(being);
    // Open the signing session keyed by the being's NAME (its trueName) —
    // loadSigningKey reads the session by nameId, not being id. A fresh
    // being's trueName is its mother's (e.g. i-am), which system-signs
    // regardless; a pw-locked sovereign name unlocks via name:connect.
    {
      const { unlockSigning } =
        await import("../../../materials/name/signingSession.js");
      if (being.trueName) unlockSigning(String(being.trueName));
    }
    return {
      identityToken,
      beingAddress: `${getStoryDomain()}/@${being.name}`,
      // First-being birth: the transport seats the session's
      // currentHistory to the new being's homeHistory (which the birth
      // fact set to this moment's history).
      seatHistory: ctx?.moment?.actorAct?.history || null,
      // The new being is placed inside this home space (with a coord).
      // Surface it so the portal can land the camera at home directly,
      // without waiting for the post-seal projection fold to expose
      // identity.position/homeSpace (that race is why a freshly-
      // registered being used to spawn at the story root).
      homeSpaceId: being.homeSpace ? String(being.homeSpace) : null,
      beingId: String(being._id),
      name: being.name,
      firstUser: true,
      welcome: TREEOS_AUTH_WELCOME,
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
  const history = ctx?.moment?.actorAct?.history || "0";
  const cherubParent = await findByName("being", "cherub", history);
  const parentBeingId = cherubParent ? String(cherubParent.id) : null;
  // The being belongs to the signed-in NAME (its trueName), not i-am.
  const ownerNameId =
    ctx?.nameId && String(ctx.nameId) !== "i-am" ? String(ctx.nameId) : null;

  let being;
  try {
    // THE CONVERSION (2.md Phase 4): cherub:birth's world-sequencing is now
    // cherub.word, run through the bridge. The JS `_registerHumanWithFreshHome`
    // stays as the fallback (a clean miss only — see _birthViaWordOrJs); the
    // session strand below reads `being` either way, so the cut is a swap.
    being = await _birthViaWordOrJs({
      name,
      password,
      importKey,
      parentBeingId,
      ownerNameId,
      history,
      moment: ctx?.moment || null,
    });
  } catch (err) {
    throw mapSeedError(err);
  }

  if (!parentBeingId) {
    log.warn(
      "cherub",
      `human "${name}" registered without cherub parent; system beings may be missing`,
    );
  }

  hooks.run("afterRegister", { user: being, req: ctx?.req }).catch(() => {});

  const identityToken = await generateToken(being);
  // Open the signing session keyed by the being's NAME (its trueName), not
  // the being id (loadSigningKey reads the session by nameId).
  {
    const { unlockSigning } =
      await import("../../../materials/name/signingSession.js");
    if (being.trueName) unlockSigning(String(being.trueName));
  }
  return {
    identityToken,
    beingAddress: `${getStoryDomain()}/@${being.name}`,
    // Subsequent-user birth: the transport seats the session's
    // currentHistory to the new being's homeHistory (the moment's
    // history). Same shape as the first-user return above.
    seatHistory: ctx?.moment?.actorAct?.history || null,
    // See first-user branch above: lets the portal land at home directly
    // and dodge the post-seal projection-fold race.
    homeSpaceId: being.homeSpace ? String(being.homeSpace) : null,
    beingId: String(being._id),
    name: being.name,
    firstUser: false,
    welcome: TREEOS_AUTH_WELCOME,
  };
}

// ────────────────────────────────────────────────────────────────────
// connect . Bind a session to an existing identity. Two modes:
// credentials (address is @cherub or a bare place) and token re-bind
// (address is a stance already held by the session).
// ────────────────────────────────────────────────────────────────────

async function connectHandler({
  address,
  addressKind,
  payload,
  identity,
  ctx,
}) {
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

    // THE CONVERSION (2.md Phase 4): the Mode-1 credential search/verify/seat is now
    // cherub-connect.word, run through the bridge (the CONTROL strand is `.word`; the
    // session ops are `host:` escapes). The JS body below stays as the clean-miss
    // fallback. Behavior-preserving — a refusal replicates the JS dummy-verify exactly.
    const viaWord = await _connectViaWordOrJs({
      name,
      password,
      moment: ctx?.moment,
    });
    if (viaWord) return viaWord;

    // Connect runs before the session has a history seated, so the
    // lookup is a cross-history identity sweep: a being born on history
    // #7a must be findable from a fresh socket. Name uniqueness is per-history, so
    // the same name can be different beings on different histories; the
    // password disambiguates. Candidate count is capped to bound the
    // bcrypt cost per attempt.
    const candidates = (await findBeingCandidatesByName(name)).slice(0, 5);
    let being = null;
    for (const candidate of candidates) {
      if (candidate.isRemote) continue;
      if (await verifyPassword(candidate, password)) {
        being = candidate;
        break;
      }
    }
    if (!being) {
      // Constant-time rejection: when nothing matched, still run one REAL scrypt verify
      // so timing doesn't disclose name existence (the username-enumeration oracle).
      await _constantTimeReject(password);
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "Invalid credentials");
    }
    const identityToken = await generateToken(being);
    // Password verified: open the signing session keyed by the being's NAME
    // (its trueName), not the being id (loadSigningKey reads it by nameId).
    {
      const { unlockSigning } =
        await import("../../../materials/name/signingSession.js");
      if (being.trueName) unlockSigning(String(being.trueName));
    }
    return {
      identityToken,
      beingAddress: `${getStoryDomain()}/@${being.name}`,
      beingId: String(being._id),
      name: being.name,
      // The history this being owns as their present. The transport
      // (the only layer that holds the socket) seats
      // socket.currentHistory from this after the moment seals. Same
      // model for birth/connect/release/switch: BE results are the
      // only writers of socket.currentHistory.
      seatHistory: being.homeHistory || null,
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
    // THE CONVERSION: the owned-connect is cherub-connect.word flow 2. Owned → return;
    // not owned → null → fall through (Mode-2/Mode-3). The JS loop below is the fallback.
    const viaWord = await _connectOwnedViaWord({
      address,
      callerNameId: ownerNameId,
      moment: ctx?.moment,
    });
    if (viaWord) return viaWord;
    const ownedTargetName = extractTargetName(address);
    if (ownedTargetName) {
      const { loadProjection } =
        await import("../../../materials/projections.js");
      const candidates = (await findBeingCandidatesByName(ownedTargetName))
        .filter((c) => !c.isRemote)
        .slice(0, 5);
      for (const candidate of candidates) {
        const fresh = await loadProjection(
          "being",
          String(candidate._id),
          candidate.homeHistory || "0",
        );
        const currentTrueName = fresh?.state?.trueName ?? null;
        if (
          currentTrueName &&
          String(currentTrueName) === String(ownerNameId)
        ) {
          // The token carries the VERIFIED current trueName as its nameId, so
          // the new session's portal identity matches what we just checked.
          const identityToken = await generateToken({
            ...candidate,
            trueName: currentTrueName,
          });
          return {
            identityToken,
            beingAddress: `${getStoryDomain()}/@${candidate.name}`,
            beingId: String(candidate._id),
            name: candidate.name,
            owned: true,
            // Seat the session on the being's home history, same as the
            // credential/inherit connects.
            seatHistory: candidate.homeHistory || null,
          };
        }
      }
    }
    // Not owned: fall through. A shared being is reached via the @cherub
    // password path (Mode 1) or the ancestor/father path (Mode 3) below.
  }

  // Mode 2: token re-claim against an already-held stance.
  if (identity) {
    const expectedStance = `${getStoryDomain()}/@${identity.name}`;
    if (address === expectedStance) {
      return {
        identityToken: null,
        beingAddress: expectedStance,
        note: "already held",
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
    //
    // THE CONVERSION: inherit-connect / father-admit is cherub-connect.word flow 3. The
    // .word is authoritative (it returns the response or its refusal becomes the IbpError);
    // the JS Mode-3 below is the clean-miss fallback (resolveAbleWord null).
    const viaWord = await _connectInheritViaWord({
      address,
      identity,
      moment: ctx?.moment,
    });
    if (viaWord) return viaWord;
    const targetName = extractTargetName(address);
    if (!targetName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "connect target must name a being (@name in the address)",
        { address },
      );
    }
    // Cross-history candidate sweep, same reasoning as Mode 1: the
    // target being may be born on any history, and per-history name
    // uniqueness means one name can be several beings. The lineage
    // (or father) relationship is the credential, so eligibility
    // picks the candidate: the first being of that name the caller
    // is actually allowed to inhabit.
    const targetCandidates = (await findBeingCandidatesByName(targetName))
      .filter((c) => !c.isRemote)
      .slice(0, 5);
    if (targetCandidates.length === 0) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "No such being on this story");
    }
    const { isAncestorOf } =
      await import("../../../materials/being/identity/lookups.js");

    // Father-admit (cross-world citizenship). When the target is a
    // being-child commissioned via summon:mate, its qualities.father
    // names the being that became father at birth. That being holds
    // BE:connect eligibility into this being — the whole point of
    // the mate-being pattern. Father-admit fires when the requester
    // matches the stored father tuple.
    //
    // Local-story fathers: identity.story (if set) or the local
    // domain must match qualities.father.story. Cross-story
    // fathers: identity.story comes from req.canopySender via the
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
      if (candidateFather?.story) {
        const requesterStory = identity?.story || getStoryDomain();
        const storyMatches =
          String(candidateFather.story) === String(requesterStory);
        const isCrossStory =
          String(candidateFather.story) !== String(getStoryDomain());
        if (storyMatches && isCrossStory) {
          // CROSS-STORY father: match on the NAME (the cryptographically
          // PROVEN id — verifyEnvelopeBeingSig checked the father's own
          // envelope sig against this nameId, setting beingSigVerified), and
          // NEVER on the client-supplied beingId. Matching beingId would
          // DECOUPLE the authorized id from the proven id: a malicious peer
          // could present the victim father's PUBLIC beingId (passing a
          // beingId match) plus a valid sig over his OWN name (passing
          // beingSigVerified) and seize the being. So the being takeover
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
              `father-admit refused for @${targetName}: cross-story father must match the ` +
                `stored father NAME and arrive with his own verified envelope signature ` +
                `(nameId match + beingSigVerified). Peer vouch / a beingId match is not enough.`,
            );
          }
        } else if (storyMatches) {
          // LOCAL father: authenticated by the live session; the local
          // being-tree id is the credential (no foreign key to verify).
          if (
            candidateFather.beingId &&
            String(candidateFather.beingId) === String(identity.beingId)
          ) {
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

    // Single-connector invariant with father-priority. When a being
    // is already inhabited (qualities.connection.inhabitedBy set), the
    // father connecting AS THE FATHER displaces the existing connector
    // (typically the mother, but any current connector). This is the
    // whole point of the mate-being pattern — the foreign actor takes
    // over the being to act through it. The rule applies even when
    // the father is locally homed; father-priority is the natural rule.
    //
    // Mother-side connects use the ancestor-descendant path and don't
    // displace an existing father. The father-vs-mother arbitration
    // is asymmetric: father always wins if eligible, regardless of
    // who's currently connected.
    //
    // Displacement stamps a be:release fact on the being before the
    // be:connect lands so the projection's inhabitedBy reflects the
    // latest state cleanly. See seed/CROSS-WORLD.md + FEDERATION.md.
    if (canInhabitAsFather) {
      const currentInhabitor =
        targetBeing.qualities?.connection?.inhabitedBy || null;
      if (
        currentInhabitor &&
        String(currentInhabitor) !== String(identity.beingId)
      ) {
        try {
          const { emitFact } = await import("../../../past/fact/facts.js");
          const moment = ctx?.moment || null;
          await emitFact(
            {
              verb: "be",
              act: "release",
              through: String(currentInhabitor),
              of: { kind: "being", id: String(targetBeing._id) },
              params: {
                releasedBy: "father-priority",
                fatherBeingId: String(identity.beingId),
                fatherStory:
                  targetBeing.qualities.father?.story || getStoryDomain(),
              },
              actId: moment?.actId || null,
              history: moment?.actorAct?.history || "0",
            },
            moment,
          );
        } catch (err) {
          log.warn(
            "Cherub",
            `father-priority displacement release failed for being @${targetBeing.name}: ${err.message}. Proceeding with connect; the projection may briefly show both inhabitors until the next be:release lands.`,
          );
        }
      }
    }

    // SIGNER = THE INHABITOR. When the FATHER drives the mother's being
    // (father-admit), his acts must sign as HIM, not as the being's trueName
    // (the mother). So the token's nameId becomes the FATHER's name while
    // beingId/name stay the being's (he drives THROUGH it; the mother still
    // OWNS it and keeps the kill power). His name is: his LOCAL trueName if he
    // is a local being, else his own foreign id — which has NO local Name key,
    // so his acts seal UNSIGNED here (his home story signs + vouches them
    // via federation later) rather than ever falling back to the mother.
    // CRITICAL: never default a foreign father to targetBeing.trueName, or a
    // cross-story father would sign as the mother. The ancestor/inherit
    // (non-father) connect keeps the being's own trueName.
    let driverTrueName = targetBeing.trueName;
    if (canInhabitAsFather) {
      const { loadProjection } =
        await import("../../../materials/projections.js");
      const fatherSlot = await loadProjection(
        "being",
        String(identity.beingId),
        targetBeing.homeHistory || "0",
      );
      driverTrueName = fatherSlot?.state?.trueName || String(identity.beingId);
    }
    const identityToken = await generateToken({
      ...targetBeing,
      trueName: driverTrueName,
    });
    return {
      identityToken,
      beingAddress: `${getStoryDomain()}/@${targetBeing.name}`,
      beingId: String(targetBeing._id),
      name: targetBeing.name,
      inherited: true,
      // Surface father-admit on the response so the wire layer / UX
      // can render the connect lifecycle correctly (being-mode).
      asFather: canInhabitAsFather,
      // Inherit-connect (or father-admit): the transport seats the
      // session's currentHistory to the target being's homeHistory,
      // same model as credentials connect.
      seatHistory: targetBeing.homeHistory || null,
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

// be:release — drop the being from the session (frame reset). WIRED bundle (mirrors truename/death):
// the world strand is release.word — the handler runs it (no floor reads) for the be:release FACT
// (stampsWordFact promotes its factParams/factTarget; applyConnectionState clears inhabitedBy from the
// release act), then keeps the HOST session effects: lockSigning(beingId) unbinds the being-keyed
// signing latch (a released identity must not keep an open unlock latch — IDENTITY.md), and
// seatHistory (the home history) is returned for the transport to re-seat socket.currentHistory.
// RELEASE DROPS THE BEING, NOT THE NAME — never lockSigning the nameId / clear socket.nameId; one
// name drives many beings across tabs, so releasing one leaves you at the auth floor, still your name
// (name:logout alone logs the name out). NO JS fallback for the fact — the word is the op.
async function _releaseViaWord({ identity, moment }) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "release", moment?.actorAct?.history);
  if (!ir) return null;
  try {
    const { result } = await runAbleWord(ir, {
      moment,
      history: moment?.actorAct?.history,
      trigger: { caller: identity?.beingId ? String(identity.beingId) : null },
      env: { host: {} }, // release.word has no floor see-ops
    });
    if (!result) return null;
    const { stampsWordFact } = await import("../../../ibp/factResult.js");
    return stampsWordFact(result, "being");
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function releaseHandler({ identity, moment }) {
  const wordResult = await _releaseViaWord({ identity, moment });
  if (!wordResult) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      "be:release: release.word is not available (the word is the op — there is no JS fallback)",
    );
  }
  // Session effects (HOST, not a world-change): unbind the being-keyed signing latch — NEVER the
  // name session. seatHistory is the home history the transport re-seats socket.currentHistory to.
  if (identity?.beingId) {
    const { lockSigning } =
      await import("../../../materials/name/signingSession.js");
    lockSigning(String(identity.beingId));
  }
  const seatHistory = await findHomeHistoryOfBeing(identity?.beingId);
  return { ...wordResult, seatHistory };
}

// ────────────────────────────────────────────────────────────────────
// switch . Change this session's history on the same being.
// The fifth BE op — history-switch is identity-binding-state (which
// reel my acts ride), so it lives in BE alongside connect/release/
// birth/death.
//
// Per-session isolation: only THIS socket's currentHistory changes.
// The same being can have N concurrent sockets, each with its own
// history; switching one doesn't touch the others. Identity is
// invariant across histories; only the per-session "which history am
// I acting from" view differs.
//
// The handler validates and returns; it never touches the socket.
// Stamp-then-seat: beVerb stamps the be:switch audit fact on the
// NEW history (so that history's view of this being's biography
// records the switch-in event at T), and only after the moment
// seals does the transport seat socket.currentHistory from
// result.seatHistory. A refused stamp leaves the session's history
// untouched. The old history's reel naturally shows "no more acts
// after T" without an explicit terminator.
// ────────────────────────────────────────────────────────────────────

// be:switch — re-seat the session onto another history. WIRED bundle (mirrors release/death/truename):
// the world strand is switch.word — the handler runs it (floor reads: destination-missing/paused,
// being-lives-on) for the CROSS-HISTORY be:switch FACT (stampsWordFact promotes its factParams
// {fromHistory,toHistory} + factTarget; the BE dispatcher stamps it on result.toHistory — the
// destination history's view of this being records the switch-in). NO session effect here: the
// transport seats socket.currentHistory from result.seatHistory AFTER the seal (stamp-then-seat).
// fromHistory (the pre-switch seat) is host-derived and bound into the trigger. NO JS fallback — the
// word is the op.
async function _switchViaWord({ payload, identity, moment }) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "switch", moment?.actorAct?.history);
  if (!ir) return null;
  const { switchHostEnv } = await import("./switchHost.js");
  // The pre-switch history. On the wire path handleBe threads payload.fromHistory (the moment rides
  // the DESTINATION history, so actorAct.history is not the old one there); in-moment self-switches
  // have no wire hint, so the actor's act history IS the seat they were on.
  const fromHistory =
    (typeof payload?.fromHistory === "string" && payload.fromHistory) ||
    moment?.actorAct?.history ||
    null;
  try {
    const { result } = await runAbleWord(ir, {
      moment,
      history: moment?.actorAct?.history,
      trigger: {
        caller: identity?.beingId ? String(identity.beingId) : null,
        history: String(payload?.history || "").trim(),
        fromHistory,
      },
      env: { host: switchHostEnv() },
    });
    if (!result) return null;
    const { stampsWordFact } = await import("../../../ibp/factResult.js");
    return stampsWordFact(result, "being");
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function switchHandler({ payload, identity, moment }) {
  const result = await _switchViaWord({ payload, identity, moment });
  if (!result) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      "be:switch: switch.word is not available (the word is the op — there is no JS fallback)",
    );
  }
  // No session effect in the handler: the transport seats socket.currentHistory from result.seatHistory
  // AFTER the moment seals (stamp-then-seat). The handler hands back the seat inputs + the fact.
  return result;
}

// ────────────────────────────────────────────────────────────────────
// death . The being's final act. Locks the act-chain; no new BE ops
// will be accepted on this being, summons refuse, able grants refuse.
// Past acts + past grants remain valid (facts at the time stand).
// See seed/done/DualBeingParents — "WORRY ABOUT LAST."
//
// The handler returns the closing summary; beVerb's dispatch path
// (death branch in be.js) stamps the be:death fact on the dying
// being's reel. The reducer's applyDeath in reducerHelpers.js
// projects qualities.death = { time, byActor }.
//
// Authority gate: today only I may perform be:death. The authorize
// step in beVerb's dispatch routes through the able-walk which
// short-circuits true for I and refuses everyone else (no able
// today declares a be:death capability). Future doctrine may extend the
// authority list (mother + governance ables); for now, I only.
// ────────────────────────────────────────────────────────────────────

// be:death — close a being's lifecycle. WIRED bundle (mirrors truename): the world strand is
// death.word — the handler runs it through the bridge (CALLER mode, the one floor read wired by
// deathHost.js); the .word RETURNS { byActor } as `factParams` + the target as `factTarget`, and
// stampsWordFact promotes them so beVerb stamps the ONE caller-attributed be:death fact on the dying
// being's reel. NO JS fallback — the word is the op. The kill authority is be.js's verb-level
// authorize() (run before this), not an op concern.
async function _deathViaWord({ beingName, payload, identity, moment }) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "death", moment?.actorAct?.history);
  if (!ir) return null;
  const { deathHostEnv } = await import("./deathHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runAbleWord(ir, {
      moment,
      history,
      trigger: {
        caller: identity?.beingId ? String(identity.beingId) : null,
        beingName: beingName || null,
      },
      env: { host: deathHostEnv() },
    });
    if (!result) return null;
    const { stampsWordFact } = await import("../../../ibp/factResult.js");
    return stampsWordFact(result, "being"); // factParams {byActor} + factTarget → _factParams/_factTarget
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function deathHandler({ beingName, identity, payload, moment }) {
  const result = await _deathViaWord({ beingName, payload, identity, moment });
  if (result) return result;
  // NO JS fallback: death.word IS the op (the single source of truth). If its IR is absent the op
  // honestly cannot run — that is the truthful state, not papered over by a JS duplicate.
  throw new IbpError(
    IBP_ERR.INTERNAL,
    "be:death: death.word is not available (the word is the op — there is no JS fallback)",
  );
}

// be:truename — hand a being to a (declared) Name: re-point its trueName.
// WIRED bundle (mirrors create-matter/index.js): the world strand is
// truename.word — the handler runs it through the bridge (resolveAbleWord ->
// runAbleWord, CALLER mode, the four floor reads wired by truenameHost.js) and the
// .word RETURNS { trueName: nameId } as `factParams`; the shim promotes it to the
// dispatcher's `_factParams` so beVerb lays the ONE caller-attributed be:truename
// fact. The inert summary below is the clean-miss fallback (no .word IR).
async function _truenameViaWord({
  address,
  beingName,
  payload,
  identity,
  moment,
}) {
  if (!moment) return null;
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "truename", moment?.actorAct?.history);
  if (!ir) return null;
  const { truenameHostEnv } = await import("./truenameHost.js");
  const history = moment?.actorAct?.history;
  try {
    const { result } = await runAbleWord(ir, {
      moment,
      history,
      trigger: {
        caller: identity?.beingId ? String(identity.beingId) : null,
        beingName: beingName || null,
        trueNameToken: payload?.trueName ?? null,
      },
      env: { host: truenameHostEnv() },
    });
    if (!result) return null;
    // The .word built its fact params (factParams { trueName } + factTarget). stampsWordFact promotes
    // them to the dispatcher's _factParams/_factTarget (kind:being — BEING_ONLY_TARGET_VERBS) and
    // strips them from the returned result. One shared cut for every word-authored fact (factResult.js).
    const { stampsWordFact } = await import("../../../ibp/factResult.js");
    return stampsWordFact(result, "being");
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function truenameHandler({
  address,
  beingName,
  identity,
  payload,
  moment,
}) {
  const result = await _truenameViaWord({
    address,
    beingName,
    payload,
    identity,
    moment,
  });
  if (result) return result;
  // NO JS fallback: truename.word IS the op, the single source of truth. If its IR is absent (the
  // .word failed to register), the op honestly cannot run — that is the truthful state, not
  // something a duplicated JS validation should paper over. (Tabor: the word is the source; no IR
  // fallback even if the IR stays.)
  throw new IbpError(
    IBP_ERR.INTERNAL,
    "be:truename: truename.word is not available (the word is the op — there is no JS fallback)",
  );
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
    description:
      "Create a top-level being owned by your name (cherub is right below I). You're already signed in as your name — no password needed.",
    label: "Create a top-level being",
    args: {
      name: { type: "text", label: "Name your being", required: true },
      password: {
        type: "password",
        label: "Password (optional — only for sharing this being)",
        required: false,
      },
    },
    handler: birthHandler,
    bootstrap: true, // arrival has no identity yet; assertVerbCaller skipped
  },
  connect: {
    description:
      "Connect to a being you already own (no password — your name owns it).",
    label: "Connect to one of your beings",
    args: {
      name: { type: "text", label: "Being name", required: true },
      password: {
        type: "password",
        label: "Password (only for a shared being you don't own)",
        required: false,
      },
    },
    handler: connectHandler,
    bootstrap: true,
  },
  release: {
    description:
      "Stop driving this being (close it). Your name stays signed in.",
    label: "Release this being",
    args: {},
    handler: releaseHandler,
    // release.word returns factParams; the BE dispatcher stamps be:release from them.
    factAction: "release",
  },
  switch: {
    description:
      "Change this session's history on the same being. " +
      "Per-session — switching one socket's history doesn't touch other sockets.",
    label: "Switch history",
    args: {
      history: { type: "text", label: "Target history path", required: true },
    },
    handler: switchHandler,
    // switch.word returns factParams {fromHistory,toHistory}; the BE dispatcher stamps the
    // be:switch fact on the DESTINATION history (be.js passes result.toHistory as the fact history).
    factAction: "switch",
  },
  death: {
    description:
      "Close this being's lifecycle. One-way; the chain locks. " +
      "Past acts + grants remain valid. Today I only.",
    label: "Close being",
    args: {},
    handler: deathHandler,
    // death.word returns factParams; the BE dispatcher stamps be:death from them.
    factAction: "death",
  },
  truename: {
    description:
      "Hand this being to a Name: set its trueName to a declared Name id. " +
      "Anyone for now; owner-only later.",
    label: "Set true name",
    args: {
      trueName: { type: "text", label: "Target Name id", required: true },
    },
    handler: truenameHandler,
    // The .word returns factParams; the BE dispatcher stamps be:truename from them
    // (declareBeOpsToFold carries factAction into the fold spec).
    factAction: "truename",
  },
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Register a human: create their fresh home space under the place
 * root, birth the being into it, set the new being as the home's
 * owner. Three facts (do:create-space, be:birth, do:set-space)
 * all ride the same `moment.deltaF` so they seal atomically.
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
  importKey = null, // optional imported identity (PEM or 24 words)
  parentBeingId,
  cherubIdentity,
  moment,
  fatherBeingId = null, // who REQUESTED the mint (arrival for register, parent for sub-births)
  ownerNameId = null, // the connected NAME this being belongs to (its trueName); null -> mother's default (i-am)
}) {
  const { randomUUID: uuidv4 } = await import("node:crypto");
  const { emitFact } = await import("../../../past/fact/facts.js");
  const { I } = await import("../../../materials/being/seedBeings.js");

  // ── 1. Create the home space ──
  // Human homes are 100×100 grid bounded territories under the place
  // root. The home's owner class lands in step 3 (after the being
  // exists to reference); step 1 stamps the space with no owner.
  const homeId = uuidv4();
  const placeRootId = getSpaceRootId();
  const actorId = cherubIdentity?.beingId || I;
  await emitFact(
    {
      verb: "do",
      act: "create-space",
      through: String(actorId),
      of: { kind: "space", id: homeId },
      params: {
        name, // home space is named for the user
        type: "home-territory",
        parent: String(placeRootId),
        // members.owner gets set in step 3 (the new being doesn't
        // exist yet; can't reference them here).
        size: { x: 100, y: 100 },
        qualities: {},
      },
      actId: moment?.actId || null,
      history: moment?.actorAct?.history || "0",
    },
    moment,
  );

  // ── 2. Birth the being into the new home ──
  const result = await birthBeing({
    spec: {
      cognition: "human",
      name,
      password,
      ...(importKey ? { importKey } : {}),
      // OWNED BY THE CONNECTED NAME. A being cherub mints for a signed-in name
      // is that NAME's own (sovereign trueName), NOT a child of i-am. Without
      // this, a name's being defaults to the mother's trueName (i-am) — the
      // funk where the being shows as I and its key-export would surface the
      // story key. Null only for the anonymous/pre-name path (no connected
      // name), where the mother's default is correct.
      ...(ownerNameId ? { trueName: String(ownerNameId) } : {}),
      defaultAble: "human",
      homeId: String(homeId),
      parentBeingId: parentBeingId ? String(parentBeingId) : null,
      // birthHere stays false (default): the being appears at their
      // own home, which is what registration semantically means.
    },
    identity: cherubIdentity,
    moment,
  });

  // ── 3. Set the new being as owner of the home ──
  // The home is a tree root they own. Stamped as I because cherub
  // already authorized the whole compound act; doing it under the new
  // being's identity faces a chicken-and-egg with stance auth (they're
  // becoming the owner; auth needs them to already be one).
  const { doVerb } = await import("../../../ibp/verbs/do.js");
  await doVerb(
    { kind: "space", id: homeId },
    "set-space",
    { field: "owner", value: String(result.beingId) },
    {
      identity: I,
      moment,
      currentHistory: moment?.actorAct?.history || "0",
    },
  );

  // ── 4. Anoint the new human with the human able ──
  // Ables-Are-Auth bootstrap (seed/AblesAreAuth.md). The new being
  // already holds `global` via _anointGlobal in birth.js (every being
  // gets global at the story root, universal single-gate doctrine).
  // Here cherub adds the registration-specific able:
  //   - human: the "root founder" canX (do whatever you want here)
  // Anchored at the place root with story-wide reach via descendants.
  // Cherub holds do:grant-able:human (declared in cherubAble.can)
  // so authorize permits this emit. grantedBy is cherub for forensics.
  await doVerb(
    { kind: "being", id: String(result.beingId) },
    "grant-able",
    {
      able: "human",
      anchorSpaceId: String(placeRootId),
      anchorBeingId: null,
    },
    {
      identity: cherubIdentity,
      moment,
      currentHistory: moment?.actorAct?.history || "0",
    },
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
    } catch {
      resolvedFatherId = null;
    }
  }
  await doVerb(
    { kind: "being", id: String(result.beingId) },
    "set-being",
    {
      field: "qualities.lineage",
      value: { mother: motherBeingId, father: resolvedFatherId },
      merge: false,
    },
    {
      identity: I,
      moment,
      currentHistory: moment?.actorAct?.history || "0",
    },
  );

  return result.being;
}

/**
 * The bridge into cherub.word (2.md Phase 4, the dual registry preferring `.word`).
 * Prefer the converted `.word` world-sequencing; fall back to the JS handler ONLY on
 * a CLEAN MISS — the op isn't converted, there's no moment to run in, or an imported
 * identity the `.word` doesn't model yet. A `.word` run that lays facts and then
 * throws leaves a DIRTY moment, so we never fall back over partial facts (that would
 * double-lay the JS strand on top); we rethrow, an honest failure. The session strand
 * reads the returned being via `bornBeingFrom`, so the caller is unchanged either way.
 * See word/ableWordRegistry.js + word/bridge.md.
 */
async function _birthViaWordOrJs({
  name,
  password,
  importKey,
  parentBeingId,
  ownerNameId,
  history,
  moment,
}) {
  const jsBirth = () =>
    _registerHumanWithFreshHome({
      name,
      password,
      importKey,
      parentBeingId,
      cherubIdentity: { name: "cherub", beingId: parentBeingId },
      moment,
      ownerNameId,
    });

  // Two cases cherub.word doesn't model yet, so the JS handler owns them:
  //  - importKey: an imported identity (PEM / 24-word paper key) rides a host secret
  //    stash that birthBeing reads.
  //  - no ownerNameId: the ANONYMOUS / mother-default birth (no connected Name).
  //    cherub.word's form-being is `trueName: "$ownerName"` — built for the named
  //    case (the being is the arriving Name's own). With no Name to bind, the JS
  //    handler's "omit trueName, inherit the mother's" default is the correct path
  //    (a literal "$ownerName" would reach birthBeing as a bogus trueName).
  if (importKey || !ownerNameId) return jsBirth();

  const { resolveAbleWord, runAbleWord, bornBeingFrom } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "birth", moment?.actorAct?.history);
  if (!ir || !moment) return jsBirth(); // not converted, or no moment → JS

  const { findByName } = await import("../../../materials/projections.js");
  const before = Array.isArray(moment.deltaF) ? moment.deltaF.length : 0;
  try {
    const arrivalSlot = await findByName("being", "arrival", history);
    await runAbleWord(ir, {
      moment,
      history,
      trigger: { name, password },
      // ownerName = the arriving Name (its own trueName); placeRoot = the story
      // root the home space is made under (create-space's parent).
      bindings: { ownerName: ownerNameId, placeRoot: String(getSpaceRootId()) },
      // proper-name → being id: Cherub the mother/being, Arrival the father.
      beings: {
        Cherub: String(parentBeingId),
        ...(arrivalSlot ? { Arrival: String(arrivalSlot.id) } : {}),
      },
      through: String(parentBeingId), // I acts THROUGH Cherub (cherub.word)
    });
  } catch (err) {
    const laid =
      (Array.isArray(moment.deltaF) ? moment.deltaF.length : 0) - before;
    if (laid > 0) throw err; // dirty moment: fail honestly, never double-lay JS facts
    log.warn(
      "Cherub",
      `cherub.word birth missed cleanly (${err.message}); JS handler`,
    );
    return jsBirth();
  }

  const being = bornBeingFrom(moment.deltaF);
  if (being && being._id) return being;
  // ran but produced no usable be:birth: a clean miss only if nothing landed.
  const laid =
    (Array.isArray(moment.deltaF) ? moment.deltaF.length : 0) - before;
  if (laid > 0) throw new Error("cherub.word ran but laid no be:birth fact");
  return jsBirth();
}

// A constant-time credential rejection: run a REAL scrypt verify against a cached dummy
// hash so a non-existent name costs the same as a wrong password (closes the
// username-enumeration timing oracle). The dummy is a genuine `scrypt$...` hash computed
// ONCE; the prior `$2b$12$0000…` was a malformed BCRYPT string that comparePassword
// rejected instantly (it checks `startsWith("scrypt$")`), so the old mitigation did NO
// work — the bug this fixes. Real cost ~60ms, matching a live verify.
let _ctRejectHash = null;
async function _constantTimeReject(password) {
  if (!_ctRejectHash) _ctRejectHash = await hashPassword("constant-time-floor");
  await verifyPassword({ password: _ctRejectHash }, password); // real scrypt work, result discarded
}

/**
 * The bridge into cherub-connect.word (flow 1, the @cherub credential path). Runs the
 * CONTROL strand (search → foreach → verify → refuse/return) as `.word` with the session
 * ops as `host:` escapes (connectHost.js). Returns the full connect response built from
 * the token, or null on a CLEAN MISS (op not converted / no usable token) so the JS body
 * runs. A WordRefusal is the "Invalid credentials" path: behavior-preserving, it replays
 * the JS dummy-verify (including its known ineffectiveness — a PRE-EXISTING timing oracle
 * flagged in 6.md, NOT introduced here) before the same UNAUTHORIZED refusal. Connect
 * lays no fact, so a fresh minimal moment keeps the caller's moment untouched.
 */
async function _connectViaWordOrJs({ name, password, moment }) {
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "connect", moment?.actorAct?.history);
  if (!ir) return null; // not converted → JS
  const { connectHostEnv, selectConnectFlow } =
    await import("./connectHost.js");
  // run ONLY the credential flow — the file also holds the owned/inherit flows, which
  // must NOT run on the Mode-1 credential path.
  const flow = selectConnectFlow(ir, "credential");
  if (!flow) return null;
  const { randomUUID } = await import("node:crypto");
  const history = moment?.actorAct?.history || "0";
  const sc = {
    actId: randomUUID(),
    actorAct: { history },
    identity: { beingId: "arrival", name: "arrival" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const { result } = await runAbleWord([flow], {
      moment: sc,
      history,
      trigger: { name, password },
      env: { host: connectHostEnv() },
    });
    if (!result?.token) return null; // produced nothing usable → JS
    const { decodeToken } =
      await import("../../../materials/being/identity/credentials.js");
    const decoded = decodeToken(result.token);
    if (!decoded?.beingId) return null;
    return {
      identityToken: result.token,
      beingAddress: `${getStoryDomain()}/@${decoded.name}`,
      beingId: String(decoded.beingId),
      name: decoded.name,
      seatHistory: result.seat ?? null,
    };
  } catch (e) {
    if (e && e.__wordRefusal) {
      // the constant-time floor (the JS `if (!being)` path), then the same refusal.
      await _constantTimeReject(password);
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "Invalid credentials");
    }
    throw e; // a real error propagates (never fall to JS over a partial)
  }
}

/**
 * cherub-connect.word FLOW 2 (a signed-in NAME drives a being it OWNS, no password). Runs
 * the owned flow through the bridge with `caller` = the signed-in name id; returns the
 * full connect response when owned, or null (not owned / not converted) so the caller
 * falls through to Mode-2/Mode-3. Lays no fact.
 */
async function _connectOwnedViaWord({ address, callerNameId, moment }) {
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "connect", moment?.actorAct?.history);
  if (!ir) return null;
  const targetName = extractTargetName(address);
  if (!targetName) return null;
  const { connectHostEnv, selectConnectFlow } =
    await import("./connectHost.js");
  const flow = selectConnectFlow(ir, "owned");
  if (!flow) return null;
  const { randomUUID } = await import("node:crypto");
  const history = moment?.actorAct?.history || "0";
  const sc = {
    actId: randomUUID(),
    actorAct: { history },
    identity: { beingId: "name", name: "name" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const { result } = await runAbleWord([flow], {
    moment: sc,
    history,
    trigger: { name: targetName, caller: String(callerNameId) },
    env: { host: connectHostEnv() },
  });
  if (!result?.token || result.owned !== true) return null; // not owned → fall through
  const { decodeToken } =
    await import("../../../materials/being/identity/credentials.js");
  const decoded = decodeToken(result.token);
  if (!decoded?.beingId) return null;
  return {
    identityToken: result.token,
    beingAddress: `${getStoryDomain()}/@${decoded.name}`,
    beingId: String(decoded.beingId),
    name: decoded.name,
    owned: true,
    seatHistory: result.seat ?? null,
  };
}

/**
 * cherub-connect.word FLOW 3 (inherit-connect / father-admit). Runs the inherit flow with
 * `caller` = the identity object {beingId,nameId,story,beingSigVerified}. The .word is
 * AUTHORITATIVE: it returns the connect response, or its WordRefusal becomes the same
 * IbpError the JS threw. Returns null only when NOT converted (resolveAbleWord null), so
 * the JS Mode-3 is the clean-miss fallback. The lone world fact (the be:release
 * displacement) is sealed here (it landed on the fresh moment, not the caller's).
 */
async function _connectInheritViaWord({ address, identity, moment }) {
  const { resolveAbleWord, runAbleWord } =
    await import("../../../present/word/ableWordRegistry.js");
  const ir = resolveAbleWord("cherub", "connect", moment?.actorAct?.history);
  if (!ir) return null;
  const { connectHostEnv, selectConnectFlow } =
    await import("./connectHost.js");
  const flow = selectConnectFlow(ir, "inherit");
  if (!flow) return null;
  const { randomUUID } = await import("node:crypto");
  const history = moment?.actorAct?.history || "0";
  const sc = {
    actId: randomUUID(),
    actorAct: { history },
    identity: { beingId: identity?.beingId },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  let result;
  try {
    ({ result } = await runAbleWord([flow], {
      moment: sc,
      history,
      trigger: { address, caller: identity },
      env: { host: connectHostEnv() },
    }));
  } catch (e) {
    if (e && e.__wordRefusal)
      throw new IbpError(e.code || IBP_ERR.FORBIDDEN, e.message); // the .word's refusal IS the answer
    throw e;
  }
  if (!result?.token) return null;
  // seal the be:release displacement (father-priority) if flow 3 laid one
  if (sc.deltaF?.length) {
    const { sealFacts } = await import("../../../past/fact/facts.js");
    await sealFacts(sc.deltaF);
  }
  const { decodeToken } =
    await import("../../../materials/being/identity/credentials.js");
  const decoded = decodeToken(result.token);
  if (!decoded?.beingId) return null;
  return {
    identityToken: result.token,
    beingAddress: `${getStoryDomain()}/@${decoded.name}`,
    beingId: String(decoded.beingId),
    name: decoded.name,
    inherited: true,
    asFather: !!result.asFather,
    seatHistory: result.seatHistory ?? null,
  };
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
// Stub able for the registry. Cherub is a delegate, not a summon-
// dispatched being: its real work happens through registered BE ops
// above. The able exists only so the @cherub stance resolves and the
// being row can be planted with ables: ["cherub"]; triggerOn: []
// means SUMMONs never queue, so assign never tries to dispatch
// through here.
// ────────────────────────────────────────────────────────────────────

export const cherubAble = Object.freeze({
  name: "cherub",
  description:
    "The gate, right below I. Processes the three BE ops (birth/connect/release) AND summon:mate — a connected name births its first TOP-LEVEL being through cherub (owned by the name). Down the chain, names reuse summon:mate on @birther / be:birth on their own beings.",
  // Seed delegate able — hosted on the story root. The cherub being
  // gets this able granted at boot by the I-Am. `can` includes
  // do:grant-able:human + do:grant-able:global so cherub can anoint new
  // humans on registration. Cherub is the only grantor of the human
  // and global ables in a default story.
  requiredCognition: "scripted",
  respondMode: "async",
  triggerOn: [],

  // Capabilities, unified in `can`:
  //   - do  actions cherub can perform. The registration flow needs to
  //     emit grant-able facts on the freshly-birthed human (giving them
  //     global + human at the place root). do:grant-able:<able> is the
  //     entry that lets authorize permit those grants.
  //   - summon participation. `as: "receiver"` declares this able
  //     ACCEPTS summon:mate from anonymous arrivals (the registration
  //     flow): summon @cherub:mate → cherub mints a new being with the
  //     visitor's chosen credentials, grants global + human at the place
  //     root, and binds the session. The summoner RECEIVES the new being.
  //     Mirrors birther's same shape; FEDERATION.md for the federation
  //     counterpart.
  //   - be licenses. The descriptor's enrichBeings reads these, cross-
  //     references the seed's static BE_OPS table for each name, and
  //     builds the per-being `actions[]` block the portal renders as
  //     menu + form. Schemas live in the seed (cherubBeOps above + BE_OPS
  //     at ibp/beOps.js), not here . a be entry names the license, not
  //     the shape.
  can: [
    {
      verb: "do",
      word: "grant-able:human",
      description: "anoint a new human at the place root",
    },
    {
      verb: "do",
      word: "grant-able:global",
      description: "give the baseline able to a new human",
    },
    {
      verb: "call",
      word: "mate",
      as: "receiver",
      description:
        "Birth your first being through your name — a top-level being, owned by you (cherub is right below I)",
    },
    { verb: "be", word: "birth" },
    { verb: "be", word: "connect" },
    { verb: "be", word: "release" },
  ],

  // summon:mate — a connected NAME, acting through @arrival, asks cherub to
  // birth its FIRST being. Cherub is right below I, so it mints TOP-LEVEL
  // beings; the child is OWNED by the summoner's name (sovereign trueName),
  // not a being of cherub. Down the chain the name reuses summon:mate against
  // @birther / be:birth on its own beings. (A name CAN be given beings without
  // ever using cherub; this is just the typical first-being path on land.)
  async call(message, ctx) {
    const intent =
      typeof message === "object" && message !== null
        ? message.intent || message.kind || null
        : null;
    if (intent === "mate") return await handleCherubMate(message, ctx);
    return null;
  },
});

// summon:mate → cherub births the name's first TOP-LEVEL being, owned by the
// summoner's NAME (its trueName = the connected name). The name then
// be:connects to it passwordless (owned connect). Mirrors birther's
// handleMateRequest, but the child is the name's OWN (sovereign), not a being.
async function handleCherubMate(message, ctx) {
  const askerNameId = ctx?.askerNameId ? String(ctx.askerNameId) : null;
  if (!askerNameId || askerNameId === "i-am") {
    return (
      ctx.failure?.(
        "refused",
        "summon:mate against cherub needs a connected name — sign in your name first",
      ) || { kind: "failure", ok: false, shape: "refused", reason: "no name" }
    );
  }
  const messageObj =
    typeof message === "object" && message !== null ? message : {};
  // The being's name rides in message.content (the summon's content payload),
  // which 1-assign seats at moment.message.content. Accept the top-level
  // .name too as a fallback for direct callers.
  const content =
    messageObj.content && typeof messageObj.content === "object"
      ? messageObj.content
      : null;
  const beingName =
    content && typeof content.name === "string" && content.name.trim()
      ? content.name.trim()
      : typeof messageObj.name === "string" && messageObj.name.trim()
        ? messageObj.name.trim()
        : null;
  if (!beingName) {
    return (
      ctx.failure?.(
        "refused",
        "give your first being a name (in the summon content)",
      ) || {
        kind: "failure",
        ok: false,
        shape: "refused",
        reason: "no being name",
      }
    );
  }
  const cherubBeingId = ctx?.toBeing?._id || ctx?.toBeing?.id || null;
  if (!cherubBeingId) {
    return (
      ctx.failure?.("internal", "cherub beingId unresolved in ctx") || {
        kind: "failure",
        ok: false,
        shape: "internal",
        reason: "no cherub id",
      }
    );
  }
  // Top-level: at the story root, parented under cherub (right below I).
  let homeSpaceId = messageObj.homeSpaceId || null;
  if (!homeSpaceId) {
    try {
      const { findRoot } = await import("../../../materials/projections.js");
      const history = ctx?.actorAct?.history || "0";
      const roots = await findRoot("space", history);
      homeSpaceId = roots?.[0]?.id || null;
    } catch {
      homeSpaceId = null;
    }
  }
  if (!homeSpaceId) {
    return (
      ctx.failure?.(
        "internal",
        "cannot resolve the story root for the new being",
      ) || {
        kind: "failure",
        ok: false,
        shape: "internal",
        reason: "no home space",
      }
    );
  }

  let result;
  try {
    result = await birthBeing({
      spec: {
        name: beingName,
        // SOVEREIGN: trueName = the summoner's name, so the being is the
        // name's OWN top-level being (not a being of cherub). Owned connect
        // (passwordless) follows from the name owning it.
        trueName: askerNameId,
        cognition: messageObj.cognition || "human",
        defaultAble: messageObj.defaultAble || "global",
        parentBeingId: cherubBeingId,
        homeId: homeSpaceId,
      },
      identity: { beingId: cherubBeingId, name: "cherub" },
      moment: ctx,
    });
  } catch (err) {
    log.warn("Cherub", `summon:mate first-being birth failed: ${err.message}`);
    return (
      ctx.failure?.("internal", `birth failed: ${err.message}`) || {
        kind: "failure",
        ok: false,
        shape: "internal",
        reason: err.message,
      }
    );
  }

  const summary =
    `your first being "${result?.name || beingName}" is born — ` +
    `top-level under cherub, owned by your name`;
  return (
    ctx.act?.(summary) || {
      kind: "act",
      ok: true,
      content: summary,
      childBeingId: result?.beingId,
      childName: result?.name,
      trueName: askerNameId,
    }
  );
}
