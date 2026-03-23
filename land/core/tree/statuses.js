import {
  logContribution,
  findNodeById,
} from "../../db/utils.js";
import { hooks } from "../hooks.js";
// Energy: dynamic import, no-op if extension not installed

async function editStatus({
  nodeId,
  status,
  isInherited,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const VALID_STATUSES = ["active", "trimmed", "completed"];
  if (!VALID_STATUSES.includes(status)) {
    throw new Error("Invalid Status");
  }

  if (status === "completed") {
    isInherited = true;
  }
  const energyUsed = 0; // Energy metered by extension hooks if installed

  const beforeData = { node, status, userId };
  const hookResult = await hooks.run("beforeStatusChange", beforeData);
  if (hookResult.cancelled) return { error: hookResult.reason || "Status change cancelled by extension" };

  node.status = status;
  await node.save();

  // afterStatusChange (fire-and-forget)
  hooks.run("afterStatusChange", { node, status, userId }).catch(() => {});

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "editStatus",
    statusEdited: status,
    nodeVersion: "0",
    energyUsed,
  });

  if (isInherited) {
    await updateNodeStatusRecursively(
      node,
      status,
      userId,
      wasAi,
      aiChatId,
      sessionId,
    );
  }

  return {
    message: `Status updated to ${status}${
      isInherited ? " and its children" : ""
    }`,
  };
}

async function updateNodeStatusRecursively(
  node,
  status,
  userId,
  wasAi,
  aiChatId = null,
  sessionId = null,
) {
  if (status === "divider") {
    node.status = status;
    await node.save();
    return;
  }

  if (["active", "trimmed", "completed"].includes(status)) {
    for (const childId of node.children) {
      const childNode = await findNodeById(childId);
      if (!childNode) continue;

      childNode.status = status;
      await childNode.save();

      await logContribution({
        userId,
        nodeId: childNode._id,
        wasAi,
        aiChatId,
        sessionId,
        action: "editStatus",
        statusEdited: status,
        nodeVersion: "0",
      });

      await updateNodeStatusRecursively(
        childNode,
        status,
        userId,
        wasAi,
        aiChatId,
        sessionId,
      );
    }
  }
}

export { editStatus };
