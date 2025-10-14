const Node = require("../../db/models/node");
const { logContribution } = require("../../db/utils");

async function updateScheduleHelper({
  nodeId,
  versionIndex,
  newSchedule,
  reeffectTime,
  userId,
}) {
  // Validate inputs
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

  // Find the node by ID
  const node = await Node.findById(nodeId);
  if (!node) {
    const error = new Error("Node not found.");
    error.status = 404;
    throw error;
  }

  // Validate version index
  if (versionIndex < 0 || versionIndex >= node.versions.length) {
    const error = new Error("Invalid version index.");
    error.status = 400;
    throw error;
  }

  // Format the new schedule date
  const formattedDate = new Date(newSchedule);

  // Update the schedule and reEffectTime for the specified version
  node.versions[versionIndex].schedule = formattedDate;
  node.versions[versionIndex].reeffectTime = reeffectTime;

  // Save the updated node
  await node.save();

  const scheduleEdited = { date: formattedDate, reeffectTime };

  // Log the contribution
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

module.exports = { updateScheduleHelper };
