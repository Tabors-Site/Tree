import Node from "../models/node.js";
import { logContribution, containsHtml } from "../utils.js";

export async function editNodeType({
  nodeId,
  newType,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (newType !== null) {
    if (typeof newType !== "string") {
      throw new Error("Type must be a string or null");
    }
    newType = newType.trim();
    if (!newType) {
      newType = null;
    } else {
      if (newType.length > 50) {
        throw new Error("Type must be 50 characters or fewer");
      }
      if (containsHtml(newType)) {
        throw new Error("Type cannot contain HTML tags");
      }
      if (newType.startsWith(".")) {
        throw new Error("Type cannot start with a dot");
      }
      if (newType.startsWith("/")) {
        throw new Error("Type cannot start with a /");
      }
      if (newType.startsWith("@")) {
        throw new Error("Type cannot start with @");
      }
    }
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.systemRole) throw new Error("Cannot modify system nodes");



  const oldType = node.type;
  await Node.findByIdAndUpdate(nodeId, { $set: { type: newType } });

  await logContribution({
    userId,
    nodeId,
    action: "editType",
    wasAi,
    chatId,
    sessionId,

    editType: {
      oldType,
      newType,
    },
  });

  return { node, oldType, newType };
}
