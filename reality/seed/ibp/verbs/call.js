// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// summon.js — the SUMMON verb. Deliver a message to the being at
// `stance` and wake their scheduler so their role runs.
//
// SUMMON is its own verb namespace, peer to DO and BE. The summon
// Fact has target=recipient (right stance, matching DO's target
// shape) and beingId=summoner (the actor). The cross-cutting fold
// handler in past/projections/inbox/inboxProjectionFold.js upserts
// an InboxProjection row keyed by correlation; the scheduler picks
// from there. Self-summons (orientation turns, transport intake)
// have target.id === beingId.
//
// Two entries:
//
//   callVerb         — public, parses the stance, resolves the
//                        being, dispatches. Threads-cut short-circuit:
//                        `<reality>/./threads/<id>` routes to
//                        cutThread.
//
//   callByResolved   — for callers that already have the receiver
//                        and inbox space resolved (DO-trigger fan-out,
//                        scheduled wakes). Skips parse + resolve; auth
//                        still runs. The only sanctioned in-process
//                        path for "internal" summons — anything
//                        writing to a being's inbox comes through
//                        here or through callVerb.
//
// Minting a new being is a BE op, not a SUMMON. The auth-running
// public entry for that is `birthBeing` in
// materials/being/identity/birth.js. Earlier this file hosted
// `summonCreateBeing` for historical reasons; moved 2026-06-03.
//
// Private: _dispatchCall (shared tail used by both callVerb and
// callByResolved), validateCallMessage, runCalling,
// pathOfResolved.

import { randomUUID } from "crypto";
import log from "../../seedReality/log.js";
import { emitFact } from "../../past/fact/facts.js";
import {
  ORIENTATION,
  validateOrientation,
} from "../../present/stamper/2-fold/orientation.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { parseWithContext, expand, resolveBranchPointers, getRealityDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { authorize } from "../authorize.js";
import { permitsReceiverSummon } from "../roleAuth.js";
import {
  threadIdFromPath,
  cutThread,
  getThreadsSpaceId,
} from "../../materials/space/threads.js";
import { getRole } from "../../present/roles/registry.js";
import { attachHandoff, wake } from "../../present/intake/scheduler.js";
import { assertVerbCaller, refuseHistoricalWrite, resolveBranchForFact, normalizeIdentity } from "./_shared.js";

// Legacy numeric priority (used by inbox queue ordering and the
// older wake APIs) mapped to the SUMMON envelope's enum. The Act
// schema stores the enum; coercing here at the verb seam keeps the
// Fact, InboxProjection, and Act all carrying the same canonical
// string regardless of which caller built the envelope.
const _PRIORITY_NUM_TO_ENUM = {
  1: "HUMAN",
  2: "GATEWAY",
  3: "INTERACTIVE",
  4: "BACKGROUND",
  5: "BACKGROUND",
};

/**
 * SUMMON. Deliver a message to the being at `stance` and wake their
 * scheduler so their role runs.
 *
 * `stance` is a stance string with @qualifier
 * ("<reality>/<path>@<being>"). `message` is
 * { from, content, correlation?, inReplyTo?, attachments?,
 *   sentAt?, activeRole?, orientation? }.
 *
 * Return shape depends on the receiving role's respondMode:
 *   sync   — { messageId, status: "accepted" } or the full response
 *   async  — { messageId, status: "accepted" }; reply later via onResponse
 *   none   — { messageId, status: "accepted" }
 */
export async function callVerb(stance, message, opts = {}) {
  assertVerbCaller("call", opts);
  refuseHistoricalWrite("call", stance, opts);
  const validatedMessage = validateCallMessage(message);

  const {
    identity = null, currentUser = null, currentReality = null,
    currentBranch = null, currentPath = null, actorBranch = null,
    onResponse = null, onError = null, moment = null,
  } = opts;

  // Top-level operation count (one-DO/BE/SUMMON-per-moment doctrine;
  // sealAct reads opCount + batched from moment). Each summon is
  // one unit of intent — the actor decides to call another being.
  // Unlike DO's set-render → set-being recursion, recursive summons
  // (a role handler that summons another role) are genuinely distinct
  // intents and should count, so no `_inOp` gate here.
  if (moment) {
    moment._opCount = (moment._opCount || 0) + 1;
  }
  const realityDomain = currentReality || getRealityDomain();

  const parseCtx = {
    currentReality: realityDomain,
    currentUser: currentUser || identity?.name || null,
    // Ambient world for relative shapes (`~`, bare paths, implicit
    // branch): the moment's own branch when inside one, else the
    // wire-threaded value. Without this the seed-side expand fell
    // through to the `#main` pointer for every relative summon and
    // resolveStance walked the wrong branch for off-main callers.
    currentBranch: moment?.actorAct?.branch || currentBranch || null,
    currentPath:   currentPath || null,
  };
  const parsed = parseWithContext(stance, parseCtx);
  const expanded = await resolveBranchPointers(expand(parsed, parseCtx), parseCtx);

  // Thread-target branch. SUMMON whose right-side path names
  // `.threads/<id>` is a cut, not a call. The thread is addressable
  // substrate but has no persistent space row — the resolver would
  // fail. Route to the seed cut handler before resolveStance runs.
  // Priority (from the envelope, defaulting to INTERACTIVE) decides
  // whether the cut runs out-of-band (HUMAN → AbortSignal) or waits
  // in the queue (lower → drains naturally on next pickup). See
  // seed/materials/space/threads.js.
  const targetThreadId = threadIdFromPath(expanded.right?.path);
  if (targetThreadId) {
    // Stance auth: broad gate. Is the asker allowed to address
    // `.threads` on this reality at all? The default rule
    // `summon:.threads:*` matches against the place root and
    // requires non-arrival (an authenticated being). Per-position
    // overrides at `.threads` can tighten this.
    const threadsSpaceId = await getThreadsSpaceId();
    const decision = await authorize({
      identity,
      verb:   "call",
      target: { kind: "thread", id: targetThreadId, spaceId: threadsSpaceId },
      moment,
      // The caller's session branch (their grants live there). The
      // wire threads it separately from currentBranch, which carries
      // the FACT's destination branch for this verb.
      actorBranch: actorBranch || null,
    });
    if (!decision.ok) {
      throw new IbpError(IBP_ERR.FORBIDDEN, decision.reason || "Not allowed to address .threads");
    }

    const priority = validatedMessage.priority || "INTERACTIVE";
    const reason   = validatedMessage.content || "thread cut";
    // Participation check happens inside cutThread: the asker must
    // be a participant in this specific rootCorrelation chain (or
    // I_AM). Facts live on Act rows, not on Space ancestry —
    // can't be expressed as a stance property today, so the cut
    // handler enforces it itself.
    const result = await cutThread({
      rootCorrelation: targetThreadId,
      priority,
      reason,
      identity,
      moment,
    });
    return {
      status:    "accepted",
      thread:    targetThreadId,
      severed:   result.severed,
      cancelled: result.cancelled,
      aborted:   result.aborted,
    };
  }

  const resolved = await resolveStance(expanded.right, { identity });

  const qualifier = resolved.being;
  if (!qualifier) {
    throw new IbpError(IBP_ERR.ROLE_UNAVAILABLE, "SUMMON requires a stance with an @qualifier");
  }
  if (!resolved.spaceId) {
    throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Stance does not resolve to a known space");
  }

  // Resolve the qualifier to a Being: direct name first (the canonical
  // shape, @ruler435 / @cherub), then role shorthand by scanning the
  // target space's qualities.beings for an entry whose value.role
  // matches. Entries are keyed by being-name (multi-being-per-role
  // support); the role-shorthand search walks values to find a match.
  // When multiple beings share the role, the first hit wins; addressing
  // a specific instance uses its name.
  const { findByName, loadOrFold } = await import("../../materials/projections.js");
  // Branch resolution at the perimeter: inside-moment continuations
  // ride moment.actorAct?.branch; wire-originated calls ride opts.currentBranch.
  // Throws MISSING_BRANCH if neither was attached (a threading bug at
  // the perimeter, surfaced loud per the branch-hardening doctrine).
  const branch = resolveBranchForFact(moment, currentBranch, "call");
  let toBeingSlot = await findByName("being", qualifier, branch);
  let toBeing = toBeingSlot ? { _id: toBeingSlot.id, ...toBeingSlot.state } : null;
  if (!toBeing && resolved.spaceId) {
    const spaceSlot = await loadOrFold("space", resolved.spaceId, branch);
    const beings = spaceSlot?.state?.qualities instanceof Map
      ? spaceSlot.state.qualities.get("beings")
      : spaceSlot?.state?.qualities?.beings;
    let homeBeingId = beings?.[qualifier]?.beingId || null;
    if (!homeBeingId && beings && typeof beings === "object") {
      const entries = beings instanceof Map
        ? Array.from(beings.values())
        : Object.values(beings);
      const hit = entries.find((e) => e && e.role === qualifier);
      homeBeingId = hit?.beingId || null;
    }
    if (homeBeingId) {
      const slot = await loadOrFold("being", homeBeingId, branch);
      toBeing = slot ? { _id: slot.id, ...slot.state } : null;
    }
  }
  if (!toBeing) {
    // No creation pathway here. SUMMON is being-to-being
    // communication; minting a being is a BE op (birthBeing in
    // materials/being/identity/birth.js). An unresolvable
    // @qualifier is simply unavailable.
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being addressable as "@${qualifier}" at this position`,
    );
  }

  // Resolve activeRole: envelope > toBeing.defaultRole > qualifier.
  // With the carry list retired (RoleFlow build, 2026-06-01), an
  // envelope-named role is honored as long as the registry knows it;
  // the flow's author is the authorization (anyone with set-being
  // permission writes the flow that gates which roles wake the being).
  // We still want to fail loudly if the role itself doesn't exist —
  // that catches typos before they reach the moment runner.
  const activeRole = validatedMessage.activeRole
    || toBeing.defaultRole
    || qualifier;

  const role = getRole(activeRole);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `Role template "${activeRole}" for being @${toBeing.name} is not registered`,
    );
  }

  // branch was already resolved at the top of callVerb (line ~172)
  // for the findByName lookup; pass it through to _dispatchCall so
  // the fact emission uses the same value.
  return _dispatchCall({
    resolved, toBeing, activeRole, role, validatedMessage,
    identity, onResponse, onError, moment, branch,
    actorBranch,
  });
}

// birthBeing (the authorized public entry for one being minting
// another) lives on the BE side now . see
// materials/being/identity/birth.js. SUMMON is being-to-being
// communication; minting a being is a BE op. Earlier this file
// hosted `summonCreateBeing` for historical reasons (the call-forth
// metaphor), which conflated the two namespaces. Moved 2026-06-03.

/**
 * SUMMON for callers that already have the receiver and inbox space
 * resolved (DO-trigger fan-out, scheduled wakes). Skips parse +
 * resolve; auth still runs.
 *
 * Only SUMMONs make SUMMONs. This is the single sanctioned entry for
 * those internal paths — anything that writes to a being's inbox
 * comes through here or through callVerb. Direct appendToInbox +
 * wake calls bypass the envelope contract and are forbidden.
 *
 * Branch precedence (no silent default to "0"):
 *   1. moment.actorAct.branch — inside-moment caller; inherits the moment's branch
 *   2. args.branch — explicit attachment from callers without a moment
 *      (subscriptions firing from a hook, scheduler boot paths, internal
 *      bootstraps). Required when moment is null.
 *   resolveBranchForFact throws MISSING_BRANCH if neither is present.
 *
 * @param {object} args
 * @param {string} args.toBeingId     receiver Being _id
 * @param {string} args.inboxSpaceId  space the inbox lives at
 * @param {object} args.message       SUMMON envelope
 * @param {string} [args.activeRole]  overrides toBeing.defaultRole
 * @param {object} args.identity      asker identity (typically I_AM)
 * @param {string} [args.branch]      explicit branch for non-moment callers
 * @param {object} [args.moment]   moment ctx for inside-moment callers
 */
export async function callByResolved(args) {
  const {
    toBeingId, inboxSpaceId, message, activeRole: roleOverride,
    identity: rawIdentity,
    onResponse, onError, moment = null, branch: argsBranch = null,
  } = args || {};
  // Accept bare-string identity shorthand (typically `I_AM` for seed-
  // internal summons) alongside the regular `{beingId, name}` shape.
  const identity = normalizeIdentity(rawIdentity);
  if (!toBeingId)    throw new IbpError(IBP_ERR.INVALID_INPUT, "callByResolved requires toBeingId");
  if (!inboxSpaceId) throw new IbpError(IBP_ERR.INVALID_INPUT, "callByResolved requires inboxSpaceId");

  const validatedMessage = validateCallMessage(message);

  const { loadOrFold } = await import("../../materials/projections.js");
  const branch = resolveBranchForFact(moment, argsBranch, "call");
  const toSlot = await loadOrFold("being", toBeingId, branch);
  if (!toSlot) {
    throw new IbpError(IBP_ERR.BEING_NOT_FOUND, `No being with id ${toBeingId} on branch ${branch}`);
  }
  const toBeing = { _id: toSlot.id, position: toSlot.position, ...toSlot.state };

  const activeRole = roleOverride || validatedMessage.activeRole || toBeing.defaultRole || toBeing.name;
  const role = getRole(activeRole);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `Role template "${activeRole}" for being @${toBeing.name} is not registered`,
    );
  }

  return _dispatchCall({
    resolved: { spaceId: inboxSpaceId, leafId: inboxSpaceId, being: activeRole },
    toBeing, activeRole, role, validatedMessage,
    identity, onResponse, onError, moment, branch,
  });
}

// ─────────────────────────────────────────────────────────────────────
// PRIVATE
// ─────────────────────────────────────────────────────────────────────

/**
 * Shared dispatch tail used by callVerb and callByResolved.
 * Runs auth, emits the call Fact (joins ctx.deltaF when in-
 * moment), and either runs the role's summon handler synchronously
 * or registers a handoff and nudges the scheduler.
 */
async function _dispatchCall({
  resolved, toBeing, activeRole, role, validatedMessage,
  identity, onResponse, onError, moment = null, branch,
  actorBranch = null,
}) {
  const decision = await authorize({
    identity,
    verb:   "call",
    // `being` is the TARGET BEING'S NAME — canSummon patterns
    // ("@cherub", "@food-*") match being names, and beings are
    // addressed individually even when several share a role. Passing
    // activeRole here made the role-walk match patterns against the
    // ROLE name: "@cherub" failed for any being whose name differs
    // from their active role, and a pattern like "@human" admitted
    // summoning EVERY human-roled being.
    target: {
      kind: "stance",
      spaceId: resolved.spaceId,
      being: toBeing?.name || activeRole,
      activeRole,
      branch,
    },
    // Envelope intent. Per seed/SUMMON.md, intent is the caller's
    // stated purpose AND an auth predicate: canSummon entries can
    // restrict by intent ({pattern: "@cherub", intent: "mate"}), and
    // the role-walk in roleAuth.permitsSummon reads this to gate. Past
    // omission of this line was the structural drift the SUMMON cleanup
    // (2026-06-11) closed: intent declarations on canSummon entries
    // were silent no-ops because the verb never plumbed it through.
    intent: validatedMessage.intent || null,
    moment,
    // The actor's branch, where their grants live. In-moment summons
    // ride moment.actorAct.branch; wire summons thread the
    // caller's session branch as actorBranch (the `branch` param is
    // the FACT's destination — the wrong side for grants). The final
    // fallback keeps seed-internal callers (scheduler wakes,
    // callByResolved) working: their actor is the substrate and
    // the destination branch is their world.
    actorBranch: moment?.actorAct?.branch || actorBranch || branch || null,
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SUMMON denied for actor "${decision.actor}": ${decision.reason}`,
      { actor: decision.actor },
    );
  }

  // Receiver-side acceptance. The other half of the post office check
  // per seed/SUMMON.md: authorize() above gated the OUTGOING side
  // (actor's role permits sending); this gates the INCOMING side
  // (receiver's role accepts this intent). Progressive enhancement —
  // roles with no `as: receiver` canSummon entries accept anything
  // (current behavior); roles that declared receiver entries are
  // strict-matched.
  const accept = permitsReceiverSummon(role, validatedMessage.intent || null);
  if (!accept.ok) {
    throw new IbpError(IBP_ERR.FORBIDDEN, `SUMMON refused: ${accept.reason}`);
  }

  const inboxNodeId = resolved.spaceId || toBeing.homeSpace || null;
  if (!inboxNodeId) {
    throw new IbpError(
      IBP_ERR.VERB_NOT_SUPPORTED,
      "SUMMON at this stance is not yet wired (no inbox target)",
    );
  }

  const recipientBeingId = String(toBeing._id);

  // Fact-driven SUMMON. The summon is the summoner's act; it stamps
  // a `summon` Fact with target=recipient (right stance) and
  // beingId=summoner (the actor). SUMMON joined DO in stamping its
  // target with the right stance on 2026-06-03; the cross-cutting
  // fold handler in past/projections/inbox/inboxProjectionFold.js
  // upserts an InboxProjection row keyed by correlation; the
  // scheduler picks from there.
  //
  // For seed-internal flows with no identity (DO-trigger fan-out,
  // scheduled wakes, genesis scaffolding), the summoner is I_AM.
  const summonerBeingId = identity?.beingId
    ? String(identity.beingId)
    : I_AM;
  const messageId = randomUUID();
  const sentAt = new Date().toISOString();

  // Orientation gate (INNER-FOLD §4). Only self-summons — where the
  // summoner IS the recipient — may carry an orientation other than
  // forward. A being can turn itself; it cannot turn another being.
  const orientation = validateOrientation(validatedMessage.orientation);
  const isSelfSummon = summonerBeingId === recipientBeingId;
  if (orientation !== ORIENTATION.FORWARD && !isSelfSummon) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `SUMMON with orientation="${orientation}" is only valid for self-summon ` +
      `(summoner must equal recipient). Got summoner=${summonerBeingId.slice(0, 8)} ` +
      `recipient=${recipientBeingId.slice(0, 8)}.`,
    );
  }

  // Phase 2: contribute the summon Fact to the caller's ΔF (when
  // inside a moment) so it commits atomically with the moment's seal.
  // Outside a moment (boot, scaffold, seed-internal flows), emitFact
  // falls back to sealFacts singleton — immediate commit. The actId
  // rides from the moment's plannedAct (moment.actId) when
  // present; null for boot/scaffold paths.
  //
  // SUMMON is its own verb namespace, peer to DO and BE. The fact's
  // target is the RECIPIENT (right stance), matching the symmetry
  // with DO (target=thing acted upon). The actor (summoner) is
  // recorded as `beingId`. Renamed from `be:summon` on 2026-06-03
  // because the BE namespace is for self-acts (birth/connect/release);
  // summoning another being is not a self-act.
  await emitFact({
    verb:    "call",
    act:     "call",
    through: summonerBeingId,
    // The actor NAME (the summoner's signing identity). In-moment summons
    // would have emitFact derive this from moment.actorAct.by; we
    // set it explicitly so the MOMENT-LESS wire summon (no moment.actorAct,
    // the summon becomes the RECIPIENT's moment) still links to the
    // summoner's Name. Precedence mirrors emitFact: moment's actor name,
    // then the caller's signed-in Name, then I_AM for seed-internal flows.
    by:      moment?.actorAct?.by ?? identity?.nameId ?? (summonerBeingId === I_AM ? I_AM : null),
    of:      { kind: "being", id: recipientBeingId }, // right stance
    params:  {
      correlation:     messageId,
      rootCorrelation: validatedMessage.rootCorrelation || messageId,
      inReplyTo:       validatedMessage.inReplyTo || null,
      sender:          validatedMessage.from,
      content:         validatedMessage.content,
      // Envelope intent: the caller's stated purpose. Persisted on the
      // Fact so the audit chain records WHAT THE CALLER SAID THEY WERE
      // DOING, separately from the payload (content) and from what the
      // receiver chose to do (later facts on the receiver's reel). Null
      // when no intent was set; the receiver's role decides on the basis
      // of (intent, content) together.
      intent:          validatedMessage.intent || null,
      priority:        validatedMessage.priority || "INTERACTIVE",
      activeRole,
      orientation,
      attachments:     validatedMessage.attachments,
      inboxSpaceId:    inboxNodeId,
      sentAt,
      // Cross-branch provenance for MOMENT-LESS summons. In-moment
      // summons get crossOrigin derived by emitFact from
      // moment.actorAct; a wire summon has no moment (the summon
      // becomes the RECIPIENT's moment), so when the caller's session
      // branch differs from the fact's destination branch the block
      // is attached here. actId is null — there is no home-side act
      // for a wire summon; the keystroke is not an act.
      ...(!moment?.actorAct && actorBranch && actorBranch !== branch
        ? {
            crossOrigin: {
              reality: null,
              branch:  actorBranch,
              beingId: summonerBeingId,
              actId:   null,
            },
          }
        : {}),
    },
    actId: moment?.actId || null,
    // Branch the summon fact lands on, pre-resolved at the entry point
    // (callVerb / callByResolved both call resolveBranchForFact
    // before dispatching here). _dispatchCall trusts the value.
    branch,
  }, moment);

  const innerCtx = {
    spaceId:     inboxNodeId,
    being:       activeRole,
    activeRole,
    toBeing,
    message:    { ...validatedMessage, correlation: messageId, sentAt, activeRole },
    resolved,
    identity,
  };

  if (role.respondMode === "sync") {
    let responseEntry = null;
    if (role.triggerOn.includes("message")) {
      responseEntry = await runCalling(role, innerCtx);
    }
    if (!responseEntry) return { status: "accepted", messageId };
    return responseEntry;
  }

  if (role.respondMode === "async") {
    const responseFromStance = `${pathOfResolved(resolved)}@${toBeing.name}`;
    attachHandoff(recipientBeingId, messageId, {
      identity,
      resolved,
      responseFromStance,
      onResponse: typeof onResponse === "function" ? onResponse : () => {},
      onError: typeof onError === "function"
        ? onError
        : (err) => {
            if (typeof onResponse === "function") {
              onResponse({
                from:        responseFromStance,
                content:     `[${err.code || "error"}] ${err.message || "summoning failed"}`,
                correlation: randomUUID(),
                inReplyTo:   messageId,
                sentAt:      new Date().toISOString(),
                error:       true,
              });
            }
          },
    });

    // Phase 2: defer the scheduler-nudge until AFTER sealAct commits.
    // The call Fact above is in the caller's ΔF (when inside a
    // moment); the InboxProjection row only materializes when sealAct
    // commits the ΔF + runs foldAfterCommit. Wake-before-fold would
    // nudge the scheduler at an empty projection. Outside a moment
    // (moment==null), emitFact committed immediately above and the
    // fold has already run — wake fires inline here.
    if (role.triggerOn?.includes("message")) {
      const fireWake = () => wake(recipientBeingId, inboxNodeId);
      if (moment && Array.isArray(moment.afterSeal)) {
        moment.afterSeal.push(fireWake);
      } else {
        fireWake();
      }
    }
    return { status: "accepted", messageId };
  }

  return { status: "accepted", messageId };
}

/**
 * Validate a SUMMON envelope. Throws IbpError on a bad shape.
 * Normalizes orientation to a known value (defaults to "forward").
 *
 * Envelope shape per seed/SUMMON.md:
 *   from        REQUIRED stance (position@being) the caller is acting from
 *   content     REQUIRED payload the receiver's role handler reads
 *   intent      OPTIONAL kebab-case label naming the caller's stated purpose;
 *               read by the role-walk auth check (canSummon's intent gate)
 *               and surfaced to the receiver's handler as an addressing hint.
 *               Intent is auth and routing first, hint second; the receiver's
 *               role decides what to do regardless.
 *   priority    OPTIONAL enum (HUMAN | GATEWAY | INTERACTIVE | BACKGROUND)
 *   orientation OPTIONAL enum (forward | half | inward) for self-summons
 *   activeRole  OPTIONAL hint at which of the receiver's roles to wake
 *   attachments OPTIONAL caller-side metadata; opaque to seed
 */
function validateCallMessage(message) {
  if (!message || typeof message !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reality.call requires a `message` object");
  }
  if (typeof message.from !== "string" || !message.from.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`message.from` is required");
  }
  if (!/@[a-z][a-z0-9-]*$/i.test(message.from)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "`message.from` must be a qualified stance (position@being)",
    );
  }
  if (message.content === undefined || message.content === null) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "`message.content` is required");
  }
  // Intent: optional, but when present must be a non-empty kebab-case
  // label. The auth gate (roleAuth.permitsSummon) matches it literally
  // against canSummon entries' intent restrictions, so loose shapes
  // (whitespace, capital letters, punctuation) would silently fail to
  // match declared entries. Reject them at the perimeter.
  if (message.intent !== undefined && message.intent !== null) {
    if (typeof message.intent !== "string" || !message.intent.length) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "`message.intent` must be a non-empty string");
    }
    if (!/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/.test(message.intent)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `\`message.intent\` "${message.intent}" must be kebab-case (lowercase, digits, dashes; ` +
        `optional single namespace prefix via ":")`,
      );
    }
  }
  // Normalize priority. Legacy callers (wakeSchedule, subscriptions)
  // pass the numeric form 1..5 used by inbox queue ordering. The Act
  // schema and downstream consumers want the enum string. Coerce
  // here so the Fact, InboxProjection, and Act all carry the same
  // canonical value.
  if (message.priority !== undefined && message.priority !== null) {
    message.priority = _PRIORITY_NUM_TO_ENUM[message.priority] || message.priority;
  }
  // Orientation (INNER-FOLD spec). External summons must carry
  // forward — only self-summons may set half or inward, enforced
  // in _dispatchCall above. Default to forward when absent.
  try {
    message.orientation = validateOrientation(message.orientation);
  } catch (err) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, err.message);
  }
  return message;
}

/**
 * Run a role's summon handler in-process (the sync-respondMode path)
 * and shape the return into a reply envelope. The role's return value
 * is consulted for text/content; an empty return means "no reply"
 * (the role chose not to speak back).
 */
async function runCalling(role, ctx) {
  let result;
  try {
    result = await role.call(ctx.message, ctx);
  } catch (err) {
    log.error("Verbs", `being "${ctx.being}" summoning errored: ${err.message}`);
    throw new IbpError(IBP_ERR.LLM_FAILED, `Summoning failed: ${err.message}`);
  }
  if (!result || typeof result !== "object") {
    return null; // no-response (role chose not to reply)
  }
  return {
    from:        `${pathOfResolved(ctx.resolved)}@${ctx.toBeing.name}`,
    content:     result.text ?? result.content ?? "",
    correlation: randomUUID(),
    inReplyTo:   ctx.message.correlation,
    sentAt:      new Date().toISOString(),
    actId:       result.actId || null,
  };
}

function pathOfResolved(resolved) {
  if (resolved?.pathByNames) return `${getRealityDomain()}${resolved.pathByNames}`;
  return `${getRealityDomain()}/`;
}
