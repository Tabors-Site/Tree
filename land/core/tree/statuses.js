import {
  logContribution,
  findNodeById,
} from "../../db/utils.js";
import { hooks } from "../hooks.js";
import Node from "../../db/models/node.js";
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
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const VALID_STATUSES = ["active", "trimmed", "completed"];
  if (!VALID_STATUSES.includes(status)) {
    throw new Error("Invalid Status");
  }

  if (status === "completed") {
    isInherited = true;
  }

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
    await Node.findByIdAndUpdate(node._id, { $set: { status } });
    return;
  }

  if (["active", "trimmed", "completed"].includes(status)) {
    for (const childId of node.children) {
      await Node.findByIdAndUpdate(childId, { $set: { status } });
      const childNode = await Node.findById(childId).select("_id children").lean();
      if (!childNode) continue;

      await logContribution({
        userId,
        nodeId: childNode._id,
        wasAi,
        aiChatId,
        sessionId,
        action: "editStatus",
        statusEdited: status,
    
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
