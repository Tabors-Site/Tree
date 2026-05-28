// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// summon.js — the SUMMON verb. Deliver a message to the being at
// `stance` and wake their scheduler so their role runs.
//
// SUMMON is the only verb whose fact lands on the CALLER'S reel
// (single-writer: a being writes only its own reel). The
// recipient is named in params.recipient; the cross-cutting fold
// handler in past/act/inboxProjectionFold.js upserts an
// InboxProjection row keyed by correlation; the scheduler picks
// from there.
//
// Three entries:
//
//   summonVerb         — public, parses the stance, resolves the
//                        being, dispatches. Two short-circuits before
//                        the normal flow: `<reality>/.threads/<id>`
//                        routes to cutThread; an unresolved
//                        @qualifier with a `create-being` content
//                        routes to summonCreateBeing (call-forth).
//
//   summonCreateBeing  — seed-internal primitive for one being calling
//                        another forth from non-being. Audit chain is
//                        Act row + be:register Fact on new being's
//                        reel + be:summon-create audit Fact on the
//                        summoner's reel. First real multi-reel ΔF.
//
//   summonByResolved   — for callers that already have the receiver
//                        and inbox space resolved (DO-trigger fan-out,
//                        scheduled wakes). Skips parse + resolve; auth
//                        still runs. The only sanctioned in-process
//                        path for "internal" summons — anything
//                        writing to a being's inbox comes through
//                        here or through summonVerb.
//
// Private: _dispatchSummon (shared tail used by both summonVerb and
// summonByResolved), validateSummonMessage, runSummoning,
// pathOfResolved.

import { randomUUID } from "crypto";
import log from "../../seedReality/log.js";
import { emitFact } from "../../past/fact/facts.js";
import {
  ORIENTATION,
  validateOrientation,
} from "../../present/orientation.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { parseWithContext, expand, getRealityDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { authorize } from "../authorize.js";
import {
  threadIdFromPath,
  cutThread,
  getThreadsSpaceId,
} from "../../materials/space/threads.js";
import { getRole } from "../../present/roles/registry.js";
import { attachHandoff, wake } from "../../present/intake/scheduler.js";
import { assertVerbCaller } from "./_shared.js";

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
export async function summonVerb(stance, message, opts = {}) {
  assertVerbCaller("summon", opts);
  const validatedMessage = validateSummonMessage(message);

  const { identity = null, currentUser = null, currentReality = null, onResponse = null, onError = null, summonCtx = null } = opts;
  const realityDomain = currentReality || getRealityDomain();

  const parsed = parseWithContext(stance, {
    currentReality: realityDomain,
    currentUser: currentUser || identity?.name || null,
  });
  const expanded = expand(parsed, { currentReality: realityDomain, currentUser: currentUser || identity?.name || null });

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
      verb:   "summon",
      target: { kind: "thread", id: targetThreadId, spaceId: threadsSpaceId },
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
      summonCtx,
    });
    return {
      status:    "accepted",
      thread:    targetThreadId,
      severed:   result.severed,
      cancelled: result.cancelled,
      aborted:   result.aborted,
    };
  }

  const resolved = await resolveStance(expanded.right);

  const qualifier = resolved.being;
  if (!qualifier) {
    throw new IbpError(IBP_ERR.ROLE_UNAVAILABLE, "SUMMON requires a stance with an @qualifier");
  }
  if (!resolved.spaceId) {
    throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Stance does not resolve to a known space");
  }

  // Resolve the qualifier to a Being: direct name first (the canonical
  // shape, @ruler435 / @cherub), then role shorthand via
  // qualities.beings.<role>.beingId on the target space.
  const Being = (await import("../../materials/being/being.js")).default;
  let toBeing = await Being.findOne({ name: qualifier });
  if (!toBeing && resolved.spaceId) {
    const Space = (await import("../../materials/space/space.js")).default;
    const targetSpace = await Space.findById(resolved.spaceId).select("qualities").lean();
    const beings = targetSpace?.qualities instanceof Map
      ? targetSpace.qualities.get("beings")
      : targetSpace?.qualities?.beings;
    const homeBeingId = beings?.[qualifier]?.beingId || null;
    if (homeBeingId) toBeing = await Being.findById(homeBeingId);
  }
  if (!toBeing) {
    // Creation pathway. When the addressed @qualifier doesn't yet
    // resolve to a Being row AND the message carries a creation spec
    // AND the caller has identity, this SUMMON is a call-forth: the
    // caller is summoning the @qualifier into existence. Authorize
    // (via summonCreateBeing's internal authorize() check) decides
    // whether the caller's stance permits creation at the target
    // space. The audit chain (Act row + BE.register Fact) is
    // stamped by summonCreateBeing.
    const content = validatedMessage.content;
    if (
      identity &&
      typeof content === "object" && content !== null &&
      content.kind === "create-being" &&
      content.spec && typeof content.spec === "object"
    ) {
      const spec = {
        ...content.spec,
        name:      content.spec.name      || qualifier,
        homeSpace: content.spec.homeSpace || resolved.spaceId,
      };
      const result = await summonCreateBeing({ spec, identity, summonCtx: opts.summonCtx || null });
      return {
        status:  "created",
        beingId: result.beingId,
        name:    result.name,
      };
    }
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being addressable as "@${qualifier}" at this position`,
    );
  }

  // Resolve activeRole: envelope > toBeing.defaultRole > qualifier.
  // Strict membership check on envelope-specified role.
  let activeRole;
  const envelopeRole = validatedMessage.activeRole || null;
  if (envelopeRole) {
    const carriedRoles = Array.isArray(toBeing.roles) ? toBeing.roles : [];
    if (!carriedRoles.includes(envelopeRole)) {
      throw new IbpError(
        IBP_ERR.ROLE_UNAVAILABLE,
        `Being @${toBeing.name} does not carry role "${envelopeRole}" ` +
        `(roles: ${carriedRoles.length ? carriedRoles.join(", ") : "none"})`,
      );
    }
    activeRole = envelopeRole;
  } else {
    activeRole = toBeing.defaultRole || qualifier;
  }

  const role = getRole(activeRole);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `Role template "${activeRole}" for being @${toBeing.name} is not registered`,
    );
  }

  return _dispatchSummon({
    resolved, toBeing, activeRole, role, validatedMessage,
    identity, onResponse, onError, summonCtx,
  });
}

/**
 * SUMMON-creates-a-being. The seed-internal primitive for one being
 * calling another forth from non-being.
 *
 * BE is identity acting on itself (register/claim/release/switch);
 * SUMMON is one being calling another. The act of creation is
 * shaped like SUMMON: the caller names the not-yet, the new being
 * answers by being.
 *
 * The caller is the *parent* of the creation act. They are
 * attributed in the Act audit. After the Being row lands, the
 * parent also stamps a be:summon-create Fact on their own reel
 * naming the new being — first real multi-reel atomic ΔF: the
 * be:register on the new being's reel + the be:summon-create on
 * the summoner's reel commit together in one transaction.
 *
 * Authorization runs through the standard authorize() check with
 * verb="be" operation="create-being" against the new being's home
 * space. I_AM passes inherently (seed short-circuit). Auth-being
 * is granted by the seed-shipped default permission seeded at
 * place root. Extensions grant their own roles by declaring
 * defaultPermissions in their manifest:
 *
 *   provides: {
 *     defaultPermissions: {
 *       "be:create-being": { requires: { role: "ruler" } },
 *     },
 *   }
 */
export async function summonCreateBeing({ spec, identity, summonCtx = null, scaffold = false }) {
  if (!spec || !spec.name || !spec.operatingMode) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "summonCreateBeing requires spec.{name, operatingMode}",
      { spec },
    );
  }
  if (spec.operatingMode !== "human" && !spec.role) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "summonCreateBeing: non-human spec requires role",
      { spec },
    );
  }
  if (!spec.homeSpace && !spec.homeParent) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "summonCreateBeing: spec requires homeSpace or homeParent",
      { spec },
    );
  }
  // Authorize against the new being's home space. I_AM short-circuits
  // inherently; cherub passes the seed-shipped place-root
  // default; extensions pass through Layer 3 rules they registered.
  const decision = await authorize({
    identity,
    verb:      "be",
    operation: "create-being",
    target:    { kind: "space", spaceId: spec.homeSpace || spec.homeParent },
  });
  if (!decision.ok) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `Stance "${decision.stance}" not authorized to summon beings forth: ${decision.reason || "no rule matched"}`,
      { caller: identity?.name || null, stance: decision.stance },
    );
  }

  // Thread the caller's moment so the be:register Fact stamped inside
  // createBeing rides the parent's frame. Genesis flows (scaffold:true)
  // pass no actId — the chain has a root and this is it.
  const factStampId = summonCtx?.actId || null;
  if (!factStampId && !scaffold) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `summonCreateBeing for @${spec.name}: missing ambient actId. Thread summonCtx from the caller's moment, or scaffold:true for boot.`,
    );
  }

  // The spec passes through to createBeingWithHome (the Mongoose
  // primitive). The full shape (homeSpace | homeParent, password,
  // llmDefault, scaffolding, homeName, etc.) is accepted because
  // seed-internal callers vary: I_AM at boot uses homeSpace; auth
  // at runtime uses homeParent + password for humans. The be:register
  // Fact is stamped INSIDE createBeing — one canonical birth Fact per
  // being, on the new being's reel, carrying the full spec for the
  // reducer to materialize.
  const { createBeingWithHome } = await import("../../materials/being/identity.js");
  const { being } = await createBeingWithHome({
    ...spec,
    identity,
    actId: factStampId,
    summonCtx, // be:register Fact joins the calling moment's ΔF
  });

  // ── Parent audit Fact (Phase 2, step 6: birth-with-parent-fact). ──
  // The be:register Fact above landed on the NEW being's reel. The
  // single-writer law forbids us from stamping on another reel for
  // the same being's "I created X" record, so the summoner stamps
  // a separate audit Fact on their OWN reel naming the created
  // being. When the summoner is a real being inside a moment, this
  // Fact joins ctx.deltaF alongside the be:register — sealAct then
  // commits both facts (two reels) + the Act row in one transaction.
  // First real multi-reel atomic ΔF in production. When standalone
  // (scaffold path, I_AM as actor), emitFact falls back to sealFacts
  // singleton — eager commit on I_AM's reel.
  const summonerBeingId = identity?.beingId ? String(identity.beingId) : I_AM;
  await emitFact({
    verb:    "be",
    action:  "summon-create",
    beingId: summonerBeingId,
    target:  { kind: "being", id: summonerBeingId }, // summoner's own reel
    params:  {
      createdBeingId: String(being._id),
      name:           being.name,
      role:           spec.role || null,
      operatingMode:  spec.operatingMode || null,
      homeSpace:      spec.homeSpace || null,
    },
    actId: factStampId,
  }, summonCtx);

  return {
    status:   "created",
    beingId:  String(being._id),
    name:     being.name,
    being,
  };
}

/**
 * SUMMON for callers that already have the receiver and inbox space
 * resolved (DO-trigger fan-out, scheduled wakes). Skips parse +
 * resolve; auth still runs.
 *
 * Only SUMMONs make SUMMONs. This is the single sanctioned entry for
 * those internal paths — anything that writes to a being's inbox
 * comes through here or through summonVerb. Direct appendToInbox +
 * wake calls bypass the envelope contract and are forbidden.
 *
 * @param {object} args
 * @param {string} args.toBeingId     receiver Being _id
 * @param {string} args.inboxSpaceId  space the inbox lives at
 * @param {object} args.message       SUMMON envelope
 * @param {string} [args.activeRole]  overrides toBeing.defaultRole
 * @param {object} args.identity      asker identity (typically I_AM)
 */
export async function summonByResolved(args) {
  const {
    toBeingId, inboxSpaceId, message, activeRole: roleOverride,
    identity, onResponse, onError, summonCtx = null,
  } = args || {};
  if (!toBeingId)    throw new IbpError(IBP_ERR.INVALID_INPUT, "summonByResolved requires toBeingId");
  if (!inboxSpaceId) throw new IbpError(IBP_ERR.INVALID_INPUT, "summonByResolved requires inboxSpaceId");

  const validatedMessage = validateSummonMessage(message);

  const Being = (await import("../../materials/being/being.js")).default;
  const toBeing = await Being.findById(toBeingId);
  if (!toBeing) {
    throw new IbpError(IBP_ERR.BEING_NOT_FOUND, `No being with id ${toBeingId}`);
  }

  const activeRole = roleOverride || validatedMessage.activeRole || toBeing.defaultRole || toBeing.name;
  const role = getRole(activeRole);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `Role template "${activeRole}" for being @${toBeing.name} is not registered`,
    );
  }

  return _dispatchSummon({
    resolved: { spaceId: inboxSpaceId, leafId: inboxSpaceId, being: activeRole },
    toBeing, activeRole, role, validatedMessage,
    identity, onResponse, onError, summonCtx,
  });
}

// ─────────────────────────────────────────────────────────────────────
// PRIVATE
// ─────────────────────────────────────────────────────────────────────

/**
 * Shared dispatch tail used by summonVerb and summonByResolved.
 * Runs auth, emits the be:summon Fact (joins ctx.deltaF when in-
 * moment), and either runs the role's summon handler synchronously
 * or registers a handoff and nudges the scheduler.
 */
async function _dispatchSummon({
  resolved, toBeing, activeRole, role, validatedMessage,
  identity, onResponse, onError, summonCtx = null,
}) {
  const decision = await authorize({
    identity,
    verb:   "summon",
    target: { kind: "stance", spaceId: resolved.spaceId, being: activeRole, activeRole },
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SUMMON denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance },
    );
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
  // a be:summon Fact on the summoner's own reel. The recipient
  // lives in params.recipient (NOT on target — single-writer: facts
  // only land on the actor's reel for being-targeted ops). The
  // cross-cutting fold handler in past/act/inboxProjectionFold.js
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

  // Phase 2: contribute the be:summon Fact to the caller's ΔF (when
  // inside a moment) so it commits atomically with the moment's seal.
  // Outside a moment (boot, scaffold, seed-internal flows), emitFact
  // falls back to sealFacts singleton — immediate commit. The actId
  // rides from the moment's plannedAct (summonCtx.actId) when
  // present; null for boot/scaffold paths.
  await emitFact({
    verb:    "be",
    action:  "summon",
    beingId: summonerBeingId,
    target:  { kind: "being", id: summonerBeingId }, // summoner's own reel
    params:  {
      recipient:       recipientBeingId,
      correlation:     messageId,
      rootCorrelation: validatedMessage.rootCorrelation || messageId,
      inReplyTo:       validatedMessage.inReplyTo || null,
      sender:          validatedMessage.from,
      content:         validatedMessage.content,
      priority:        validatedMessage.priority || "INTERACTIVE",
      activeRole,
      orientation,
      attachments:     validatedMessage.attachments,
      inboxSpaceId:    inboxNodeId,
      sentAt,
    },
    actId: summonCtx?.actId || null,
  }, summonCtx);

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
      responseEntry = await runSummoning(role, innerCtx);
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
    // The be:summon Fact above is in the caller's ΔF (when inside a
    // moment); the InboxProjection row only materializes when sealAct
    // commits the ΔF + runs foldAfterCommit. Wake-before-fold would
    // nudge the scheduler at an empty projection. Outside a moment
    // (summonCtx==null), emitFact committed immediately above and the
    // fold has already run — wake fires inline here.
    if (role.triggerOn?.includes("message")) {
      const fireWake = () => wake(recipientBeingId, inboxNodeId);
      if (summonCtx && Array.isArray(summonCtx.afterSeal)) {
        summonCtx.afterSeal.push(fireWake);
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
 */
function validateSummonMessage(message) {
  if (!message || typeof message !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reality.summon requires a `message` object");
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
  // Orientation (INNER-FOLD spec). External summons must carry
  // forward — only self-summons may set half or inward, enforced
  // in _dispatchSummon above. Default to forward when absent.
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
async function runSummoning(role, ctx) {
  let result;
  try {
    result = await role.summon(ctx.message, ctx);
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
