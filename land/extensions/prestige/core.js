import {
  logContribution,
  findNodeById,
  handleSchedule,
} from "../../db/utils.js";
import { getExtMeta, setExtMeta } from "../../core/tree/extensionMetadata.js";

let useEnergy = async () => ({ energyUsed: 0 });
try { ({ useEnergy } = await import("../energy/core.js")); } catch {}

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

  const prestigeData = getExtMeta(node, "prestige");
  const currentLevel = prestigeData.current || 0;

  await addPrestigeToNode(node);

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "prestige",
    nodeVersion: currentLevel,
    energyUsed,
  });

  return { message: "Prestige added successfully." };
}

async function addPrestigeToNode(node) {
  const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
  const prestigeData = meta.prestige || { current: 0, history: [] };
  const currentLevel = prestigeData.current || 0;

  const snapshot = {
    version: currentLevel,
    status: node.status,
    values: { ...(meta.values || {}) },
    goals: { ...(meta.goals || {}) },
    schedule: meta.schedule || null,
    reeffectTime: meta.reeffectTime || 0,
    archivedAt: new Date().toISOString(),
  };

  if (!prestigeData.history) prestigeData.history = [];
  prestigeData.history.push(snapshot);

  node.status = "completed";

  const values = meta.values || {};
  const newValues = {};
  for (const key of Object.keys(values)) {
    newValues[key] = 0;
  }

  prestigeData.current = currentLevel + 1;

  const scheduleData = meta.schedule ? { schedule: new Date(meta.schedule), reeffectTime: meta.reeffectTime || 0 } : null;
  const newSchedule = scheduleData ? await handleSchedule(scheduleData) : null;

  setExtMeta(node, "prestige", prestigeData);
  setExtMeta(node, "values", newValues);
  if (newSchedule) setExtMeta(node, "schedule", newSchedule);

  node.status = "active";

  await node.save();
}

export { addPrestige, addPrestigeToNode };
