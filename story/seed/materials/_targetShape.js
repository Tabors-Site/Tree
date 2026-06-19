// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// _targetShape.js — the canonical DO target contract.
//
// A DO `target` is one of two shapes and ONLY two shapes:
//
//   1. Typed identity:   { kind: "space"|"being"|"matter", id: <uuid> }
//      The canonical form. Every wire-resolved target, every typed
//      in-process caller, every fact's `of` field. Carries the
//      minimum needed to identify what the verb acts on; nothing
//      more, no row fields, no ORM coupling.
//
//   2. String id:        "<uuid>"
//      Convenience form. Only legitimate when the op's registered
//      `targets` field contains exactly one kind, so the kind is
//      unambiguous from the op's contract. Resolves to the typed
//      form inside the dispatcher; handlers see typed.
//
// There is no third shape. Mongoose docs do not flow across the
// verb boundary. The verb layer speaks identities; if a handler
// needs row contents (qualities, position, name uniqueness, size,
// ...) it fetches the row itself using `loadTargetRow`. That fetch
// is part of the handler's work, not the dispatcher's. Keeping the
// boundary at {kind, id} means the verb layer doesn't know what
// storage looks like — same shape across in-process, wire, and any
// future transport.
//
// Stance is a separate axis. The IBP resolver returns a structured
// stance object (chain of segments, spaceId, leafId, being). Some
// ops accept a stance as target (create-space child, for example);
// those handlers detect the stance shape explicitly via the
// resolver-specific `.chain` field. The two contract shapes above
// are the targeted-aggregate forms; stance is the address form.

const KINDS = new Set(["space", "being", "matter"]);

/**
 * Detect the target kind. Three return values:
 *   "stance"          — resolver output (carries `.chain` array)
 *   "<kind>"          — typed `{kind, id}` target; returned kind echoes input
 *   null              — string id (kind is ambiguous; the op contract decides)
 * Throws on Mongoose docs / other shapes (Pass 2: in-process callers
 * must pass typed targets, not ORM rows).
 */
export function detectTargetKind(target) {
  if (target == null) {
    throw new Error("detectTargetKind: target is null/undefined");
  }
  if (typeof target === "string") return null;
  if (typeof target !== "object") {
    throw new Error(`detectTargetKind: expected object or string, got ${typeof target}`);
  }
  // Stance object from the IBP resolver. Treated as an address form,
  // not a typed target. A stance with a non-empty `.chain` (or an
  // explicit `.being` qualifier) names a position; ops that accept
  // stance targets detect this shape themselves.
  if ((Array.isArray(target.chain) && target.chain.length > 0) || target.being) {
    return "stance";
  }
  // Typed identity. The canonical shape. Kind must be one of the
  // known aggregate kinds.
  if (target.kind && target.id != null) {
    if (!KINDS.has(target.kind)) {
      throw new Error(`detectTargetKind: unknown kind "${target.kind}"; expected space/being/matter/stance`);
    }
    return target.kind;
  }
  // Anything else is the bug the colleague's note named: a raw row
  // (Mongoose doc, plain `{_id}` envelope) flowing across a
  // boundary it shouldn't cross. Throw loudly so the offending call
  // site is obvious instead of silently mis-attributed downstream.
  throw new Error(
    `detectTargetKind: unrecognized target shape. Expected { kind, id } or string id. ` +
    `Got keys: ${Object.keys(target).join(",")}. ` +
    `Migrate the caller to pass { kind: "<space|being|matter>", id: "<uuid>" } instead of a row.`,
  );
}

/**
 * Extract the id from any valid target shape. Stance targets return
 * spaceId; typed and string return the id. Same throw-on-unknown
 * discipline as detectTargetKind.
 */
export function targetIdOf(target) {
  if (target == null) {
    throw new Error("targetIdOf: target is null/undefined");
  }
  if (typeof target === "string") return target;
  if (typeof target !== "object") {
    throw new Error(`targetIdOf: expected object or string, got ${typeof target}`);
  }
  // Stance: prefer spaceId, then leafId.
  if (Array.isArray(target.chain) && (target.spaceId || target.leafId)) {
    return String(target.spaceId || target.leafId);
  }
  // Typed identity.
  if (target.kind && target.id != null) return String(target.id);
  throw new Error(
    `targetIdOf: unrecognized target shape. Got keys: ${Object.keys(target).join(",")}. ` +
    `Expected { kind, id } or string id.`,
  );
}

/**
 * Load the underlying Mongoose row for a typed (or string) target.
 * Handlers that need row contents (qualities namespaces, current
 * coord/position for clamping, name-uniqueness checks, etc.) call
 * this at the top of the handler. The dispatcher does NOT load rows
 * automatically — the load is part of the handler's work, scoped to
 * what that handler needs.
 *
 * `expectedKind` disambiguates string targets (and asserts the typed
 * kind matches what the handler expects). Throws when the kind
 * doesn't match or the row isn't found.
 *
 * `opts.moment`, when threaded by a handler running inside a moment,
 * lets the loader fall back to in-flight create-<kind> specs in
 * `moment.deltaF` when the row hasn't materialized in Mongo yet.
 * Returns a sparse row (`_id` + the create spec's fields, `_pending:true`).
 * Handlers needing rich row data should fetch it via the spec's
 * spaceId/parent fields rather than expecting a full Mongoose doc.
 */
export async function loadTargetRow(target, expectedKind, { moment = null } = {}) {
  if (!expectedKind || !KINDS.has(expectedKind)) {
    throw new Error(`loadTargetRow: expectedKind must be space/being/matter; got "${expectedKind}"`);
  }
  // Branch the lookup happens on. The moment carries TWO branches: the
  // actor's (moment.actorAct.history — where their Act seals) and the
  // target's (moment.targetHistory — where the row LIVES and the Fact
  // lands). A LOCAL target row lives on the TARGET branch, so we prefer
  // it. For a same-world moment the two are equal (assign seats them
  // so), so this is a no-op there; for a cross-story INBOUND moment
  // actorAct.history is the FOREIGN home branch and the local target only
  // resolves on moment.targetHistory. Same precedence (targetHistory
  // before actorAct.history) that resolveTargetHistory / resolveHistoryForFact
  // use for the fact-landing side.
  const branch = moment?.targetHistory || moment?.actorAct?.history || "0";
  // loadOrFold (not loadProjection): every DO/BE/SUMMON op flows through
  // loadTargetRow. On a fresh branch the target's slot hasn't been
  // cold-folded yet — bare loadProjection returns null, the handler
  // throws "target not found," and the user can't act on their OWN
  // being or anything else inherited from main. loadOrFold walks the
  // lineage so branch-N targets resolve transparently from main.
  const { loadOrFold, findByName } = await import("./projections.js");

  // Stance-target shortcut for being-loading ops. The IBP resolver
  // hands the verb a stance object carrying `{ chain, spaceId, being }`;
  // ops that expect a Being row need the @qualifier resolved to a row
  // before the handler runs. Branch-scoped: names are per-branch
  // identifiers.
  if (
    expectedKind === "being" &&
    target &&
    typeof target === "object" &&
    typeof target.being === "string" &&
    target.being.length > 0 &&
    !(target.kind && target.id != null)
  ) {
    const slot = await findByName("being", target.being, branch);
    if (!slot) {
      throw new Error(`loadTargetRow: no being found with name "${target.being}" on branch ${branch}`);
    }
    return { _id: slot.id, position: slot.position, ...(slot.state || {}) };
  }

  // Resolve the id and verify the kind.
  let id;
  if (typeof target === "string") {
    id = target;
  } else if (target && target.kind && target.id != null) {
    if (target.kind !== expectedKind) {
      throw new Error(
        `loadTargetRow: kind mismatch. Op expects ${expectedKind}; target carries ${target.kind}.`,
      );
    }
    id = String(target.id);
  } else {
    throw new Error(
      `loadTargetRow: unrecognized target shape. Expected { kind, id } or string id; ` +
      `got ${typeof target} with keys ${target && typeof target === "object" ? Object.keys(target).join(",") : "n/a"}.`,
    );
  }

  const slot = await loadOrFold(expectedKind, id, branch);
  if (slot) return { _id: slot.id, position: slot.position, ...(slot.state || {}) };

  // Row absent — check the moment's deltaF for a pending create-<kind>
  // spec at this id. Scaffolds chain creates and immediate sets within
  // one moment; the row only materializes at sealAct, so handlers
  // running inside the same moment can't read back from Mongo. They
  // can read from deltaF, the locally-known source of truth for what
  // this moment is bringing into being.
  //
  // Synthesizes a sparse row carrying _id plus whatever the create spec
  // declared. Handlers that need more (e.g. set-matter's coord clamp
  // reads Space.size) still go through their own lookups — but those
  // lookups land at the target's spaceId, which is in the spec.
  // Create-fact shape varies by kind: space and matter ride do:create-*,
  // being rides be:birth. The expected (verb, act) pair per kind:
  const CREATE_FACT = {
    space:  { verb: "do", act: "create-space" },
    matter: { verb: "do", act: "create-matter" },
    being:  { verb: "be", act: "birth" },
  };
  const deltaF = Array.isArray(moment?.deltaF) ? moment.deltaF : null;
  if (deltaF && deltaF.length) {
    const create = CREATE_FACT[expectedKind];
    const pending = create
      ? deltaF.find(
          (f) =>
            f?.verb === create.verb &&
            f?.act === create.act &&
            f?.of?.kind === expectedKind &&
            String(f?.of?.id) === id,
        )
      : null;
    if (pending) {
      const spec = pending.params || {};
      return { _id: id, _pending: true, ...spec };
    }
  }

  throw new Error(`loadTargetRow: ${expectedKind} not found with id "${id}"`);
}

async function _modelFor(kind) {
  if (kind === "being")  return (await import("./being/being.js")).default;
  if (kind === "space")  return (await import("./space/space.js")).default;
  if (kind === "matter") return (await import("./matter/matter.js")).default;
  throw new Error(`_modelFor: unknown kind "${kind}"`);
}
