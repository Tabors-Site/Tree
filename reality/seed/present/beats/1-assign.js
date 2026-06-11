// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// assign.js — beat one of the stamping. Who acts, and the moment
// opens its frame.
//
// Scheduler picks an intake entry off a being's line and hands it
// here. assign loads the receiver Being, resolves the active role,
// checks role-carry, mints the actId, computes the act's derived
// fields (ibpAddress, rootCorrelation, parentThread), and builds the
// summon context the moment's dispatch needs. It returns
// { actId, plannedAct, role, summonCtx } for moment to dispatch, or
// { skipped } when the entry can't run.
//
// **assign no longer writes the Act row to Mongo** (Round 5).
// The Act row is created at seal-time by stamped.js, only when
// cognition returned ok:true. On ok:false the Act row never
// materializes — that's how "no Act row for the failed moment" is
// structurally enforced. Tool-calls during the moment still stamp
// Facts carrying actId; on a partial-then-fail those Facts persist
// with an actId pointing to a row that never existed. That's the
// honest audit: intermediate Facts happened inside a moment that
// produced no final answer. See [[project-cognition-result-type]]
// and seed/present/cognition/cognitionResult.js for the CognitionResult contract.
//
// Two intake kinds reach assign:
//
//   kind: "summon"
//     A SUMMON the being received. summonCtx carries the message
//     shape; moment.js calls role.summon(message, ctx).
//
//   kind: "transport-act"
//     The being acted from their own transport (portal/browser/CLI).
//     summonCtx carries the act payload { verb, target, action, args };
//     moment.js dispatches it directly through doVerb/beVerb. No
//     role.summon handler runs — the act was already decided
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

import log from "../../seedReality/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Being from "../../materials/being/being.js";
import { loadProjection, loadOrFold, assertBranchOrThrow } from "../../materials/projections.js";
import Act from "../../past/act/act.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { resolveActiveStack, computeAvailableRoles } from "../roles/roleFlow.js";
import { composeStack } from "../roles/roleComposer.js";
import Space from "../../materials/space/space.js";
import { computeIbpStampAddress } from "../../ibp/address.js";
import { validateOrientation, DEFAULT_ORIENTATION } from "./2-fold/orientation.js";
import { isAncestorOf, beingCognition } from "../../materials/being/identity/lookups.js";
import { findLastSealedForBeing } from "./2-fold/reelChains.js";
import { getSpaceRootId } from "../../sprout.js";

/**
 * Set up one moment for stamping. Loads the being, resolves the
 * active role, opens the Act row, and builds the summon ctx.
 *
 * Dispatches by entry.kind:
 *   "summon"        — message-shaped ctx; moment calls role.summon
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
 * @returns {Promise<{ actId?, role?, summonCtx?, skipped? }>}
 *   actId    — the Act row this moment opened (always present on success)
 *   role       — resolved role spec
 *   summonCtx  — the prepared context moment.js dispatches on (carries actId + kind)
 *   skipped    — reason string when the entry can't run
 *                ("being-not-found" | "role-not-carried" | "role-unavailable")
 */
export async function assign({ beingId, spaceId, entry, handoff = null, signal = null } = {}) {
  const kind = entry?.kind || "summon";
  // ── assign: load the being ───────────────────────────────────────
  // Branch-aware via the intake entry. The moment runs in the caller's
  // Two branches per the cross-world doctrine. `branch` is the
  // ACTOR's branch (where the moment runs and where the Act seals).
  // `targetBranch` is where the Fact lands; for same-world calls it
  // matches `branch`, for cross-world it differs. Both attach to
  // summonCtx so verbs invoked inside the moment route correctly.
  // See seed/CROSS-WORLD.md.
  const branch = assertBranchOrThrow(
    entry?.branch || entry?.act?.branch,
    "assign(entry)",
  );
  const targetBranch = (typeof entry?.targetBranch === "string" && entry.targetBranch.length > 0)
    ? entry.targetBranch
    : branch;
  // loadOrFold (not loadProjection): on a fresh branch, the receiving
  // being's slot hasn't been cold-folded into this branch's projection
  // table yet. Bare loadProjection returns null, assign returns
  // skipped:"being-not-found", and the moment closes silently without
  // calling handoff.onError or onResponse — the wire's awaitResult
  // times out at 60s. loadOrFold walks lineage so an inherited being
  // resolves on first access without manual rebuild.
  const slot = await loadOrFold("being", beingId, branch);
  if (!slot) {
    log.warn("Assign", `being ${String(beingId).slice(0, 8)} not found on branch ${branch}`);
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

  // ── assign: resolve the active role ──────────────────────────────
  // Resolution order (see seed/present/roles/roleFlow.js for the doctrine):
  //   1. entry.activeRole — caller specifically requested this voice;
  //      honor without running flow.
  //   2. Being.qualities.roleFlow — per-being conditional program; first
  //      clause whose `when` matches AND whose role's requiredCognition
  //      matches the being's effective cognition wins.
  //   3. toBeing.defaultRole — terminal fallback.
  //
  // resolveActiveStack returns an ordered [primary, ...modifiers] role-name
  // list (empty when nothing resolves). composeStack folds it into one
  // role-shaped spec the rest of the moment runner reads uniformly.
  let spaceRow = null;
  if (spaceId) {
    // loadOrFold: same lineage-cold-fold rationale as the being load
    // above. A position space inherited from the parent branch needs
    // its slot materialized so resolveActiveStack reads the right
    // qualities (per-stance permissions, descriptor derivers, etc.).
    const _sSlot = await loadOrFold("space", spaceId, branch);
    spaceRow = _sSlot ? { _id: _sSlot.id, ...(_sSlot.state || {}) } : null;
  }

  // ── precompute caller enrichment for the evaluator ──
  // The flow's `caller.cognition / isAncestor / isDescendant` paths
  // need data that lives one DB hop away. We do those lookups here
  // (assign is async; the evaluator stays pure) and pass the result in.
  const callerEnrichment = await enrichCallerForFlow({ toBeing, handoff, entry, branch });

  // Previous moment lookup for `me.previousRole` and
  // `time.sinceLastMoment`. Best-effort; a being with no prior moment
  // gets a null `previousRole` and a null `sinceLastMoment`.
  const lastSealed = await findLastSealedForBeing(String(toBeing._id));
  const previousMoment = lastSealed
    ? { activeRole: lastSealed.activeRole || null, stampedAt: lastSealed.stampedAt || null }
    : null;

  // World signals lookup. Snapshots reality root's `qualities.world`
  // namespace so `world.<ns>.<key>` paths in the flow resolve to the
  // current published values. One findById per moment-open;
  // set-world-signal writes propagate at the next moment.
  const worldSignals = await loadWorldSignals();

  // Pre-compute the roles this being can CURRENTLY play (held +
  // reaching this position). Per seed/RolesAreAuth.md, every roleFlow
  // clause filters through this map; a clause whose role isn't here
  // is skipped same as a failed when-condition.
  const availableRoles = await computeAvailableRoles({
    toBeing,
    positionSpaceId: toBeing?.position || null,
    branch: branch || "0",
  });

  const stack = resolveActiveStack({
    toBeing,
    entry,
    handoff,
    space:            spaceRow,
    callerEnrichment,
    previousMoment,
    now:              entry?.receivedAt ? new Date(entry.receivedAt) : null,
    worldSignals,
    availableRoles,
  });

  if (!stack || stack.length === 0) {
    log.warn(
      "Assign",
      `no active role resolves for being ${String(beingId).slice(0, 8)} ` +
        `(no entry.activeRole, no roleFlow match, no defaultRole)`,
    );
    return { skipped: "role-unresolved" };
  }

  // Compose [primary, ...modifiers] into a single role-shaped spec.
  // Past this boundary nothing else in the moment runner knows about
  // stacking — buildPrompt, momentum, llmMoment all see one role with
  // unioned can*-arrays and a prompt that joins each stack member's
  // body with a divider. composeStack returns null only when the
  // primary role is unregistered or its requiredCognition can't be met.
  //
  // The carry list (toBeing.roles[]) check that used to live here is
  // gone with the one-role-per-being world. RoleFlow is the source of
  // truth: if a clause names a role, that's authorization. The flow's
  // author already had set-being permission on the being to write it.
  const role = composeStack({ stack, toBeing });
  if (!role) {
    log.warn(
      "Assign",
      `no role registered (or cognition mismatch) for primary "${stack[0]}" ` +
        `of being ${String(beingId).slice(0, 8)}`,
    );
    return { skipped: "role-unavailable" };
  }
  const activeRole = role.primaryName;

  // ── assign: open the Act row for this moment ───────────────────
  // For kind="summon" the asker is the SUMMON's sender (from handoff
  // when present, else the receiver acting on its own behalf for
  // place-driven wakes). For kind="transport-act" the asker IS the
  // acting being — they entered through their own transport, no
  // SUMMON envelope.
  const askerBeingId = kind === "transport-act"
    ? String(beingId)
    : (handoff?.identity?.beingId || beingId);
  const askerName = kind === "transport-act"
    ? (entry?.identity?.name || null)
    : (handoff?.identity?.name || null);

  const actMessage = kind === "transport-act"
    ? describeTransportAct(entry.act)
    : entry.content;
  const actSource = kind === "transport-act"
    ? (askerName || "transport")
    : (askerName || entry.from || "user");

  // Plan the Act row but do NOT write it to Mongo. The Act gets
  // created at seal-time by stamped.js, only when cognition
  // returned ok:true. plannedAct carries the derived fields the
  // seal needs (ibpAddress, rootCorrelation, parentThread); moment
  // threads it through to stamped via summonCtx.plannedAct.
  const plannedAct = await planActRow({
    beingIn:           String(askerBeingId),
    beingOut:          String(beingId),
    addresseePosition: spaceId,
    askerPosition:    handoff?.resolved?.spaceId || null,
    message:           actMessage,
    source:            actSource,
    activeRole,
    inboxMessageId:    entry.correlation,
    inReplyTo:         entry.inReplyTo || null,
    rootCorrelation:   entry.rootCorrelation || entry.correlation || null,
    receivedAt:        entry.sentAt || null,
    priority:          entry.priority || null,
    // Branch this moment runs on; stamped onto the Act so the act-chain
    // respects lineage on cross-branch reads (mirrors the Fact schema).
    branch,
    // Bucket 3 Option D: this moment answers the InboxProjection
    // row keyed by entry.correlation; stamped.js fires
    // closeInboxOnAnswer when the Act row materializes on seal.
    answers:           entry.correlation || null,
  });

  // ── assign: build the summon ctx moment.js dispatches on ─────────
  // Two shapes by kind. moment.js reads ctx.kind and routes.
  const actId = plannedAct?._id ? String(plannedAct._id) : null;

  // Orientation (INNER-FOLD §1). The fold parameter ω rides on the
  // entry (which came from the be:summon Fact's params via the
  // InboxProjection). External summons carry forward; self-summons
  // may carry half or inward. Default is forward.
  const orientation = validateOrientation(entry?.orientation, DEFAULT_ORIENTATION);

  // `branch` was extracted up top alongside the projection load; it
  // becomes the actorAct.branch seated on summonCtx, which every Fact
  // this moment emits inherits as its actor-side branch. The cross-
  // branch dispatch path routes targets via summonCtx.targetBranch
  // (set just below); same-world moments have actorAct.branch ===
  // targetBranch.

  // The actor's Act is the single carrier of the identity tuple
  // (reality, branch, beingIn, _id). summonCtx.actorAct points to it;
  // every downstream consumer (emitFact, foldEngine, the Stamper,
  // verb handlers) reads identity from the Act, never from
  // independently-threaded fields.
  //
  // targetBranch rides alongside as the Fact's destination branch.
  // For same-world calls this equals actorAct.branch; for cross-world
  // it differs. resolveBranchForFact consults it as the second
  // precedence (after opts.currentBranch). See CROSS-WORLD.md.
  // Asker's identity — exposed on the ctx so the receiver's role
  // handler can attribute the summoner without digging through
  // handoff plumbing. For cross-world summons via canopy,
  // crossWorld.js's runVerbAsForeignActor stamps identity.reality
  // with the cryptographically vouched canopySender; that flows here.
  // For same-reality summons, askerReality is null (the local
  // domain is implicit). See FEDERATION.md "mate + vessel".
  const askerReality = handoff?.identity?.reality || null;
  const baseCtx = {
    kind,
    spaceId,
    being:       activeRole,             // legacy field name; carries the active role
    activeRole,
    orientation,
    toBeing,
    actId,
    actorAct: plannedAct,
    targetBranch,
    askerBeingId,
    askerName,
    askerReality,
    // Branch-aware aggregate reader. Extensions and roles call
    // `await ctx.read("being"|"space"|"matter", id)` and get the
    // row-shaped object back (or null). Internally walks lineage via
    // loadOrFold using this moment's branch — extension authors don't
    // need to know about branch threading, lineage cold-folds, or the
    // loadOrFold/loadProjection distinction. Return shape matches
    // `ctx.toBeing` (id baked in as `_id`, state fields flattened).
    read: async (kind, id) => {
      if (!id) return null;
      // "positions" reads the per-space position projection (who
      // stands where) — the public surface for code-cognition roles
      // that used to reach into seed/past/projections directly.
      // Projections are caches of the fold; this is a READ, never a
      // write path.
      if (kind === "positions") {
        const { readPositionsInSpace } =
          await import("../../past/projections/position/positionProjectionFold.js");
        return readPositionsInSpace(String(id));
      }
      const { loadOrFold } = await import("../../materials/projections.js");
      const slot = await loadOrFold(kind, String(id), branch);
      if (!slot) return null;
      return { _id: slot.id, position: slot.position, ...(slot.state || {}) };
    },
    // Cognition-result builders. Role.summon handlers return one of
    // these three discriminated shapes; extensions don't need to know
    // about CognitionResult internals or import from seed/cognition/.
    // Bare strings, plain objects, and legacy { ok, content } shapes
    // are still accepted at the normalize boundary — these helpers
    // are the discoverable form.
    //
    //   ctx.act(text)               — seal an Act with `text` as the
    //                                 closing utterance. The common
    //                                 case for any role that DOES.
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
    act: (content) => ({ kind: "act", ok: true, content: String(content ?? "") }),
    idle: () => ({ kind: "see", ok: false }),
    failure: (shape, reason) => ({
      kind:   "failure",
      ok:     false,
      shape:  String(shape || "internal"),
      reason: String(reason || ""),
    }),
    // The four verbs, pre-bound with this moment's identity + summonCtx.
    // Extensions don't need to import doVerb/seeVerb/beVerb/summon* and
    // they don't need to thread { identity, summonCtx: ctx } on every
    // call. The wrapped form is the canonical handler-side surface:
    //   await ctx.do(target, action, args)
    //   await ctx.see(address, opts)
    //   await ctx.be(operation, payload)
    //   await ctx.summon(address, message)  — relative or absolute IBP address
    do: async (target, action, args = {}) => {
      const { doVerb } = await import("../../ibp/verbs/do.js");
      return doVerb(target, action, args, {
        identity: handoff?.identity || entry?.identity || null,
        summonCtx: baseCtx,
      });
    },
    see: async (address, opts = {}) => {
      const { seeVerb } = await import("../../ibp/verbs/see.js");
      return seeVerb(address, {
        ...opts,
        identity: opts.identity || handoff?.identity || entry?.identity || null,
        summonCtx: baseCtx,
      });
    },
    be: async (operation, payload = {}) => {
      const { beVerb } = await import("../../ibp/verbs/be.js");
      return beVerb(operation, payload, {
        identity: handoff?.identity || entry?.identity || null,
        summonCtx: baseCtx,
      });
    },
    summon: async (address, message) => {
      const { summonVerb } = await import("../../ibp/verbs/summon.js");
      return summonVerb(address, message, {
        identity: handoff?.identity || entry?.identity || null,
        summonCtx: baseCtx,
      });
    },
    resolved: handoff?.resolved || {
      being:       activeRole,
      activeRole,
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

  let summonCtx;
  if (kind === "transport-act") {
    summonCtx = {
      ...baseCtx,
      act: entry.act || null,
    };
  } else {
    summonCtx = {
      ...baseCtx,
      message: {
        from:            entry.from,
        content:         entry.content,
        correlation:     entry.correlation,
        rootCorrelation: entry.rootCorrelation || entry.correlation,
        activeRole,
        orientation,
        inReplyTo:       entry.inReplyTo,
        attachments:     entry.attachments,
        sentAt:          entry.sentAt,
        priority:        entry.priority,
        actId,
      },
    };
  }

  // plannedAct rides on the return so moment.js can hand it to
  // stamped.js for the seal-time write. The summonCtx carries
  // actId (so DO/BE Facts stamped during the moment reference
  // this Act); plannedAct stays separate because the cognition
  // shouldn't see or care about the Act's structural fields.
  return { actId, plannedAct, role, summonCtx };
}

// Render a one-line description of a transport-act for the Act's
// startMessage. The full payload lives on the intake entry; this is
// what shows up when humans skim a Summon row.
//
// For DO: target is a typed object ({kind, id}); render as "<verb>
// <action> on <kind>/<id>".  For BE: target is the op-name string
// itself (e.g. "connect"); render as "BE <op>". Previously this used a
// raw `${target}` interpolation, which silently produced "[object
// Object]" for every DO row in the audit history.
function describeTransportAct(act) {
  if (!act || typeof act !== "object") return "[transport-act]";
  const verb   = (act.verb || "?").toUpperCase();
  const target = formatTransportTarget(act.target);
  const action = typeof act.action === "string" ? act.action : null;
  if (verb === "BE") {
    return action ? `BE ${target} ${action}` : `BE ${target}`;
  }
  return action ? `${verb} ${action} on ${target}` : `${verb} on ${target}`;
}

function formatTransportTarget(t) {
  if (t == null) return "?";
  if (typeof t === "string") return t;
  if (typeof t === "object") {
    if (t.kind && t.id) return `${t.kind}/${truncId(t.id)}`;
    if (t.spaceId)      return `space/${truncId(t.spaceId)}`;
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
 * Returns null when the inputs are invalid (beingIn missing).
 */
async function planActRow(opts = {}) {
  const {
    beingIn,
    beingOut = null,
    askerPosition = null,
    addresseePosition = null,
    message,
    source = "user",
    activeRole = null,
    inboxMessageId = null,
    inReplyTo = null,
    rootCorrelation = null,
    receivedAt = null,
    priority = null,
    branch,
    // Bucket 3 Option D: the correlation of the InboxProjection row
    // this moment is consuming. Stored on the Act as `answers`; on
    // seal, the cross-cutting fold evicts the matching row.
    answers = null,
  } = opts;
  if (typeof branch !== "string" || !branch.length) {
    throw new Error("planActRow: branch is required (no silent main-bias)");
  }

  if (!beingIn) {
    log.warn("Assign", "planActRow called without beingIn");
    return null;
  }

  let resolvedRoot = rootCorrelation || null;

  // Resolve rootCorrelation: when there's a parent and no explicit
  // root, inherit the parent's so audit walks see the whole reply
  // chain rooted at the originating user message.
  if (!resolvedRoot && inReplyTo) {
    try {
      const parent = await Act.findById(inReplyTo)
        .select("rootCorrelation")
        .lean();
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
      const { getCurrentRootCorrelation } = await import("../../intake/scheduler.js");
      const currentRoot = getCurrentRootCorrelation(String(beingIn));
      if (currentRoot && currentRoot !== resolvedRoot) {
        resolvedParentThread = currentRoot;
      }
    } catch {
      // Scheduler unavailable (pre-cognition boot, tests).
    }
  }

  const ibpAddress = await computeIbpStampAddress({
    askerBeingId: beingIn,
    askerPosition,
    addresseeBeingId: beingOut,
    addresseePosition,
    // The moment's branch: scopes the being lookups (branch-born
    // beings compose) and renders into the lane identity.
    branch,
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
  // Identity tuple (reality, branch, beingIn, _id) lives on this row.
  // Everything downstream (Facts in deltaF, inner face attachment,
  // crossOrigin derivation) reads from here. See CROSS-WORLD.md.
  const { getRealityDomain } = await import("../../ibp/address.js");
  const { computeActId, readActHead } = await import("../../past/act/actHash.js");
  const opening = {
    beingIn,
    beingOut: beingOut || null,
    ibpAddress,
    activeRole,
    inboxMessageId,
    inReplyTo,
    parentThread: resolvedParentThread,
    startMessage: { content: safeMessage, source },
    reality: getRealityDomain(),
    branch,
  };
  const p = await readActHead(branch, beingIn);
  actId = computeActId(p, opening);
  // A summon with no parent IS its own root.
  if (!resolvedRoot) resolvedRoot = actId;

  return {
    _id: actId,
    p,
    beingIn,
    beingOut: beingOut || null,
    ibpAddress,
    activeRole,
    inboxMessageId,
    inReplyTo,
    rootCorrelation: resolvedRoot,
    parentThread:    resolvedParentThread,
    answers, // Bucket 3 Option D: closure key the seal evicts on
    receivedAt: receivedAt || now,
    stampedAt: now,
    startMessage: { content: safeMessage, source },
    reality: getRealityDomain(),
    branch,
    // status is seated by the Stamper at insert time — openers
    // don't carry it. See sealAct in 4-stamped.js.
    ...(priority ? { priority } : {}),
  };
}

// Precompute the caller-side data the roleFlow evaluator's
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
async function enrichCallerForFlow({ toBeing, handoff, entry, branch = "0" }) {
  const kind = entry?.kind || "summon";
  if (kind === "transport-act") {
    return {
      cognition:    beingCognition(toBeing),
      isAncestor:   false,
      isDescendant: false,
    };
  }
  const callerBeingId = handoff?.identity?.beingId || null;
  if (!callerBeingId || String(callerBeingId) === String(toBeing._id)) {
    return { cognition: null, isAncestor: false, isDescendant: false };
  }
  const [callerSlot, callerIsAncestor, meIsAncestorOfCaller] = await Promise.all([
    // loadOrFold: the caller might be a being inherited from main on a
    // sub-branch. Bare loadProjection would return null, callerRow
    // stays null, the enriched-caller fields drop out of role
    // evaluation — a non-obvious behavioral change on non-main
    // branches.
    loadOrFold("being", callerBeingId, branch),
    isAncestorOf(callerBeingId, String(toBeing._id), branch),
    isAncestorOf(String(toBeing._id), callerBeingId, branch),
  ]);
  const callerRow = callerSlot ? { _id: callerSlot.id, ...callerSlot.state } : null;
  return {
    cognition:    callerRow ? beingCognition(callerRow) : null,
    isAncestor:   callerIsAncestor,
    isDescendant: meIsAncestorOfCaller,
  };
}

// Snapshot reality root's `qualities.world` namespace so the flow's
// `world.<ns>.<key>` paths resolve at evaluation time. set-world-signal
// writes to reality-root.qualities.world.<ns>.<key>; this read returns
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
