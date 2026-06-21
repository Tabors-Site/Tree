// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// birther. The being that mints children from authenticated callers.
//
// Two paths share this role:
//
//   1. AUTHENTICATED LOCAL BE:birth. A being already on this story
//      calls BE:birth on @birther to mint a child. The new being's
//      being-tree parent is the CALLER. Births this way show up in
//      the caller's beingLineage and are inhabit-able through
//      cherub's Mode-3 connect. This path runs through the
//      registered BE handlers in seed/ibp/beOps.js + verbs/be.js.
//
//   2. SUMMON:mate (cross-world citizenship). A being summons this
//      birther asking to be father of a child here. Birther's
//      cognition auto-accepts and calls be:birth(father=summoner) on
//      this story's chain. The new child has birther as mother
//      (full structural parent) and the summoner as father (BE:connect
//      eligibility into the vessel). For cross-story summons the
//      father.story is the canopy-verified foreign domain; for
//      same-story the local domain is implicit. See
//      seed/CROSS-WORLD.md + protocols/ibp/FEDERATION.md.
//
// (Cherub serves arrival — unauthenticated callers landing on the
// story for the first time. Different entry point, different role.)
//
// Birther is scripted-cognition: its summon function dispatches by
// intent in the message envelope. No LLM frame.
//
// Birther is also the doctrine demonstrator for the unified inner
// face (philosophy/names/innerFace.md). can: [{ verb:"see", word:"place" }]
// tells the kernel to fold the position descriptor into
// ctx.innerFace.blocks; on summon:mate the summon handler reads that
// block to detect a name collision against current occupants and
// refuses with kind:"failure", shape:"refused" before commissioning
// the vessel. First scripted role in the repo that turns a see entry
// into a real perception-aware decision.

import log from "../../../seedStory/log.js";

const DEFAULT_BIRTHER_NAME_PREFIX = "vessel";

export const birtherRole = Object.freeze({
  name: "birther",
  description:
    "Mints children from authenticated callers. Click @birther to give birth to a child being — the new being's parent is you. Cross-world: foreign actors can summon:mate against @birther to commission a vessel-child on this story.",
  requiredCognition: "scripted",
  permissions: ["be"],
  respondMode: "async",
  triggerOn: [],

  // Unified capability list. Order: all see, then do, then summon,
  // then be.
  //
  // The summon entry carries `as` to discriminate the side of the
  // summon edge it describes:
  //   "actor"     — caller-side; this role can send (default if absent)
  //   "receiver"  — receiver-side; this role accepts when targeted
  //
  // Auth (authorizeViaRoles → permitsSummon) consults `as:"actor"`
  // entries on the CALLER'S role. UI discovery + receive-side checks
  // consult `as:"receiver"` entries on the TARGET'S role. One field,
  // two surfaces — same shape as left-stance/right-stance everywhere
  // else in the substrate. See seed/RolesAreAuth.md + FEDERATION.md.
  can: [
    { verb: "see", word: "place" },
    {
      verb: "call",
      word: "mate",
      as: "receiver",
      description: "Auto-accepts mate requests. The summoner becomes father; this birther becomes mother; child is birthed on this story.",
    },
    { verb: "be", word: "birth" },
  ],

  async call(message, ctx) {
    // ctx.innerFace carries the canonical inner face the kernel built
    // for this moment (orientation + role + position + capabilities +
    // role.can see-entry-resolved blocks). Scripted roles read it as data:
    //   ctx.innerFace.blocks . [{ key, source, label, payload }, ...]
    // Same shape the LLM mouth reformats and the human portal renders.
    // This birther role uses it as a perception-aware pre-flight gate
    // for the "mate" intent: before commissioning a vessel, it looks
    // at the "place" block (resolved from the see:"place" entry) and
    // refuses when an occupant already carries the prospective vessel name.
    // Honest preview of the in-place uniqueness check, answered from
    // the inner face the kernel folded for this moment.
    //
    // Dispatch by intent in the message. Today's intents:
    //
    //   "mate" . cross-world citizenship request. The summoner becomes
    //            father; this birther becomes mother; child is birthed
    //            on this story. See FEDERATION.md.
    //
    // Anything else is a no-op (no error). Until more intents are
    // declared, that's the safe default for an unknown ask.
    const intent = (typeof message === "object" && message !== null)
      ? (message.intent || message.kind || null)
      : null;

    if (intent === "mate") {
      // Perception-aware pre-flight. Compute the prospective vessel
      // name with the same suggested-or-fallback rule handleMateRequest
      // uses, then scan the "place" block from ctx.innerFace for a
      // name collision against current beings[]/residents[]. Refusing
      // here turns the in-place uniqueness throw into a structured
      // see-and-refuse, which is what the inner face is for.
      const prospectiveName = await resolveBeingName(message, ctx);
      const blocks = Array.isArray(ctx?.innerFace?.blocks)
        ? ctx.innerFace.blocks
        : [];
      const placeBlock = blocks.find((b) => b && b.key === "place");
      const payload = placeBlock?.payload || {};
      const occupants = [
        ...(Array.isArray(payload.beings)    ? payload.beings    : []),
        ...(Array.isArray(payload.residents) ? payload.residents : []),
      ];
      const collision = prospectiveName
        ? occupants.find((o) => {
            const occName = (o && (o.being || o.name)) || null;
            return occName && occName === prospectiveName;
          })
        : null;
      if (collision) {
        log.warn(
          "Birther",
          `mate refused: name collision "${prospectiveName}" at homeSpace`,
        );
        return ctx.failure?.("refused", `vessel name "${prospectiveName}" already at home space`)
          || { kind: "failure", ok: false, shape: "refused", reason: `name collision: ${prospectiveName}` };
      }
      return await handleMateRequest(message, ctx, prospectiveName);
    }

    return null;
  },
});

// Vessel name. Suggested (from message.name) wins; otherwise the
// `vessel-<story>-<short>` fallback. Story is the asker's when
// carried (cross-realm); otherwise the local domain. The perception-
// aware gate and handleMateRequest both call this so the name they
// guard against is the same name handleMateRequest commits to.
async function resolveBeingName(message, ctx) {
  const messageObj = (typeof message === "object" && message !== null) ? message : {};
  // The suggested name rides in message.content (the summon payload); accept a
  // top-level .name too (direct callers). 1-assign seats content at
  // moment.message.content.
  const content = (messageObj.content && typeof messageObj.content === "object") ? messageObj.content : null;
  const suggested =
    (content && typeof content.name === "string" && content.name.length) ? content.name.trim()
    : (typeof messageObj.name === "string" && messageObj.name.length) ? messageObj.name.trim()
    : null;
  if (suggested) return suggested;
  const askerBeingId = ctx?.askerBeingId || null;
  if (!askerBeingId) return null;
  let fatherStory = ctx?.askerStory || null;
  if (!fatherStory) {
    const { getStoryDomain } = await import("../../../ibp/address.js");
    fatherStory = getStoryDomain();
  }
  return `${DEFAULT_BIRTHER_NAME_PREFIX}-${
    fatherStory.replace(/[^a-z0-9]/gi, "")
  }-${String(askerBeingId).slice(0, 6)}`;
}

// ────────────────────────────────────────────────────────────────────
// summon:mate auto-accept.
//
// Birther's whole job in the cross-world path: receive a mate
// request, accept it, and call be:birth on this story's chain. The
// summoner is recorded as the father (BE:connect eligibility); the
// birther is recorded as the mother (full structural parent).
//
// Same-story summon:mate also runs through this path — askerStory
// equals our own domain; the father tuple still records the summoner.
// (Same-story vessel-children are rarer than cross-story, but the
// substrate doesn't gatekeep — any being summoning :mate against
// birther becomes a father of a child here.)
// ────────────────────────────────────────────────────────────────────

async function handleMateRequest(message, ctx, precomputedName = null) {
  const askerBeingId = ctx?.askerBeingId || null;
  const askerStory = ctx?.askerStory || null;
  if (!askerBeingId) {
    log.warn("Birther", "mate request received without askerBeingId; refusing");
    return ctx.failure?.("internal", "summon:mate received without asker identity")
      || { kind: "failure", ok: false, shape: "internal", reason: "no asker identity" };
  }

  // Resolve father tuple. For same-story summons, askerStory may
  // be null (handoff carried no explicit story); the local domain
  // is implicit. For cross-story, askerStory came from the
  // canopy-verified sender — the trusted ground truth.
  const { getStoryDomain } = await import("../../../ibp/address.js");
  const localStory = getStoryDomain();
  const fatherStory = askerStory || localStory;

  const father = {
    story: fatherStory,
    beingId: String(askerBeingId),
    // The father's NAME (the signer) — cherub's cross-story father-admit
    // matches THIS (the cryptographically-proven id), not the beingId.
    // Falls back to the beingId for a pre-split father (beingId IS his pubkey).
    nameId:  ctx?.askerNameId ? String(ctx.askerNameId) : String(askerBeingId),
  };

  // Resolve the homeSpace for the new vessel. Default: the story
  // root (the new being lives at the top of this story). Operators
  // who want vessels parented elsewhere can override via
  // message.homeSpaceId.
  const messageObj = (typeof message === "object" && message !== null) ? message : {};
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
    return ctx.failure?.("internal", "cannot resolve homeSpace for new vessel")
      || { kind: "failure", ok: false, shape: "internal", reason: "no home space" };
  }

  // Vessel name. Pre-resolved by the summon dispatcher via
  // resolveBeingName (single source of truth across the
  // perception-aware gate and this call). Recompute defensively if
  // the dispatcher didn't pass one (direct call path that bypasses
  // summon()).
  const name = precomputedName || await resolveBeingName(message, ctx);
  if (!name) {
    return ctx.failure?.("internal", "vessel name unresolvable (no suggestion and no asker identity)")
      || { kind: "failure", ok: false, shape: "internal", reason: "no vessel name" };
  }

  // Birther's own being id (= the actor of be:birth = the mother).
  const birtherBeingId = ctx?.toBeing?._id
    || ctx?.toBeing?.id
    || null;
  if (!birtherBeingId) {
    return ctx.failure?.("internal", "birther beingId unresolved in ctx")
      || { kind: "failure", ok: false, shape: "internal", reason: "no birther id" };
  }

  const { birthBeing } = await import("../../../materials/being/identity/birth.js");

  let result;
  try {
    result = await birthBeing({
      spec: {
        name,
        // Vessels get a generated credential; the father's BE:connect
        // doesn't use it (father-admit bypasses the password path).
        // Operators can override via messageObj.password if they want
        // a known credential for the vessel.
        password: messageObj.password || "x".repeat(48),
        cognition: messageObj.cognition || "scripted",
        defaultRole: messageObj.defaultRole || "global",
        parentBeingId: birtherBeingId,
        homeId: homeSpaceId,
        // The father tuple — recorded at qualities.father, immutable
        // thereafter. Future BE:connect father-admit reads this.
        father,
      },
      identity: { beingId: birtherBeingId, name: "birther" },
      moment: ctx,
    });
  } catch (err) {
    log.warn("Birther", `mate-request birth failed: ${err.message}`);
    return ctx.failure?.("internal", `birth failed: ${err.message}`)
      || { kind: "failure", ok: false, shape: "internal", reason: err.message };
  }

  const summary = `vessel-child "${result?.name || name}" born on ${localStory} ` +
    `(father=${fatherStory}/@${String(askerBeingId).slice(0, 8)}, ` +
    `child=${String(result?.beingId).slice(0, 8)})`;

  return ctx.act?.(summary) || {
    kind: "act",
    ok: true,
    content: summary,
    childBeingId: result?.beingId,
    childName: result?.name,
  };
}
