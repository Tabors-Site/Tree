// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Node status changes.
 * Three statuses: active, completed, trimmed.
 * Completed status always inherits to children (by design).
 * Recursive inheritance capped by depth and total node count.
 */

import log from "../log.js";
import { logContribution } from "./contributions.js";
import { hooks } from "../hooks.js";
import { checkCascade } from "./cascade.js";
import Node from "../models/node.js";
import { NODE_STATUS, ERR, ProtocolError } from "../protocol.js";
import { getLandConfigValue } from "../landConfig.js";

const VALID_STATUSES = new Set(Object.values(NODE_STATUS));
const MAX_INHERITED_NODES = 10000; // total nodes affected by one inherited status change

async function editStatus({
  nodeId, status, isInherited,
  userId, wasAi = false, chatId = null, sessionId = null,
}) {
  if (!nodeId || !userId) throw new Error("nodeId and userId are required");
  if (!status || !VALID_STATUSES.has(status)) {
    throw new Error(`Invalid status "${status}". Valid: ${[...VALID_STATUSES].join(", ")}`);
  }

  const node = await Node.findById(nodeId).select("_id name status children systemRole");
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  // Completed always inherits. This is by design, not a bug.
  if (status === NODE_STATUS.COMPLETED) isInherited = true;

  // beforeStatusChange hook: extensions can validate or cancel
  const beforeData = { node, status, userId };
  const hookResult = await hooks.run("beforeStatusChange", beforeData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Status change cancelled by extension");
  }

  node.status = status;
  await node.save();

  hooks.run("afterStatusChange", { node, status, userId })
    .catch(err => log.debug("Status", `afterStatusChange hook error: ${err.message}`));

  checkCascade(nodeId, { action: "status:change", status, userId }).catch(() => {});

  await logContribution({
    userId, nodeId, wasAi, chatId, sessionId,
    action: "editStatus",
    statusEdited: status,
  });

  // Recursive inheritance
  if (isInherited && node.children?.length > 0) {
    const maxDepth = Number(getLandConfigValue("cascadeMaxDepth")) || 50;
    let totalAffected = 0;
    await inheritStatus(node.children, status, userId, wasAi, chatId, sessionId, 0, maxDepth, { count: totalAffected, max: MAX_INHERITED_NODES });
  }

  return {
    message: `Status updated to ${status}${isInherited ? " (inherited to children)" : ""}`,
  };
}

/**
 * Recursively set status on all descendants.
 * Explicit depth parameter (no arguments[] hack).
 * Capped by both depth and total node count.
 */
async function inheritStatus(childIds, status, userId, wasAi, chatId, sessionId, depth, maxDepth, counter) {
  if (depth >= maxDepth) return;

  for (const childId of childIds) {
    if (counter.count >= counter.max) {
      log.warn("Status", `Inherited status change capped at ${counter.max} nodes`);
      return;
    }

    await Node.findByIdAndUpdate(childId, { $set: { status } });
    counter.count++;

    await logContribution({
      userId, nodeId: childId, wasAi, chatId, sessionId,
      action: "editStatus",
      statusEdited: status,
    });

    const child = await Node.findById(childId).select("children").lean();
    if (child?.children?.length > 0) {
      await inheritStatus(child.children, status, userId, wasAi, chatId, sessionId, depth + 1, maxDepth, counter);
    }
  }
}

export { editStatus };
