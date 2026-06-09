// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Graft. Apply a clone bundle into this reality, producing fresh
// spaces / beings / matter with new local IDs.
//
// The graft is the inverse of clone:
//
//   - Each captured aggregate gets a fresh uuid in the target's
//     namespace.
//   - Refs inside content get remapped from sourceId-keyed Refs to the
//     fresh bare-string ids (or sentinels resolve to the operator /
//     insertion point).
//   - Facts get stamped in dependency order: spaces first (parents
//     before children), beings next, matter last.
//
// Conflict resolution (v1):
//
//   - Name collision in the insertion-point's children: refuse with a
//     specific error. The operator chooses (rename in the bundle,
//     graft elsewhere, or delete the conflicting child first). Future
//     versions can wire the merge mediator.
//
// History does not transfer — that's the clone-vs-seed distinction.
// A grafted subtree begins its life on the target's reels at the
// moment of the graft; subsequent reads see fresh facts only. The
// bundle's sourceReality / sourceBranch are recorded in the
// graft-completed meta-fact for audit, not replayed. For full-biography
// transfer (acts preserved, identity continuation), see seed.js + plant.

import { v4 as uuidv4 } from "uuid";
import { isSentinelRef, isAggregateRef, refKind, refId } from "../ref.js";
import { remapRefs } from "../refWalker.js";
import { assertValidBundle } from "./bundle.js";
import { emitFact } from "../../past/fact/facts.js";
import { withBeingAct } from "../../sprout.js";

/**
 * Graft a clone bundle into the target.
 *
 * @param {object} bundle              the clone bundle
 * @param {string} targetParentSpaceId where to insert (the new subtree's parent)
 * @param {object} opts
 * @param {string} opts.operatorBeingId  who is grafting (must be authenticated; used for GRAFT_INITIATOR + audit)
 * @param {string} [opts.branch]       target branch (default "0")
 * @param {object} [opts.params]       parameter values for the bundle's declared parameter holes ($paramName references in field values)
 * @param {object} [opts.summonCtx]    if invoked inside an existing moment; otherwise the eager-fold singleton path is used
 * @returns {Promise<{ rootSpaceId, counts, remapTable }>}
 */
export async function graftClone(bundle, targetParentSpaceId, opts = {}) {
  assertValidBundle(bundle);
  if (!targetParentSpaceId || typeof targetParentSpaceId !== "string") {
    throw new Error("graftClone: targetParentSpaceId is required");
  }
  if (!opts.operatorBeingId || typeof opts.operatorBeingId !== "string") {
    throw new Error("graftClone: opts.operatorBeingId is required (identifies the grafter for GRAFT_INITIATOR + audit)");
  }
  const branch = opts.branch || "0";

  // ── Parameter resolution. ──
  // Build the substitution table from declared parameters + operator-
  // supplied opts.params. Missing required parameters refuse up front.
  // The resolved table is what the field walker consults when it sees
  // a `"$paramName"` string in any bundle field.
  const paramTable = new Map();
  const supplied = opts.params || {};
  for (const decl of bundle.parameters) {
    if (Object.prototype.hasOwnProperty.call(supplied, decl.name)) {
      paramTable.set(decl.name, supplied[decl.name]);
    } else if (Object.prototype.hasOwnProperty.call(decl, "default")) {
      paramTable.set(decl.name, decl.default);
    } else {
      throw new Error(
        `graftClone: missing required parameter "${decl.name}". ` +
        `Provide it in opts.params or declare a default in the bundle.`,
      );
    }
  }
  // Flag unknown supplied params loudly — the operator likely intended
  // something the bundle won't apply.
  for (const name of Object.keys(supplied)) {
    if (!paramTable.has(name)) {
      throw new Error(
        `graftClone: opts.params["${name}"] supplied but bundle declares no parameter named "${name}".`,
      );
    }
  }

  const { loadProjection, loadOrFold } = await import("../projections.js");
  const { default: Projection } = await import("../branch/projection.js");

  // ── 1. Verify the target parent space exists. ──
  // loadOrFold: a target parent inherited from the parent branch
  // resolves via lineage cold-fold. Bare loadProjection threw
  // "target parent space not found" when grafting onto a sub-branch.
  const targetParentSlot = await loadOrFold("space", targetParentSpaceId, branch);
  if (!targetParentSlot) {
    throw new Error(`graftClone: target parent space "${targetParentSpaceId}" not found in branch "${branch}"`);
  }
  // Heaven space refuse — but allow the place root ("space-root").
  // Tier-3 heaven spaces (identity, config, tools, etc.) are substrate
  // furniture; grafting user content under them mixes operator state
  // into kernel territory. The place root is the natural target for
  // top-level grafts (where the old seed system planted).
  const targetHeaven = targetParentSlot.state?.heavenSpace;
  if (targetHeaven && targetHeaven !== "space-root") {
    throw new Error(`graftClone: cannot graft under heaven space "${targetHeaven}"`);
  }

  // ── 2. Conflict check: name collision at the insertion point. ──
  // The bundle's scope root will land as a child of targetParentSpaceId.
  // Refuse if a sibling with the same name already exists.
  const rootBundleSpace = bundle.content.spaces.find(
    (s) => s.sourceId === bundle.meta.sourceScopeSpaceId,
  );
  if (!rootBundleSpace) {
    throw new Error("graftClone: bundle.content.spaces is missing the scope root");
  }
  const targetSiblings = await Projection.find({
    branch, type: "space",
    "state.parent": targetParentSpaceId,
    "state.name": rootBundleSpace.name,
    tombstoned: { $ne: true },
  }).select("id").lean();
  if (targetSiblings.length > 0) {
    throw new Error(
      `graftClone: a sibling named "${rootBundleSpace.name}" already exists at the insertion point. ` +
      `Rename the bundle's scope root, graft into a different parent, or remove the conflicting sibling first.`,
    );
  }

  // ── 3. Build the remap table. ──
  // Each bundle aggregate gets a fresh uuid. The remap table feeds the
  // walker (`remapRefs`) when we substitute Refs in each entry's fields.
  const remapTable = new Map();  // sourceId → newLocalId
  for (const s of bundle.content.spaces) remapTable.set(s.sourceId, uuidv4());
  for (const b of bundle.content.beings) remapTable.set(b.sourceId, uuidv4());
  for (const m of bundle.content.matter) remapTable.set(m.sourceId, uuidv4());

  // The walker callback: turns a Ref or sentinel into a bare-string id
  // (or null). Substrate consumers downstream of the reducers read bare
  // strings; this is the boundary where Refs become bare ids.
  const resolveRef = (r) => {
    if (isSentinelRef(r)) {
      if (refKind(r) === "graft-initiator") return opts.operatorBeingId;
      if (refKind(r) === "insertion-point") return targetParentSpaceId;
      throw new Error(`graftClone: unknown sentinel kind "${refKind(r)}"`);
    }
    if (isAggregateRef(r)) {
      const sourceId = r.id;
      const newId = remapTable.get(sourceId);
      if (!newId) {
        throw new Error(`graftClone: bundle references unknown sourceId "${sourceId}" (not in content)`);
      }
      // Return the bare-string id; the receiver substrate stores bare.
      return newId;
    }
    return r;
  };

  // Parameter substitution walker. Any string of the exact form
  // `"$name"` is replaced with paramTable.get("name"). Strings that
  // look like `"$name"` but reference an unknown name throw — silent
  // pass-through would let typos misroute. Refs / sentinels / objects
  // get recursed into; non-string scalars pass through unchanged.
  //
  // `"$$"`-prefixed strings escape: `"$$foo"` becomes the literal
  // `"$foo"`. Lets authored content include dollar-prefixed text
  // (uncommon but not impossible: prices, regex patterns, jq queries).
  const substituteParams = (value) => {
    if (value === null || typeof value !== "object") {
      if (typeof value !== "string") return value;
      if (value.startsWith("$$")) return value.slice(1);
      if (!value.startsWith("$")) return value;
      const name = value.slice(1);
      if (!paramTable.has(name)) {
        throw new Error(
          `graftClone: bundle field references "$${name}" but no parameter by that name is declared.`,
        );
      }
      return paramTable.get(name);
    }
    if (Array.isArray(value)) return value.map(substituteParams);
    // Plain objects (including Ref shapes) — recurse into values.
    // Ref objects (`{__ref, id}`) have `id: string` not `id: "$name"`,
    // so the Ref id passes through this walker untouched and remapRefs
    // handles it in the next pass.
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteParams(v);
    }
    return out;
  };

  // remapInBundleField runs both passes: parameter substitution first
  // (string `"$name"` → operator-supplied value), then Ref/sentinel
  // resolution (`{__ref, id: sourceId}` → newLocalId, sentinels →
  // grafter or insertion point).
  const remapInBundleField = (value) => remapRefs(substituteParams(value), resolveRef);

  // ── 4. Stamp create-space facts in depth order. ──
  // bundle.content.spaces is already depth-ordered by cloneSubtree;
  // we trust that. Each space's parent is either INSERTION_POINT (→
  // targetParentSpaceId) or another bundle space (→ remapTable lookup).
  //
  // ROLLBACK doctrine: the substrate is append-only — we can't UN-stamp
  // facts. But on graft failure, we CAN stamp the reversal facts
  // (end-space, end-being, end-matter) for every aggregate we already
  // created, restoring the destination's current state to pre-graft.
  // The chain remembers BOTH the creates AND the reversals (a graft-
  // failed audit fact ties them together). This matches doctrine:
  // chain = truth, current state = fold of chain. We track committed
  // aggregates in `committed` and walk it in reverse on catch.
  const counts = { spaces: 0, beings: 0, matter: 0 };
  let rootSpaceId = null;
  const committed = [];  // { kind, id } in commit order; reversed on rollback

  try {

  for (const s of bundle.content.spaces) {
    const newId = remapTable.get(s.sourceId);
    if (!rootSpaceId) rootSpaceId = newId;  // first space (depth 0) is the graft root

    // Every field flows through remapInBundleField so parameter holes
    // (`"$name"` strings) resolve uniformly across scalar fields (name,
    // type, size, coord) and Ref-bearing fields (parent, qualities,
    // members). Refs and sentinels in scalar fields are a noop;
    // parameter substitution in Ref fields is also a noop because Ref
    // `id` values are not parameter names.
    const spec = {
      name:         remapInBundleField(s.name),
      type:         remapInBundleField(s.type),
      parent:       remapInBundleField(s.parent),
      qualities:    remapInBundleField(s.qualities),
      ...(s.size  !== undefined ? { size:  remapInBundleField(s.size)  } : {}),
      ...(s.coord !== undefined ? { coord: remapInBundleField(s.coord) } : {}),
    };
    // members: per-class array of refs; remap entry-by-entry, drop
    // empty classes.
    if (s.members && typeof s.members === "object") {
      const remappedMembers = {};
      for (const [className, list] of Object.entries(s.members)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        remappedMembers[className] = list.map(remapInBundleField);
      }
      if (Object.keys(remappedMembers).length > 0) {
        spec.members = remappedMembers;
      }
    }
    // Doctrine: each grafted fact is the grafter doing one logical
    // thing on their reel. One act, one fact. Batching many facts into
    // a single ΔF triggers nonlinear fold/append-lock back-pressure
    // (40 qualities writes inside one moment serialize on the same
    // per-reel lock and choke); per-fact small acts fold independently.
    await withBeingAct(opts.operatorBeingId, `graft:create-space ${s.name}`, branch, async (ctx) => {
      await emitFact({
        verb:    "do",
        action:  "create-space",
        beingId: opts.operatorBeingId,
        target:  { kind: "space", id: newId },
        params:  spec,
        actId:   ctx.actId,
        branch,
      }, ctx);
    });
    committed.push({ kind: "space", id: newId });
    counts.spaces++;
  }

  // ── 5. Stamp be:birth facts for each captured being. ──
  for (const b of bundle.content.beings) {
    const newId = remapTable.get(b.sourceId);
    const spec = {
      name:          remapInBundleField(b.name),
      // Beings in the bundle are non-human (cloneSubtree filtered
      // password-bearing ones). Birth needs a password field on the
      // reducer path; we plant an empty hash since these beings can't
      // be auth-driven by humans anyway.
      password:      "",
      defaultRole:   remapInBundleField(b.defaultRole || null),
      cognition:     "scripted",  // v1 default; future revisions can carry cognition in bundle
      parentBeingId: remapInBundleField(b.parentBeingId),
      homeSpace:     remapInBundleField(b.homeSpace),
      position:      remapInBundleField(b.position),
      qualities:     remapInBundleField(b.qualities),
      ...(b.coord !== undefined ? { coord: remapInBundleField(b.coord) } : {}),
    };
    // be:birth is special — the new being self-stamps (beingIn=newId).
    // Open the act under the NEW being so the birth lands as their
    // first act on their own reel. Same one-fact-per-act discipline.
    await withBeingAct(newId, `graft:birth ${spec.name}`, branch, async (ctx) => {
      await emitFact({
        verb:    "be",
        action:  "birth",
        beingId: newId,
        target:  { kind: "being", id: newId },
        params:  spec,
        actId:   ctx.actId,
        branch,
      }, ctx);
    });
    committed.push({ kind: "being", id: newId });
    counts.beings++;
  }

  // ── 6. Stamp create-matter facts. ──
  // Matter depth: parentMatterId chains within the bundle; we need
  // parents-before-children order. The bundle preserves source order
  // which isn't depth-guaranteed; sort here for safety.
  const matterById = new Map(bundle.content.matter.map((m) => [m.sourceId, m]));
  const matterDepth = new Map();
  const computeMatterDepth = (m) => {
    if (matterDepth.has(m.sourceId)) return matterDepth.get(m.sourceId);
    const parentRef = m.parentMatterId;
    if (!isAggregateRef(parentRef)) {
      matterDepth.set(m.sourceId, 0);
      return 0;
    }
    const parent = matterById.get(parentRef.id);
    if (!parent) {
      matterDepth.set(m.sourceId, 0);
      return 0;
    }
    const d = 1 + computeMatterDepth(parent);
    matterDepth.set(m.sourceId, d);
    return d;
  };
  for (const m of bundle.content.matter) computeMatterDepth(m);
  const orderedMatter = [...bundle.content.matter].sort(
    (a, b) => (matterDepth.get(a.sourceId) || 0) - (matterDepth.get(b.sourceId) || 0),
  );

  for (const m of orderedMatter) {
    const newId = remapTable.get(m.sourceId);
    const spec = {
      name:           remapInBundleField(m.name),
      origin:         remapInBundleField(m.origin || "ibp"),
      content:        remapInBundleField(m.content),
      spaceId:        remapInBundleField(m.spaceId),
      beingId:        remapInBundleField(m.beingId),
      parentMatterId: remapInBundleField(m.parentMatterId),
      qualities:      remapInBundleField(m.qualities),
    };
    await withBeingAct(opts.operatorBeingId, `graft:create-matter ${spec.name}`, branch, async (ctx) => {
      await emitFact({
        verb:    "do",
        action:  "create-matter",
        beingId: opts.operatorBeingId,
        target:  { kind: "matter", id: newId },
        params:  spec,
        actId:   ctx.actId,
        branch,
      }, ctx);
    });
    committed.push({ kind: "matter", id: newId });
    counts.matter++;
  }

  // ── 7. Stamp `content.facts[]` in order. ──
  // The spaces/beings/matter arrays handle CREATE (one fact each).
  // content.facts[] handles everything else — set-X, subscription-
  // registered, wake-scheduled, qualities writes. Each entry's target
  // and params flow through the substitution + remap walker so $params
  // and Refs to bundle sourceIds resolve correctly. Per the same
  // one-fact-per-act doctrine: each entry rides its own moment under
  // the actor named by its f.beingId field (or the grafter by default).
  const factsBlock = Array.isArray(bundle.content.facts) ? bundle.content.facts : [];
  counts.facts = 0;
  for (const f of factsBlock) {
    const target = f.target ? {
      kind: f.target.kind,
      id:   remapInBundleField(f.target.id),  // bundle sourceId → new local id
    } : null;
    const actorBeingId = f.beingId
      ? remapInBundleField(f.beingId)
      : opts.operatorBeingId;
    await withBeingAct(actorBeingId, `graft:${f.action}`, branch, async (ctx) => {
      await emitFact({
        verb:    f.verb,
        action:  f.action,
        beingId: actorBeingId,
        target,
        params:  remapInBundleField(f.params || {}),
        actId:   ctx.actId,
        branch,
      }, ctx);
    });
    counts.facts++;
  }

  // ── 8. Stamp a graft-completed meta-fact on the new root's reel. ──
  // Records provenance: where this came from, who applied it, what
  // counts landed. Rides the OUTER wire moment (opts.summonCtx) when
  // present so the operator's transport act records "I grafted X."
  // When called standalone, opens its own act under the grafter.
  if (opts.summonCtx) {
    await emitFact({
      verb:    "do",
      action:  "graft-completed",
      beingId: opts.operatorBeingId,
      target:  { kind: "space", id: rootSpaceId },
      params:  {
        sourceReality:      bundle.meta.sourceReality || null,
        sourceBranch:       bundle.meta.sourceBranch || null,
        sourceScopeSpaceId: bundle.meta.sourceScopeSpaceId || null,
        sourceScopeName:    bundle.meta.sourceScopeName || null,
        bundleCreatedAt:    bundle.meta.createdAt || null,
        counts,
      },
      actId:  opts.summonCtx.actId,
      branch,
    }, opts.summonCtx);
  } else {
    await withBeingAct(opts.operatorBeingId, "graft:completed", branch, async (ctx) => {
      await emitFact({
        verb:    "do",
        action:  "graft-completed",
        beingId: opts.operatorBeingId,
        target:  { kind: "space", id: rootSpaceId },
        params:  {
          sourceReality:      bundle.meta.sourceReality || null,
          sourceBranch:       bundle.meta.sourceBranch || null,
          sourceScopeSpaceId: bundle.meta.sourceScopeSpaceId || null,
          sourceScopeName:    bundle.meta.sourceScopeName || null,
          bundleCreatedAt:    bundle.meta.createdAt || null,
          counts,
        },
        actId: ctx.actId,
        branch,
      }, ctx);
    });
  }
  } catch (err) {
    // ── ROLLBACK ──
    // Per-fact acts already committed; we can't UN-stamp them. Append
    // the reversal: end-X fact for every aggregate we created, in
    // REVERSE order (children before parents), so the current state
    // restores to pre-graft. Each reversal is its own act under the
    // grafter. The chain remembers both the creates AND the reversals
    // — fold sees create then end-X, the projection ends tombstoned.
    // A graft-failed audit fact ties them together.
    //
    // If a reversal itself throws (e.g., the aggregate is already
    // tombstoned by something else, or the substrate is unhealthy),
    // we log and continue — partial-rollback is still better than
    // none. The original error is re-thrown at the end so the caller
    // sees what actually broke.
    const endAction = { space: "end-space", being: "end-being", matter: "end-matter" };
    for (let i = committed.length - 1; i >= 0; i--) {
      const { kind, id } = committed[i];
      try {
        await withBeingAct(opts.operatorBeingId, `graft:rollback ${endAction[kind]}`, branch, async (ctx) => {
          await emitFact({
            verb:    "do",
            action:  endAction[kind],
            beingId: opts.operatorBeingId,
            target:  { kind, id },
            params:  { reason: "graft rollback" },
            actId:   ctx.actId,
            branch,
          }, ctx);
        });
      } catch (rollbackErr) {
        // Best-effort. Log via console — log import would be circular.
        // eslint-disable-next-line no-console
        console.error(`graftClone rollback: ${endAction[kind]} on ${id.slice(0,8)} failed: ${rollbackErr.message}`);
      }
    }
    // Audit: the graft failed. Stamps even when rollback is partial
    // so the operator's reel records "I tried to graft X and it failed."
    try {
      if (opts.summonCtx) {
        await emitFact({
          verb:    "do",
          action:  "graft-failed",
          beingId: opts.operatorBeingId,
          target:  null,
          params: {
            sourceScopeName: bundle.meta.sourceScopeName || null,
            error:           String(err?.message || err),
            committedCount:  committed.length,
          },
          actId:  opts.summonCtx.actId,
          branch,
        }, opts.summonCtx);
      } else {
        await withBeingAct(opts.operatorBeingId, "graft:failed", branch, async (ctx) => {
          await emitFact({
            verb:    "do",
            action:  "graft-failed",
            beingId: opts.operatorBeingId,
            target:  null,
            params: {
              sourceScopeName: bundle.meta.sourceScopeName || null,
              error:           String(err?.message || err),
              committedCount:  committed.length,
            },
            actId: ctx.actId,
            branch,
          }, ctx);
        });
      }
    } catch {}
    throw err;
  }

  return {
    rootSpaceId,
    counts,
    // remapTable converted to a plain object for the wire return.
    remapTable: Object.fromEntries(remapTable),
  };
}
