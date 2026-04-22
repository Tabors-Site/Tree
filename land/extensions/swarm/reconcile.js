// Tree authoritative reconciliation.
//
// The unified plan namespace caches branch status + history. The tree
// node graph is ground truth for what branches actually exist and
// what they contain. When a user edits the tree directly (reorders,
// renames, inserts, deletes, rewrites), the plan's branch kind steps
// drift from reality. Reconcile walks the tree and merges branch
// kind steps back. Non branch step kinds are preserved as is.
//
// Rules:
//   - Match tree children to branch kind steps by childNodeId (stable).
//   - Tree child present, step exists → keep step status, refresh
//     spec/path/files from the node's swarm metadata. (User edited
//     the spec; tree wins on structure, plan wins on transient
//     status.)
//   - Tree child present, no matching step → add a new pending step.
//   - Step has childNodeId, tree child gone → drop from plan.
//   - Step has no childNodeId (never dispatched) → leave as is.
//
// Recursive: each matched child reconciles against its own tree.

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta } from "./state/meta.js";
import { plan } from "./state/planAccess.js";

export async function reconcileProject({ projectNodeId, core }) {
  if (!projectNodeId) return { added: 0, removed: 0, updated: 0 };

  const totals = { added: 0, removed: 0, updated: 0 };
  const p = await plan();

  const reconcileNode = async (nodeId) => {
    const node = await Node.findById(nodeId).select("_id name children metadata").lean();
    if (!node) return;
    const planObj = await p.readPlan(nodeId);
    const allSteps = planObj?.steps || [];
    const existingBranches = allSteps.filter((s) => s.kind === "branch");
    const otherSteps = allSteps.filter((s) => s.kind !== "branch");

    // Pull all direct children with role=branch from the tree.
    const childIds = Array.isArray(node.children) ? node.children : [];
    let branchChildren = [];
    if (childIds.length > 0) {
      const kids = await Node.find({ _id: { $in: childIds } })
        .select("_id name metadata").lean();
      branchChildren = kids.filter((k) => {
        const m = readMeta(k);
        return m?.role === "branch";
      });
    }

    // Index existing branch steps by childNodeId for O(1) matching.
    const stepsByChildId = new Map();
    const orphanSteps = []; // branch steps without a childNodeId (never dispatched)
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

    for (const kid of branchChildren) {
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

    // Carry forward any orphan branch steps (architect seeded, never
    // dispatched). They stay until dispatched or the user clears them.
    for (const orphan of orphanSteps) reconciledBranches.push(orphan);

    // Count steps dropped (had childNodeId, tree child gone).
    for (const [prevId] of stepsByChildId) {
      if (!seenChildIds.has(prevId)) removed++;
    }

    if (added + removed + updated > 0 || reconciledBranches.length !== existingBranches.length) {
      const nextSteps = [...otherSteps, ...reconciledBranches];
      await p.setSteps(nodeId, nextSteps, core);
      totals.added += added;
      totals.removed += removed;
      totals.updated += updated;
    }

    // Recurse: each matched child reconciles its own plan.
    for (const kid of branchChildren) {
      await reconcileNode(kid._id);
    }
  };

  try {
    await reconcileNode(projectNodeId);
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
