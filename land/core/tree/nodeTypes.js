import Node from "../../db/models/node.js";
import { logContribution } from "../../db/utils.js";
import { useEnergy } from "./energy.js";

export const CORE_NODE_TYPES = [
  "goal",
  "plan",
  "task",
  "knowledge",
  "resource",
  "identity",
];

export function isCoreType(type) {
  return type === null || CORE_NODE_TYPES.includes(type);
}

function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}

export async function editNodeType({
  nodeId,
  newType,
  userId,
  wasAi = false,
  aiChatId = null,
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
      if (newType.startsWith("@")) {
        throw new Error("Type cannot start with @");
      }
    }
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const { energyUsed } = await useEnergy({
    userId,
    action: "editType",
  });

  const oldType = node.type;
  node.type = newType;
  await node.save();

  await logContribution({
    userId,
    nodeId,
    action: "editType",
    wasAi,
    aiChatId,
    sessionId,
    nodeVersion: node.prestige.toString(),
    editType: {
      oldType,
      newType,
    },
    energyUsed,
  });

  return { node, oldType, newType };
}
