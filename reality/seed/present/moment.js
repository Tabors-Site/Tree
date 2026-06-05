// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// moment.js — one moment, start to finish.
//
// A moment is the atom (see philosophy/MOMENT.md). It has exactly
// four beats:
//
//   1. assign     — mint actId, plan the Act, resolve who acts
//                   (assign.js). DOES NOT WRITE the Act row.
//   2. fold       — mount the face (fold/)
//   3. momentum   — the being's act (momentum.js). Returns a
//                   CognitionResult: { ok: true, content } or
//                   { ok: false, shape, reason }.
//   4. stamped    — IF ok:true: write the Act row (seal). IF
//                   ok:false: no Act row, no seal, release.
//
// moment.js is the conductor — it walks the four beats in order
// and routes the moment's outcome (raw verb result for transport
// acts; SUMMON-reply row for received SUMMONs) back to whoever's
// waiting. It owns no business logic of its own; each beat is its
// own file.
//
// **Round 5 structural change.** The seal is GATED on
// CognitionResult.ok. Cognition cannot produce text — it produces
// a discriminated result whose type makes failure unrepresentable
// at the seal. A failed cognition is a moment whose act is ∅
// (MODEL.md: SEE = a=∅ = seals nothing). No Act row is written.
// The InboxProjection stays open automatically — no answering Act
// exists to close it. The being's reel and act-chain are byte-
// identical to before the failed moment. Zero trace.
//
// See seed/present/cognition/cognitionResult.js for the CognitionResult contract.
//
// The intake queue and per-being serial behavior live in
// intake/scheduler.js; the scheduler calls runMoment() once per
// pending intake entry and is otherwise out of the moment's
// business.

import log from "../seedReality/log.js";
import { assign }   from "./beats/1-assign.js";
import { momentum } from "./beats/3-momentum.js";
import { sealAct }  from "./beats/4-stamped.js";
import { markIntakeRunning, markIntakeComplete } from "./intake/intake.js";
import { closeInboxOnAnswer } from "../past/projections/inbox/inboxProjectionFold.js";
import { buildResponseEntry } from "./replies.js";
import { buildFacadeSnapshot } from "./beats/2-fold/facadeSnapshot.js";
import { resolveBareCapabilities } from "./roles/capabilities.js";

/**
 * Run one moment for a being. Walks all four beats; never throws —
 * errors land as a CognitionResult({ ok:false, shape:"internal" })
 * and the moment releases with no Act row.
 *
 * @param {object} opts
 * @param {string} opts.beingId        the acting being's id
 * @param {string} opts.spaceId        the intake-storing space
 * @param {object} opts.entry          the intake entry (kind, correlation, ...)
 * @param {number} opts.index          the entry's array index (for intake state)
 * @param {object} [opts.handoff]      runtime context stashed at SUMMON-time
 * @param {AbortController} opts.controller  the abort signal that propagates into the act
 * @returns {Promise<{ actId: string|null, result: any, responseEntry: object|null }>}
 *   actId is non-null only when the Act row materialized (cognition
 *   ok:true OR abort path). On ok:false failure, actId is null and
 *   no Mongo state changed.
 */
export async function runMoment({ beingId, spaceId, entry, index, handoff = null, controller } = {}) {
  if (!controller) throw new Error("runMoment requires an AbortController");

  const isTransportAct = entry.kind === "transport-act";

  await markIntakeRunning(spaceId, beingId, index);

  let setup = null;
  let cognition = null;       // CognitionResult
  let rawResult = null;       // transport-act verb return (ride-along)
  let responseEntry = null;
  let actInserted = null;     // the Act row, when one materializes

  try {
    // ── Beat 1: assign mints actId + plans the Act. No Mongo write. ──
    setup = await assign({
      beingId,
      spaceId,
      entry,
      handoff,
      signal: controller.signal,
    });
    if (setup.skipped) {
      // assign couldn't run this entry (being missing, role not
      // carried, role not registered). Already logged inside assign.
      // No actId, no Act row, no inbox close.
      return { actId: null, result: null, responseEntry: null };
    }

    // ── Beat 3: momentum runs the act. Returns CognitionResult. ──
    cognition = await momentum(setup);
  } catch (err) {
    // Conductor-level failure (assign threw, momentum threw before
    // its own try/catch). Treat as cognition failure: no Act row.
    if (controller.signal.aborted) {
      log.info("Moment", `aborted being=${beingId.slice(0, 8)} corr=${entry.correlation.slice(0, 8)}: ${err.message}`);
      cognition = { kind: "failure", ok: false, shape: "aborted", reason: err.message };
    } else {
      log.error("Moment", `errored being=${beingId.slice(0, 8)}: ${err.message}`);
      cognition = { kind: "failure", ok: false, shape: "internal", reason: err.message };
      if (handoff?.onError) {
        try { handoff.onError(err, entry); } catch {}
      }
    }
  }

  // ── Beat 4: seal-gate. ──
  // Three discriminated paths, by cognition.kind:
  //   "act"     . Act row writes; ΔF commits with it; replies fire.
  //   "see"     . No Act row. The no-act release: the being looked
  //               and chose not to act. Two routes feed this in the
  //               LLM path: (a) explicit end-turn tool call —
  //               deliberate "I have seen, I will not act"; (b) no
  //               tool call at all — implicit release. Same outcome
  //               either way. The inbox row CLOSES (the moment ran
  //               to completion). No eviction-as-failure, no onError
  //               handoff.
  //   "failure" . No Act row, ever — including the aborted shape.
  //               Inbox eviction depends on whether the failure is
  //               deterministic (garbage, internal, transport-act —
  //               evict) or transient (aborted — keep the row for
  //               the scheduler's next pickup; a HUMAN-priority cut
  //               or user cancel can plausibly succeed on retry).
  //
  // Per the MODEL.md doctrine: a moment that produces nothing leaves
  // zero trace. SEE and every failure shape — aborted included —
  // share that property. The earlier "aborted seals stopped:true"
  // legacy stub was retired; sealAct now refuses to write an Act
  // with no content and no Facts as a structural invariant.
  try {
    if (setup?.plannedAct && cognition?.kind === "act") {
      // ── Cognition succeeded. Build seal content + seal the Act. ──
      let sealContent;
      if (isTransportAct) {
        // Transport-act: the act IS the verb call. endMessage.content
        // is null (no closing utterance); the verb's return rides on
        // cognition.verbResult for the handoff.
        sealContent = null;
        rawResult = cognition.verbResult ?? null;
      } else {
        sealContent = cognition.content;
        responseEntry = buildResponseEntry({
          result: { text: cognition.content },
          handoff,
          originalEntry: entry,
        });
      }

      // Carry the bounded record of the face the cognition acted
      // under onto the Act row. The LLM cognition mouth builds and
      // stashes it on summonCtx during the prompt assembly. Scripted
      // cognitions and transport-acts don't go through that path, so
      // we build a fallback snapshot here from whatever the moment
      // resolved (role + summonCtx) — universal capture per INNER-
      // FOLD §6, no half-records on the act-chain.
      if (!setup.summonCtx?.facadeSnapshot) {
        await applyFallbackSnapshot({ setup, beingId, isTransportAct });
      }
      setup.plannedAct.facadeSnapshot = setup.summonCtx?.facadeSnapshot ?? null;

      actInserted = await sealAct(setup.plannedAct, {
        content: sealContent,
        stopped: false,
        deltaF:    setup.summonCtx?.deltaF    || [],
        afterSeal: setup.summonCtx?.afterSeal || [],
      });

      // Continuation is the role's call, not the seed's. A being that
      // wants to step again emits SUMMON(self) as part of its act —
      // explicit, in deltaF, atomic with the seal, with whatever
      // orientation the next moment should fold at. The seed used to
      // synthesize a post-seal forward self-summon for roles that
      // declared `selfContinue:true`, but that hid the loop, hard-
      // wired forward, and double-queued when the role also emitted
      // its own self-summon. Doctrine: "only SUMMONs make SUMMONs"
      // means every wake-call traces to an explicit summon emission
      // by a being, not a post-seal side effect.
      //
      // Transport-acts are still pre-decided keystroke-like; no loop
      // semantics apply.
    } else if (setup?.plannedAct && cognition?.kind === "see") {
      // ── No-act release. The being looked and chose not to act. ──
      // Whether the LLM called end-turn (the explicit deliberate
      // release) or simply emitted no tool call (the implicit
      // release), llmMoment returns cognitionSee() and we land here.
      // Distinct from failure: this is a complete moment, the inbox
      // closes cleanly. No Act row, no eviction-as-failure, no
      // onError handoff.
      try { await closeInboxOnAnswer(entry.correlation); } catch {}
      log.info(
        "Moment",
        `saw being=${beingId.slice(0, 8)} . no act sealed (clean release)`,
      );
    } else if (setup?.plannedAct) {
      // kind:"failure" (every shape, including aborted). NO Act row
      // written. What happens to the inbox row depends on whether
      // the failure is DETERMINISTIC (retrying produces the same
      // failure) or TRANSIENT (a later attempt could plausibly
      // succeed).
      //
      //   transport-act, any shape    — deterministic. The user did a
      //                                 specific act; it failed with a
      //                                 specific reason. Evict.
      //
      //   summon, shape:"garbage"     — deterministic. The role
      //                                 returned null/undefined — it
      //                                 doesn't have a sync handler
      //                                 for this. Canonical case:
      //                                 SUMMON to a human (human role
      //                                 returns null because humans
      //                                 respond from their transport).
      //                                 Retrying produces the same
      //                                 null. Evict.
      //
      //   summon, shape:"internal"    — deterministic in practice. A
      //                                 thrown error during cognition.
      //                                 Most are code-level (e.g.
      //                                 "target must be a Being") or
      //                                 config-level (e.g. "no LLM
      //                                 connection"). Evict.
      //
      //   summon, shape:"aborted"     — TRANSIENT. The moment was
      //                                 aborted externally (HUMAN-
      //                                 priority cut, user cancel).
      //                                 Leave the row; a later attempt
      //                                 may run cleanly. No onError
      //                                 either: abort is not a failure
      //                                 the wire-caller needs to hear
      //                                 about — they caused it.
      //
      //   summon, other shapes        — leave for now; surface as new
      //                                 shapes get added.
      //
      // Fire onError on every eviction path so the wire-side caller
      // gets a fast failure instead of timing out.
      const shape = cognition?.shape;
      const shouldEvict =
        isTransportAct ||
        shape === "garbage" ||
        shape === "internal";

      if (shouldEvict) {
        try { await closeInboxOnAnswer(entry.correlation); } catch {}
        if (handoff?.onError) {
          try {
            handoff.onError(
              Object.assign(
                new Error(cognition?.reason || `${shape || "unknown"} failure`),
                { shape: shape || "internal" },
              ),
            );
          } catch {}
        }
      }
      log.info(
        "Moment",
        `released being=${beingId.slice(0, 8)} ` +
        `shape=${shape || "unknown"} ` +
        `reason="${(cognition?.reason || "").slice(0, 80)}" — no Act written` +
        (shouldEvict ? " (inbox row evicted)" : ""),
      );
    }
  } catch (err) {
    // sealAct (or anything else in the seal branch above) threw. This
    // is a SUBSTRATE failure — distinct from a cognition failure: the
    // cognition decided to act and produced an act-shape return, but
    // the substrate refused to seal it (no facts + no endMessage, an
    // index conflict, a fact-emission throw mid-sealAct, etc.).
    //
    // The cognition-failure branch above handles its own
    // closeInboxOnAnswer + handoff.onError. Substrate failures land
    // here and used to do neither — which left the InboxProjection row
    // permanently OPEN. Every subsequent wake re-picked that row first
    // (oldest sentAt wins in pickNextIntake), the seenCorrelations
    // guard broke out of the loop, and the being's queue was frozen
    // until process restart (no per-being state surviving in scheduler,
    // just the un-evicted DB row).
    //
    // Treat substrate failures as DETERMINISTIC: retrying produces the
    // same failure. Evict the row, fire onError so the wire-caller
    // gets a fast failure instead of timing out, log the cause.
    log.warn("Moment", `seal failed: ${err.message}`);
    try { await closeInboxOnAnswer(entry.correlation); } catch {}
    if (handoff?.onError) {
      try {
        handoff.onError(
          Object.assign(
            new Error(err?.message || "substrate seal refused"),
            { shape: "internal", cause: "seal-failed" },
          ),
        );
      } catch {}
    }
  }

  // ── Bookkeeping. ──
  // markIntakeComplete is a no-op tombstone today (see intake.js)
  // but we still call it for any callers that haven't migrated.
  try {
    await markIntakeComplete(spaceId, beingId, [entry.correlation], {
      responseId: responseEntry?.correlation || null,
      actId:      responseEntry?.actId || (actInserted ? String(actInserted._id) : null),
    });
  } catch (err) {
    log.warn("Moment", `markIntakeComplete failed: ${err.message}`);
  }

  // Handoff: only fire onResponse when something actually happened.
  // For transport-act: fire with the verb return + actId (when sealed).
  // For summon: fire with the response entry (built only on ok:true).
  // For ok:false: no handoff fires — the asker's onResponse is for
  // delivering an answer, and there is no answer.
  if (handoff?.onResponse && actInserted) {
    try {
      if (isTransportAct) {
        handoff.onResponse({ result: rawResult, actId: String(actInserted._id) });
      } else if (responseEntry) {
        handoff.onResponse(responseEntry);
      }
    } catch {}
  }

  return {
    actId: actInserted ? String(actInserted._id) : null,
    result: rawResult,
    responseEntry,
  };
}

/**
 * Build a fallback facadeSnapshot for moments whose cognition path
 * didn't already build one (scripted-cognition roles, transport-acts,
 * and anything else that lands an act through momentum without going
 * through llmMoment's snapshot capture). Universal capture per
 * INNER-FOLD §6: every act-chain entry carries the bounded record of
 * the face the act was committed under; no half-records.
 *
 * For transport-acts the snapshot still records orientation + role +
 * capabilities + position. The "act was pre-decided" framing doesn't
 * change what the chain stores — the chain stores what was around
 * the being when the deed sealed, regardless of who decided.
 *
 * Failures swallow with a warn — never block a seal on snapshot
 * build trouble; null persists fine and the renderer falls back.
 */
async function applyFallbackSnapshot({ setup, beingId, isTransportAct }) {
  try {
    const role = setup?.role;
    const summonCtx = setup?.summonCtx;
    if (!role || !summonCtx) return;

    const orientation = summonCtx.orientation || "forward";
    const currentSpace =
      summonCtx.currentSpace ||
      setup.plannedAct?.currentSpace ||
      null;

    const beingCtx = {
      being: summonCtx.being || null,
      role,
      currentSpace,
      rootId: summonCtx.rootId || null,
      name: summonCtx.name || null,
    };
    const capabilities = await resolveBareCapabilities(role, beingCtx);

    const snapshot = buildFacadeSnapshot({
      orientation,
      role: role?.name || null,
      // Non-LLM paths don't run foldPlace as part of their dispatch
      // (transport-act runs the verb directly; scripted roles do
      // whatever code they do). The face here records the bare
      // position id without a folded occupant list — the chain
      // still carries the orientation, role, capabilities, and the
      // where. A richer fold could land later if any future scripted
      // cognition wants its forward face captured.
      face: {
        space: currentSpace ? { _id: currentSpace, name: null } : null,
        occupants: [],
      },
      capabilities,
    });
    summonCtx.facadeSnapshot = snapshot;
    if (isTransportAct) {
      log.debug("Moment", `transport-act snapshot captured for being=${beingId.slice(0, 8)}`);
    }
  } catch (err) {
    log.warn("Moment", `fallback facadeSnapshot build failed: ${err.message}`);
  }
}

