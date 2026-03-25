// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Tree Integrity Check (fsck for TreeOS)
 *
 * The tree structure is stored redundantly: parent points up, children[] points down.
 * If they disagree, every system built on the tree fails silently. The ancestor cache
 * trusts parent. The tree summary trusts children[]. Resolution chains trust both.
 *
 * This module verifies consistency and auto-repairs where safe:
 *   - parent says A but A's children[] missing this node: add to children[]
 *   - children[] includes ID but that node doesn't exist: remove phantom ref
 *   - children[] includes ID but that node's parent points elsewhere: fix children[]
 *   - node has no parent and isn't system/root: log as orphan (no auto-delete)
 *
 * Runs at boot, daily, and on demand via core.tree.checkIntegrity().
 */

import log from "../log.js";
import Node from "../models/node.js";
import { invalidateAll } from "./ancestorCache.js";
import { getLandConfigValue } from "../landConfig.js";

/**
 * Run a full integrity check on the tree.
 * Returns a report of what was found and fixed.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.repair=true] - auto-repair safe inconsistencies
 * @param {boolean} [opts.silent=false] - suppress log output
 * @returns {Promise<{ checked: number, issues: number, repaired: number, orphans: string[], details: string[] }>}
 */
export async function checkIntegrity({ repair = true, silent = false } = {}) {
  const report = {
    checked: 0,
    issues: 0,
    repaired: 0,
    orphans: [],
    details: [],
  };

  // Load all nodes with just the structural fields
  const nodes = await Node.find({}).select("_id parent children systemRole name").lean();
  const nodeMap = new Map();
  for (const n of nodes) {
    nodeMap.set(String(n._id), n);
  }

  report.checked = nodes.length;

  // Find the land root
  const landRoot = nodes.find(n => n.systemRole === "land-root");
  const landRootId = landRoot ? String(landRoot._id) : null;

  for (const node of nodes) {
    const nodeId = String(node._id);

    // 1. Check: if node has a parent, parent's children[] should include this node
    if (node.parent) {
      const parentId = String(node.parent);
      const parent = nodeMap.get(parentId);

      if (!parent) {
        // Parent doesn't exist. Orphaned reference.
        report.issues++;
        const msg = `${node.name} (${nodeId}): parent ${parentId} does not exist`;
        report.details.push(msg);

        if (repair) {
          // Clear the dangling parent reference. Node becomes orphan.
          await Node.updateOne({ _id: nodeId }, { $set: { parent: null } });
          report.repaired++;
          report.orphans.push(nodeId);
          if (!silent) log.warn("Integrity", `Repaired: cleared dangling parent on ${node.name}`);
        }
      } else {
        const parentChildren = (parent.children || []).map(String);
        if (!parentChildren.includes(nodeId)) {
          // Parent exists but doesn't list this node as a child
          report.issues++;
          const msg = `${node.name} (${nodeId}): parent ${parent.name} missing this node in children[]`;
          report.details.push(msg);

          if (repair) {
            await Node.updateOne({ _id: parentId }, { $addToSet: { children: nodeId } });
            report.repaired++;
            if (!silent) log.warn("Integrity", `Repaired: added ${node.name} to ${parent.name}'s children[]`);
          }
        }
      }
    } else if (!node.systemRole && nodeId !== landRootId) {
      // No parent, not a system node, not land root. Orphan.
      report.orphans.push(nodeId);
      report.details.push(`${node.name} (${nodeId}): orphan node (no parent, not system)`);

      if (repair) {
        // Soft-delete orphaned nodes: set parent to DELETED so they're recoverable
        // via the deleted-revive extension but don't pollute the active tree.
        const { DELETED: DEL } = await import("../protocol.js");
        await Node.updateOne({ _id: nodeId }, { $set: { parent: DEL } });
        report.repaired++;
        if (!silent) log.warn("Integrity", `Repaired: soft-deleted orphan ${node.name} (${nodeId})`);
      }
    }

    // 2. Check: every ID in children[] should point to an existing node whose parent points back
    if (node.children && node.children.length > 0) {
      const phantoms = [];
      const mispointed = [];

      for (const childId of node.children) {
        const cid = String(childId);
        const child = nodeMap.get(cid);

        if (!child) {
          // Child doesn't exist. Phantom reference.
          phantoms.push(cid);
        } else if (String(child.parent) !== nodeId) {
          // Child exists but its parent points somewhere else
          mispointed.push({ childId: cid, childName: child.name, actualParent: String(child.parent) });
        }
      }

      if (phantoms.length > 0) {
        report.issues += phantoms.length;
        const msg = `${node.name} (${nodeId}): ${phantoms.length} phantom child reference(s)`;
        report.details.push(msg);

        if (repair) {
          await Node.updateOne(
            { _id: nodeId },
            { $pullAll: { children: phantoms } },
          );
          report.repaired += phantoms.length;
          if (!silent) log.warn("Integrity", `Repaired: removed ${phantoms.length} phantom children from ${node.name}`);
        }
      }

      if (mispointed.length > 0) {
        report.issues += mispointed.length;
        for (const m of mispointed) {
          report.details.push(
            `${node.name} (${nodeId}): child ${m.childName} (${m.childId}) parent points to ${m.actualParent} instead`
          );
        }

        if (repair) {
          // Remove mispointed children from this node's children[].
          // The child's parent field is authoritative.
          const mispointedIds = mispointed.map(m => m.childId);
          await Node.updateOne(
            { _id: nodeId },
            { $pullAll: { children: mispointedIds } },
          );
          report.repaired += mispointed.length;
          if (!silent) log.warn("Integrity", `Repaired: removed ${mispointed.length} mispointed children from ${node.name}`);
        }
      }
    }
  }

  // After any repairs, invalidate the ancestor cache
  if (report.repaired > 0) {
    invalidateAll();
  }

  if (!silent) {
    if (report.issues === 0) {
      log.verbose("Integrity", `Tree integrity check: ${report.checked} nodes, no issues`);
    } else {
      log.warn("Integrity",
        `Tree integrity check: ${report.checked} nodes, ${report.issues} issues, ${report.repaired} repaired, ${report.orphans.length} orphans`
      );
    }
  }

  return report;
}

/**
 * Start the periodic integrity check job.
 * Default: once per day (86400000ms). Configurable via integrityCheckInterval.
 */
export function startIntegrityJob() {
  const interval = parseInt(
    getLandConfigValue("integrityCheckInterval") || "86400000", 10
  );

  const timer = setInterval(() => {
    checkIntegrity({ repair: true, silent: false }).catch(err => {
      log.error("Integrity", "Periodic check failed:", err.message);
    });
  }, interval);

  if (timer.unref) timer.unref();
  return timer;
}
