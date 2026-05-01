// Sub-Ruler lineage. When a Ruler dispatches a branch step, the
// resulting sub-Ruler scope carries a backreference to the parent's
// plan emission and the specific step it is expanding. This lineage
// is durable data: cuts/regenerations of the subtree can replay from
// the same upstream context, and Pass 2 courts adjudicating "did this
// sub-Ruler conform to expectation?" can read the chain directly
// (parent Ruler → parent's active plan → specific step → spec passed
// down → sub-Ruler's emission and work).
//
// Without lineage, courts must INFER the chain from siblings + names +
// timestamps. With it, every sub-Ruler's metadata.governing.lineage
// makes the upstream context queryable.
//
// Shape:
//   metadata.governing.lineage = {
//     parentRulerId:           "<uuid>",
//     parentPlanEmissionId:    "<uuid>"  | null,  // null when parent
//                                                  // ran via legacy text
//                                                  // path before phase 2
//     parentStepIndex:         number    | null,  // 1-based position
//                                                  // within emission.steps
//     parentBranchEntryName:   "<name>"  | null,  // the entry name used
//                                                  // to dispatch
//     expandingFromSpec:       "<spec>"  | null,  // durable spec for
//                                                  // regeneration
//     stampedAt:               ISO timestamp
//   }
//
// Lineage is written ONCE at dispatch time. Subsequent re-runs of the
// sub-Ruler (re-invocation, court-driven re-plan) leave the lineage
// untouched — what changes is the sub-Ruler's own plan/contracts trio,
// not its origin record.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";

const NS = "governing";

/**
 * Write the lineage stamp on a sub-Ruler. Idempotent: if a lineage
 * record already exists at this node, the stamp is preserved (origin
 * doesn't change across re-runs). Set `force: true` to overwrite, e.g.
 * when a court orders a re-parent or the parent's plan was revised in
 * a way that requires re-stamping.
 */
export async function writeLineage({
  subRulerNodeId,
  parentRulerId,
  parentPlanEmissionId = null,
  parentStepIndex = null,
  parentBranchEntryName = null,
  expandingFromSpec = null,
  force = false,
}) {
  if (!subRulerNodeId || !parentRulerId) return null;

  const node = await Node.findById(subRulerNodeId);
  if (!node) return null;

  const existingMeta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (!force && existingMeta?.lineage?.parentRulerId) {
    return existingMeta.lineage;
  }

  const lineage = {
    parentRulerId: String(parentRulerId),
    parentPlanEmissionId: parentPlanEmissionId ? String(parentPlanEmissionId) : null,
    parentStepIndex: typeof parentStepIndex === "number" ? parentStepIndex : null,
    parentBranchEntryName: parentBranchEntryName ? String(parentBranchEntryName).slice(0, 200) : null,
    expandingFromSpec: expandingFromSpec ? String(expandingFromSpec).slice(0, 1000) : null,
    stampedAt: new Date().toISOString(),
  };

  try {
    const { setExtMeta: kernelSetExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
    await kernelSetExtMeta(node, NS, {
      ...(existingMeta || {}),
      lineage,
    });
  } catch (err) {
    log.warn("Governing", `writeLineage at ${String(subRulerNodeId).slice(0, 8)} failed: ${err.message}`);
    return null;
  }
  return lineage;
}

/**
 * Read the lineage stamp from a sub-Ruler. Returns null when absent
 * (the Ruler is at the architect-entry root, OR phase-1 dispatch
 * created it before lineage stamping was wired). Pass 2 courts will
 * use this to walk the upstream chain.
 */
export async function readLineage(subRulerNodeId) {
  if (!subRulerNodeId) return null;
  const node = await Node.findById(subRulerNodeId).select("_id metadata").lean();
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  return meta?.lineage || null;
}

/**
 * Resolve lineage details by walking the parent chain to find the
 * dispatching Ruler's active plan emission and matching the current
 * sub-Ruler's name to a branch entry within that emission. Used at
 * dispatch time when explicit lineage params are not threaded through
 * (current substrate: branch dispatch comes from synthesized
 * [[BRANCHES]], so the structured backreference must be reconstructed
 * from the just-emitted plan).
 *
 * Returns the lineage payload or null if no parent Ruler / no matching
 * branch step is found.
 */
export async function inferLineageFromParent(subRulerNodeId) {
  if (!subRulerNodeId) return null;

  const sub = await Node.findById(subRulerNodeId).select("_id name parent").lean();
  if (!sub?.parent) return null;

  const parent = await Node.findById(sub.parent).select("_id metadata").lean();
  if (!parent) return null;
  const parentMeta = parent.metadata instanceof Map
    ? Object.fromEntries(parent.metadata)
    : (parent.metadata || {});
  if (parentMeta[NS]?.role !== "ruler") return null;

  // Read parent's active plan emission via governing.readActivePlanEmission.
  let emission = null;
  try {
    const { getExtension } = await import("../../loader.js");
    const governing = getExtension("governing")?.exports;
    if (governing?.readActivePlanEmission) {
      emission = await governing.readActivePlanEmission(parent._id);
    }
  } catch {}
  if (!emission) {
    // Parent has no structured emission. Lineage with parent ruler
    // only — the structured backref is null because the parent ran
    // via legacy text path.
    return {
      parentRulerId: String(parent._id),
      parentPlanEmissionId: null,
      parentStepIndex: null,
      parentBranchEntryName: null,
      expandingFromSpec: null,
    };
  }

  // Find the branch step whose entries include a name matching the
  // sub-Ruler's name (case-insensitive). 1-based step index.
  const subName = String(sub.name || "").trim().toLowerCase();
  const steps = Array.isArray(emission.steps) ? emission.steps : [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
    const entry = step.branches.find((b) =>
      String(b?.name || "").trim().toLowerCase() === subName,
    );
    if (entry) {
      return {
        parentRulerId: String(parent._id),
        parentPlanEmissionId: emission._emissionNodeId || null,
        parentStepIndex: i + 1,
        parentBranchEntryName: entry.name || sub.name,
        expandingFromSpec: entry.spec || null,
      };
    }
  }

  // No matching branch step. Could be a step the parent dispatched via
  // a non-emission path (sub-plan, ruler-own-integration). Stamp parent
  // ref only.
  return {
    parentRulerId: String(parent._id),
    parentPlanEmissionId: emission._emissionNodeId || null,
    parentStepIndex: null,
    parentBranchEntryName: null,
    expandingFromSpec: null,
  };
}
