// Tree-authoritative reconciliation.
//
// subPlan caches branch status + history. The tree node graph is ground
// truth for what branches actually exist and what they contain. When a
// user edits the tree directly (reorders, renames, inserts, deletes,
// rewrites), subPlan drifts from reality. Reconcile walks the tree and
// merges it back.
//
// Rules:
//   - Match tree children to subPlan entries by nodeId (stable).
//   - Tree child present, subPlan entry exists → keep subPlan status,
//     refresh spec / path / files / mode from the node's metadata.
//     (User edited the spec; tree wins.)
//   - Tree child present, subPlan has no matching entry → add a new
//     pending entry. (User manually inserted a branch.)
//   - SubPlan entry has nodeId, tree child gone → drop from subPlan.
//     (User deleted a branch.)
//   - SubPlan entry has no nodeId (never dispatched) → leave alone;
//     it's architect-seeded and waiting for dispatch.
//
// Recursive: each matched child's own subPlan reconciles against its
// own tree children. A user editing the shape at any depth gets
// absorbed cleanly.
//
// Returns { added, removed, updated } counts so callers can surface
// "here's what the tree looked like vs what I thought".

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";
import { readMeta, mutateMeta } from "./state/meta.js";

export async function reconcileProject({ projectNodeId, core }) {
  if (!projectNodeId) return { added: 0, removed: 0, updated: 0 };

  const totals = { added: 0, removed: 0, updated: 0 };

  const reconcileNode = async (nodeId) => {
    const node = await Node.findById(nodeId).select("_id name children metadata").lean();
    if (!node) return;
    const meta = readMeta(node);
    const subPlan = meta?.subPlan;
    const existingEntries = Array.isArray(subPlan?.branches) ? subPlan.branches : [];

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

    // Index existing entries by nodeId for O(1) matching.
    const entriesByNodeId = new Map();
    const orphanEntries = []; // subPlan entries without a nodeId (never dispatched)
    for (const entry of existingEntries) {
      if (entry.nodeId) {
        entriesByNodeId.set(String(entry.nodeId), entry);
      } else {
        orphanEntries.push(entry);
      }
    }

    // Build reconciled list: one entry per tree child, preserving status
    // where possible, plus orphan entries (architect seeds awaiting dispatch).
    const reconciled = [];
    const seenNodeIds = new Set();
    let added = 0;
    let removed = 0;
    let updated = 0;

    for (const kid of branchChildren) {
      const kidIdStr = String(kid._id);
      seenNodeIds.add(kidIdStr);
      const kidMeta = readMeta(kid);
      const prior = entriesByNodeId.get(kidIdStr);

      // Node wins on structural fields. Cache wins on transient status.
      const merged = {
        name: kid.name || prior?.name,
        nodeId: kidIdStr,
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
        // Detect "updated": structural fields changed
        const structurallyChanged =
          prior.spec !== merged.spec ||
          prior.path !== merged.path ||
          prior.name !== merged.name;
        if (structurallyChanged) updated++;
      }
      reconciled.push(merged);
    }

    // Carry forward any orphan entries (architect-seeded, never dispatched).
    // These stay in subPlan until they get dispatched or the user clears them.
    for (const orphan of orphanEntries) reconciled.push(orphan);

    // Count entries dropped (had nodeId, tree child gone).
    for (const [prevNodeId, prev] of entriesByNodeId) {
      if (!seenNodeIds.has(prevNodeId)) removed++;
    }

    if (added + removed + updated > 0 || reconciled.length !== existingEntries.length) {
      await mutateMeta(nodeId, (draft) => {
        if (!draft.subPlan) draft.subPlan = { branches: [], createdAt: new Date().toISOString() };
        draft.subPlan.branches = reconciled;
        draft.subPlan.reconciledAt = new Date().toISOString();
        if (added + removed + updated > 0) {
          draft.subPlan.lastReconciliation = { added, removed, updated, at: draft.subPlan.reconciledAt };
        }
        return draft;
      }, core);

      totals.added += added;
      totals.removed += removed;
      totals.updated += updated;
    }

    // Recurse: each matched child reconciles its own subPlan.
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
