// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The four-verb dispatcher. core.see / core.do / core.summon / core.be.
//
// Each verb has exactly one execution implementation here. The IBP wire
// handlers (protocols/ibp/verbs/) parse the envelope, resolve the
// stance, and delegate to the matching core verb. In-process callers
// (extensions, kernel internals) reach the same execution by calling
// core.see / core.do / core.summon / core.be directly. See
// [[project_four_verbs_one_execution]] and [[project_seed_four_verbs_only]]
// for the architectural commitment.

import { randomUUID } from "crypto";
import log from "./log.js";
import { getOperation, registerOperation, unregisterOperation, unregisterOperationsFromExtension, listOperations } from "./operations.js";
import { logDid } from "../tree/dids.js";
import { ARTIFACT_ORIGIN, ERR, ProtocolError } from "./protocol.js";
import { isSourceNodeId } from "./source.js";
import { parseWithContext, expand, getLandDomain } from "../addressing/address.js";
import { resolveStance } from "../addressing/resolver.js";
import { buildDescriptor } from "../addressing/descriptor.js";
import { buildDiscovery } from "../addressing/discovery.js";
import { IbpError, IBP_ERR } from "./errors.js";
import { authorize, getAuthConfig } from "./authorize.js";
import { appendToInbox, markInboxConsumed } from "../scheduler/inbox.js";
import { getRole } from "../roles/registry.js";
import { authBeing } from "../roles/auth.js";
import { llmAssignerBeing } from "../roles/llmAssigner.js";
import { attachHandoff, wake } from "../scheduler/scheduler.js";

/**
 * DO verb. Looks up the registered operation, runs its handler, writes
 * a Did (unless the op opts out), returns the handler's result.
 *
 * @param {*} target - whatever the operation expects (node, being, artifact, id, stance, ...)
 *                     The dispatcher passes target through; the operation handler
 *                     interprets it. Convention: nodes/beings/artifacts can be
 *                     Mongoose docs, plain `{ _id }` objects, or id strings.
 * @param {string} operation - operation name ("create-child" or "food:log-meal")
 * @param {object} [params] - operation-specific payload
 * @param {object} [opts]
 * @param {object} [opts.identity] - { beingId, name } when called from a being context
 * @param {object} [opts.summonCtx] - summon context for correlation / audit attribution
 * @param {boolean} [opts.skipAudit] - skip Did write. Reserve for kernel-internal use.
 * @param {boolean} [opts.internal] - skip stance authorization. Reserve for kernel-trusted
 *                                    batch operations (boot, migrations, system writes).
 *                                    Extension code should pass `identity` instead so the
 *                                    gate evaluates that being's stance permissions.
 * @returns the handler's return value
 */
export async function doVerb(target, operation, params = {}, opts = {}) {
  if (typeof operation !== "string" || operation.length === 0) {
    throw new Error("core.do(target, operation, params): operation must be a non-empty string");
  }

  const op = getOperation(operation);
  if (!op) {
    throw new Error(`Unknown DO operation: "${operation}". Use core.do.listOperations() to see available operations.`);
  }

  // Read-only origin gate. DO is always a write in the four-verb model;
  // SEE is the read counterpart. If the target is (or names) an artifact
  // whose origin's sync mode is read-only, reject before the handler
  // runs. Filesystem-origin artifacts are read-only by default — the
  // substrate cannot mutate disk through verbs. The seed's `.source`
  // self-tree is the canonical instance; user-project filesystem
  // mirrors stay read-only until an extension registers a write-through
  // handler (deferred). See [[project_substrate_as_universal_workspace]]
  // (read-mostly origins reject at step 2) and
  // [[project_seed_source_system_node]].
  const denial = checkReadOnlyOrigin(target);
  if (denial) {
    throw new ProtocolError(403, ERR.ORIGIN_READ_ONLY, denial);
  }

  // Stance Authorization gate. One execution per verb means one auth gate
  // per verb; wire-side and in-process callers both pass here. The
  // `internal:true` opt skips the gate for kernel-trusted batch operations
  // (boot, migrations, system writes) where there's no caller identity to
  // evaluate. Extension code should pass `identity` so the gate evaluates
  // that being's stance permissions at the target node. See
  // [[project_four_verbs_one_execution]] and [[project_stance_authorization]].
  if (!opts.internal) {
    const identity = opts.identity || null;
    const nodeIdForAuth = resolveNodeIdForAudit(target, null);
    const namespace = (operation === "set-meta" || operation === "clear-meta")
      ? params?.namespace
      : undefined;
    const decision = await authorize({
      identity,
      verb:   "do",
      target: { kind: "position", nodeId: nodeIdForAuth },
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
  };

  const result = await op.handler(ctx);

  // Auto-Did. Operations can opt out via spec.skipAudit. Callers can also
  // skip via opts.skipAudit (kernel-trusted batch operations).
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    try {
      const nodeId = resolveNodeIdForAudit(target, result);
      // logDid expects { nodeId, action, beingId, ...extensionData }.
      // The beforeDid hook can enrich extensionData; extensions listen
      // there if they want richer per-op audit fields.
      await logDid({
        nodeId,
        action:   op.didAction,
        beingId:  opts.identity?.beingId || null,
        summonId: opts.summonCtx?.summonId || null,
        // The operation name lands in `action`; extensions can add more
        // via beforeDid. Params/result intentionally NOT auto-serialized
        // (too much variance; opt-in via beforeDid).
      });
    } catch (err) {
      // Audit failure must not kill the operation. Log loudly so it does
      // not pass unnoticed.
      log.error("Verbs", `Did write failed for op "${operation}": ${err.message}`);
    }
  }

  return result;
}

/**
 * Attach registry methods to the doVerb function so callers can use
 * `core.do(target, op, params)` AND `core.do.registerOperation(...)`.
 */
doVerb.registerOperation = registerOperation;
doVerb.unregisterOperation = unregisterOperation;
doVerb.unregisterOperationsFromExtension = unregisterOperationsFromExtension;
doVerb.getOperation = getOperation;
doVerb.listOperations = listOperations;


// ────────────────────────────────────────────────────────────────────
// SEE verb. Returns a Position Descriptor for `target`.
//
// `target` may be:
//   - a stance / position / land string
//     ("<land>/<path>@<being>", "<land>/<path>", "<land>")
//   - a pre-parsed `{ kind: "position"|"stance"|"land", value }` envelope
//
// `opts`:
//   identity      — { beingId, name } | null (for stance-auth gating)
//   addressKind   — explicit "stance" | "position" | "land" hint
//                   (defaults to inference from the target shape)
//   currentUser   — name to use for pronoun resolution (defaults to identity.name)
//   currentLand   — land domain for relative addresses (defaults to this land)
//
// Returns the descriptor (or the discovery payload for `<land>/.discovery`).
// Live subscription is the wire layer's responsibility — it reads
// `descriptor.address.nodeId` after the call and subscribes the socket
// when `payload.live` is set. See protocols/ibp/verbs/see.js.
// ────────────────────────────────────────────────────────────────────

export async function seeVerb(target, opts = {}) {
  if (target == null) {
    throw new ProtocolError(400, ERR.INVALID_INPUT, "core.see requires a target");
  }

  // Discovery short-circuit. `<land>/.discovery` is read by every client
  // right after socket open to learn capabilities.
  const addrString = typeof target === "string" ? target : (target.value || target.address || null);
  if (typeof addrString === "string" && /\/\.discovery$/i.test(addrString)) {
    return buildDiscovery();
  }

  const { identity = null, currentUser = null, currentLand = null } = opts;
  const addressKind = opts.addressKind
    || (target && typeof target === "object" && target.kind)
    || inferAddressKind(addrString);

  const parseCtx = {
    currentLand: currentLand || getLandDomain(),
    currentUser: currentUser || identity?.name || null,
  };
  const parsed   = parseWithContext(addrString, parseCtx);
  const expanded = expand(parsed, parseCtx);
  const resolved = await resolveStance(expanded.right);

  // Stance Authorization gate.
  const decision = await authorize({
    identity,
    verb: "see",
    target: {
      kind:        addressKind === "stance" ? "stance" : "position",
      nodeId:      resolved.nodeId,
      visibility:  resolved.leafNode?.visibility,
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

  return buildDescriptor(resolved, { identity });
}

// ────────────────────────────────────────────────────────────────────
// SUMMON verb. Delivers `message` to the being addressed by `stance`,
// then wakes the per-being scheduler to run the role's summoning.
//
// `stance` is a stance string with @qualifier ("<land>/<path>@<being>").
//
// `message` is the inbox payload: { from, content, intent?, correlation?,
// inReplyTo?, attachments?, sentAt?, activeRole? }.
//
// `opts`:
//   identity         — { beingId, name } | null
//   currentUser      — name for pronoun resolution (defaults from identity.name)
//   currentLand      — land domain (defaults to this land)
//   onResponse       — callback(responseEntry) for async-mode replies; the wire
//                      layer composes one that emits via the being-room.
//                      In-process callers can pass their own or omit (drop on the floor).
//   onError          — callback(err) for async-mode errors; same shape as onResponse.
//
// Returns shape depends on the receiving role's respondMode:
//   sync   — { messageId, status: "accepted" } or the full response entry
//   async  — { messageId, status: "accepted" }; reply later via onResponse
//   none   — { messageId, status: "accepted" }
// ────────────────────────────────────────────────────────────────────

export async function summonVerb(stance, message, opts = {}) {
  const validatedMessage = validateSummonMessage(message);

  const { identity = null, currentUser = null, currentLand = null, onResponse = null, onError = null } = opts;
  const land = currentLand || getLandDomain();

  const parsed = parseWithContext(stance, {
    currentLand: land,
    currentUser: currentUser || identity?.name || null,
  });
  const expanded = expand(parsed, { currentLand: land, currentUser: currentUser || identity?.name || null });
  const resolved = await resolveStance(expanded.right);

  const qualifier = resolved.being;
  if (!qualifier) {
    throw new IbpError(IBP_ERR.ROLE_UNAVAILABLE, "SUMMON requires a stance with an @qualifier");
  }
  if (!resolved.nodeId) {
    throw new IbpError(IBP_ERR.NODE_NOT_FOUND, "Stance does not resolve to a known node");
  }

  // Resolve the qualifier to a specific Being:
  //   1. Direct name lookup (canonical: @ruler435, @auth)
  //   2. Role shorthand at the resolved position via metadata.beings.<role>.beingId
  const Being = (await import("../models/being.js")).default;
  let toBeing = await Being.findOne({ name: qualifier });
  if (!toBeing && resolved.nodeId) {
    const Node = (await import("../models/node.js")).default;
    const targetNode = await Node.findById(resolved.nodeId).select("metadata").lean();
    const emb = targetNode?.metadata instanceof Map
      ? targetNode.metadata.get("beings")
      : targetNode?.metadata?.beings;
    const homeBeingId = emb?.[qualifier]?.beingId || null;
    if (homeBeingId) toBeing = await Being.findById(homeBeingId);
  }
  if (!toBeing) {
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

  // Stance Authorization gate.
  const decision = await authorize({
    identity,
    verb:   "summon",
    target: { kind: "stance", nodeId: resolved.nodeId, being: activeRole, activeRole },
    intent: validatedMessage.intent,
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SUMMON denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance },
    );
  }

  // Resolve inbox-attach node.
  const inboxNodeId = resolved.nodeId || toBeing.homePositionId || null;
  if (!inboxNodeId) {
    throw new IbpError(
      IBP_ERR.VERB_NOT_SUPPORTED,
      "SUMMON at this stance is not yet wired (no inbox target)",
    );
  }

  const recipientBeingId = String(toBeing._id);
  const { messageId, sentAt } = await appendToInbox(inboxNodeId, recipientBeingId, validatedMessage);

  const summonCtx = {
    nodeId:     inboxNodeId,
    being:      activeRole,                  // legacy field name; carries the active role
    activeRole,                              // canonical
    toBeing,                                 // resolved being instance (receiver)
    message:    { ...validatedMessage, correlation: messageId, sentAt, activeRole },
    resolved,
    identity,
  };

  // Sync respond-mode: run summoning inline, return the response.
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
        summonId:   responseEntry?.summonId || null,
      },
    );
    if (!responseEntry) return { status: "accepted", messageId };
    return responseEntry;
  }

  // Async respond-mode: register handoff (scheduler calls onResponse/onError
  // when summoning completes), wake, return accepted.
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
                intent:      "chat",
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

  // none: ack accepted; nothing else to do.
  await markInboxConsumed(inboxNodeId, recipientBeingId, [messageId]);
  return { status: "accepted", messageId };
}

// ────────────────────────────────────────────────────────────────────
// BE verb. Identity operations: register / claim / release / switch.
//
// `operation` is one of "register" | "claim" | "release" | "switch".
//
// `payload` is operation-specific:
//   register  { name, password, ... }
//   claim     { name, password }              (against the land's auth-being)
//   claim     { }                              (re-claim a held stance)
//   release   { }
//   switch    { from }                         (target stance lives in opts.address)
//
// `opts`:
//   address       — stance or land string the BE call addresses (auth-being land for register/claim)
//   addressKind   — "stance" | "land"
//   identity      — currently authenticated identity (required for release/switch)
//   socket        — optional socket (passed through to auth-being hooks)
//   req           — optional Express req (passed through; used by HTTP-arrival flows)
//   currentLand   — defaults to this land
//
// Returns the auth-being's operation result (typically { identityToken, beingAddress, ... }).
// ────────────────────────────────────────────────────────────────────

// Canonical land-system beings reachable via BE. Each declares its own
// `honoredOperations`; the dispatcher below routes by the address's
// @being qualifier (bare-land addresses default to @auth).
const LAND_BEINGS = Object.freeze({
  "auth":         authBeing,
  "llm-assigner": llmAssignerBeing,
});

export async function beVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "core.be requires an operation");
  }

  const {
    address     = null,
    addressKind = null,
    identity    = null,
    socket      = null,
    req         = null,
    currentLand = null,
  } = opts;

  const land = currentLand || getLandDomain();

  // Address must point at this land.
  const targetLand = extractLandFromAddress(address, addressKind);
  if (targetLand && targetLand !== land) {
    throw new IbpError(
      IBP_ERR.NODE_NOT_FOUND,
      `Land "${targetLand}" is not served by this server`,
      { targetLand, serverLand: land },
    );
  }

  // Stance Authorization gate (uniform across all BE operations).
  // register/claim from arrival is the bootstrap exception — authorize
  // permits it inherently.
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

  // register + claim are identity-bind operations, not being-method
  // dispatches — the address carries which identity is being bound,
  // not which being to talk to. They always run through auth-being.
  // Auth-config toggles gate them at the land level.
  if (operation === "register" || operation === "claim") {
    const authConfig = await getAuthConfig();
    if (operation === "register" && !authConfig.register_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Registration is disabled on this land", { operation });
    }
    if (operation === "claim" && !authConfig.claim_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Claim is disabled on this land", { operation });
    }
    if (operation === "register") return authBeing.register(payload, ctx);
    return runClaim({ kind: addressKind, value: address }, payload, ctx);
  }

  // Everything else dispatches to the addressed being. Bare-land
  // addresses default to @auth (the welcome character).
  const beingName = extractBeingFromAddress(address, addressKind) || "auth";
  const role = LAND_BEINGS[beingName];
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being @${beingName} at this land`,
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

  // Auth-being's switch derives `from` / `to` from the address.
  if (beingName === "auth" && operation === "switch") {
    const from = payload.from;
    const to   = addressKind === "stance" ? address : null;
    return role.switch({ from, to }, ctx);
  }

  // Default dispatch: kebab-case op name → camelCase method.
  const methodName = kebabToCamel(operation);
  const method = role[methodName];
  if (typeof method !== "function") {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `Being @${beingName} declares BE "${operation}" but has no ${methodName}() handler`,
    );
  }
  return method.call(role, payload, ctx);
}

// Two claim modes:
//   - credentials (address is land or <land>/@auth, payload has name+password)
//   - token re-claim (address is a held stance, identity carries a valid token)
async function runClaim(address, opPayload, ctx) {
  const isAuthBeingAddress =
    address.kind === "land" ||
    (address.kind === "stance" && /\/@auth$/.test(address.value));

  if (isAuthBeingAddress) {
    return authBeing.claim(opPayload, ctx);
  }

  if (!ctx.identity) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "Token re-claim requires a still-valid identity token",
    );
  }
  const expectedStance = `${getLandDomain()}/@${ctx.identity.name}`;
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

function inferAddressKind(addrString) {
  if (typeof addrString !== "string" || !addrString.length) return "land";
  if (addrString.includes("@")) return "stance";
  if (addrString.includes("/")) return "position";
  return "land";
}

function extractLandFromAddress(address, addressKind) {
  if (typeof address !== "string" || !address.length) return null;
  if (addressKind === "land") return address;
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
    return null; // no-response or place-intent
  }
  return {
    from:        `${pathOfResolved(ctx.resolved)}@${ctx.toBeing.name}`,
    content:     result.content,
    intent:      result.intent || ctx.message.intent,
    correlation: randomUUID(),
    inReplyTo:   ctx.message.correlation,
    sentAt:      new Date().toISOString(),
    summonId:    result.summonId || null,
  };
}

function pathOfResolved(resolved) {
  if (resolved?.pathByNames) return `${getLandDomain()}${resolved.pathByNames}`;
  return `${getLandDomain()}/`;
}

/**
 * Inspect the DO target and decide whether the dispatcher should reject
 * the call because the target's origin is read-only.
 *
 * Two paths land here:
 *   1. Direct artifact target: a handler was passed an Artifact doc or
 *      `{ origin, ... }` envelope. Check the origin enum.
 *   2. Position target: the IBP DO handler passes a resolved stance
 *      `{ nodeId, ... }`. If nodeId is the .source system node, the
 *      whole position is read-only (its artifact tree mirrors disk).
 *
 * Returns `null` when allowed, or a human-readable reason string when
 * the call must be rejected. The caller throws ProtocolError(403,
 * ORIGIN_READ_ONLY, reason).
 */
function checkReadOnlyOrigin(target) {
  if (!target || typeof target !== "object") return null;

  // Direct artifact target.
  if (typeof target.origin === "string" && isReadMostlyOrigin(target.origin)) {
    return `Cannot DO write on ${target.origin}-origin artifact: this origin is read-only at the kernel layer`;
  }

  // Position target (or anything carrying a nodeId).
  const nodeId = target.nodeId;
  if (nodeId && isSourceNodeId(nodeId)) {
    return "Cannot DO write under the .source self-tree: the seed's source mirror is read-only";
  }

  return null;
}

/**
 * Origins whose sync mode defaults to read-only. Filesystem-origin
 * artifacts cannot be mutated through substrate writes unless an
 * extension registers a write-through handler (deferred). Web-origin
 * artifacts mirror remote pages and are always read-only.
 */
function isReadMostlyOrigin(origin) {
  return origin === ARTIFACT_ORIGIN.FILESYSTEM || origin === ARTIFACT_ORIGIN.WEB;
}

/**
 * Best-effort nodeId resolution for the audit Did. Most DO operations
 * target a node; the dispatcher tries (in order):
 *   1. result._didNodeId      (operation handler hint)
 *   2. target._id              (Mongoose Node doc)
 *   3. target.nodeId           (envelope-like { nodeId, ... })
 *   4. target.id               (generic { id, ... })
 *   5. target as string        (raw id)
 *
 * When nothing is resolvable (e.g., being- or artifact-only operations
 * that have no node side), the Did is written without nodeId.
 */
function resolveNodeIdForAudit(target, result) {
  if (result && typeof result === "object" && result._didNodeId) {
    return String(result._didNodeId);
  }
  if (target && typeof target === "object") {
    if (target._id) return String(target._id);
    if (target.nodeId) return String(target.nodeId);
    if (target.id) return String(target.id);
  }
  if (typeof target === "string") return target;
  return null;
}
