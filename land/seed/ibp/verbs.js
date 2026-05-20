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
import log from "../system/log.js";
import { getOperation, registerOperation, unregisterOperation, unregisterOperationsFromExtension, listOperations } from "./operations.js";
import { logDid } from "../space/dids.js";
import { ERR, ProtocolError } from "./protocol.js";
import { MATTER_ORIGIN } from "../matter/origins.js";
import { SEED_BEING } from "../space/seedSpaces.js";
import { isSourceSpaceId } from "../space/source.js";
import { parseWithContext, expand, getLandDomain } from "../ibp/address.js";
import { resolveStance } from "../ibp/resolver.js";
import { buildDescriptor } from "../ibp/descriptor.js";
import { buildDiscovery } from "../ibp/discovery.js";
import { IbpError, IBP_ERR } from "./errors.js";
import { authorize, getAuthConfig } from "./authorize.js";
import { appendToInbox, markInboxConsumed } from "../cognition/inbox.js";
import { getRole } from "../being/roles/registry.js";
import { authBeing } from "../being/roles/auth.js";
import { llmAssignerBeing } from "../being/roles/llmAssigner.js";
import { registerBeBeing, getBeBeing } from "../being/beRegistry.js";

// Kernel pre-registration. The two kernel BE-honoring beings register
// at module load so the dispatcher below can find them. Extensions add
// their own BE-honoring beings via registerBeBeing (e.g. a court-
// being's convene/rule, a treasurer-being's transfer/freeze).
registerBeBeing("auth",         authBeing,         "kernel");
registerBeBeing("llm-assigner", llmAssignerBeing,  "kernel");
import { attachHandoff, wake } from "../cognition/scheduler.js";

/**
 * DO verb. Looks up the registered operation, runs its handler, writes
 * a Did (unless the op opts out), returns the handler's result.
 *
 * @param {*} target - whatever the operation expects (space, being, matter, id, stance, ...)
 *                     The dispatcher passes target through; the operation handler
 *                     interprets it. Convention: spaces/beings/matter can be
 *                     Mongoose docs, plain `{ _id }` objects, or id strings.
 * @param {string} operation - operation name ("create-child" or "food:log-meal")
 * @param {object} [params] - operation-specific payload
 * @param {object} [opts]
 * @param {object} [opts.identity] - { beingId, name } the being acting from a stance.
 *                                    Required for normal verb calls; omitted only when
 *                                    `opts.scaffold` is set.
 * @param {object} [opts.summonCtx] - summon context for correlation / audit attribution
 * @param {boolean} [opts.skipAudit] - skip Did write. Reserve for kernel-internal use.
 * @param {boolean} [opts.scaffold] - mark this call as a seed-plant / scaffold flow.
 *                                    With NO identity, this is pre-being kernel
 *                                    bootstrap (landRoot creation, migrations,
 *                                    first-time-boot config writes): the stance
 *                                    auth gate is skipped and the audit Did is
 *                                    attributed to SEED_BEING. With identity
 *                                    set, scaffold is just a planting marker.
 *                                    The being is the actor, stance auth runs
 *                                    against their stance, and the audit row
 *                                    names them. Extensions planting their own
 *                                    seeds always pass identity + scaffold.
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

  // Read-only origin gate. DO is always a write in the four-verb model;
  // SEE is the read counterpart. If the target is (or names) matter
  // whose origin's sync mode is read-only, reject before the handler
  // runs. Filesystem-origin matter is read-only by default — the
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

  // Stance Authorization gate. The only call that legitimately skips
  // stance auth is the pre-being scaffold path: scaffold:true AND no
  // identity (server boot, migrations, first-time landRoot creation).
  // A being passing scaffold (e.g. planting an extension seed) still
  // gets their stance evaluated normally. See
  // [[project_four_verbs_one_execution]], [[project_stance_authorization]],
  // and [[project_extension_seeds]].
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

  // Auto-Did. Operations can opt out via spec.skipAudit. Callers can also
  // skip via opts.skipAudit (kernel-trusted batch operations).
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    try {
      // Audit actor: the being if one is acting, otherwise SEED_BEING
      // for pre-being scaffold (server boot, migrations). A being
      // planting a seed passes identity AND scaffold; identity wins
      // here so the planter is correctly named in the audit row.
      const actorBeingId = opts.identity?.beingId
        || (opts.scaffold === true ? SEED_BEING : null);
      await logDid({
        verb:     "do",
        action:   op.didAction,
        beingId:  actorBeingId,
        target:   resolveAuditTarget(target, result),
        params:   ctx.params,
        result:   summarizeAuditResult(result),
        summonId: opts.summonCtx?.summonId || null,
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
// `descriptor.address.spaceId` after the call and subscribes the socket
// when `payload.live` is set. See protocols/ibp/verbs/see.js.
// ────────────────────────────────────────────────────────────────────

export async function seeVerb(target, opts = {}) {
  if (target == null) {
    throw new ProtocolError(400, ERR.INVALID_INPUT, "core.see requires a target");
  }

  // Discovery short-circuit. `<land>/.discovery` is read by every client
  // right after socket open to learn capabilities. Intrinsic pre-identity
  // surface; runs before the kernel-access gate.
  const addrString = typeof target === "string" ? target : (target.value || target.address || null);
  if (typeof addrString === "string" && /\/\.discovery$/i.test(addrString)) {
    return buildDiscovery();
  }

  assertVerbCaller("see", opts);

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

  return buildDescriptor(resolved, { identity });
}

// ────────────────────────────────────────────────────────────────────
// SUMMON verb. Delivers `message` to the being addressed by `stance`,
// then wakes the per-being scheduler to run the role's summoning.
//
// `stance` is a stance string with @qualifier ("<land>/<path>@<being>").
//
// `message` is the inbox payload: { from, content, correlation?,
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
  assertVerbCaller("summon", opts);
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
  if (!resolved.spaceId) {
    throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Stance does not resolve to a known node");
  }

  // Resolve the qualifier to a specific Being:
  //   1. Direct name lookup (canonical: @ruler435, @auth)
  //   2. Role shorthand at the resolved position via metadata.beings.<role>.beingId
  const Being = (await import("../models/being.js")).default;
  let toBeing = await Being.findOne({ name: qualifier });
  if (!toBeing && resolved.spaceId) {
    const Space = (await import("../models/space.js")).default;
    const targetSpace = await Space.findById(resolved.spaceId).select("metadata").lean();
    const emb = targetSpace?.metadata instanceof Map
      ? targetSpace.metadata.get("beings")
      : targetSpace?.metadata?.beings;
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
    target: { kind: "stance", spaceId: resolved.spaceId, being: activeRole, activeRole },
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SUMMON denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance },
    );
  }

  // Resolve inbox-attach node.
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

// BE-being lookup is registry-driven now (seed/being/beRegistry.js).
// Kernel pre-registers auth and llm-assigner at module load above;
// extensions add their own via registerBeBeing.

export async function beVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "core.be requires an operation");
  }

  // Register/claim from arrival are intrinsic identity-acquisition
  // operations: the caller is binding to a being, so no being identity
  // exists yet. Every other BE operation needs an identified caller (or
  // a scaffold flow). authorize() still gates register/claim against
  // land-level register_enabled / claim_enabled flags below.
  if (operation !== "register" && operation !== "claim") {
    assertVerbCaller("be", opts);
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
      IBP_ERR.SPACE_NOT_FOUND,
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
    const authResult = operation === "register"
      ? await authBeing.register(payload, ctx)
      : await runClaim({ kind: addressKind, value: address }, payload, ctx);
    await writeBeDid({ operation, identity, authResult, payload });
    return authResult;
  }

  // Everything else dispatches to the addressed being. Bare-land
  // addresses default to @auth (the welcome character). The registry
  // returns the being's spec; extensions can register their own
  // BE-honoring beings (court, treasurer, federation, etc.) via
  // seed/being/beRegistry.js.
  const beingName = extractBeingFromAddress(address, addressKind) || "auth";
  const role = getBeBeing(beingName);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being @${beingName} registered for BE operations on this land`,
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
  let beResult;
  if (beingName === "auth" && operation === "switch") {
    const from = payload.from;
    const to   = addressKind === "stance" ? address : null;
    beResult = await role.switch({ from, to }, ctx);
  } else {
    // Default dispatch: kebab-case op name → camelCase method.
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
  await writeBeDid({ operation, identity, authResult: beResult, payload, beingName });
  return beResult;
}

/**
 * BE auto-Did. Every BE operation produces an audit row, mirroring the
 * DO dispatcher's behavior. The actor is the identity that arrived
 * (register / claim from arrival has no prior identity; the row names
 * the newly-bound being from authResult.beingAddress / .userId).
 */
async function writeBeDid({ operation, identity, authResult, payload, beingName = "auth" }) {
  try {
    let actorBeingId = identity?.beingId || null;
    if (!actorBeingId && authResult && typeof authResult === "object") {
      actorBeingId = authResult.userId || authResult.beingId || null;
    }
    if (!actorBeingId) actorBeingId = SEED_BEING;

    const safeResult = authResult && typeof authResult === "object"
      ? { beingAddress: authResult.beingAddress || null, note: authResult.note || null }
      : null;

    const safeParams = payload && typeof payload === "object"
      ? { name: payload.name || null, from: payload.from || null }
      : null;

    await logDid({
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
    log.error("Verbs", `BE Did write failed for "${operation}" @${beingName}: ${err.message}`);
  }
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

// Kernel access gate. Every verb has exactly two legitimate stance
// positions for its caller:
//
//   Left stance  — a being acting from a stance (`opts.identity` carries
//                  who). The dominant path; every post-boot call is here.
//   Right stance — a seed being planted onto a position
//                  (`opts.scaffold === true`). Reserved for seed plant
//                  flows ([[project_extension_seeds]]) and pre-being
//                  kernel bootstrap (first-boot landRoot creation,
//                  migrations, first-time config writes).
//
// Two stance positions, two error codes:
//
//   NOT_A_BEING  — default failure. No identity, no scaffold claim.
//                  The left-stance check failed; the caller did not
//                  arrive as a being.
//   NOT_A_SEED   — caller passed `scaffold` but its value was not true.
//                  The right-stance plant context is malformed.
//
// Both warn with the caller's frame so the offending file:line is
// visible. The discovery short-circuit in seeVerb and the register /
// claim branch in beVerb intentionally run before this gate (intrinsic
// pre-identity surfaces).
function assertVerbCaller(verb, opts) {
  if (opts.identity) return;
  if (opts.scaffold === true) return;

  const frame = captureCallerFrame();

  // The caller passed `scaffold` (any value) but not `true`. They
  // claimed the right-stance plant path; its shape is wrong.
  if ("scaffold" in opts) {
    log.warn("Verbs",
      `core.${verb}: not a seed verb (right stance requires scaffold: true) (caller: ${frame})`);
    throw new IbpError(
      IBP_ERR.NOT_A_SEED,
      `core.${verb}: not a seed verb (right stance requires scaffold: true for seed planting / first-boot bootstrap)`,
    );
  }

  // Default failure: caller did not arrive as a being.
  log.warn("Verbs",
    `core.${verb}: not a being verb (left stance requires identity) (caller: ${frame})`);
  throw new IbpError(
    IBP_ERR.NOT_A_BEING,
    `core.${verb}: not a being verb (left stance requires identity)`,
  );
}

// Walks the stack past frames inside this file so the reported caller
// is the actual offending site (not assertVerbCaller / the verb itself).
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
    return null; // no-response (role chose not to reply)
  }
  return {
    from:        `${pathOfResolved(ctx.resolved)}@${ctx.toBeing.name}`,
    content:     result.text ?? result.content ?? "",
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
 *   1. Direct matter target: a handler was passed a Matter doc or
 *      `{ origin, ... }` envelope. Check the origin enum.
 *   2. Position target: the IBP DO handler passes a resolved stance
 *      `{ spaceId, ... }`. If spaceId is the .source land seed space, the
 *      whole position is read-only (its matter tree mirrors disk).
 *
 * Returns `null` when allowed, or a human-readable reason string when
 * the call must be rejected. The caller throws ProtocolError(403,
 * ORIGIN_READ_ONLY, reason).
 */
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

/**
 * Origins whose sync mode defaults to read-only. Filesystem-origin
 * matter cannot be mutated through substrate writes unless an
 * extension registers a write-through handler (deferred). Web-origin
 * matter mirrors remote pages and is always read-only.
 */
function isReadMostlyOrigin(origin) {
  return origin === MATTER_ORIGIN.FILESYSTEM || origin === MATTER_ORIGIN.WEB;
}

/**
 * Best-effort audit target for the Did. Most DO operations target a
 * substrate primitive (space, matter, being); the dispatcher infers
 * (kind, id) from the call shape so the audit row carries a queryable
 * `target.kind` + `target.id`.
 *
 * Lookup order:
 *   1. result._didTarget       (operation handler hint: { kind, id })
 *   2. result._didSpaceId      (legacy hint, treated as space target)
 *   3. target._didKind / target._id  (Mongoose doc + explicit kind hint)
 *   4. target.spaceId   → space
 *   5. target.matterId  → matter
 *   6. target.beingId   → being
 *   7. target.id        (generic; kind unknown)
 *   8. target as string (raw id; kind unknown)
 *
 * Returns null when nothing is resolvable; the Did is still written
 * (target itself is optional in the schema).
 */
function resolveAuditTarget(target, result) {
  if (result && typeof result === "object") {
    if (result._didTarget && result._didTarget.id) {
      return { kind: result._didTarget.kind || null, id: String(result._didTarget.id) };
    }
    if (result._didSpaceId) {
      return { kind: "space", id: String(result._didSpaceId) };
    }
  }
  if (target && typeof target === "object") {
    if (target._didKind && target._id) {
      return { kind: target._didKind, id: String(target._id) };
    }
    if (target._id) return { kind: "space", id: String(target._id) };
    if (target.spaceId)  return { kind: "space",  id: String(target.spaceId) };
    if (target.matterId) return { kind: "matter", id: String(target.matterId) };
    if (target.beingId)  return { kind: "being",  id: String(target.beingId) };
    if (target.id) return { kind: null, id: String(target.id) };
  }
  if (typeof target === "string") return { kind: null, id: target };
  return null;
}

/**
 * Summarize an operation's return value for the audit Did. Strings and
 * primitives pass through; Mongoose docs collapse to their id; bare
 * objects pass through (cap is enforced by logDid).
 */
function summarizeAuditResult(result) {
  if (result == null) return null;
  if (typeof result !== "object") return result;
  if (typeof result.toObject === "function") {
    try { return { _id: String(result._id) }; } catch { return null; }
  }
  return result;
}
