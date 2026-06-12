// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Cross-world dispatch helpers. Two halves of the receipt loop:
//
//   crossRealityDispatch  — outbound. Opens a local Act for the
//                           actor's attempt, forwards the envelope to
//                           the foreign reality via canopy, and
//                           applies the peer's response back to the
//                           Act (status transition + inner face).
//
//   runVerbAsForeignActor — inbound. Builds a synthetic summonCtx
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
// These helpers are the cross-REALITY transport layer; cross-branch
// within the same reality runs entirely in-process through the normal
// inbox / assign / sealAct flow (which already threads crossOrigin
// correctly via summonCtx.targetBranch).

import Act from "../past/act/act.js";
import { handleCrossWorldResponse } from "../past/act/crossWorldResponse.js";
import { sealFacts } from "../past/fact/facts.js";
import { getRealityDomain } from "./address.js";

/**
 * Outbound cross-reality dispatch. Open a local Act, forward via
 * canopy with the actor's identity tuple, apply the foreign response
 * back to the Act.
 *
 * @param {object} opts
 * @param {object} opts.envelope   { id, verb, address, payload }
 * @param {object} opts.actor      { beingId, branch } — the actor's
 *                                  identity on this (home) substrate
 * @param {object} [opts.identity] { beingId, name } — caller identity
 *                                  forwarded in the envelope
 * @returns {Promise<{ actId: string, peerAck: object, status: string,
 *                     innerFaceHash: string|null }>}
 */
export async function crossRealityDispatch({ envelope, actor, identity } = {}) {
  if (!envelope?.verb || !envelope?.address) {
    throw new Error("crossRealityDispatch: envelope.verb + address required");
  }
  if (!actor?.beingId) {
    throw new Error("crossRealityDispatch: actor.beingId required");
  }
  if (!actor?.branch) {
    throw new Error("crossRealityDispatch: actor.branch required");
  }

  const now = new Date();
  const reality = getRealityDomain();

  // 1. Open the local Act at status="attempted". The actor's chain
  // records "I attempted this cross-reality call." No facts attach
  // to it; deltaF stays empty because the consequences live on the
  // foreign substrate.
  //
  // SANCTIONED DOCTRINE EXCEPTION — assign.js is the one legitimate
  // Stamp opener (presentism invariant), and this Act.create is the
  // documented second site: a cross-reality attempt has no inbox
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
  const opening = {
    beingIn: actor.beingId,
    beingOut: actor.beingId,
    ibpAddress: envelope.address,
    activeRole: null,
    inboxMessageId: null,
    inReplyTo: null,
    parentThread: null,
    startMessage: {
      content: `cross-reality ${envelope.verb}`,
      source: actor.beingId,
    },
    reality,
    branch: actor.branch,
  };
  // Open + advance under the act-chain lock (read-compute-write on
  // the head); the CAS'd advance is the cross-check.
  const actId = await withActChainLock(actor.branch, actor.beingId, async () => {
    const p = await readActHead(actor.branch, actor.beingId);
    const id = computeActId(p, opening);
    await Act.create({
      _id: id,
      p,
      beingIn: actor.beingId,
      beingOut: actor.beingId,
      ibpAddress: envelope.address,
      activeRole: null,
      inboxMessageId: null,
      inReplyTo: null,
      rootCorrelation: id,
      parentThread: null,
      receivedAt: now,
      stampedAt: now,
      startMessage: {
        content: `cross-reality ${envelope.verb}`,
        source: actor.beingId,
      },
      reality,
      branch: actor.branch,
      status: "attempted",
    });
    await advanceActHead(actor.branch, actor.beingId, id, { expectPrev: p });
    return id;
  });
  // Stamper live loop parity: this direct open is the one seal path
  // that bypasses sealAct, so fire afterAct here too (cross-reality
  // attempt acts push to stamper-space subscribers like any other).
  try {
    const { hooks } = await import("../hooks.js");
    hooks.run("afterAct", {
      actId,
      beingIn: actor.beingId,
      beingOut: actor.beingId,
      activeRole: null,
      endMessage: null,
      stoppedAt: now,
    }).catch(() => {});
  } catch { /* observation only */ }

  // 2. Forward to peer with the actor's identity tuple. The
  // forwardToPeer import is lazy so this seed module doesn't pull
  // protocols/ at module-load time.
  const { forwardToPeer } = await import("../../protocols/ibp/canopy.js");
  const peerAck = await forwardToPeer({
    ...envelope,
    identity: identity || { beingId: actor.beingId, name: null },
    actorBranch: actor.branch,
    actorActId: actId,
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
 * Inbound cross-reality dispatch. Run a substrate verb as the foreign
 * actor. The synthetic summonCtx carries actorAct as a JS object —
 * NOT a Mongo row, since the actor's Act lives on their home
 * substrate. emitFact reads { reality, branch, beingIn, _id } off this
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
 * @param {object} opts.actor      { reality, branch, beingId, actId }
 *                                  the foreign actor's identity tuple
 * @param {object} [opts.carrier]  the original carrier (for identity
 *                                  + canopySender propagation)
 * @returns {Promise<{ descriptor: object|null, result: any }>}
 */
export async function runVerbAsForeignActor({ verb, address, payload, actor, carrier } = {}) {
  if (!verb || !address) {
    throw new Error("runVerbAsForeignActor: verb + address required");
  }
  if (!actor?.reality || !actor?.branch || !actor?.beingId || !actor?.actId) {
    throw new Error(
      "runVerbAsForeignActor: actor must carry { reality, branch, beingId, actId }",
    );
  }

  // Synthetic actorAct. NOT a Mongoose row on this substrate. emitFact
  // reads the four identity fields off it to derive crossOrigin.
  const actorAct = {
    _id: actor.actId,
    beingIn: actor.beingId,
    reality: actor.reality,
    branch: actor.branch,
  };

  // Synthetic summonCtx. Carries actorAct + deltaF for emitFact to push
  // onto. targetBranch will be filled in by the verb handler from the
  // parsed target address (it's the local target's branch on THIS
  // substrate).
  const summonCtx = {
    actId: actor.actId,
    actorAct,
    deltaF: [],
    afterSeal: [],
    // targetBranch is the LOCAL target's branch — verb handler fills
    // it in from the parsed address before dispatching ops.
    targetBranch: null,
  };

  const identity = {
    beingId: actor.beingId,
    name: null,
    // The verifyIncoming middleware will already have stamped
    // req.canopySender; authorize sees it via carrier.
    canopyVerifiedSender: actor.reality,
    // `reality` is the canopy-verified home reality of the foreign
    // actor. Downstream gates (e.g. cherub's BE:connect father-admit
    // check) read this to match against the target vessel's
    // qualities.father.reality. See FEDERATION.md "mate + vessel".
    reality: actor.reality,
  };

  let result = null;
  if (verb === "see") {
    const { seeVerb } = await import("./verbs/see.js");
    result = await seeVerb(address, { identity, summonCtx });
  } else if (verb === "do") {
    const { doVerb } = await import("./verbs/do.js");
    result = await doVerb(
      payload?.target || null,
      payload?.action,
      payload?.args || {},
      { identity, summonCtx },
    );
  } else if (verb === "summon") {
    const { summonVerb } = await import("./verbs/summon.js");
    result = await summonVerb(
      address,
      payload?.message,
      { identity, summonCtx },
    );
  } else if (verb === "be") {
    const { beVerb } = await import("./verbs/be.js");
    result = await beVerb(
      payload?.op,
      payload?.opPayload,
      { identity, summonCtx },
    );
  } else {
    throw new Error(`runVerbAsForeignActor: unknown verb "${verb}"`);
  }

  // Commit any facts the verb pushed onto summonCtx.deltaF. emitFact's
  // crossOrigin attachment already fired (since actorAct's world ≠
  // the local target's world for these facts).
  if (summonCtx.deltaF.length > 0) {
    await sealFacts(summonCtx.deltaF);
  }

  // Run afterSeal callbacks. summonByResolved queues `wake()` here when
  // it enqueues a SUMMON onto a receiver's inbox (triggerOn:["message"]
  // roles); without firing the callbacks, the receiver's runLoop never
  // starts and the inbox entry sits forever. Same shape stamped.js
  // uses to drain afterSeal at moment seal. This is the missing seam
  // for cross-reality SUMMONs to actually deliver — the normal sealAct
  // path wasn't entered (we have no local Act for the foreign actor),
  // so the seam has to live here.
  if (Array.isArray(summonCtx.afterSeal) && summonCtx.afterSeal.length > 0) {
    for (const cb of summonCtx.afterSeal) {
      try { await cb(); }
      catch (err) {
        const log = (await import("../seedReality/log.js")).default;
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
      descriptor = await seeVerb(address, { identity, summonCtx: null });
    } catch {
      descriptor = null;
    }
  }

  void carrier; // reserved for future per-carrier overrides (e.g. socket bound output channels)
  return { descriptor, result };
}
