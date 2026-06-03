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
import { I_AM } from "../../materials/being/seedBeings.js";
import { isSourceSpaceId } from "../../materials/space/source.js";
import { authorize } from "../authorize.js";
import { assertVerbCaller, refuseHistoricalWrite } from "./_shared.js";

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
 *                                   Required unless opts.scaffold is true
 *                                   and no being yet exists.
 * @param {object} [opts.summonCtx]  for summon correlation on the Fact
 * @param {boolean}[opts.skipAudit]  skip the Fact stamp (seed-internal only)
 * @param {boolean}[opts.scaffold]   marks a seed-plant / boot-scaffold flow.
 *                                   With NO identity, I_AM is the actor (pre-
 *                                   being bootstrap); with identity, the
 *                                   being is the actor and scaffold is
 *                                   just the planting flag.
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

  // Read-only origin gate. DO is always a write; if the target lives in
  // a read-only realm (filesystem-origin matter, the .source self-tree),
  // reject before the handler runs.
  const denial = checkReadOnlyOrigin(target);
  if (denial) {
    throw new IbpError(IBP_ERR.ORIGIN_READ_ONLY, denial);
  }

  // scaffold:true semantics, narrowed (post-boot-moment refactor):
  //   - bypass stance auth + implicit I-Am actor when no identity
  //   - DOES NOT imply commit-as-singleton. The caller MUST pass a
  //     summonCtx (a real moment's ctx, typically the boot moment from
  //     withBootMoment or a runtime moment). Without summonCtx, the
  //     fact would be orphaned from any Act — there is no second seal
  //     path. The check below throws loudly on misconfiguration.
  if (opts.scaffold === true && !opts.summonCtx?.actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `DO ${operation}: scaffold:true requires summonCtx (the boot moment's ctx from withBootMoment, or an open runtime moment). Commit-strategy is no longer implied by the flag.`,
      { operation },
    );
  }
  // Stance auth. The only call that legitimately skips the gate is the
  // pre-being scaffold path: scaffold:true AND no identity (boot,
  // migrations, first-time spaceRoot creation). A being who passes
  // scaffold (planting an extension seed) still gets their stance
  // evaluated normally.
  const isPreBeingScaffold = opts.scaffold === true && !opts.identity;
  if (!isPreBeingScaffold) {
    const identity = opts.identity || null;
    // Auth target ≠ audit target. The Fact lands on whatever reel the
    // op declares (being's reel, matter's reel, space's reel — that's
    // `resolveAuditTarget`). But the permission rules live in
    // `qualities.permissions` on Spaces, walked via the ancestor
    // cache. So for non-space targets, resolve to the Space the
    // entity lives at — Being.position / .homeSpace, Matter.spaceId.
    // Then the ancestor walk finds the per-position rules (and the
    // reality-root default `do.*` fallback) the same way it would for
    // a direct space target.
    const auditTarget = resolveAuditTarget(target, null, op);
    const authBranch = opts.summonCtx?.branch || "0";
    const spaceIdForAuth = await resolveAuthSpaceId(target, auditTarget, authBranch);
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
      target: { kind: "position", spaceId: spaceIdForAuth },
      action: operation,
      namespace,
      summonCtx: opts.summonCtx,
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
  // opts.skipAudit (seed-trusted batches only).
  //
  // Presentism: every act lives in a moment. assign opens the Act;
  // momentum threads actId through summonCtx. The only legitimate
  // path with a null actId is boot scaffolding (opts.scaffold ===
  // true), the I_AM's pre-genesis materialization. The guard throws
  // outside the audit try so a missing frame fails the act, not just
  // its Fact — per STAMPER.md, the fact insert IS the commit; an act
  // without a fact didn't happen.
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    const actId = opts.summonCtx?.actId || null;
    if (!actId) {
      // Post-refactor invariant: every DO Fact rides an Act. The
      // scaffold:true gate above already required summonCtx, so if
      // we get here without an actId, the caller didn't thread one.
      throw new IbpError(
        IBP_ERR.INTERNAL,
        `DO ${operation}: missing ambient actId. Every act must ride an open Act. Thread opts.summonCtx from the caller's moment, or open a boot moment via withBootMoment(...).`,
        { operation },
      );
    }
    const actorBeingId = opts.identity?.beingId
      || (opts.scaffold === true ? I_AM : null);
    // Phase 2: contribute to ctx.deltaF (if inside a moment) instead
    // of committing eagerly. sealAct will commit this Fact + the Act
    // row + any other Facts the moment produced in one transaction.
    // Outside a moment (boot/scaffold), emitFact falls back to
    // sealFacts singleton — same as the pre-Phase-2 behavior.
    await emitFact({
      verb:    "do",
      action:  op.factAction,
      beingId: actorBeingId,
      target:  resolveAuditTarget(target, result, op),
      params:  ctx.params,
      result:  summarizeAuditResult(result),
      actId,
      // Branch this fact lands on. Inherited from the moment's
      // summonCtx; assign sets summonCtx.branch from the intake entry
      // (which the wire layer fills from the parsed `#` qualifier).
      // Boot/scaffold paths without a moment fall through to "0".
      branch:  opts.summonCtx?.branch || "0",
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
 * auth check looks for `qualities.permissions` rules, which live ONLY
 * on Spaces. So when the op writes a Being or Matter, the auth check
 * has to walk from the Space the entity lives at — otherwise the
 * ancestor walk runs on a being-id or matter-id, finds no space row,
 * and returns "no permission rule matched" even when the reality
 * root has a `do.*` default that would have applied.
 *
 * Mapping:
 *   Space target  → its own id
 *   Being target  → Being.position (or .homeSpace as fallback)
 *   Matter target → Matter.spaceId
 *   String id     → look up — first Space, then Being, then Matter
 *
 * Returns null when nothing resolves (rare; the auth chain falls
 * through to the reality root via getSpaceRootId in findMatchingRule).
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
  if (matterSlot) return matterSlot.state?.spaceId ? String(matterSlot.state.spaceId) : null;
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
