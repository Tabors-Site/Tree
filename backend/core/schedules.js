import Node from "../db/models/node.js";
import { logContribution } from "../db/utils.js";

async function updateSchedule({
  nodeId,
  versionIndex,
  newSchedule,
  reeffectTime,
  userId,
}) {
  if (
    !nodeId ||
    versionIndex === undefined ||
    !newSchedule ||
    reeffectTime === undefined
  ) {
    const error = new Error(
      "nodeId, versionIndex, newSchedule, and reeffectTime are required."
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

  const formattedDate = new Date(newSchedule);

  node.versions[versionIndex].schedule = formattedDate;
  node.versions[versionIndex].reeffectTime = reeffectTime;

  await node.save();

  const scheduleEdited = { date: formattedDate, reeffectTime };

  await logContribution({
    userId,
    nodeId,
    action: "editSchedule",
    nodeVersion: versionIndex,
    scheduleEdited,
  });

  return {
    message: "Schedule and re-effect time updated successfully.",
    node,
  };
}

export { updateSchedule };
