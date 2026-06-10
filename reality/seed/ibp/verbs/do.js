// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// do.js — the DO verb. Run a registered operation against a target,
// auto-emit a Fact, return the handler's result.
//
// Operations live in the dispatcher (ibp/operations.js); seed-shipped
// ones register at boot via the per-material ops files (each
// materials/<kind>/ops.js + materials/seeds.js + realityConfig.js,
// imported for side effects by seed/services.js); extension ones
// register from their init() function. The verb body does:
//
//   1. caller-shape gate (assertVerbCaller)
//   2. operation lookup (getOperation)
//   3. read-only origin gate (checkReadOnlyOrigin) — DO is always a write
//   4. stance auth (authorize) — namespace-aware for set/set-qualities
//   5. handler dispatch
//   6. auto-Fact emission via emitFact (joins ctx.deltaF when in a moment)
//
// The operation REGISTRY methods (registerOperation, etc.) hang off
// the doVerb function itself, so callers reach both the verb and the
// registry through the same export.

import log from "../../seedReality/log.js";
import {
  getOperation,
  registerOperation,
  unregisterOperation,
  unregisterOperationsFromExtension,
  listOperations,
} from "../operations.js";
import { emitFact } from "../../past/fact/facts.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { MATTER_ORIGIN } from "../../materials/matter/origins.js";
import { isSourceSpaceId } from "../../materials/space/source.js";
import { authorize } from "../authorize.js";
import { assertVerbCaller, refuseHistoricalWrite, resolveBranchForFact } from "./_shared.js";

/**
 * DO. Run a registered operation against a target, stamp a Fact, return
 * the handler's result.
 *
 * @param {*}      target     space / being / matter / id / stance / ...
 *                            The handler interprets it; we pass it through.
 * @param {string} operation  e.g. "create-child" or "food:log-meal"
 * @param {object} [params]   operation-specific payload
 * @param {object} [opts]
 * @param {object} [opts.identity]   { beingId, name } — the being acting.
 *                                   Required. Seed-internal flows that
 *                                   used to pass `scaffold: true` now
 *                                   pass `identity: I_AM_IDENTITY`;
 *                                   authorize() short-circuits on I_AM.
 * @param {object} [opts.summonCtx]  for summon correlation on the Fact
 * @param {boolean}[opts.skipAudit]  skip the Fact stamp (seed-internal only)
 * @returns the handler's return value
 */
export async function doVerb(target, operation, params = {}, opts = {}) {
  assertVerbCaller("do", opts);
  refuseHistoricalWrite("do", target, opts);
  if (typeof operation !== "string" || operation.length === 0) {
    throw new Error("reality.do(target, operation, params): operation must be a non-empty string");
  }

  const op = getOperation(operation);
  if (!op) {
    throw new Error(`Unknown DO operation: "${operation}". Use reality.do.listOperations() to see available operations.`);
  }

  // Resolve branch ONCE at the entry point. summonCtx.actorAct?.branch wins when
  // inside an existing moment (continuation); otherwise opts.currentBranch
  // from the wire layer. resolveBranchForFact throws MISSING_BRANCH if
  // both are absent — silent default to "0" hid threading bugs.
  const branch = resolveBranchForFact(opts.summonCtx, opts.currentBranch, "do");

  // Read-only origin gate. DO is always a write; if the target lives in
  // a read-only realm (filesystem-origin matter, the .source self-tree),
  // reject before the handler runs.
  const denial = checkReadOnlyOrigin(target);
  if (denial) {
    throw new IbpError(IBP_ERR.ORIGIN_READ_ONLY, denial);
  }

  // Every DO act rides an open Act. assertVerbCaller above already
  // required `identity`; this requires the actId. The same guard used
  // to be split between a scaffold-specific check and the universal
  // check below; the scaffold version retired with the flag because
  // it's the same invariant.
  if (!opts.summonCtx?.actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `DO ${operation}: missing ambient actId. Every act rides an open Act. Thread opts.summonCtx from the caller's moment, or open one via withIAmAct(...) / withBeingAct(...).`,
      { operation },
    );
  }
  // Stance auth runs for every call. authorize() short-circuits on
  // `identity?.name === I_AM` without a DB read, so seed-internal
  // flows (I_AM acting on its own reality) pass through identically
  // to how `scaffold: true` used to bypass — one path, one doctrine.
  {
    const identity = opts.identity;
    // Auth target ≠ audit target. The Fact lands on whatever reel the
    // op declares (being's reel, matter's reel, space's reel — that's
    // `resolveAuditTarget`). authorize() (the role-walk; see
    // seed/RolesAreAuth.md) takes whatever target the caller passed.
    // For non-space targets we still resolve to the Space the entity
    // lives at so the role-walk has a coherent path/spaceId to match
    // against role.reach + role host coverage.
    const auditTarget = resolveAuditTarget(target, null, op);
    const spaceIdForAuth = await resolveAuthSpaceId(target, auditTarget, branch);
    // Extract namespace for namespace-aware authorization. Three
    // forms handled: legacy set-qualities/clear-qualities (params.namespace),
    // and the material-scoped set-<kind> ops with
    // field="qualities.<namespace>[.<inner>]".
    let namespace;
    if (operation === "set-qualities" || operation === "clear-qualities") {
      namespace = params?.namespace;
    } else if (
      (operation === "set-space" ||
        operation === "set-being" ||
        operation === "set-matter") &&
      typeof params?.field === "string" &&
      params.field.startsWith("qualities.")
    ) {
      namespace = params.field.slice("qualities.".length).split(".")[0];
    }
    const decision = await authorize({
      identity,
      verb:   "do",
      // target.branch = the branch this DO's Fact lands on (resolved
      // once at the verb entry). Auth evaluates the same world the
      // stamp rides.
      target: { kind: "position", spaceId: spaceIdForAuth, branch },
      action: operation,
      namespace,
      summonCtx: opts.summonCtx,
      // The caller's branch (session.currentBranch). Their grants
      // live there; target may be on a different branch. See
      // authorize.js "actorBranch vs targetBranch."
      actorBranch: opts.currentBranch || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `DO denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor, action: operation },
      );
    }
  }

  const ctx = {
    target,
    params: params || {},
    identity: opts.identity,
    summonCtx: opts.summonCtx || null,
  };

  // Top-level operation count for the moment (one-moment-one-act
  // doctrine; sealAct reads opCount from summonCtx and throws if it
  // would seal more than one op). Increments only at the OUTERMOST
  // doVerb on this summonCtx. Recursive dispatches (set-render →
  // set-being / set-matter / set-space) see `_inOp:true` and skip
  // the increment so a single sugared call still counts as one op.
  const _ctx = opts.summonCtx;
  const _wasInOp = !!(_ctx && _ctx._inOp);
  if (_ctx && !_wasInOp) {
    _ctx._inOp = true;
    _ctx._opCount = (_ctx._opCount || 0) + 1;
  }

  let result;
  try {
    result = await op.handler(ctx);
  } finally {
    if (_ctx && !_wasInOp) _ctx._inOp = false;
  }

  // Auto-Fact. Operations opt out via spec.skipAudit; callers via
  // opts.skipAudit (seed-trusted batches only).
  //
  // Presentism: every act lives in a moment. assign opens the Act;
  // momentum threads actId through summonCtx. The entry-point guard
  // above already required summonCtx.actId, so by the time we get
  // here the act has a frame.
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    const actId = opts.summonCtx.actId;
    const actorBeingId = opts.identity.beingId;
    // Phase 2: contribute to ctx.deltaF (if inside a moment) instead
    // of committing eagerly. sealAct will commit this Fact + the Act
    // row + any other Facts the moment produced in one transaction.
    await emitFact({
      verb:    "do",
      action:  op.factAction,
      beingId: actorBeingId,
      target:  resolveAuditTarget(target, result, op),
      params:  ctx.params,
      result:  summarizeAuditResult(result),
      actId,
      // Branch this fact lands on, pre-resolved at the entry. Inherited
      // from the moment's summonCtx (set by assign from the intake
      // entry, which the wire layer fills from the parsed `#`
      // qualifier) or attached as opts.currentBranch by the wire.
      branch,
    }, opts.summonCtx);
  }

  return result;
}

// `reality.do` is callable AND carries the operation registry as
// methods, so callers reach both surfaces through the same export.
doVerb.registerOperation = registerOperation;
doVerb.unregisterOperation = unregisterOperation;
doVerb.unregisterOperationsFromExtension = unregisterOperationsFromExtension;
doVerb.getOperation = getOperation;
doVerb.listOperations = listOperations;

// ─────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS — read-only gate + audit shaping
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the Space id the authorization check should walk from.
 *
 * Audit and auth are different targets. The audit fact lands on the
 * op's reel (Being / Matter / Space — whichever the op writes). The
 * role-walk authorize (seed/RolesAreAuth.md) reaches a target via
 * spaceId + path; for ops on Beings or Matter we map to the Space
 * the entity lives at so the role's reach can be evaluated against a
 * concrete position.
 *
 * Mapping:
 *   Space target  → its own id
 *   Being target  → Being.position (or .homeSpace as fallback)
 *   Matter target → Matter.spaceId
 *   String id     → look up — first Space, then Being, then Matter
 *
 * Returns null when nothing resolves (rare; the auth chain falls
 * through to the reality root via getSpaceRootId in the role-walk).
 */
async function resolveAuthSpaceId(target, auditTarget, branch) {
  // The audit target's kind tells us what to look up. When the
  // op-handler already returned a kind (via result._factTarget or
  // schema-typed shapes), trust it.
  const kind = auditTarget?.kind || null;
  const id   = auditTarget?.id   || null;
  if (!id) return null;

  if (kind === "space") return id;
  // loadOrFold (not loadProjection): on a fresh branch the target's
  // slot hasn't been cold-folded yet. resolveAuthSpaceId returning null
  // sends authorize() to "no space, no rule" which denies the write.
  // Walking the lineage gets the same answer the user gets on main
  // until they explicitly diverge.
  const { loadOrFold } = await import("../../materials/projections.js");

  // Branch is required — strict-default doctrine. Authorize walks
  // permissions on the branch the act is happening on; reading the
  // wrong branch's slot returns the wrong position and the wrong
  // ancestor chain, which silently rejects writes that should pass.
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `resolveAuthSpaceId: branch is required (got ${JSON.stringify(branch)})`,
    );
  }

  // For being/matter, look up the live slot's position / spaceId.
  if (kind === "being") {
    const slot = await loadOrFold("being", id, branch);
    return slot?.position || slot?.state?.homeSpace || null;
  }
  if (kind === "matter") {
    const slot = await loadOrFold("matter", id, branch);
    return slot?.state?.spaceId ? String(slot.state.spaceId) : null;
  }

  // Kind unknown. Probe each type in order.
  const spaceSlot = await loadOrFold("space", id, branch);
  if (spaceSlot) return String(spaceSlot.id);
  const beingSlot = await loadOrFold("being", id, branch);
  if (beingSlot) return beingSlot.position || beingSlot.state?.homeSpace || null;
  const matterSlot = await loadOrFold("matter", id, branch);
  if (matterSlot) {
    return matterSlot.state?.spaceId ? String(matterSlot.state.spaceId) : null;
  }
  return null;
}

/**
 * Returns null when the DO target is writable, or a reason string when
 * it sits in a read-only realm (filesystem/web origin matter, or
 * anything under the .source self-tree). The caller throws
 * IbpError(ORIGIN_READ_ONLY, reason).
 */
function checkReadOnlyOrigin(target) {
  if (!target || typeof target !== "object") return null;

  // Direct matter target.
  if (typeof target.origin === "string" && isReadMostlyOrigin(target.origin)) {
    return `Cannot DO write on ${target.origin}-origin matter: this origin is read-only at the seed layer`;
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

/**
 * Audit target for the Fact. The handler's result is authoritative
 * about what just changed; consult it before the call's target so
 * the Fact names the substrate event (the new space, the edited
 * matter, the removed being), not the call shape.
 *
 * Lookup order:
 *   1. result._factTarget         (explicit { kind, id } hint)
 *   2. result.spaceId | matterId | beingId
 *   3. target._factKind + target._id
 *   4. target.spaceId | matterId | beingId
 *   5. target._id                 (Mongoose doc; guess space)
 *   6. target.id                  (kind unknown)
 *   7. target as string           (raw id; kind unknown)
 *
 * Returns null when nothing is resolvable; the Fact still stamps,
 * since target is optional in the schema.
 */
// Produce the fact's `target` field from the call's target and the
// handler's result. The contract is { kind, id } — see materials/
// _targetShape.js. No duck-typing on raw rows; no guessing kinds; no
// fallback to "space." Inputs are typed identities or throw.
//
// Precedence:
//   1. Handler override via result._factTarget — explicit, wins.
//   2. Convenience fields on the result (spaceId/matterId/beingId)
//      that the handler chose to surface — the kind is unambiguous
//      from the field name, no guess.
//   3. The call's target itself when typed; the fact lands on the
//      reel the call addressed.
function resolveAuditTarget(target, result, op) {
  if (result && typeof result === "object") {
    if (result._factTarget && result._factTarget.id) {
      return { kind: result._factTarget.kind || null, id: String(result._factTarget.id) };
    }
    if (result.spaceId)  return { kind: "space",  id: String(result.spaceId) };
    if (result.matterId) return { kind: "matter", id: String(result.matterId) };
    if (result.beingId)  return { kind: "being",  id: String(result.beingId) };
  }
  // Typed identity — the canonical shape.
  if (target && typeof target === "object" && target.kind && target.id != null) {
    return { kind: target.kind, id: String(target.id) };
  }
  // String id paired with an op that targets exactly one kind. The
  // op contract carries the kind; we trust it. When the op accepts
  // multiple kinds, the string is ambiguous and the caller must use
  // the typed form.
  if (typeof target === "string") {
    const targets = Array.isArray(op?.targets) ? op.targets : null;
    if (targets && targets.length === 1) {
      return { kind: targets[0], id: target };
    }
    return { kind: null, id: target };
  }
  // Stance object from the resolver. Stance-targeted ops surface
  // the right kind via their result; here we only get this far when
  // the result didn't carry one, which means the stance addressed a
  // space (the only kind a bare stance names).
  if (target && typeof target === "object" && Array.isArray(target.chain) && target.spaceId) {
    return { kind: "space", id: String(target.spaceId) };
  }
  throw new Error(
    `resolveAuditTarget: unrecognized target shape for op "${op?.name || "?"}". ` +
    `Expected { kind, id } or string id (with single-kind op). ` +
    `Got ${typeof target}${target && typeof target === "object" ? ` with keys ${Object.keys(target).join(",")}` : ""}. ` +
    `Migrate the caller — Mongoose rows do not cross the verb boundary; pass { kind, id } instead.`,
  );
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
