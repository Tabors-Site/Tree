// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// do.js — the DO verb. Run a registered operation against a target,
// auto-emit a Fact, return the handler's result.
//
// Operations live in the dispatcher (ibp/operations.js); seed-shipped
// ones register at boot via the per-material ops files (each
// materials/<kind>/ops.js + materials/seeds.js + storyConfig.js,
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

import log from "../../seedStory/log.js";
import {
  getOperation,
  registerOperation,
  unregisterOperation,
  unregisterOperationsFromExtension,
  listOperations,
} from "../operations.js";
import { resolveDoOpFromFold } from "../../present/word/wordStore.js";
import { emitFact } from "../../past/fact/facts.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { isSourceSpaceId } from "../../materials/space/source.js";
import { authorize } from "../authorize.js";
import {
  assertVerbCaller,
  refuseHistoricalWrite,
  resolveHistoryForFact,
} from "./_shared.js";
import { stripForAudit } from "../../materials/redact.js";

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
 * @param {object} [opts.moment]  for summon correlation on the Fact
 * @param {boolean}[opts.skipAudit]  skip the Fact stamp (seed-internal only)
 * @returns the handler's return value
 */
export async function doVerb(target, operation, params = {}, opts = {}) {
  assertVerbCaller("do", opts);
  refuseHistoricalWrite("do", target, opts);
  if (typeof operation !== "string" || operation.length === 0) {
    throw new Error(
      "story.do(target, operation, params): operation must be a non-empty string",
    );
  }

  // Fold-ONLY: a do-op resolves from the live projection (the fold of coin facts), the
  // registry-free path (philosophy/word/10.md §2). The fold is the SOLE source the running system
  // dispatches on — no Map fallback. This IS achievable because the seed declares its words BEFORE it
  // builds the story: genesis.js declares every do-op onto I_AM's reel (a fact needs only I_AM, not
  // the space/being it will later describe) right after ensureIAm and BEFORE ensureSpaceRoot, so the
  // first do-op dispatched while building the story (create-space, set-being, set-space) already
  // resolves from the fold. The operations Map stays ONLY as the module-load registration buffer that
  // declareOpsToFold reads to KNOW what to declare — never a dispatch truth. (This supersedes the
  // earlier "fold-only is not achievable" reading: the bootstrap was reordered to FOLLOW the fold, so
  // 10.md step 5 lands — genesis is words, and the words are what the dispatch runs on.)
  let op = resolveDoOpFromFold(operation);
  if (!op) {
    throw new Error(
      `Unknown DO operation: "${operation}". Use story.do.listOperations() to see available operations.`,
    );
  }

  // Resolve history ONCE at the entry point. moment.actorAct?.history wins when
  // inside an existing moment (continuation); otherwise opts.currentHistory
  // from the wire layer. resolveHistoryForFact throws MISSING_BRANCH if
  // both are absent — silent default to "0" hid threading bugs.
  const history = resolveHistoryForFact(opts.moment, opts.currentHistory, "do");

  // Source matter joins the normal chain rule (philosophy/OS/MIRROR.md
  // step 2). Writes through the mirror mount land as sealed facts on
  // the I-Am's chain; the old SOURCE_READ_ONLY gate is retired so the
  // FUSE write path can reach the matter handlers. The disk-fold
  // populator in materials/space/source.js keeps its own carve-out
  // (the single sanctioned exception): it patches source matter rows
  // directly through initProjection, bypassing the chain on purpose,
  // because the disk walk is the populator's truth. checkReadOnlySource
  // stays exported below so the populator can still consult it if it
  // wants to refuse a redundant write; nothing in the seed calls it
  // anymore.

  // Matter-type gate. An op that declares `matterTypes` applies only
  // to matter of those types — the enforcement half of the type
  // system (the type def's `ops` list is the advertisement half; see
  // materials/matter/types.js). Cheap: only fires when the op opted
  // in AND the target is matter.
  if (op.matterTypes) {
    const { detectTargetKind, targetIdOf } =
      await import("../../materials/_targetShape.js");
    if (detectTargetKind(target) === "matter") {
      const { loadOrFold } = await import("../../materials/projections.js");
      const slot = await loadOrFold(
        "matter",
        String(targetIdOf(target)),
        history,
      );
      const matterType = slot?.state?.type || "generic";
      if (!op.matterTypes.includes(matterType)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `DO ${operation}: this op applies to matter type(s) ` +
            `${op.matterTypes.join(", ")} — target is "${matterType}"`,
          { operation, matterType, applies: [...op.matterTypes] },
        );
      }
    }
  }

  // Every DO act rides an open Act. assertVerbCaller above already
  // required `identity`; this requires the actId. The same guard used
  // to be split between a scaffold-specific check and the universal
  // check below; the scaffold version retired with the flag because
  // it's the same invariant.
  if (!opts.moment?.actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `DO ${operation}: missing ambient actId. Every act rides an open Act. Thread opts.moment from the caller's moment, or open one via withIAmAct(...) / withBeingAct(...).`,
      { operation },
    );
  }
  // Stance auth runs for every call. authorize() short-circuits on
  // `identity?.name === I_AM` without a DB read, so seed-internal
  // flows (I_AM acting on its own story) pass through identically
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
    const spaceIdForAuth = await resolveAuthSpaceId(
      target,
      auditTarget,
      history,
    );
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
    // The action the role-walk matches against canDo. By default the
    // operation name; an op may declare `authAction(ctx)` to refine
    // it with parameter context — grant-role authorizes as
    // `grant-role:<roleName>` so a role's canDo can name WHICH roles
    // it may grant (`grant-role:human`) instead of all-or-nothing.
    // Open to extension ops the same way.
    let authAction = operation;
    if (typeof op.authAction === "function") {
      try {
        authAction = op.authAction({ params, target }) || operation;
      } catch {
        authAction = operation;
      }
    }
    const decision = await authorize({
      identity,
      verb: "do",
      // target.history = the history this DO's Fact lands on (resolved
      // once at the verb entry). Auth evaluates the same world the
      // stamp rides.
      target: { kind: "position", spaceId: spaceIdForAuth, history: history },
      action: authAction,
      namespace,
      // The being this DO acts ON (when it's a being op). authorize uses
      // it for the inheritation-coverage fallback: a Name with authority
      // over this being's tree-subtree may act on it even without a role
      // grant. Null for space/matter ops (no being-tree position).
      auditBeingId:
        auditTarget && auditTarget.kind === "being" && auditTarget.id
          ? String(auditTarget.id)
          : null,
      moment: opts.moment,
      // The caller's history (session.currentHistory). Their grants
      // live there; target may be on a different history. See
      // authorize.js "actorHistory vs targetHistory."
      actorHistory: opts.currentHistory || null,
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
    moment: opts.moment || null,
    // The history this DO's Fact lands on (resolved once at verb entry,
    // same value authorize() gates against). Ops that resolve other
    // material on this history (e.g. inheritation name lookups) read it
    // here instead of re-deriving from moment.
    history: history,
  };

  // Top-level operation count for the moment (one-moment-one-act
  // doctrine; sealAct reads opCount from moment and throws if it
  // would seal more than one op). Increments only at the OUTERMOST
  // doVerb on this moment. Recursive dispatches (set-render →
  // set-being / set-matter / set-space) see `_inOp:true` and skip
  // the increment so a single sugared call still counts as one op.
  const _ctx = opts.moment;
  const _wasInOp = !!(_ctx && _ctx._inOp);
  if (_ctx && !_wasInOp) {
    _ctx._inOp = true;
    _ctx._opCount = (_ctx._opCount || 0) + 1;
  }

  let result;
  try {
    if (op.matter) {
      // NATIVE WORD (P5): the op's body is MATTER — a content-addressed blob — not a host handler.
      // Run it through the engine lane's production entry `runWordBody` (matterWord.js), which fetches
      // the blob from CAS by hash and dispatches to its matter TYPE's run-op, enforcing executability +
      // the effect-class (pure → replay-safe, cached by hash; effectful → a one-time fact-source). The
      // op's params are the inputs; the run-op's output is the result the auto-Fact below stamps —
      // a native word still flows through the SAME auth + one-fact path as a handler op (op.matter
      // rides resolveDoOpFromFold, so factAction/targets/auth are uniform). CONTRACT NOTES, the two
      // open co-design points with the engine lane: (1) inputs pass as [ctx.params] — fine for the `js`
      // driver (an object), but `wasm` needs a real numbers/linear-memory marshalling layer, so
      // structured-params-over-wasm is unresolved; (2) effect-class→fact: this stamps BOTH pure and
      // effectful once (every-act-makes-a-fact) — whether a PURE native word should stamp at all
      // (computation vs fact-source, the is-be cut one level down) is the other open point.
      const { runWordBody } = await import("../../present/word/matterWord.js");
      const ran = await runWordBody(op.matter, [ctx.params]);
      result = ran && typeof ran === "object" && "result" in ran ? ran.result : ran;
    } else {
      result = await op.handler(ctx);
    }
  } finally {
    if (_ctx && !_wasInOp) _ctx._inOp = false;
  }

  // Auto-Fact. Operations opt out via spec.skipAudit; callers via
  // opts.skipAudit (seed-trusted batches only).
  //
  // Presentism: every act lives in a moment. assign opens the Act;
  // momentum threads actId through moment. The entry-point guard
  // above already required moment.actId, so by the time we get
  // here the act has a frame.
  // Every act makes a fact: the dispatcher stamps unconditionally. An op that "did nothing"
  // (an idempotent re-take, a queued ask) still RECORDS the act — it returns its outcome as
  // _factParams WITHOUT a grant record, so the fact lands in the being's history but the
  // reducer folds no world-change. (`skipAudit` is the only opt-out, for seed-trusted
  // batches that genuinely lay their own facts.)
  const shouldAudit = !op.skipAudit && !opts.skipAudit;
  if (shouldAudit) {
    const actId = opts.moment.actId;
    const actorBeingId = opts.identity.beingId;
    // Phase 2: contribute to ctx.deltaF (if inside a moment) instead
    // of committing eagerly. sealAct will commit this Fact + the Act
    // row + any other Facts the moment produced in one transaction.
    await emitFact(
      {
        verb: "do",
        act: op.factAction,
        through: actorBeingId,
        of: resolveAuditTarget(target, result, op),
        // An op that ENRICHES its fact (resolves a type, content-addresses
        // an id, adds a timestamp) returns the canonical fact params as
        // result._factParams — the dispatcher lays them, so the op never
        // self-emits (no skipAudit, no host: emit). Mirrors result._factTarget
        // (resolveAuditTarget). The `_`-prefix means stripForAudit drops it
        // from the recorded result. Falls back to the input params otherwise.
        params: (result && typeof result === "object" && result._factParams)
          ? result._factParams
          : ctx.params,
        result: summarizeAuditResult(result),
        actId,
        // History this fact lands on, pre-resolved at the entry. Inherited
        // from the moment's moment (set by assign from the intake
        // entry, which the wire layer fills from the parsed `#`
        // qualifier) or attached as opts.currentHistory by the wire.
        history: history,
      },
      opts.moment,
    );
  }

  return result;
}

// `story.do` is callable AND carries the operation registry as
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
 * through to the story root via getSpaceRootId in the role-walk).
 */
async function resolveAuthSpaceId(target, auditTarget, history) {
  // The audit target's kind tells us what to look up. When the
  // op-handler already returned a kind (via result._factTarget or
  // schema-typed shapes), trust it.
  const kind = auditTarget?.kind || null;
  const id = auditTarget?.id || null;
  if (!id) return null;

  if (kind === "space") return id;
  // loadOrFold (not loadProjection): on a fresh history the target's
  // slot hasn't been cold-folded yet. resolveAuthSpaceId returning null
  // sends authorize() to "no space, no rule" which denies the write.
  // Walking the lineage gets the same answer the user gets on main
  // until they explicitly diverge.
  const { loadOrFold } = await import("../../materials/projections.js");

  // History is required — strict-default doctrine. Authorize walks
  // permissions on the history the act is happening on; reading the
  // wrong history's slot returns the wrong position and the wrong
  // ancestor chain, which silently rejects writes that should pass.
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      `resolveAuthSpaceId: history is required (got ${JSON.stringify(history)})`,
    );
  }

  // For being/matter, look up the live slot's position / spaceId.
  if (kind === "being") {
    const slot = await loadOrFold("being", id, history);
    return slot?.position || slot?.state?.homeSpace || null;
  }
  if (kind === "matter") {
    const slot = await loadOrFold("matter", id, history);
    return slot?.state?.spaceId ? String(slot.state.spaceId) : null;
  }

  // Kind unknown. Probe each type in order.
  const spaceSlot = await loadOrFold("space", id, history);
  if (spaceSlot) return String(spaceSlot.id);
  const beingSlot = await loadOrFold("being", id, history);
  if (beingSlot)
    return beingSlot.position || beingSlot.state?.homeSpace || null;
  const matterSlot = await loadOrFold("matter", id, history);
  if (matterSlot) {
    return matterSlot.state?.spaceId ? String(matterSlot.state.spaceId) : null;
  }
  return null;
}

/**
 * Returns null when the DO target is writable, or a reason string
 * when it would have been the old source-read-only refusal. After
 * MIRROR.md step 2 the do-verb path no longer calls this; source
 * matter joins the normal chain rule. The helper stays available
 * for materials/space/source.js (the disk-fold populator's own
 * sanctioned carve-out) should it want to consult it. Nothing in
 * the seed calls this anymore.
 */
async function checkReadOnlySource(target, history) {
  if (!target || typeof target !== "object") return null;

  // Typed matter target: load the row and check its type.
  if (target.kind === "matter" && target.id != null) {
    try {
      const { loadOrFold } = await import("../../materials/projections.js");
      const slot = await loadOrFold(
        "matter",
        String(target.id),
        history || "0",
      );
      if ((slot?.state?.type || "generic") === "source") {
        return "Cannot DO write on source matter: the seed's disk mirror is read-only";
      }
    } catch {
      // Unresolvable target — the handler's own not-found path owns it.
    }
  }

  // Position target (or anything carrying a spaceId).
  const spaceId = target.spaceId;
  if (spaceId && isSourceSpaceId(spaceId)) {
    return "Cannot DO write under the .source self-tree: the seed's source mirror is read-only";
  }

  return null;
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
      return {
        kind: result._factTarget.kind || null,
        id: String(result._factTarget.id),
      };
    }
    if (result.spaceId) return { kind: "space", id: String(result.spaceId) };
    if (result.matterId) return { kind: "matter", id: String(result.matterId) };
    if (result.beingId) return { kind: "being", id: String(result.beingId) };
  }
  // Typed identity — the canonical shape.
  if (
    target &&
    typeof target === "object" &&
    target.kind &&
    target.id != null
  ) {
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
  if (
    target &&
    typeof target === "object" &&
    Array.isArray(target.chain) &&
    target.spaceId
  ) {
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
    try {
      return { _id: String(result._id) };
    } catch {
      return null;
    }
  }
  // Omit one-time reveals (plaintext / private key / mnemonic / token) and transport
  // plumbing (_factTarget) so the durable audit fact never records cleartext credentials
  // or key material. The asker still gets the full result over the wire (this strips only
  // the recorded copy). See redact.js stripForAudit.
  return stripForAudit(result);
}
