import {
  logContribution,
  findNodeById,
  handleSchedule,
} from "../../db/utils.js";
import { useEnergy } from "../../core/tree/energy.js";

async function addPrestige({
  nodeId,
  userId,
  wasAi,
  aiChatId = null,
  sessionId = null,
}) {
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const { energyUsed } = await useEnergy({
    userId,
    action: "prestige",
  });
  const targetNodeIndex = node.prestige;
  await addPrestigeToNode(node);

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "prestige",
    nodeVersion: targetNodeIndex,
    energyUsed,
  });

  return { message: "Prestige added successfully." };
}

async function addPrestigeToNode(node) {
  const currentVersion = node.versions.find(
    (v) => v.prestige === node.prestige,
  );
  if (!currentVersion)
    throw new Error("No version found for current prestige level");

  currentVersion.status = "completed";

  const valuesMap =
    currentVersion.values instanceof Map
      ? currentVersion.values
      : new Map(Object.entries(currentVersion.values));

  const newValues = new Map();
  for (const key of valuesMap.keys()) {
    newValues.set(key, 0);
  }
  const goalsMap =
    currentVersion.goals instanceof Map
      ? currentVersion.goals
      : new Map(Object.entries(currentVersion.goals || {}));

  const newGoals = new Map();
  for (const [key, goal] of goalsMap.entries()) {
    newGoals.set(key, goal);
  }

  const newVersion = {
    prestige: node.prestige + 1,
    values: newValues,
    goals: newGoals,
    status: "active",
    dateCreated: new Date().toISOString(),
    schedule: await handleSchedule(currentVersion),
    reeffectTime: currentVersion.reeffectTime,
  };

  node.prestige++;
  node.versions.push(newVersion);
  await node.save();
}

export { addPrestige, addPrestigeToNode };
