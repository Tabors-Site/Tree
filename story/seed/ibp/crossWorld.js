// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Cross-world dispatch helpers. Two halves of the receipt loop:
//
//   crossStoryDispatch  — outbound. Opens a local Act for the
//                           actor's attempt, forwards the envelope to
//                           the foreign story via canopy, and
//                           applies the peer's response back to the
//                           Act (status transition + inner face).
//
//   runVerbAsForeignActor — inbound. Builds a synthetic moment
//                           whose actorAct represents the foreign
//                           actor (no local Act row on this side),
//                           runs the substrate verb so emitFact stamps
//                           facts with crossOrigin pointing home,
//                           commits the deltaF, and returns the
//                           descriptor (the actor's inner face).
//
// Per CROSS-WORLD.md "Act lifecycle and status" + "The Inner Face":
//
//   The actor's Act lives on home. The Fact lands on the target.
//   The Act starts at "attempted" and transitions when the foreign
//   side reports back; the descriptor returned by the foreign side
//   attaches as the Act's inner face. Both updates land via the
//   handleCrossWorldResponse composite path.
//
// These helpers are the cross-STORY transport layer; cross-branch
// within the same story runs entirely in-process through the normal
// inbox / assign / sealAct flow (which already threads crossOrigin
// correctly via moment.targetHistory).

import Act from "../past/act/act.js";
import { handleCrossWorldResponse } from "../past/act/crossWorldResponse.js";
import { sealFacts } from "../past/fact/facts.js";
import { getStoryDomain } from "./address.js";

// Foreign act dedup. Every legitimate cross-story call rides a FRESH
// home-side attempt act (crossStoryDispatch opens one per dispatch),
// so a repeated (story, actId) pair is a replay, never a retry. The
// canopy layer already refuses byte-identical replays; this catches the
// stronger attacker, a compromised peer re-wrapping a captured deed in
// fresh canopy bodies. In-memory: the envelope being-sig freshness
// window bounds what a restart could let back in.
const seenForeignActs = new Map(); // "story|actId" -> expiresAt (ms)
const SEEN_ACT_TTL_MS = Number(
  process.env.CROSS_SEEN_ACT_TTL_MS || 10 * 60_000,
);
const SEEN_ACT_MAX = 50_000;

function checkAndRecordForeignAct(story, actId) {
  const now = Date.now();
  if (seenForeignActs.size > 1_000 || seenForeignActs.size >= SEEN_ACT_MAX) {
    for (const [k, exp] of seenForeignActs) {
      if (exp <= now) seenForeignActs.delete(k);
    }
  }
  // Fail closed on a flooded cache: refusing fresh work is recoverable,
  // admitting replays is not.
  if (seenForeignActs.size >= SEEN_ACT_MAX) return false;
  const key = `${story}|${actId}`;
  if (seenForeignActs.has(key)) return false;
  seenForeignActs.set(key, now + SEEN_ACT_TTL_MS);
  return true;
}

/**
 * Resolve the LOCAL target branch from an inbound cross-story address.
 *
 * The Fact lands on the TARGET's reel, on the TARGET's branch — and for
 * an inbound foreign actor the target lives on THIS substrate. Without
 * this, the synthetic moment's targetHistory stays null and
 * resolveHistoryForFact falls through to moment.actorAct.history — the
 * FOREIGN actor's branch — so the foreign-attributed fact would land on
 * a foreign-named branch reel instead of the local target's. See
 * CROSS-WORLD.md "The Fact lands on the target."
 *
 * The address may arrive as a full bridge (`home::local/space@being`);
 * we keep only the RIGHT (callee) stance so the cross-branch-bridge gate
 * (which compares left/right branches) can't refuse a legitimately
 * cross-story address. The right stance is expanded against THIS
 * story with the local default branch as the implicit context, so an
 * address with no explicit branch resolves to local main (never the
 * foreign actor's branch). No literal "0" — the #main pointer resolves
 * through getDefaultHistory.
 */
async function resolveLocalTargetHistory(address) {
  const { getDefaultHistory } =
    await import("../materials/history/historyRegistry.js");
  const localDefault = await getDefaultHistory();
  try {
    const { parse, expand, resolveHistoryPointers } =
      await import("./address.js");
    const raw = String(address || "");
    const rhs = raw.includes("::") ? raw.split("::").pop().trim() : raw;
    if (!rhs) return localDefault;
    const expandCtx = {
      currentStory: getStoryDomain(),
      currentHistory: localDefault,
    };
    const parsed = parse(rhs);
    const expanded = await resolveHistoryPointers(
      expand(parsed, expandCtx),
      expandCtx,
    );
    return expanded?.right?.history || localDefault;
  } catch {
    // Parse failure: fall back to local main. Worst case the verb path
    // re-parses and surfaces the real address error; we never let the
    // fact silently land on the foreign actor's branch.
    return localDefault;
  }
}

/**
 * Outbound cross-story dispatch. Open a local Act, forward via
 * canopy with the actor's identity tuple, apply the foreign response
 * back to the Act.
 *
 * @param {object} opts
 * @param {object} opts.envelope   { id, verb, address, payload }
 * @param {object} opts.actor      { beingId, history } — the actor's
 *                                  identity on this (home) substrate
 * @param {object} [opts.identity] { beingId, name } — caller identity
 *                                  forwarded in the envelope
 * @returns {Promise<{ actId: string, peerAck: object, status: string,
 *                     innerFaceHash: string|null }>}
 */
export async function crossStoryDispatch({ envelope, actor, identity } = {}) {
  if (!envelope?.verb || !envelope?.address) {
    throw new Error("crossStoryDispatch: envelope.verb + address required");
  }
  if (!actor?.beingId) {
    throw new Error("crossStoryDispatch: actor.beingId required");
  }
  if (!actor?.history) {
    throw new Error("crossStoryDispatch: actor.history required");
  }

  const now = new Date();
  const story = getStoryDomain();

  // 1. Open the local Act at status="attempted". The actor's chain
  // records "I attempted this cross-story call." No facts attach
  // to it; deltaF stays empty because the consequences live on the
  // foreign substrate.
  //
  // SANCTIONED DOCTRINE EXCEPTION — assign.js is the one legitimate
  // Stamp opener (presentism invariant), and this Act.create is the
  // documented second site: a cross-story attempt has no inbox
  // entry and no scheduler pick to ride (the moment it frames runs
  // on the FOREIGN substrate), so the local audit Act is opened
  // directly. The OS port should either keep this exception explicit
  // or give cross-world dispatch a synthetic assign path.
  //
  // Content-addressed like every act: identity = hash of the opening
  // chained to the actor's previous sealed act; the head advances
  // here because this open IS the row landing.
  const { computeActId, readActHead, advanceActHead } =
    await import("../past/act/actHash.js");
  const { withActChainLock } = await import("../past/act/actChainLock.js");
  const { loadSigningKey, signActDoc, signEnvelopeBeingSig } =
    await import("../past/act/actSig.js");
  // Load the actor's NAME key once (the name is the signer; the being is
  // what it acts through). The home story holds it custodially. Fall back to
  // beingId only for the pre-split / i-am case where they coincide; an
  // ordinary post-split being whose id is a content hash only resolves a key
  // via its nameId.
  const actorNameId = actor.nameId || actor.beingId;
  const signingPem = await loadSigningKey(actorNameId, actor.history);
  const opening = {
    through: actor.beingId,
    to: actor.beingId,
    ibpAddress: envelope.address,
    activeAble: null,
    inboxMessageId: null,
    inReplyTo: null,
    parentThread: null,
    startMessage: {
      content: `cross-story ${envelope.verb}`,
      source: actor.beingId,
    },
    story,
    history: actor.history,
  };
  // Open + advance under the act-chain lock (read-compute-write on
  // the head); the CAS'd advance is the cross-check.
  const actId = await withActChainLock(
    story,
    actor.history,
    actor.beingId,
    async () => {
      const p = await readActHead(story, actor.history, actor.beingId);
      const id = computeActId(p, opening);
      // Sign the attempt act too. This is the one act path that bypasses
      // sealAct (the documented Stamp-opener exception above), so the
      // signature has to be attached here to keep "every act is signed"
      // true. ΔF is empty (the consequences land on the foreign chain), so
      // factIds = [].
      const sig = await signActDoc(
        {
          _id: id,
          p,
          by: actorNameId,
          through: actor.beingId,
          to: actor.beingId,
          story,
          history: actor.history,
        },
        [],
        signingPem,
      );
      await Act.create({
        _id: id,
        p,
        by: actorNameId,
        through: actor.beingId,
        to: actor.beingId,
        ibpAddress: envelope.address,
        activeAble: null,
        inboxMessageId: null,
        inReplyTo: null,
        rootCorrelation: id,
        parentThread: null,
        receivedAt: now,
        stampedAt: now,
        startMessage: {
          content: `cross-story ${envelope.verb}`,
          source: actor.beingId,
        },
        story,
        history: actor.history,
        status: "attempted",
        sig,
      });
      await advanceActHead(story, actor.history, actor.beingId, id, { expectPrev: p });
      return id;
    },
  );
  // Stamper live loop parity: this direct open is the one seal path
  // that bypasses sealAct, so fire afterAct here too (cross-story
  // attempt acts push to stamper-space subscribers like any other).
  try {
    const { hooks } = await import("../hooks.js");
    hooks
      .run("afterAct", {
        actId,
        beingIn: actor.beingId,
        beingOut: actor.beingId,
        activeAble: null,
        endMessage: null,
        stoppedAt: now,
      })
      .catch(() => {});
  } catch {
    /* observation only */
  }

  // 2. Forward to peer with the actor's identity tuple. The
  // forwardToPeer import is lazy so this seed module doesn't pull
  // protocols/ at module-load time.
  const { forwardToPeer } = await import("../../protocols/ibp/canopy.js");
  // Sign the deed with the actor's own NAME key: this verb, on this address,
  // with this payload, tied to the home act just opened. The receiving story
  // verifies it self-certifyingly against the NAME (actorNameId) — no callback
  // home. Null when the actor has no local name key (anonymous / keyless, or a
  // foreign name with no local custody); the call still forwards under the
  // story-level canopy sig (and a strict peer refuses the unsigned envelope).
  const beingSig = await signEnvelopeBeingSig(
    {
      verb: envelope.verb,
      address: envelope.address,
      payload: envelope.payload,
      nameId: actorNameId,
      actId,
      history: actor.history,
      story,
    },
    signingPem,
  );
  const peerAck = await forwardToPeer({
    ...envelope,
    identity: identity || {
      beingId: actor.beingId,
      name: null,
      nameId: actor.nameId || null,
    },
    actorHistory: actor.history,
    actorActId: actId,
    beingSig,
  });

  // 3. Map the peerAck shape to the cross-world response shape and
  // apply it to the Act. Status terminal pick:
  //   ok                  → landed
  //   PEER_UNREACHABLE    → unreachable
  //   PEER_NOT_FOUND      → unreachable
  //   INVALID_INPUT       → malformed
  //   FORBIDDEN           → denied
  //   any other error     → denied (foreign side rejected)
  let status;
  if (peerAck.status === "ok") {
    status = "landed";
  } else {
    const code = peerAck.error?.code;
    if (code === "PEER_UNREACHABLE" || code === "PEER_NOT_FOUND") {
      status = "unreachable";
    } else if (code === "INVALID_INPUT") {
      status = "malformed";
    } else {
      status = "denied";
    }
  }
  const descriptor = peerAck.data?.descriptor || null;
  const result = await handleCrossWorldResponse(actId, {
    status,
    descriptor,
    meta: peerAck.error || null,
  });

  return {
    actId,
    peerAck,
    status: result.status,
    innerFaceHash: result.innerFaceHash,
  };
}

/**
 * Inbound cross-story dispatch. Run a substrate verb as the foreign
 * actor. The synthetic moment carries actorAct as a JS object —
 * NOT a Mongo row, since the actor's Act lives on their home
 * substrate. emitFact reads { story, history, through, _id } off this
 * object to compute the crossOrigin block for any facts the verb
 * produces. After the verb returns, sealFacts commits the deltaF.
 *
 * Returns the descriptor; the dispatcher embeds it in the response
 * body as the actor's inner face.
 *
 * @param {object} opts
 * @param {("see"|"do"|"summon"|"be")} opts.verb
 * @param {string} opts.address    IBP address string
 * @param {object} opts.payload    verb-specific payload
 * @param {object} opts.actor      { story, history, beingId, actId }
 *                                  the foreign actor's identity tuple
 * @param {object} [opts.carrier]  the original carrier (for identity
 *                                  + canopySender propagation)
 * @returns {Promise<{ descriptor: object|null, result: any }>}
 */
export async function runVerbAsForeignActor({
  verb,
  address,
  payload,
  actor,
  carrier,
} = {}) {
  if (!verb || !address) {
    throw new Error("runVerbAsForeignActor: verb + address required");
  }
  if (!actor?.story || !actor?.history || !actor?.beingId || !actor?.actId) {
    throw new Error(
      "runVerbAsForeignActor: actor must carry { story, history, beingId, actId }",
    );
  }

  // Cross-story being-sig gate, BEFORE any verb work or seal. If the
  // envelope carries the actor's own signature over { verb, address,
  // payload, nameId, actId, history, story }, verify it against the actor's
  // NAME (which IS the pubkey) — self-certifying, no callback to the actor's
  // home story. A present-but-invalid sig is a hard refusal; an absent sig
  // is accepted (the story-level canopy sig that got us here already
  // vouched, and peers may not sign yet).
  const actorNameId = actor.nameId || actor.beingId;
  let beingSigVerified = false;
  {
    const { verifyEnvelopeBeingSig } = await import("../past/act/actSig.js");
    const v = await verifyEnvelopeBeingSig(
      {
        verb,
        address,
        payload,
        nameId: actorNameId,
        actId: actor.actId,
        history: actor.history,
        story: actor.story,
      },
      actor.beingSig,
    );
    if (!v.ok) {
      throw new Error(
        `runVerbAsForeignActor: cross-story being-sig verification failed (${v.reason})`,
      );
    }
    // "being" = the actor's OWN signature verified against its key id.
    // The advisory passes (unsigned peer, non-key signer) flow on under
    // the canopy domain sig, but downstream high-stakes gates (cherub's
    // father-admit) can demand the real thing via this flag.
    beingSigVerified = v.reason === "being";

    // Per-peer strict mode. A peer registered with requireSignedEnvelopes
    // loses the advisory floor: every envelope from it must carry the
    // actor's own verified signature. Set it for peers known to sign
    // (same-generation seeds); leave it off for migration-era peers.
    // No peer row (direct in-process callers, tests) keeps today's
    // advisory behavior.
    if (!beingSigVerified) {
      const { getPeerByDomain } = await import("../../protocols/ibp/peers.js");
      const peer = await getPeerByDomain(actor.story).catch(() => null);
      if (peer?.requireSignedEnvelopes) {
        throw new Error(
          `runVerbAsForeignActor: cross-story being-sig verification failed ` +
            `(peer ${actor.story} requires signed envelopes; got ${v.reason})`,
        );
      }
    }
  }

  // Foreign act replay gate. AFTER signature checks (a refused envelope
  // must not burn its actId), BEFORE any verb work or seal.
  if (!checkAndRecordForeignAct(actor.story, actor.actId)) {
    throw new Error(
      `runVerbAsForeignActor: foreign act ${String(actor.actId).slice(0, 16)}… ` +
        `from ${actor.story} was already dispatched (replay refused)`,
    );
  }

  // Synthetic actorAct. NOT a Mongoose row on this substrate. emitFact
  // reads the four identity fields off it to derive crossOrigin.
  const actorAct = {
    _id: actor.actId,
    by: actorNameId,
    through: actor.beingId,
    story: actor.story,
    history: actor.history,
  };

  // Synthetic moment. Carries actorAct + deltaF for emitFact to push
  // onto. targetHistory is the LOCAL target's branch on THIS substrate,
  // resolved from the inbound address: the Fact lands on the target's
  // reel/branch, NOT the foreign actor's branch (actorAct.history). The
  // precedence in resolveHistoryForFact puts targetHistory above
  // actorAct.history, so seating it here is what keeps a foreign-named
  // fact on the correct local reel.
  const targetHistory = await resolveLocalTargetHistory(address);
  const moment = {
    actId: actor.actId,
    actorAct,
    deltaF: [],
    afterSeal: [],
    targetHistory,
  };

  const identity = {
    beingId: actor.beingId,
    name: null,
    // The NAME the foreign actor signed as (verified self-certifyingly above).
    // Cherub's father-admit matches the being's qualities.father.nameId
    // against THIS (the proven id), never the client-supplied beingId.
    nameId: actorNameId,
    // The verifyIncoming middleware will already have stamped
    // req.canopySender; authorize sees it via carrier.
    canopyVerifiedSender: actor.story,
    // `story` is the canopy-verified home story of the foreign
    // actor. Downstream gates (e.g. cherub's BE:connect father-admit
    // check) read this to match against the target being's
    // qualities.father.story. See FEDERATION.md "mate + being".
    story: actor.story,
    // True only when the actor's own envelope signature verified
    // against its key id (self-certifying). Father-admit requires it:
    // taking over a being needs the father's OWN key, not just the
    // peer story's vouch.
    beingSigVerified,
  };

  let result = null;
  if (verb === "see") {
    const { seeVerb } = await import("./verbs/see.js");
    result = await seeVerb(address, { identity, moment });
  } else if (verb === "do") {
    const { doVerb } = await import("./verbs/do.js");
    result = await doVerb(
      payload?.target || null,
      payload?.act,
      payload?.args || {},
      { identity, moment },
    );
  } else if (verb === "call") {
    const { callVerb } = await import("./verbs/call.js");
    result = await callVerb(address, payload?.message, { identity, moment });
  } else if (verb === "be") {
    const { beVerb } = await import("./verbs/be.js");
    result = await beVerb(payload?.act, payload?.opPayload, {
      identity,
      moment,
    });
  } else {
    throw new Error(`runVerbAsForeignActor: unknown verb "${verb}"`);
  }

  // Commit any facts the verb pushed onto moment.deltaF. emitFact's
  // crossOrigin attachment already fired (since actorAct's world ≠
  // the local target's world for these facts).
  if (moment.deltaF.length > 0) {
    await sealFacts(moment.deltaF);
  }

  // Run afterSeal callbacks. callByResolved queues `wake()` here when
  // it enqueues a SUMMON onto a receiver's inbox (triggerOn:["message"]
  // ables); without firing the callbacks, the receiver's runLoop never
  // starts and the inbox entry sits forever. Same shape stamped.js
  // uses to drain afterSeal at moment seal. This is the missing seam
  // for cross-story SUMMONs to actually deliver — the normal sealAct
  // path wasn't entered (we have no local Act for the foreign actor),
  // so the seam has to live here.
  if (Array.isArray(moment.afterSeal) && moment.afterSeal.length > 0) {
    for (const cb of moment.afterSeal) {
      try {
        await cb();
      } catch (err) {
        const log = (await import("../seedStory/log.js")).default;
        log.warn("CrossWorld", `afterSeal callback failed: ${err.message}`);
      }
    }
  }

  // The descriptor IS the actor's inner face. For SEE the result IS
  // the descriptor; for other verbs we re-derive the descriptor at the
  // target so the actor's chain captures "what the world looked like
  // at the moment of the act."
  let descriptor = null;
  if (verb === "see" && result && typeof result === "object") {
    descriptor = result;
  } else {
    try {
      const { seeVerb } = await import("./verbs/see.js");
      descriptor = await seeVerb(address, { identity, moment: null });
    } catch {
      descriptor = null;
    }
  }

  void carrier; // reserved for future per-carrier overrides (e.g. socket bound output channels)
  return { descriptor, result };
}
