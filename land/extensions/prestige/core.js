import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { getExtension } from "../loader.js";

// Services wired from init() via setServices()
let Node = null;
let logContribution = async () => {};
let useEnergy = async () => ({ energyUsed: 0 });

export function setServices({ models, contributions }) {
  Node = models.Node;
  logContribution = contributions.logContribution;
}
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

/**
 * Resolve "latest" to the current prestige level for a node.
 * Without prestige data, returns 0.
 */
export async function resolveVersion(nodeId, version) {
  if (version === "latest") {
    const node = await Node.findById(nodeId).select("metadata").lean();
    if (!node) throw new Error("Node not found");
    const prestige = getExtMeta(node, "prestige");
    return prestige?.current || 0;
  }
  return Number(version);
}

function calculateNextSchedule(scheduleData) {
  if (scheduleData.schedule === null) return null;
  const current = new Date(scheduleData.schedule);
  return new Date(current.getTime() + scheduleData.reeffectTime * 60 * 60 * 1000).toISOString();
}

async function addPrestige({
  nodeId,
  userId,
  wasAi,
  chatId = null,
  sessionId = null,
}) {
  const node = await Node.findById(nodeId).populate("children");
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

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
    chatId,
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

  const values = meta.values || {};
  const newValues = {};
  for (const key of Object.keys(values)) {
    newValues[key] = 0;
  }

  prestigeData.current = currentLevel + 1;

  // Write prestige metadata (own namespace only)
  await setExtMeta(node, "prestige", prestigeData);

  // Reset values via the values extension's export (not direct namespace write)
  const valuesExt = getExtension("values");
  if (valuesExt?.exports?.setValueForNode) {
    for (const key of Object.keys(newValues)) {
      try {
        await valuesExt.exports.setValueForNode({
          nodeId: node._id.toString(), key, value: 0,
          userId: node.rootOwner?.toString() || "system",
        });
      } catch {}
    }
  }

  // Advance schedule via the schedules extension's export (not direct namespace write)
  const schedulesExt = getExtension("schedules");
  if (schedulesExt?.exports?.updateSchedule && meta.schedule) {
    const scheduleData = { schedule: new Date(meta.schedule), reeffectTime: meta.reeffectTime || 0 };
    const newSchedule = calculateNextSchedule(scheduleData);
    if (newSchedule) {
      try {
        await schedulesExt.exports.updateSchedule(node._id.toString(), { schedule: newSchedule });
      } catch {}
    }
  }

  // Reset status to active via direct DB update.
  // Note: this bypasses beforeStatusChange/afterStatusChange hooks intentionally.
  // Prestige is a kernel-level reset, not a user status change.
  await Node.updateOne({ _id: node._id }, { $set: { status: "active" } });
}

export { addPrestige, addPrestigeToNode };
