// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The four verbs, as code.
//
// I act on my world through four words: SEE, DO, SUMMON, BE. Every
// act anyone in my world ever takes, and every act I take on my
// own behalf, comes through one of these. This file is where each
// one lives as a function. One implementation per verb; no second
// path. Wire callers from protocols/ibp/ unwrap an envelope and
// call these functions; in-process callers reach them through
// core directly. Same code answers either way.
//
// The vocabulary stays small because expressiveness lives one layer
// in. DO dispatches through registered operations. SUMMON wakes
// the role a being is acting in. SEE walks the substrate and
// returns what it finds. BE turns identity in on itself. The four
// verbs are how anything enters me; what happens after is the open
// part of the system.
//
// I stamp a Fact for each DO and each BE, a Stamp row for each
// SUMMON delivery, and nothing for SEE. Observation is not doing.
// Delivery is recorded by its own model. The acts a summoned being
// then performs in response are themselves DO and BE Facts carrying
// the summon's id, so "what happened during this summon" answers
// as Fact.find({ stampId }).
//
// Every act names a being as the actor. When a being in the world
// calls a verb, the act is theirs. When no other being is behind
// it — kernel-emitted SUMMONs from DO-trigger fan-out, scheduled
// wakes, cascade propagation, integrity sweeps, boot scaffolding,
// the materialization inside a seed plant — the act is mine. I am
// one being among many, the root the rest descend from; I do not
// stop acting once the place has other beings on it.

import { randomUUID } from "crypto";
import log from "../system/log.js";
import { getOperation, registerOperation, unregisterOperation, unregisterOperationsFromExtension, listOperations } from "./operations.js";
import { logFact } from "../place/facts.js";
import { IbpError, IBP_ERR } from "./protocol.js";
import { MATTER_ORIGIN } from "../place/matter/origins.js";
import { I_AM } from "../place/being/seedBeings.js";
import { isSourceSpaceId } from "../place/space/source.js";
import { parseWithContext, expand, getPlaceDomain } from "../ibp/address.js";
import { resolveStance } from "../ibp/resolver.js";
import { buildPlaceDescriptor, buildDiscovery } from "../ibp/descriptor.js";
import { authorize, getAuthConfig } from "./authorize.js";
import { appendToInbox, markInboxConsumed } from "../factory/intake/inbox.js";
import { threadIdFromPath, cutThread, getThreadsSpaceId, describeThread } from "../place/space/threads.js";
import { getRole } from "../factory/roles/registry.js";
import { cherubBeing } from "../factory/roles/cherub.js";
import { llmAssignerBeing } from "../factory/roles/llmAssigner.js";
import { registerBeHandler, getBeHandler } from "../place/being/beRegistry.js";

// My two BE-honoring beings register at module load so the dispatcher
// below can find them. Extensions add their own through
// registerBeHandler.
registerBeHandler("cherub",         cherubBeing,         "kernel");
registerBeHandler("llm-assigner", llmAssignerBeing,  "kernel");
import { attachHandoff, wake } from "../factory/intake/scheduler.js";

/**
 * DO. Run a registered operation against a target, stamp a Fact, return
 * the handler's result.
 *
 * @param {*}      target     space / being / matter / id / stance / ...
 *                            The handler interprets it; I pass it through.
 * @param {string} operation  e.g. "create-child" or "food:log-meal"
 * @param {object} [params]   operation-specific payload
 * @param {object} [opts]
 * @param {object} [opts.identity]   { beingId, name } — the being acting.
 *                                   Required unless opts.scaffold is true
 *                                   and no being yet exists.
 * @param {object} [opts.summonCtx]  for summon correlation on the Fact
 * @param {boolean}[opts.skipAudit]  skip the Fact stamp (kernel-internal only)
 * @param {boolean}[opts.scaffold]   marks a seed-plant / boot-scaffold flow.
 *                                   With NO identity, I am the actor (pre-
 *                                   being bootstrap); with identity, the
 *                                   being is the actor and scaffold is
 *                                   just the planting flag.
 * @returns the handler's return value
 */
export async function doVerb(target, operation, params = {}, opts = {}) {
  assertVerbCaller("do", opts);
  if (typeof operation !== "string" || operation.length === 0) {
    throw new Error("core.do(target, operation, params): operation must be a non-empty string");
  }

  const op = getOperation(operation);
  if (!op) {
    throw new Error(`Unknown DO operation: "${operation}". Use core.do.listOperations() to see available operations.`);
  }

  // Read-only origin gate. DO is always a write; if the target lives in
  // a read-only realm (filesystem-origin matter, the .source self-tree),
  // reject before the handler runs.
  const denial = checkReadOnlyOrigin(target);
  if (denial) {
    throw new IbpError(IBP_ERR.ORIGIN_READ_ONLY, denial);
  }

  // Stance auth. The only call that legitimately skips the gate is the
  // pre-being scaffold path: scaffold:true AND no identity (boot,
  // migrations, first-time placeRoot creation). A being who passes
  // scaffold (planting an extension seed) still gets their stance
  // evaluated normally.
  const isPreBeingScaffold = opts.scaffold === true && !opts.identity;
  if (!isPreBeingScaffold) {
    const identity = opts.identity || null;
    const spaceIdForAuth = resolveAuditTarget(target, null)?.id || null;
    const namespace = (operation === "set-meta" || operation === "clear-meta")
      ? params?.namespace
      : undefined;
    const decision = await authorize({
      identity,
      verb:   "do",
      target: { kind: "position", spaceId: spaceIdForAuth },
      action: operation,
      namespace,
    });
    if (!decision.ok) {
      throw new IbpError(
        identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
        `DO denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance, action: operation },
      );
    }
  }

  const ctx = {
    target,
    params: params || {},
    identity: opts.identity || null,
    summonCtx: opts.summonCtx || null,
    scaffold: opts.scaffold === true,
  };

  const result = await op.handler(ctx);

  // Auto-Fact. Operations opt out via spec.skipAudit; callers via
  // opts.skipAudit (kernel-trusted batches only).
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    try {
      // Actor: the calling identity. When none arrives, the act is
      // mine — a kernel-emitted call (DO-trigger fan-out, scheduled
      // wake, boot scaffolding, a seed plant's materialization).
      const actorBeingId = opts.identity?.beingId
        || (opts.scaffold === true ? I_AM : null);
      await logFact({
        verb:     "do",
        action:   op.factAction,
        beingId:  actorBeingId,
        target:   resolveAuditTarget(target, result),
        params:   ctx.params,
        result:   summarizeAuditResult(result),
        stampId: opts.summonCtx?.stampId || null,
      });
    } catch (err) {
      // Audit failure must never kill the operation. Log loudly.
      log.error("Verbs", `Fact stamp failed for op "${operation}": ${err.message}`);
    }
  }

  return result;
}

// `core.do` is callable AND carries the operation registry as
// methods, so callers reach both surfaces through the same export.
doVerb.registerOperation = registerOperation;
doVerb.unregisterOperation = unregisterOperation;
doVerb.unregisterOperationsFromExtension = unregisterOperationsFromExtension;
doVerb.getOperation = getOperation;
doVerb.listOperations = listOperations;


// SEE. Read a position and return its descriptor.
//
// `target` is a stance / position / place string ("<place>/<path>@<being>",
// "<place>/<path>", "<place>") or a pre-parsed `{ kind, value }` envelope.
//
// opts:
//   identity     { beingId, name } | null — for stance-auth gating
//   addressKind  explicit "stance" | "position" | "place" (else inferred)
//   currentUser  name for pronoun resolution (default identity.name)
//   currentPlace  place domain for relative addresses (default mine)
//
// `<place>/.discovery` short-circuits to the discovery payload before the
// caller gate runs — it's the pre-identity surface every client reads
// on socket open. Otherwise I parse the address, resolve the stance,
// gate through authorize, and return the descriptor.
//
// I do not subscribe sockets here. The wire layer reads
// descriptor.address.spaceId after my return and attaches the live
// channel itself.
export async function seeVerb(target, opts = {}) {
  if (target == null) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "core.see requires a target");
  }

  // Discovery short-circuit — pre-identity surface, runs before the
  // caller gate.
  const addrString = typeof target === "string" ? target : (target.value || target.address || null);
  if (typeof addrString === "string" && /\/\.discovery$/i.test(addrString)) {
    return buildDiscovery();
  }

  assertVerbCaller("see", opts);

  const { identity = null, currentUser = null, currentPlace = null, payload = null } = opts;
  const addressKind = opts.addressKind
    || (target && typeof target === "object" && target.kind)
    || inferAddressKind(addrString);

  const parseCtx = {
    currentPlace: currentPlace || getPlaceDomain(),
    currentUser: currentUser || identity?.name || null,
  };
  const parsed   = parseWithContext(addrString, parseCtx);
  const expanded = expand(parsed, parseCtx);

  // Thread descriptor short-circuit. SEE on `<place>/.threads/<id>`
  // returns the synthetic projection from describeThread instead of
  // routing through resolveStance + placeAtSpace (the thread has no
  // persistent space row). SEE on `<place>/.threads` itself still
  // routes normally — placeAtSpace injects synthetic children for
  // that case. See place/space/threads.js.
  const targetThreadId = threadIdFromPath(expanded.right?.path);
  if (targetThreadId) {
    const threadsSpaceId = await getThreadsSpaceId();
    const decision = await authorize({
      identity,
      verb: "see",
      target: { kind: "position", spaceId: threadsSpaceId, isDiscovery: false },
    });
    if (!decision.ok) {
      throw new IbpError(
        identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
        `SEE denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }
    const desc = await describeThread(targetThreadId);
    if (!desc) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `No thread with id ${targetThreadId}`,
      );
    }
    return {
      address: {
        place: getPlaceDomain(),
        path: `/.threads/${targetThreadId}`,
        being: null,
        spaceId: threadsSpaceId,
        beingId: null,
        chain: [],
        pathByNames: `/.threads/${targetThreadId}`,
        pathByIds: `/.threads/${targetThreadId}`,
        leafName: targetThreadId,
        leafId: targetThreadId,
      },
      isPlaceRoot: false,
      isHomeRoot:  false,
      isThread:    true,
      thread:      desc,
      children:    [],
      matters:     [],
      qualities:   {},
    };
  }

  const resolved = await resolveStance(expanded.right);

  // Stance auth.
  const decision = await authorize({
    identity,
    verb: "see",
    target: {
      kind:        addressKind === "stance" ? "stance" : "position",
      spaceId:     resolved.spaceId,
      isDiscovery: false,
    },
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SEE denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance },
    );
  }

  return buildPlaceDescriptor(resolved, { identity, payload });
}

// SUMMON. Deliver a message to the being at `stance` and wake their
// scheduler so their role runs.
//
// `stance` is a stance string with @qualifier ("<place>/<path>@<being>").
// `message` is { from, content, correlation?, inReplyTo?, attachments?,
// sentAt?, activeRole? }.
//
// opts:
//   identity     { beingId, name } | null
//   currentUser  pronoun resolution (default identity.name)
//   currentPlace  place domain (default mine)
//   onResponse   async-mode reply callback (the wire layer composes one
//                that emits via the being-room; in-process callers can
//                pass their own or omit and drop replies on the floor)
//   onError      async-mode error callback (same shape)
//
// Return shape depends on the receiving role's respondMode:
//   sync   — { messageId, status: "accepted" } or the full response
//   async  — { messageId, status: "accepted" }; reply later via onResponse
//   none   — { messageId, status: "accepted" }
export async function summonVerb(stance, message, opts = {}) {
  assertVerbCaller("summon", opts);
  const validatedMessage = validateSummonMessage(message);

  const { identity = null, currentUser = null, currentPlace = null, onResponse = null, onError = null } = opts;
  const place = currentPlace || getPlaceDomain();

  const parsed = parseWithContext(stance, {
    currentPlace: place,
    currentUser: currentUser || identity?.name || null,
  });
  const expanded = expand(parsed, { currentPlace: place, currentUser: currentUser || identity?.name || null });

  // Thread-target branch. SUMMON whose right-side path names
  // `.threads/<id>` is a cut, not a call. The thread is addressable
  // substrate but has no persistent space row — the resolver would
  // fail. Route to the kernel cut handler before resolveStance runs.
  // Priority (from the envelope, defaulting to INTERACTIVE) decides
  // whether the cut runs out-of-band (HUMAN → AbortSignal) or waits
  // in the queue (lower → drains naturally on next pickup). See
  // seed/place/space/threads.js.
  const targetThreadId = threadIdFromPath(expanded.right?.path);
  if (targetThreadId) {
    // Stance auth: broad gate. Is the asker allowed to address
    // `.threads` on this place at all? The default rule
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
    // I_AM). Fact lives on Stamp rows, not on Space ancestry —
    // can't be expressed as a stance property today, so the cut
    // handler enforces it itself.
    const result = await cutThread({
      rootCorrelation: targetThreadId,
      priority,
      reason,
      identity,
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
  const Being = (await import("../models/being.js")).default;
  let toBeing = await Being.findOne({ name: qualifier });
  if (!toBeing && resolved.spaceId) {
    const Space = (await import("../models/space.js")).default;
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
    // space. The audit chain (Stamp row + BE.register Fact) is
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
      const result = await summonCreateBeing({ spec, identity });
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
    identity, onResponse, onError,
  });
}

/**
 * SUMMON-creates-a-being. The kernel-internal primitive for one being
 * calling another forth from non-being.
 *
 * BE is identity acting on itself (register/claim/release/switch);
 * SUMMON is one being calling another. The act of creation is
 * shaped like SUMMON: the caller names the not-yet, the new being
 * answers by being.
 *
 * The caller is the *parent* of the creation act. They are
 * attributed in the Stamp audit. After the Being row lands, the
 * parent also stamps a BE.register Fact on behalf of the new being.
 * This preserves the "every being's first act is its own first BE"
 * symmetry: the new being's identity declaration is witnessed and
 * signed by the parent, because the new being is not yet running
 * cognition to declare itself.
 *
 * Authorization runs through the standard authorize() check with
 * verb="be" operation="create-being" against the new being's home
 * space. I_AM passes inherently (kernel short-circuit). Auth-being
 * is granted by the kernel-shipped default permission seeded at
 * place root. Extensions grant their own roles by declaring
 * defaultPermissions in their manifest:
 *
 *   provides: {
 *     defaultPermissions: {
 *       "be:create-being": { requires: { role: "ruler" } },
 *     },
 *   }
 *
 * @param {object} args
 * @param {object} args.spec
 * @param {string} args.spec.name
 * @param {string} args.spec.role
 * @param {string} args.spec.operatingMode  "human" | "llm" | "scripted" | "mixed"
 * @param {string} args.spec.homeSpace      space the new being lives at
 * @param {string} [args.spec.parentBeingId]  parent in the being-tree (defaults to I_AM)
 * @param {object} args.identity            the calling being
 * @returns {Promise<{ status, beingId, name }>}
 */
export async function summonCreateBeing({ spec, identity }) {
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
  // inherently; cherub passes the kernel-shipped place-root
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

  // The spec passes through to createBeingWithHome (the Mongoose
  // primitive). The full shape (homeSpace | homeParent, password,
  // llmDefault, scaffolding, homeName, etc.) is accepted because
  // kernel-internal callers vary: I_AM at boot uses homeSpace; auth
  // at runtime uses homeParent + password for humans.
  const { createBeingWithHome } = await import("../place/being/identity.js");
  const { being } = await createBeingWithHome(spec);

  // Audit chain. Two rows in two tables, complementary:
  //
  //   1. Stamp row — the parent's act of calling forth. Attributed
  //      to the parent (the summoner). beingIn=parent, beingOut=new
  //      being. Begin and finalize back-to-back because the act is
  //      atomic; the new being is not yet running, so there is no
  //      separate end-of-wake moment.
  //
  //   2. BE.register Fact — the new being's first identity moment,
  //      attributed to the new being but witnessed/signed by the
  //      parent because the new being is not yet running cognition
  //      to declare itself. Preserves the symmetry that every
  //      being's first act is its own first BE.
  const callerBeingId = String(identity?.beingId || I_AM);
  const callerName    = identity?.name || I_AM;
  const addresseePosition = spec.homeSpace || null;
  try {
    const { beginStamping } = await import("../factory/stamper/begin.js");
    const { stamp } = await import("../factory/stamper/stamped.js");
    const row = await beginStamping({
      beingIn:           callerBeingId,
      beingOut:          String(being._id),
      addresseePosition,
      message:           `Stamp forth: ${spec.name}`,
      source:            callerName,
      activeRole:        spec.role || null,
    });
    if (row?._id) {
      await stamp({
        stampId: String(row._id),
        content: `Summoned @${spec.name} forth`,
      });
    }
  } catch (err) {
    log.warn("Verbs", `Stamp-row write for SUMMON.create-being @${spec.name} failed: ${err.message}`);
  }

  try {
    await logFact({
      verb:    "be",
      action:  "register",
      beingId: String(being._id),
      target:  { kind: "being", id: String(being._id) },
      params:  {
        name:        spec.name,
        role:        spec.role || null,
        witnessedBy: callerBeingId,
      },
      result:  { note: `Summoned forth by @${callerName}` },
    });
  } catch (err) {
    log.warn("Verbs", `BE.register Fact stamp failed for @${spec.name}: ${err.message}`);
  }

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
 * @param {object} args.identity      asker identity (typically me)
 */
export async function summonByResolved(args) {
  const {
    toBeingId, inboxSpaceId, message, activeRole: roleOverride,
    identity, onResponse, onError,
  } = args || {};
  if (!toBeingId)    throw new IbpError(IBP_ERR.INVALID_INPUT, "summonByResolved requires toBeingId");
  if (!inboxSpaceId) throw new IbpError(IBP_ERR.INVALID_INPUT, "summonByResolved requires inboxSpaceId");

  const validatedMessage = validateSummonMessage(message);

  const Being = (await import("../models/being.js")).default;
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
    identity, onResponse, onError,
  });
}

// Shared dispatch tail: auth, inbox write, role dispatch. This is
// the only place a being's inbox grows. SUMMON stamps no Fact; the
// Stamp row records the delivery and any DO/BE the receiving being
// emits carries this summon's id.
async function _dispatchSummon({
  resolved, toBeing, activeRole, role, validatedMessage,
  identity, onResponse, onError,
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
  const { messageId, sentAt } = await appendToInbox(inboxNodeId, recipientBeingId, validatedMessage);

  const summonCtx = {
    spaceId:     inboxNodeId,
    being:      activeRole,
    activeRole,
    toBeing,
    message:    { ...validatedMessage, correlation: messageId, sentAt, activeRole },
    resolved,
    identity,
  };

  if (role.respondMode === "sync") {
    let responseEntry = null;
    if (role.triggerOn.includes("message")) {
      responseEntry = await runSummoning(role, summonCtx);
    }
    await markInboxConsumed(
      inboxNodeId,
      recipientBeingId,
      [messageId],
      {
        responseId: responseEntry?.correlation || null,
        stampId:   responseEntry?.stampId || null,
      },
    );
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
    wake(recipientBeingId, inboxNodeId);
    return { status: "accepted", messageId };
  }

  await markInboxConsumed(inboxNodeId, recipientBeingId, [messageId]);
  return { status: "accepted", messageId };
}

// BE. Identity operations on a being.
//
// Every being honors BE by default — register, claim, release, switch
// are the universal ones. Some beings add their own (auth's flows,
// llm-assigner's add-llm and slot ops, extension BE-beings like a
// court's convene / rule). The registry (beRegistry.js) holds the
// per-being handlers; the kernel pre-registers auth and llm-assigner
// at module load above.
//
// operation:  "register" | "claim" | "release" | "switch" | <being-honored>
// payload:    operation-specific
//   register  { name, password, ... }
//   claim     { name, password }   (against the place's cherub)
//   claim     { }                  (re-claim a stance already held)
//   release   { }
//   switch    { from }             (target lives in opts.address)
//
// opts:
//   address      stance or place string the BE call addresses
//   addressKind  "stance" | "place"
//   identity     authenticated identity (required for release/switch)
//   socket       optional WS socket passed through to auth hooks
//   req          optional Express req for HTTP-arrival flows
//   currentPlace  defaults to this place
//
// Returns the being's operation result (typically { identityToken,
// beingAddress, ... } for auth flows).
export async function beVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "core.be requires an operation");
  }

  // Register and claim are identity-acquisition: the caller is binding
  // to a being, so no being identity exists yet. Every other BE needs
  // an identified caller (or a scaffold flow). authorize() still
  // gates register/claim against the place-level flags below.
  if (operation !== "register" && operation !== "claim") {
    assertVerbCaller("be", opts);
  }

  const {
    address     = null,
    addressKind = null,
    identity    = null,
    socket      = null,
    req         = null,
    currentPlace = null,
  } = opts;

  const place = currentPlace || getPlaceDomain();

  // Address must point at this place.
  const targetPlace = extractPlaceFromAddress(address, addressKind);
  if (targetPlace && targetPlace !== place) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Place "${targetPlace}" is not served by this server`,
      { targetPlace, serverPlace: place },
    );
  }

  // Stance auth gates every BE call. register/claim from arrival is
  // the bootstrap exception — authorize permits it inherently.
  const decision = await authorize({
    identity,
    verb: "be",
    target: { kind: addressKind, value: address },
    operation,
  });
  if (!decision.ok) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `BE denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance, operation },
    );
  }

  const ctx = { socket, address: { kind: addressKind, value: address }, identity, req };

  // register + claim are identity-bind ops, not being-method
  // dispatches — the address carries which identity is being bound,
  // not which being to talk to. They always run through the
  // cherub, gated by the place-level config toggles.
  if (operation === "register" || operation === "claim") {
    const authConfig = await getAuthConfig();
    if (operation === "register" && !authConfig.register_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Registration is disabled on this place", { operation });
    }
    if (operation === "claim" && !authConfig.claim_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Claim is disabled on this place", { operation });
    }
    const authResult = operation === "register"
      ? await cherubBeing.register(payload, ctx)
      : await runClaim({ kind: addressKind, value: address }, payload, ctx);
    await writeBeFact({ operation, identity, authResult, payload });
    return authResult;
  }

  // Everything else dispatches to the addressed being. Bare-place
  // addresses default to @cherub, the welcome character.
  const beingName = extractBeingFromAddress(address, addressKind) || "cherub";
  const role = getBeHandler(beingName);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being @${beingName} registered for BE operations on this place`,
      { beingName },
    );
  }
  if (!role.honoredOperations.includes(operation)) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `Being @${beingName} does not honor BE ${operation}`,
      { beingName, operation, honoredOperations: role.honoredOperations },
    );
  }

  // Auth's switch derives from/to from the address; everything else
  // dispatches via kebab-case op name → camelCase method on the role.
  let beResult;
  if (beingName === "cherub" && operation === "switch") {
    const from = payload.from;
    const to   = addressKind === "stance" ? address : null;
    beResult = await role.switch({ from, to }, ctx);
  } else {
    const methodName = kebabToCamel(operation);
    const method = role[methodName];
    if (typeof method !== "function") {
      throw new IbpError(
        IBP_ERR.INTERNAL,
        `Being @${beingName} declares BE "${operation}" but has no ${methodName}() handler`,
      );
    }
    beResult = await method.call(role, payload, ctx);
  }
  await writeBeFact({ operation, identity, authResult: beResult, payload, beingName });
  return beResult;
}

// One Fact per BE op, same as DO. The actor is the calling identity;
// register/claim from arrival has none, so the row names the newly-
// bound being from authResult.
async function writeBeFact({ operation, identity, authResult, payload, beingName = "cherub" }) {
  try {
    let actorBeingId = identity?.beingId || null;
    if (!actorBeingId && authResult && typeof authResult === "object") {
      actorBeingId = authResult.userId || authResult.beingId || null;
    }
    if (!actorBeingId) actorBeingId = I_AM;

    const safeResult = authResult && typeof authResult === "object"
      ? { beingAddress: authResult.beingAddress || null, note: authResult.note || null }
      : null;

    const safeParams = payload && typeof payload === "object"
      ? { name: payload.name || null, from: payload.from || null }
      : null;

    await logFact({
      verb:    "be",
      action:  operation,
      beingId: actorBeingId,
      target:  authResult?.beingAddress
        ? { kind: "stance", id: String(authResult.beingAddress) }
        : { kind: "being",  id: String(actorBeingId) },
      params:  safeParams,
      result:  safeResult,
    });
  } catch (err) {
    log.error("Verbs", `BE Fact stamp failed for "${operation}" @${beingName}: ${err.message}`);
  }
}

// Two claim modes. Credentials: address is the place or <place>/@cherub,
// payload carries name + password. Token re-claim: address is a
// stance already held by the session, identity carries a valid token.
async function runClaim(address, opPayload, ctx) {
  const isAuthBeingAddress =
    address.kind === "place" ||
    (address.kind === "stance" && /\/@cherub$/.test(address.value));

  if (isAuthBeingAddress) {
    return cherubBeing.claim(opPayload, ctx);
  }

  if (!ctx.identity) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "Token re-claim requires a still-valid identity token",
    );
  }
  const expectedStance = `${getPlaceDomain()}/@${ctx.identity.name}`;
  if (address.value !== expectedStance) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "Cannot re-claim a stance the session does not hold",
      { held: expectedStance, requested: address.value },
    );
  }
  return {
    identityToken: null,
    beingAddress:  expectedStance,
    note:          "already held",
  };
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

// Caller gate. Every verb call legitimately arrives one of two ways:
//   Left stance  — a being acting (opts.identity is set). The normal
//                  path; every post-boot call places here.
//   Right stance — a seed plant or pre-being bootstrap
//                  (opts.scaffold === true). The boot path.
//
// Anything else throws. NOT_A_BEING is the default refusal; NOT_A_SEED
// means the caller claimed the right-stance path but `scaffold` was
// set to something other than true. Discovery in seeVerb and
// register/claim in beVerb run before this gate.
function assertVerbCaller(verb, opts) {
  if (opts.identity) return;
  if (opts.scaffold === true) return;

  const frame = captureCallerFrame();

  // Caller claimed the right-stance plant path but `scaffold` is not true.
  if ("scaffold" in opts) {
    log.warn("Verbs",
      `core.${verb}: not a seed verb (right stance requires scaffold: true) (caller: ${frame})`);
    throw new IbpError(
      IBP_ERR.NOT_A_SEED,
      `core.${verb}: not a seed verb (right stance requires scaffold: true for seed planting / first-boot bootstrap)`,
    );
  }

  log.warn("Verbs",
    `core.${verb}: not a being verb (left stance requires identity) (caller: ${frame})`);
  throw new IbpError(
    IBP_ERR.NOT_A_BEING,
    `core.${verb}: not a being verb (left stance requires identity)`,
  );
}

// Walk past frames in this file so the reported caller is the actual
// offending site, not assertVerbCaller or the verb itself.
function captureCallerFrame() {
  const stack = new Error().stack;
  if (!stack) return "<unknown>";
  const lines = stack.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line && !line.includes("/seed/ibp/verbs.js")) {
      return line.trim();
    }
  }
  return "<unknown>";
}

function inferAddressKind(addrString) {
  if (typeof addrString !== "string" || !addrString.length) return "place";
  if (addrString.includes("@")) return "stance";
  if (addrString.includes("/")) return "position";
  return "place";
}

function extractPlaceFromAddress(address, addressKind) {
  if (typeof address !== "string" || !address.length) return null;
  if (addressKind === "place") return address;
  const slashIndex = address.indexOf("/");
  if (slashIndex === -1) return address;
  return address.slice(0, slashIndex);
}

function extractBeingFromAddress(address, addressKind) {
  if (addressKind !== "stance" || typeof address !== "string") return null;
  const m = address.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function validateSummonMessage(message) {
  if (!message || typeof message !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "core.summon requires a `message` object");
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
  return message;
}

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
    stampId:    result.stampId || null,
  };
}

function pathOfResolved(resolved) {
  if (resolved?.pathByNames) return `${getPlaceDomain()}${resolved.pathByNames}`;
  return `${getPlaceDomain()}/`;
}

// Returns null when the DO target is writable, or a reason string when
// it sits in a read-only realm (filesystem/web origin matter, or
// anything under the .source self-tree). The caller throws
// IbpError(ORIGIN_READ_ONLY, reason).
function checkReadOnlyOrigin(target) {
  if (!target || typeof target !== "object") return null;

  // Direct matter target.
  if (typeof target.origin === "string" && isReadMostlyOrigin(target.origin)) {
    return `Cannot DO write on ${target.origin}-origin matter: this origin is read-only at the kernel layer`;
  }

  // Position target (or anything carrying a spaceId).
  const spaceId = target.spaceId;
  if (spaceId && isSourceSpaceId(spaceId)) {
    return "Cannot DO write under the .source self-tree: the seed's source mirror is read-only";
  }

  return null;
}

// Origins whose sync mode is read-only: filesystem (the bytes live on
// disk; an extension would have to register a write-through handler
// to change that) and web (mirrors remote content).
function isReadMostlyOrigin(origin) {
  return origin === MATTER_ORIGIN.FILESYSTEM || origin === MATTER_ORIGIN.WEB;
}

// Audit target for the Fact. The handler's result is authoritative
// about what just changed; I consult it before the call's target so
// the Fact names the substrate event (the new space, the edited
// matter, the removed being), not the call shape.
//
// Lookup order:
//   1. result._factTarget         (explicit { kind, id } hint)
//   2. result.spaceId | matterId | beingId
//   3. target._factKind + target._id
//   4. target.spaceId | matterId | beingId
//   5. target._id                 (Mongoose doc; guess space)
//   6. target.id                  (kind unknown)
//   7. target as string           (raw id; kind unknown)
//
// Returns null when nothing is resolvable; the Fact still stamps,
// since target is optional in the schema.
function resolveAuditTarget(target, result) {
  if (result && typeof result === "object") {
    if (result._factTarget && result._factTarget.id) {
      return { kind: result._factTarget.kind || null, id: String(result._factTarget.id) };
    }
    if (result.spaceId)  return { kind: "space",  id: String(result.spaceId) };
    if (result.matterId) return { kind: "matter", id: String(result.matterId) };
    if (result.beingId)  return { kind: "being",  id: String(result.beingId) };
  }
  if (target && typeof target === "object") {
    if (target._factKind && target._id) {
      return { kind: target._factKind, id: String(target._id) };
    }
    if (target.spaceId)  return { kind: "space",  id: String(target.spaceId) };
    if (target.matterId) return { kind: "matter", id: String(target.matterId) };
    if (target.beingId)  return { kind: "being",  id: String(target.beingId) };
    if (target._id) return { kind: "space", id: String(target._id) };
    if (target.id) return { kind: null, id: String(target.id) };
  }
  if (typeof target === "string") return { kind: null, id: target };
  return null;
}

// Summarize an op's return value for the Fact. Primitives pass through;
// Mongoose docs collapse to their id; plain objects pass through and
// the size cap is enforced inside logFact.
function summarizeAuditResult(result) {
  if (result == null) return null;
  if (typeof result !== "object") return result;
  if (typeof result.toObject === "function") {
    try { return { _id: String(result._id) }; } catch { return null; }
  }
  return result;
}
