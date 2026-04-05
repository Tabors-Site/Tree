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
 *   - node has no parent and isn't system/root: soft-delete as orphan
 *
 * Runs at boot, daily, and on demand via core.tree.checkIntegrity().
 *
 * Streams nodes via cursor to avoid loading entire collection into memory.
 * Progress logged every 10K nodes on large lands.
 */

import log from "../log.js";
import Node from "../models/node.js";
import { invalidateAll } from "./ancestorCache.js";
import { getLandConfigValue } from "../landConfig.js";
import { SYSTEM_ROLE, DELETED } from "../protocol.js";

const MAX_DETAILS = 500; // cap report details to prevent unbounded memory
const PROGRESS_INTERVAL = 10000; // log progress every N nodes

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
  const startMs = Date.now();
  const report = {
    checked: 0,
    issues: 0,
    repaired: 0,
    orphans: [],
    details: [],
    durationMs: 0,
  };

  function addDetail(msg) {
    if (report.details.length < MAX_DETAILS) report.details.push(msg);
  }

  // Build lookup maps using cursor (stream, don't load all at once)
  // Map<nodeId, { parent, children: Set<string>, systemRole, name }>
  const nodeMap = new Map();

  const cursor = Node.find({}).select("_id parent children systemRole name").lean().cursor();
  for await (const n of cursor) {
    const id = String(n._id);
    nodeMap.set(id, {
      parent: n.parent ? String(n.parent) : null,
      children: new Set((n.children || []).map(String)),
      systemRole: n.systemRole || null,
      name: n.name || id,
    });
  }

  report.checked = nodeMap.size;

  // Find the land root
  let landRootId = null;
  for (const [id, node] of nodeMap) {
    if (node.systemRole === SYSTEM_ROLE.LAND_ROOT) {
      landRootId = id;
      break;
    }
  }

  let processed = 0;

  for (const [nodeId, node] of nodeMap) {
    processed++;
    if (!silent && processed % PROGRESS_INTERVAL === 0) {
      log.verbose("Integrity", `Progress: ${processed}/${report.checked} nodes checked...`);
    }

    // 1. Check: if node has a parent, parent's children[] should include this node
    if (node.parent) {
      const parent = nodeMap.get(node.parent);

      if (!parent) {
        // Parent doesn't exist. Soft-delete immediately (don't leave as orphan for next boot).
        report.issues++;
        report.orphans.push(nodeId);
        addDetail(`${node.name} (${nodeId}): parent ${node.parent} does not exist`);

        if (repair) {
          await Node.updateOne({ _id: nodeId }, { $set: { parent: DELETED } });
          report.repaired++;
          if (!silent) log.warn("Integrity", `Repaired: soft-deleted orphan ${node.name} (dangling parent ${node.parent})`);
        }
      } else if (!parent.children.has(nodeId)) {
        // Parent exists but doesn't list this node as a child
        report.issues++;
        addDetail(`${node.name} (${nodeId}): parent ${parent.name} missing this node in children[]`);

        if (repair) {
          await Node.updateOne({ _id: node.parent }, { $addToSet: { children: nodeId } });
          report.repaired++;
          if (!silent) log.warn("Integrity", `Repaired: added ${node.name} to ${parent.name}'s children[]`);
        }
      }
    } else if (!node.systemRole && nodeId !== landRootId) {
      // No parent, not a system node, not land root. Orphan.
      report.orphans.push(nodeId);
      addDetail(`${node.name} (${nodeId}): orphan node (no parent, not system)`);

      if (repair) {
        await Node.updateOne({ _id: nodeId }, { $set: { parent: DELETED } });
        report.repaired++;
        if (!silent) log.warn("Integrity", `Repaired: soft-deleted orphan ${node.name} (${nodeId})`);
      }
    }

    // 2. Check: every ID in children[] should point to an existing node whose parent points back
    if (node.children.size > 0) {
      const phantoms = [];
      const mispointed = [];

      for (const cid of node.children) {
        const child = nodeMap.get(cid);

        if (!child) {
          phantoms.push(cid);
        } else if (child.parent !== nodeId) {
          mispointed.push({ childId: cid, childName: child.name, actualParent: child.parent });
        }
      }

      if (phantoms.length > 0) {
        report.issues += phantoms.length;
        addDetail(`${node.name} (${nodeId}): ${phantoms.length} phantom child reference(s)`);

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
          addDetail(`${node.name} (${nodeId}): child ${m.childName} (${m.childId}) parent points to ${m.actualParent} instead`);
        }

        if (repair) {
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

  report.durationMs = Date.now() - startMs;

  if (!silent) {
    if (report.issues === 0) {
      log.verbose("Integrity", `Tree integrity check: ${report.checked} nodes, no issues (${report.durationMs}ms)`);
    } else {
      log.warn("Integrity",
        `Tree integrity check: ${report.checked} nodes, ${report.issues} issues, ${report.repaired} repaired, ${report.orphans.length} orphans (${report.durationMs}ms)`
      );
    }
  }

  if (report.details.length >= MAX_DETAILS) {
    report.details.push(`... (capped at ${MAX_DETAILS} details)`);
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
      log.error("Integrity", `Periodic check failed: ${err.message}`);
    });
  }, interval);

  if (timer.unref) timer.unref();
  return timer;
}
