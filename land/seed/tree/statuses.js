// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import {
  logContribution,
  findNodeById,
} from "../utils.js";
import { hooks } from "../hooks.js";
import Node from "../models/node.js";
import { NODE_STATUS, ERR, ProtocolError } from "../protocol.js";

async function editStatus({
  nodeId,
  status,
  isInherited,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const VALID_STATUSES = Object.values(NODE_STATUS);
  if (!VALID_STATUSES.includes(status)) {
    throw new Error("Invalid Status");
  }

  if (status === NODE_STATUS.COMPLETED) {
    isInherited = true;
  }

  const beforeData = { node, status, userId };
  const hookResult = await hooks.run("beforeStatusChange", beforeData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
    throw new ProtocolError(500, code, hookResult.reason || "Status change cancelled by extension");
  }

  node.status = status;
  await node.save();

  // afterStatusChange (fire-and-forget)
  hooks.run("afterStatusChange", { node, status, userId }).catch(() => {});

  // Cascade
  import("./cascade.js").then(({ checkCascade }) =>
    checkCascade(nodeId, { action: "status:change", status, userId })
  ).catch(() => {});

  await logContribution({
    userId,
    nodeId,
    wasAi,
    chatId,
    sessionId,
    action: "editStatus",
    statusEdited: status,

  });

  if (isInherited) {
    await updateNodeStatusRecursively(
      node,
      status,
      userId,
      wasAi,
      chatId,
      sessionId,
    );
  }

  return {
    message: `Status updated to ${status}${
      isInherited ? " and its children" : ""
    }`,
  };
}

const MAX_CASCADE_DEPTH = 50;

async function updateNodeStatusRecursively(
  node,
  status,
  userId,
  wasAi,
  chatId = null,
  sessionId = null,
) {
  const depth = arguments[6] || 0;
  if (depth > MAX_CASCADE_DEPTH) return;

  if (Object.values(NODE_STATUS).includes(status)) {
    for (const childId of node.children) {
      await Node.findByIdAndUpdate(childId, { $set: { status } });
      const childNode = await Node.findById(childId).select("_id children").lean();
      if (!childNode) continue;

      await logContribution({
        userId,
        nodeId: childNode._id,
        wasAi,
        chatId,
        sessionId,
        action: "editStatus",
        statusEdited: status,
      });

      await updateNodeStatusRecursively(
        childNode, status, userId, wasAi, chatId, sessionId, depth + 1,
      );
    }
  }
}

export { editStatus };
