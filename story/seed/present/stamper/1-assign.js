// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// assign.js — beat one of the stamping. Who acts, and the moment
// opens its frame.
//
// Scheduler picks an intake entry off a being's line and hands it
// here. assign loads the receiver Being, resolves the active able,
// checks able-carry, mints the actId, computes the act's derived
// fields (ibpAddress, rootCorrelation, parentThread), and builds the
// summon context the moment's dispatch needs. It returns
// { actId, plannedAct, able, moment } for moment to dispatch, or
// { skipped } when the entry can't run.
//
// **assign no longer writes the Act row to Mongo** (Round 5).
// The Act row is created at seal-time by stamped.js, only when
// cognition returned ok:true. On ok:false the Act row never
// materializes — that's how "no Act row for the failed moment" is
// structurally enforced. Tool-calls during the moment do NOT write
// Facts directly either: emitFact accumulates into moment.deltaF
// and the whole ΔF commits atomically with the Act at seal (Phase 2,
// facts.js / 4-stamped.js). A failed moment therefore leaves NOTHING
// on the chain — no orphan facts, no act row. See
// seed/present/cognition/cognitionResult.js for the CognitionResult
// contract.
//
// Two intake kinds reach assign:
//
//   kind: "call"
//     A SUMMON the being received. moment carries the message
//     shape; moment.js calls able.call(message, ctx).
//
//   kind: "transport-act"
//     The being acted from their own transport (portal/browser/CLI).
//     moment carries the act payload { verb, target, action, args };
//     moment.js dispatches it directly through doVerb/beVerb. No
//     able.summon handler runs — the act was already decided
//     externally.
//
// Opening the row IS part of beat one. presentism: a being only
// exists as a moment, so when the scheduler picks an intake entry
// and assign resolves who acts, the Act that frames the moment
// opens here. Every DO and BE the being emits during the moment
// carries this actId. stamped.js presses the closing face when
// the moment ends.
//
// genesis is the one exception: the I-Am's first BE has no
// summoner, so it bootstraps its own first Act out-of-band in
// boot code. Every other Act opens here.
//
// The four beats of a stamping:
//   assign.js   who acts + open the frame   (this file)
//   fold/       read the present
//   moment.js   the being acting
//   stamped.js  press the closing face

import log from "../../seedStory/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import {
  loadProjection,
  loadOrFold,
  assertHistoryOrThrow,
} from "../../materials/projections.js";
import { getActById } from "../../past/act/actChain.js";
import { getStoryConfigValue } from "../../storyConfig.js";
import {
  resolveActiveStack,
  computeAvailableAbles,
} from "../ables/flow.js";
import { composeStack } from "../ables/ableComposer.js";
import { computeIbpStampAddress } from "../../ibp/address.js";
import {
  validateOrientation,
  DEFAULT_ORIENTATION,
} from "./2-fold/orientation.js";
import {
  isAncestorOf,
  beingCognition,
} from "../../materials/being/identity/lookups.js";
import { findLastSealedForBeing } from "./2-fold/reelChains.js";
import { getSpaceRootId } from "../../sprout.js";

/**
 * Set up one moment for stamping. Loads the being, resolves the
 * active able, opens the Act row, and builds the summon ctx.
 *
 * Dispatches by entry.kind:
 *   "summon"        — message-shaped ctx; moment calls able.summon
 *   "transport-act" — act-shaped ctx ({ verb, target, action, args });
 *                     moment dispatches the wrapped verb directly
 *
 * @param {object} opts
 * @param {string} opts.beingId       — receiver / acting being
 * @param {string} opts.spaceId       — position the entry landed at
 * @param {object} opts.entry         — the intake row (kind, correlation, ...)
 * @param {object} [opts.handoff]     — runtime context stashed by SUMMON (identity, resolved, ...)
 * @param {AbortSignal} [opts.signal] — abort propagating from the scheduler's controller
 *
 * @returns {Promise<{ actId?, able?, moment?, skipped? }>}
 *   actId    — the Act row this moment opened (always present on success)
 *   able       — resolved able spec
 *   moment  — the prepared context moment.js dispatches on (carries actId + kind)
 *   skipped    — reason string when the entry can't run
 *                ("being-not-found" | "able-not-carried" | "able-unavailable")
 */
export async function assign({
  beingId,
  spaceId,
  entry,
  handoff = null,
  signal = null,
} = {}) {
  const kind = entry?.kind || "call";
  // ── assign: load the being ───────────────────────────────────────
  // History-aware via the intake entry. The moment runs in the caller's
  // Two histories per the cross-world doctrine. `history` is the
  // ACTOR's history (where the moment runs and where the Act seals).
  // `targetHistory` is where the Fact lands; for same-world calls it
  // matches `history`, for cross-world it differs. Both attach to
  // moment so verbs invoked inside the moment route correctly.
  // See seed/CROSS-WORLD.md.
  const history = assertHistoryOrThrow(
    entry?.history || entry?.act?.history,
    "assign(entry)",
  );
  const targetHistory =
    typeof entry?.targetHistory === "string" && entry.targetHistory.length > 0
      ? entry.targetHistory
      : history;
  // loadOrFold (not loadProjection): on a fresh history, the receiving
  // being's slot hasn't been cold-folded into this history's projection
  // table yet. Bare loadProjection returns null, assign returns
  // skipped:"being-not-found", and the moment closes silently without
  // calling handoff.onError or onResponse — the wire's awaitResult
  // times out at 60s. loadOrFold walks lineage so an inherited being
  // resolves on first access without manual rebuild.
  const slot = await loadOrFold("being", beingId, history);
  if (!slot) {
    log.warn(
      "Assign",
      `being ${String(beingId).slice(0, 8)} not found on history ${history}`,
    );
    return { skipped: "being-not-found" };
  }
  // Flatten the slot into a row-shaped object so the downstream code
  // (resolveActiveStack, composeStack, etc.) keeps reading `toBeing.X`
  // without changes. Position rides at top level; state fields flatten.
  const toBeing = {
    _id: slot.id,
    position: slot.position,
    foldedSeq: slot.foldedSeq,
    ...slot.state,
  };

  // ── assign: resolve the active able ──────────────────────────────
  // Resolution order (see seed/present/ables/flow.js for the doctrine):
  //   1. entry.activeAble — caller specifically requested this voice;
  //      honor without running flow.
  //   2. Being.qualities.flow — per-being conditional program; first
  //      clause whose `when` matches AND whose able's requiredCognition
  //      matches the being's effective cognition wins.
  //   3. toBeing.defaultAble — terminal fallback.
  //
  // resolveActiveStack returns an ordered [primary, ...modifiers] able-name
  // list (empty when nothing resolves). composeStack folds it into one
  // able-shaped spec the rest of the moment runner reads uniformly.
  let spaceRow = null;
  if (spaceId) {
    // loadOrFold: same lineage-cold-fold rationale as the being load
    // above. A position space inherited from the parent history needs
    // its slot materialized so resolveActiveStack reads the right
    // qualities (per-stance permissions, descriptor derivers, etc.).
    const _sSlot = await loadOrFold("space", spaceId, history);
    spaceRow = _sSlot ? { _id: _sSlot.id, ...(_sSlot.state || {}) } : null;
  }

  // ── precompute caller enrichment for the evaluator ──
  // The flow's `caller.cognition / isAncestor / isDescendant` paths
  // need data that lives one DB hop away. We do those lookups here
  // (assign is async; the evaluator stays pure) and pass the result in.
  const callerEnrichment = await enrichCallerForFlow({
    toBeing,
    handoff,
    entry,
    history,
  });

  // Previous moment lookup for `me.previousAble` and
  // `time.sinceLastMoment`. Best-effort; a being with no prior moment
  // gets a null `previousAble` and a null `sinceLastMoment`.
  const lastSealed = await findLastSealedForBeing(String(toBeing._id));
  const previousMoment = lastSealed
    ? {
        activeAble: lastSealed.activeAble || null,
        stampedAt: lastSealed.stampedAt || null,
      }
    : null;

  // World signals lookup. Snapshots story root's `qualities.world`
  // namespace so `world.<ns>.<key>` paths in the flow resolve to the
  // current published values. One findById per moment-open;
  // set-world-signal writes propagate at the next moment.
  const worldSignals = await loadWorldSignals();

  // Pre-compute the ables this being can CURRENTLY play (held +
  // reaching this position). Per seed/AblesAreAuth.md, every flow
  // clause filters through this map; a clause whose able isn't here
  // is skipped same as a failed when-condition.
  const availableAbles = await computeAvailableAbles({
    toBeing,
    positionSpaceId: toBeing?.position || null,
    history,
  });

  const stack = resolveActiveStack({
    toBeing,
    entry,
    handoff,
    space: spaceRow,
    callerEnrichment,
    previousMoment,
    worldSignals,
    availableAbles,
  });

  if (!stack || stack.length === 0) {
    log.warn(
      "Assign",
      `no active able resolves for being ${String(beingId).slice(0, 8)} ` +
        `(no entry.activeAble, no flow match, no defaultAble)`,
    );
    return { skipped: "able-unresolved" };
  }

  // Compose [primary, ...modifiers] into a single able-shaped spec.
  // Past this boundary nothing else in the moment runner knows about
  // stacking — buildPrompt, momentum, llmMoment all see one able with
  // unioned can*-arrays and a prompt that joins each stack member's
  // body with a divider. composeStack returns null only when the
  // primary able is unregistered or its requiredCognition can't be met.
  //
  // The carry list (toBeing.ables[]) check that used to live here is
  // gone with the one-able-per-being world. Flow is the source of
  // truth: if a clause names a able, that's authorization. The flow's
  // author already had set-being permission on the being to write it.
  const able = composeStack({ stack, toBeing });
  if (!able) {
    log.warn(
      "Assign",
      `no able registered (or cognition mismatch) for primary "${stack[0]}" ` +
        `of being ${String(beingId).slice(0, 8)}`,
    );
    return { skipped: "able-unavailable" };
  }
  const activeAble = able.primaryName;

  // ── assign: open the Act row for this moment ───────────────────
  // For kind="summon" the asker is the SUMMON's sender (from handoff
  // when present, else the receiver acting on its own behalf for
  // place-driven wakes). For kind="transport-act" the asker IS the
  // acting being — they entered through their own transport, no
  // SUMMON envelope.
  const askerBeingId =
    kind === "transport-act"
      ? String(beingId)
      : handoff?.identity?.beingId || beingId;
  const askerName =
    kind === "transport-act"
      ? entry?.identity?.name || null
      : handoff?.identity?.name || null;
  // The session's signed-in Name (the INHABITOR driving this being). Same
  // fork as askerName, sourced from the verified-token identity threaded by
  // the wire. When the driver differs from the being's own trueName (a father
  // driving the mother's being), this is who SIGNS. Null for place/scheduler
  // wakes with no live session -> the seal falls back to the being's trueName.
  const sessionNameId =
    kind === "transport-act"
      ? entry?.identity?.nameId || null
      : handoff?.identity?.nameId || null;

  const actMessage =
    kind === "transport-act" ? describeTransportAct(entry.act) : entry.content;
  const actSource =
    kind === "transport-act"
      ? askerName || "transport"
      : askerName || entry.from || "user";

  // Plan the Act row but do NOT write it to Mongo. The Act gets
  // created at seal-time by stamped.js, only when cognition
  // returned ok:true. plannedAct carries the derived fields the
  // seal needs (ibpAddress, rootCorrelation, parentThread); moment
  // threads it through to stamped via moment.plannedAct.
  const plannedAct = await planActRow({
    through: String(askerBeingId),
    to: String(beingId),
    // Who signs: the session's Name (the inhabitor) when present, else the
    // acting being's own trueName (resolved inside planActRow).
    inhabitorNameId: sessionNameId,
    addresseePosition: spaceId,
    askerPosition: handoff?.resolved?.spaceId || null,
    message: actMessage,
    source: actSource,
    activeAble,
    inboxMessageId: entry.correlation,
    inReplyTo: entry.inReplyTo || null,
    rootCorrelation: entry.rootCorrelation || entry.correlation || null,
    receivedAt: entry.sentAt || null,
    priority: entry.priority || null,
    // History this moment runs on; stamped onto the Act so the act-chain
    // respects lineage on cross-history reads (mirrors the Fact schema).
    history,
    // Bucket 3 Option D: this moment answers the InboxProjection
    // row keyed by entry.correlation; stamped.js fires
    // closeInboxOnAnswer when the Act row materializes on seal.
    answers: entry.correlation || null,
  });

  // ── assign: build the summon ctx moment.js dispatches on ─────────
  // Two shapes by kind. moment.js reads ctx.kind and routes.
  const actId = plannedAct?._id ? String(plannedAct._id) : null;

  // Orientation (INNER-FOLD §1). The fold parameter ω rides on the
  // entry (which came from the call Fact's params via the
  // InboxProjection). External summons carry forward; self-summons
  // may carry half or inward. Default is forward.
  const orientation = validateOrientation(
    entry?.orientation,
    DEFAULT_ORIENTATION,
  );

  // `history` was extracted up top alongside the projection load; it
  // becomes the actorAct.history seated on moment, which every Fact
  // this moment emits inherits as its actor-side history. The cross-
  // history dispatch path routes targets via moment.targetHistory
  // (set just below); same-world moments have actorAct.history ===
  // targetHistory.

  // The actor's Act is the single carrier of the identity tuple
  // (story, history, through, _id). moment.actorAct points to it;
  // every downstream consumer (emitFact, foldEngine, the Stamper,
  // verb handlers) reads identity from the Act, never from
  // independently-threaded fields.
  //
  // targetHistory rides alongside as the Fact's destination history.
  // For same-world calls this equals actorAct.history; for cross-world
  // it differs. resolveHistoryForFact consults it as the second
  // precedence (after opts.currentHistory). See CROSS-WORLD.md.
  // Asker's identity — exposed on the ctx so the receiver's able
  // handler can attribute the summoner without digging through
  // handoff plumbing. For cross-world summons via canopy,
  // crossWorld.js's runVerbAsForeignActor stamps identity.story
  // with the cryptographically vouched canopySender; that flows here.
  // For same-story summons, askerStory is null (the local
  // domain is implicit). See FEDERATION.md "mate + being".
  const askerStory = handoff?.identity?.story || null;
  // The asker's NAME (the signer), threaded from the verified identity. The
  // birther records it as the being's qualities.father.nameId so cherub's
  // cross-story father-admit matches the cryptographically-proven name.
  const askerNameId = handoff?.identity?.nameId || null;
  const baseCtx = {
    kind,
    spaceId,
    being: activeAble, // legacy field name; carries the active able
    activeAble,
    orientation,
    toBeing,
    actId,
    actorAct: plannedAct,
    targetHistory,
    askerBeingId,
    askerName,
    askerStory,
    askerNameId,
    // History-aware aggregate reader. Extensions and ables call
    // `await ctx.read("being"|"space"|"matter", id)` and get the
    // row-shaped object back (or null). Internally walks lineage via
    // loadOrFold using this moment's history — extension authors don't
    // need to know about history threading, lineage cold-folds, or the
    // loadOrFold/loadProjection distinction. Return shape matches
    // `ctx.toBeing` (id baked in as `_id`, state fields flattened).
    read: async (kind, id) => {
      if (!id) return null;
      // "positions" reads the per-space position projection (who
      // stands where) — the public surface for code-cognition ables
      // that used to reach into seed/past/projections directly.
      // Projections are caches of the fold; this is a READ, never a
      // write path.
      if (kind === "positions") {
        const { readPositionsInSpace } =
          await import("../../past/projections/position/positionProjectionFold.js");
        return readPositionsInSpace(String(id));
      }
      const { loadOrFold } = await import("../../materials/projections.js");
      const slot = await loadOrFold(kind, String(id), history);
      if (!slot) return null;
      return { _id: slot.id, position: slot.position, ...(slot.state || {}) };
    },
    // Cognition-result builders. Able.summon handlers return one of
    // these three discriminated shapes; extensions don't need to know
    // about CognitionResult internals or import from seed/cognition/.
    // Bare strings, plain objects, and legacy { ok, content } shapes
    // are still accepted at the normalize boundary — these helpers
    // are the discoverable form.
    //
    //   ctx.act(text)               — seal an Act with `text` as the
    //                                 closing utterance. The common
    //                                 case for any able that DOES.
    //   ctx.idle()                  — looked, chose not to act.
    //                                 Legitimate completion: inbox
    //                                 closes, no Act, no retry. Use
    //                                 when a wake fires but there's
    //                                 nothing to do this turn (gating,
    //                                 polling, debounce). Maps to
    //                                 cognition `{ kind: "see" }` —
    //                                 named `idle` here to avoid
    //                                 collision with the SEE verb
    //                                 wrapper below (ctx.see).
    //   ctx.failure(shape, reason)  — structured failure. Shapes:
    //                                 "timeout" | "http-error" |
    //                                 "garbage" | "aborted" |
    //                                 "internal". Inbox eviction
    //                                 follows the shape's recover-
    //                                 ability semantics.
    act: (content) => ({
      kind: "act",
      ok: true,
      content: String(content ?? ""),
    }),
    idle: () => ({ kind: "see", ok: false }),
    failure: (shape, reason) => ({
      kind: "failure",
      ok: false,
      shape: String(shape || "internal"),
      reason: String(reason || ""),
    }),
    // The four verbs, pre-bound with this moment's identity + moment.
    // Extensions don't need to import doVerb/seeVerb/beVerb/summon* and
    // they don't need to thread { identity, moment: ctx } on every
    // call. The wrapped form is the canonical handler-side surface:
    //   await ctx.do(target, action, args)
    //   await ctx.see(address, opts)
    //   await ctx.be(operation, payload)
    //   await ctx.summon(address, message)  — relative or absolute IBP address
    do: async (target, action, args = {}) => {
      const { doVerb } = await import("../../ibp/verbs/do.js");
      return doVerb(target, action, args, {
        identity: handoff?.identity || entry?.identity || null,
        moment: baseCtx,
      });
    },
    see: async (address, opts = {}) => {
      const { seeVerb } = await import("../../ibp/verbs/see.js");
      return seeVerb(address, {
        ...opts,
        identity: opts.identity || handoff?.identity || entry?.identity || null,
        moment: baseCtx,
      });
    },
    be: async (operation, payload = {}) => {
      const { beVerb } = await import("../../ibp/verbs/be.js");
      return beVerb(operation, payload, {
        identity: handoff?.identity || entry?.identity || null,
        moment: baseCtx,
      });
    },
    summon: async (address, message) => {
      const { callVerb } = await import("../../ibp/verbs/call.js");
      return callVerb(address, message, {
        identity: handoff?.identity || entry?.identity || null,
        moment: baseCtx,
      });
    },
    resolved: handoff?.resolved || {
      being: activeAble,
      activeAble,
      spaceId,
    },
    identity: handoff?.identity || entry?.identity || null,
    signal,
    // ΔF accumulator. Every Fact emission inside this moment pushes a
    // spec onto this array (verb handlers and material helpers thread
    // it through). At seal-time, sealAct commits the whole ΔF and the
    // Act row together in one Mongo transaction. One act → one ΔF →
    // one commit. Empty for moments that emit no facts (LLM moment
    // with no tool calls); still atomic via single-doc Act insert.
    deltaF: [],
    // Stale-detection key map (PARALLEL FACTS §1.3). Populated by
    // beat-2 (foldPlace) and by consumers that fold a reel before
    // emitting against it — keyed `<targetKind>:<targetId>` → the
    // seq this moment folded that reel at. emitFact reads this map
    // to stamp `foldSeq` on facts whose target reel was folded here.
    // Reels never folded leave foldSeq null on emit.
    foldedSeqs: new Map(),
    // Post-seal callbacks. Verb handlers queue side effects here that
    // can only fire AFTER sealAct commits + folds run (the cross-
    // cutting fold materializes projection rows on commit; wakes
    // that depend on those rows must wait). sealAct flushes this
    // array last, after closeInboxOnAnswer / noteActSealOnThread.
    afterSeal: [],
  };

  let moment;
  if (kind === "transport-act") {
    moment = {
      ...baseCtx,
      act: entry.act || null,
    };
  } else {
    moment = {
      ...baseCtx,
      message: {
        from: entry.from,
        content: entry.content,
        correlation: entry.correlation,
        rootCorrelation: entry.rootCorrelation || entry.correlation,
        activeAble,
        orientation,
        // Envelope intent — what the auth walk gated on. Without it
        // the able handler can't dispatch on the caller's purpose
        // (federation handshakes read this; see seed/SUMMON.md).
        intent: entry.intent || null,
        inReplyTo: entry.inReplyTo,
        attachments: entry.attachments,
        sentAt: entry.sentAt,
        priority: entry.priority,
        actId,
      },
    };
  }

  // plannedAct rides on the return so moment.js can hand it to
  // stamped.js for the seal-time write. The moment carries
  // actId (so DO/BE Facts stamped during the moment reference
  // this Act); plannedAct stays separate because the cognition
  // shouldn't see or care about the Act's structural fields.
  return { actId, plannedAct, able, moment };
}

// Render a one-line description of a transport-act for the Act's
// startMessage. The full payload lives on the intake entry; this is
// what shows up when humans skim a Summon row.
//
// `act.act` is the operation in flight (the seal records it as
// fact.act). For DO: act.target is a typed object ({kind, id});
// render as "<verb> <act> on <kind>/<id>". For BE/NAME the op stands
// alone; render as "BE <act>" / "NAME <act>".
function describeTransportAct(act) {
  if (!act || typeof act !== "object") return "[transport-act]";
  const verb = (act.verb || "?").toUpperCase();
  const op = typeof act.act === "string" ? act.act : null;
  if (verb === "BE" || verb === "NAME") {
    return op ? `${verb} ${op}` : verb;
  }
  const target = formatTransportTarget(act.target);
  return op ? `${verb} ${op} on ${target}` : `${verb} on ${target}`;
}

function formatTransportTarget(t) {
  if (t == null) return "?";
  if (typeof t === "string") return t;
  if (typeof t === "object") {
    if (t.kind && t.id) return `${t.kind}/${truncId(t.id)}`;
    if (t.spaceId) return `space/${truncId(t.spaceId)}`;
    if (typeof t.value === "string") return t.value;
  }
  return String(t);
}

function truncId(id) {
  const s = String(id);
  return s.length > 12 ? s.slice(0, 8) + "…" : s;
}

// ─────────────────────────────────────────────────────────────────────
// Private helper: open the Act row.
//
// This is the moment-open write. It's private to assign because
// assign is the only legitimate Act opener — genesis bootstraps
// the I-Am's first Act out-of-band in boot code; everything else
// runs through SUMMON, lands in an inbox, and reaches assign.
//
// Resolves rootCorrelation (inherits from parent), spawn-lineage
// parentThread (from scheduler.currentRoot), and ibpAddress
// (canonical stance pair); caps message content; creates the row
// with an open endMessage. stamped.js presses the closing face
// when the moment ends.
// ─────────────────────────────────────────────────────────────────────

function MAX_CHAT_CONTENT_BYTES() {
  return Math.max(
    10000,
    Math.min(
      Number(getInternalConfigValue("maxChatContentBytes")) || 100000,
      1000000,
    ),
  );
}

function capContent(s) {
  if (typeof s !== "string") return s;
  const max = MAX_CHAT_CONTENT_BYTES();
  return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
}

/**
 * Compute the Act row's derived fields and return a plain object
 * that stamped.js writes to Mongo at seal-time (only when cognition
 * returned ok:true). The actId is minted here so DO/BE Facts
 * stamped inside the moment can carry it; the row itself does NOT
 * exist in Mongo until the seal step writes it.
 *
 * Returns null when the inputs are invalid (through missing).
 */
async function planActRow(opts = {}) {
  const {
    through,
    to = null,
    inhabitorNameId = null,
    askerPosition = null,
    addresseePosition = null,
    message,
    source = "user",
    activeAble = null,
    inboxMessageId = null,
    inReplyTo = null,
    rootCorrelation = null,
    receivedAt = null,
    priority = null,
    history,
    // Bucket 3 Option D: the correlation of the InboxProjection row
    // this moment is consuming. Stored on the Act as `answers`; on
    // seal, the cross-cutting fold evicts the matching row.
    answers = null,
  } = opts;
  if (typeof history !== "string" || !history.length) {
    throw new Error("planActRow: history is required (no silent main-bias)");
  }

  if (!through) {
    log.warn("Assign", "planActRow called without through");
    return null;
  }

  let resolvedRoot = rootCorrelation || null;

  // Resolve rootCorrelation: when there's a parent and no explicit
  // root, inherit the parent's so audit walks see the whole reply
  // chain rooted at the originating user message.
  if (!resolvedRoot && inReplyTo) {
    try {
      const parent = getActById(inReplyTo);
      resolvedRoot = parent?.rootCorrelation || inReplyTo;
    } catch {
      resolvedRoot = inReplyTo;
    }
  }

  // Identity placeholder — computed below once the full opening is
  // assembled (the act's _id IS the hash of its opening; see
  // past/act/actHash.js). rootCorrelation may equal the act's own id
  // (a parentless summon is its own root), which is exactly why the
  // digest excludes rootCorrelation — no circularity.
  let actId = null;

  // Spawn-lineage. When the asker is currently acting under another
  // rootCorrelation (running inside thread A) and emits a fresh
  // top-level SUMMON (no inReplyTo, so a new chain), record that the
  // new chain was spawned from A. Without this, spawned threads
  // look like roots with no lineage. Read scheduler.currentRoot
  // here so beings don't have to remember to pass it.
  let resolvedParentThread = null;
  if (!inReplyTo) {
    try {
      const { getCurrentRootCorrelation } =
        await import("../intake/scheduler.js");
      const currentRoot = getCurrentRootCorrelation(String(through));
      if (currentRoot && currentRoot !== resolvedRoot) {
        resolvedParentThread = currentRoot;
      }
    } catch {
      // Scheduler unavailable (pre-cognition boot, tests).
    }
  }

  const ibpAddress = await computeIbpStampAddress({
    askerBeingId: through,
    askerPosition,
    addresseeBeingId: to,
    addresseePosition,
    // The moment's history: scopes the being lookups (history-born
    // beings compose) and renders into the lane identity.
    history,
  });

  const now = new Date();
  const safeMessage = capContent(message);

  // Plain object — no Mongo write. stamped.js writes this at seal
  // time only when cognition returns ok:true. The `_id` is minted
  // here so Facts emitted during the moment can carry actId; the
  // Act row doesn't exist until seal materializes it.
  //
  // CONTENT-ADDRESSED: the _id is the hash of the OPENING, chained
  // to the being's previous sealed act (ActHead read here; advanced
  // only at seal so crashed moments never enter the chain). See
  // past/act/actHash.js for what the digest covers and excludes.
  //
  // Identity tuple (story, history, through, _id) lives on this row.
  // Everything downstream (Facts in deltaF, inner face attachment,
  // crossOrigin derivation) reads from here. See CROSS-WORLD.md.
  const { getStoryDomain } = await import("../../ibp/address.js");
  const { computeActId, readActHead } =
    await import("../../past/act/actHash.js");

  // The actor NAME — who SIGNS the act and whom every fact attributes.
  // Resolved onto the row, NOT into the opening/digest, so act._id is
  // unchanged. THE INHABITOR SIGNS: prefer the session's signed-in Name (a
  // father driving the mother's being signs as the father), else the acting
  // being's own trueName (its owner, for self-driven acts + place/scheduler
  // wakes with no live session). Key-gated: only a real key-bearing Name id
  // can be the signer, so a null / non-key inhabitor never downgrades or
  // hijacks it. No fallback to nothing: a being with no signer cannot act.
  const { loadOrFold } = await import("../../materials/projections.js");
  const { isKeyId } = await import("../../materials/name/keys.js");
  const actorSlot = await loadOrFold("being", through, history);
  const ownTrueName = actorSlot?.state?.trueName || null;
  const by =
    inhabitorNameId && isKeyId(inhabitorNameId) ? inhabitorNameId : ownTrueName;
  if (!by) {
    throw new Error(
      `planActRow: acting being ${String(through).slice(0, 8)} has no signer name ` +
        `(no session inhabitor, no trueName).`,
    );
  }

  const opening = {
    through,
    to: to || null,
    ibpAddress,
    activeAble,
    inboxMessageId,
    inReplyTo,
    parentThread: resolvedParentThread,
    startMessage: { content: safeMessage, source },
    story: getStoryDomain(),
    history,
  };
  const p = await readActHead(getStoryDomain(), history, through);
  actId = computeActId(p, opening);
  // A summon with no parent IS its own root.
  if (!resolvedRoot) resolvedRoot = actId;

  return {
    _id: actId,
    p,
    by,
    through,
    to: to || null,
    ibpAddress,
    activeAble,
    inboxMessageId,
    inReplyTo,
    rootCorrelation: resolvedRoot,
    parentThread: resolvedParentThread,
    answers, // Bucket 3 Option D: closure key the seal evicts on
    receivedAt: receivedAt || now,
    stampedAt: now,
    startMessage: { content: safeMessage, source },
    story: getStoryDomain(),
    history,
    // status is seated by the Stamper at insert time — openers
    // don't carry it. See sealAct in 4-stamped.js.
    ...(priority ? { priority } : {}),
  };
}

// Precompute the caller-side data the flow evaluator's
// `caller.cognition / isAncestor / isDescendant` paths need. The
// evaluator is sync; doing these lookups here lets us serve those
// vocabulary additions without giving the evaluator DB access.
//
// Transport-act has no separate caller (the being acts on its own
// behalf); we return an enrichment that resolves to "isSelf-ish"
// readings. SUMMON without an identified asker (rare; happens for
// scheduled wakes that didn't thread an identity) also returns null
// data — the flow then sees `caller.cognition: null`, `isAncestor:
// false`, etc., which is the correct conservative default.
async function enrichCallerForFlow({ toBeing, handoff, entry, history = "0" }) {
  const kind = entry?.kind || "call";
  if (kind === "transport-act") {
    return {
      cognition: beingCognition(toBeing),
      isAncestor: false,
      isDescendant: false,
    };
  }
  const callerBeingId = handoff?.identity?.beingId || null;
  if (!callerBeingId || String(callerBeingId) === String(toBeing._id)) {
    return { cognition: null, isAncestor: false, isDescendant: false };
  }
  const [callerSlot, callerIsAncestor, meIsAncestorOfCaller] =
    await Promise.all([
      // loadOrFold: the caller might be a being inherited from main on a
      // sub-history. Bare loadProjection would return null, callerRow
      // stays null, the enriched-caller fields drop out of able
      // evaluation — a non-obvious behavioral change on non-main
      // histories.
      loadOrFold("being", callerBeingId, history),
      isAncestorOf(callerBeingId, String(toBeing._id), history),
      isAncestorOf(String(toBeing._id), callerBeingId, history),
    ]);
  const callerRow = callerSlot
    ? { _id: callerSlot.id, ...callerSlot.state }
    : null;
  return {
    cognition: callerRow ? beingCognition(callerRow) : null,
    isAncestor: callerIsAncestor,
    isDescendant: meIsAncestorOfCaller,
  };
}

// Snapshot story root's `qualities.world` namespace so the flow's
// `world.<ns>.<key>` paths resolve at evaluation time. set-world-signal
// writes to story-root.qualities.world.<ns>.<key>; this read returns
// the whole world subtree once per moment-open so all flow clauses
// share one consistent view.
async function loadWorldSignals() {
  const rootId = getSpaceRootId();
  if (!rootId) return null;
  try {
    const slot = await loadProjection("space", rootId, "0");
    if (!slot) return null;
    const quals = slot.state?.qualities;
    const world = quals instanceof Map ? quals.get("world") : quals?.world;
    return world && typeof world === "object" ? world : null;
  } catch {
    return null;
  }
}
