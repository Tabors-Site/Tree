// Tree-authoritative reconciliation (Path B — plan-as-peer model).
//
// Background
// ----------
// The unified plan namespace (metadata.plan on plan-type nodes) caches
// each plan's branch-kind steps. The tree node graph is ground truth
// for what work-units actually exist. When the tree diverges from the
// plan (user edits directly, a tool reparents, a branch is deleted),
// reconcile walks the tree and updates the plan's steps to match.
//
// Under Pass 1's Path B structure:
//
//   scope-node  (the scope the plan coordinates: project root, or a
//               branch whose work decomposes further)
//   ├── plan-node   (type=plan; carries metadata.plan.steps)
//   ├── branch-A    (role=branch; work-unit at this scope)
//   ├── branch-B    (role=branch; work-unit at this scope)
//   └── branch-C
//             └── plan-node-sub   (this branch's own sub-plan)
//             └── sub-branch-A    (sibling of the sub-plan)
//             └── sub-branch-B
//
// The plan and its branches are SIBLINGS under the scope. A plan does
// not contain its branches; it describes work that lives alongside it.
// This matters because plans are transient events and branches persist;
// when the plan concludes, the branches remain as children of their
// actual scope node, not as orphans under a dead plan parent.
//
// Reconciliation walk
// -------------------
// Input is the plan-node id. The reconcile:
//   1. Reads the plan's steps from metadata.plan.
//   2. Walks the plan-node's PARENT's children, excluding the plan
//      itself, filtered to role="branch". These are the work-units
//      this plan coordinates.
//   3. Merges tree-branches with plan-branch-steps (tree wins on
//      structure, plan wins on status, same rules as before).
//   4. Recurses: for each branch, check if it has its own sub-plan
//      child (a plan-type child of the branch). If so, reconcile that
//      sub-plan the same way.
//
// Status merge rules (unchanged from the previous Path-A version):
//   - Tree branch present, matching plan step → keep plan status,
//     refresh structural fields from the node's swarm metadata.
//   - Tree branch present, no matching plan step → add a new pending
//     step to the plan.
//   - Plan step has childNodeId, tree branch gone → drop from plan.
//   - Plan step has no childNodeId (architect-seeded, never
//     dispatched) → leave as is.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta } from "./state/meta.js";
import { plan } from "./state/planAccess.js";

/**
 * Reconcile a plan with its sibling tree-branches.
 *
 * Accepts either the plan-type node id directly, or a scope node id
 * (in which case we resolve to the scope's plan-type child). A scope
 * node with no plan-type child has nothing to reconcile and is a
 * quiet no-op.
 */
export async function reconcileProject({ projectNodeId, core }) {
  if (!projectNodeId) return { added: 0, removed: 0, updated: 0 };

  const totals = { added: 0, removed: 0, updated: 0 };
  const p = await plan();

  const reconcileOnePlan = async (planId) => {
    const planNode = await Node.findById(planId).select("_id name parent type metadata").lean();
    if (!planNode) return;

    // If the caller passed a scope node, hop to its plan-type child.
    if (planNode.type !== "plan") {
      const planChild = await Node.findOne({
        parent: planNode._id,
        type: "plan",
      }).select("_id").lean();
      if (planChild) await reconcileOnePlan(planChild._id);
      return;
    }

    const planObj = await p.readPlan(planNode._id);
    const allSteps = planObj?.steps || [];
    const existingBranches = allSteps.filter((s) => s.kind === "branch");
    const otherSteps = allSteps.filter((s) => s.kind !== "branch");

    // Walk siblings — the plan's work-units live under the same parent
    // as the plan itself (Path B).
    const parentId = planNode.parent;
    if (!parentId) {
      // A plan with no parent can't have siblings; nothing to reconcile
      // at this level. Still recurse into any steps that reference
      // children.
      if (existingBranches.length > 0) {
        await recurseIntoSubPlans(existingBranches);
      }
      return;
    }

    const parentNode = await Node.findById(parentId).select("children").lean();
    const siblingIds = (parentNode?.children || [])
      .map((id) => String(id))
      .filter((id) => id !== String(planNode._id));

    let branchSiblings = [];
    if (siblingIds.length > 0) {
      const kids = await Node.find({ _id: { $in: siblingIds } })
        .select("_id name metadata").lean();
      branchSiblings = kids.filter((k) => {
        const m = readMeta(k);
        return m?.role === "branch";
      });
    }

    // Index existing branch steps by childNodeId for O(1) matching.
    const stepsByChildId = new Map();
    const orphanSteps = []; // branch steps never dispatched (no childNodeId)
    for (const step of existingBranches) {
      if (step.childNodeId) {
        stepsByChildId.set(String(step.childNodeId), step);
      } else {
        orphanSteps.push(step);
      }
    }

    const reconciledBranches = [];
    const seenChildIds = new Set();
    let added = 0;
    let removed = 0;
    let updated = 0;

    for (const kid of branchSiblings) {
      const kidIdStr = String(kid._id);
      seenChildIds.add(kidIdStr);
      const kidMeta = readMeta(kid);
      const prior = stepsByChildId.get(kidIdStr);

      // Tree wins on structural fields. Plan wins on transient status.
      const merged = {
        id: prior?.id, // preserve id when matching
        kind: "branch",
        title: kid.name || prior?.title,
        childNodeId: kidIdStr,
        spec: kidMeta?.spec ?? prior?.spec,
        path: kidMeta?.path ?? prior?.path ?? null,
        files: kidMeta?.files ?? prior?.files ?? [],
        slot: prior?.slot ?? kidMeta?.slot ?? null,
        mode: prior?.mode ?? kidMeta?.mode ?? null,
        status: prior?.status ?? kidMeta?.status ?? "pending",
        retries: prior?.retries ?? 0,
        summary: prior?.summary ?? null,
        error: prior?.error ?? null,
        startedAt: prior?.startedAt ?? null,
        finishedAt: prior?.finishedAt ?? null,
        // Preserve Pass 1 metadata if the prior step carried it.
        stepType: prior?.stepType ?? "simple",
        branchSignature: prior?.branchSignature ?? undefined,
        subPlanNodeId: prior?.subPlanNodeId ?? undefined,
      };

      if (!prior) {
        added++;
      } else {
        const structurallyChanged =
          prior.spec !== merged.spec ||
          prior.path !== merged.path ||
          prior.title !== merged.title;
        if (structurallyChanged) updated++;
      }
      reconciledBranches.push(merged);
    }

    // Carry forward orphan branch steps (architect-seeded, never
    // dispatched). They stay pending until dispatched or the user
    // clears them.
    for (const orphan of orphanSteps) reconciledBranches.push(orphan);

    // Count steps dropped (had childNodeId, tree branch gone).
    for (const [prevId] of stepsByChildId) {
      if (!seenChildIds.has(prevId)) removed++;
    }

    if (added + removed + updated > 0 || reconciledBranches.length !== existingBranches.length) {
      const nextSteps = [...otherSteps, ...reconciledBranches];
      await p.setSteps(planNode._id, nextSteps, core);
      totals.added += added;
      totals.removed += removed;
      totals.updated += updated;
    }

    // Recurse into any sub-plans: for each branch we found as a
    // sibling, check if it has a plan-type child (that branch's own
    // sub-plan) and reconcile it.
    await recurseIntoSubPlans(branchSiblings.map((b) => ({ childNodeId: b._id })));
  };

  const recurseIntoSubPlans = async (branchRefs) => {
    for (const ref of branchRefs) {
      const branchId = ref.childNodeId;
      if (!branchId) continue;
      try {
        const subPlan = await Node.findOne({
          parent: branchId,
          type: "plan",
        }).select("_id").lean();
        if (subPlan) await reconcileOnePlan(subPlan._id);
      } catch (err) {
        log.debug("Swarm", `sub-plan recurse skipped for ${branchId}: ${err.message}`);
      }
    }
  };

  try {
    await reconcileOnePlan(projectNodeId);
  } catch (err) {
    log.warn("Swarm", `reconcileProject ${projectNodeId} failed: ${err.message}`);
  }

  if (totals.added + totals.removed + totals.updated > 0) {
    log.info("Swarm",
      `🔄 Reconciled ${projectNodeId}: +${totals.added} new, -${totals.removed} dropped, ~${totals.updated} updated from tree edits`,
    );
  }
  return totals;
}
