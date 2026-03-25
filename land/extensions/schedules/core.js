import Node from "../../seed/models/node.js";
import { logContribution } from "../../seed/utils.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";

let useEnergy = async () => ({ energyUsed: 0 });
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

async function updateSchedule({
  nodeId,
  newSchedule,
  reeffectTime,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  if (!nodeId || reeffectTime === undefined) {
    const error = new Error("nodeId and reeffectTime are required.");
    error.status = 400;
    throw error;
  }

  if (reeffectTime > 1000000) {
    const error = new Error("reeffect time must be below 1,000,000 hrs");
    error.status = 400;
    throw error;
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    const error = new Error("Node not found.");
    error.status = 404;
    throw error;
  }
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  let formattedDate = null;

  if (newSchedule !== undefined && newSchedule !== "" && newSchedule !== null) {
    formattedDate = new Date(newSchedule);
    if (isNaN(formattedDate)) {
      const error = new Error("Invalid schedule date.");
      error.status = 400;
      throw error;
    }
  }
  const { energyUsed } = await useEnergy({
    userId,
    action: "editSchedule",
  });

  setExtMeta(node, "schedule", formattedDate);
  setExtMeta(node, "reeffectTime", reeffectTime);
  await node.save();

  const scheduleEdited = { date: formattedDate, reeffectTime };

  await logContribution({
    userId,
    nodeId,
    wasAi,
    chatId,
    sessionId,
    action: "editSchedule",
    scheduleEdited,
    energyUsed,
  });

  return {
    message: "Schedule and re-effect time updated successfully.",
    node,
  };
}

async function getCalendar({ rootNodeId, startDate, endDate }) {
  if (!rootNodeId) {
    const error = new Error("rootNodeId is required");
    error.status = 400;
    throw error;
  }

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  if (start && isNaN(start)) {
    const error = new Error("Invalid startDate");
    error.status = 400;
    throw error;
  }

  if (end && isNaN(end)) {
    const error = new Error("Invalid endDate");
    error.status = 400;
    throw error;
  }

  const results = [];
  const visited = new Set();

  async function walk(nodeId) {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = await Node.findById(nodeId)
      .select("name metadata children")
      .lean();

    if (!node) return;

    const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
    const schedule = meta.schedule;

    if (schedule) {
      const scheduleDate = new Date(schedule);

      const inRange =
        (!start || scheduleDate >= start) && (!end || scheduleDate <= end);

      if (inRange) {
        results.push({
          nodeId: node._id.toString(),
          name: node.name ?? "(Untitled)",
          schedule: scheduleDate,
          reeffectTime: meta.reeffectTime ?? null,
        });
      }
    }

    if (Array.isArray(node.children)) {
      for (const childId of node.children) {
        await walk(childId);
      }
    }
  }

  await walk(rootNodeId);

  return results;
}

export { updateSchedule, getCalendar };
