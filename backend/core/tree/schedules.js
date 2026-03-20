import Node from "../../db/models/node.js";
import { logContribution } from "../../db/utils.js";
import { useEnergy } from "./energy.js";

async function updateSchedule({
  nodeId,
  versionIndex,
  newSchedule,
  reeffectTime,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  if (!nodeId || versionIndex === undefined || reeffectTime === undefined) {
    const error = new Error(
      "nodeId, versionIndex, and reeffectTime are required.",
    );
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

  if (versionIndex < 0 || versionIndex >= node.versions.length) {
    const error = new Error("Invalid version index.");
    error.status = 400;
    throw error;
  }

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
  node.versions[versionIndex].schedule = formattedDate;

  node.versions[versionIndex].schedule = formattedDate;

  node.versions[versionIndex].reeffectTime = reeffectTime;

  await node.save();

  const scheduleEdited = { date: formattedDate, reeffectTime };

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "editSchedule",
    nodeVersion: versionIndex,
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
      .select("name prestige versions children")
      .lean();

    if (!node) return;

    const versionIndex = node.prestige;
    const version = node.versions?.[versionIndex];

    if (version?.schedule) {
      const scheduleDate = new Date(version.schedule);

      const inRange =
        (!start || scheduleDate >= start) && (!end || scheduleDate <= end);

      if (inRange) {
        results.push({
          nodeId: node._id.toString(),
          name: node.name ?? "(Untitled)",
          versionIndex,
          schedule: scheduleDate,
          reeffectTime: version.reeffectTime ?? null,
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
