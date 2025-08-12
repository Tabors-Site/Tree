const Contribution = require("./models/contribution");

const Node = require("./models/node");

async function handleSchedule(nodeVersion) {
  if (nodeVersion.schedule === null) {
    return nodeVersion.schedule; // No change for floating schedules
  } else {
    const currentSchedule = new Date(nodeVersion.schedule);
    const updatedSchedule = new Date(
      currentSchedule.getTime() + nodeVersion.reeffectTime * 60 * 60 * 1000
    );
    return updatedSchedule.toISOString();
  }
}

async function findNodeById(nodeId) {
  try {
    const node = await Node.findOne({ _id: nodeId }).populate("children");
    if (!node) {
      return null; // Return null if the node is not found
    }
    return node;
  } catch (error) {
    console.error("Error finding node by UUID:", error);
    throw error; // Re-throw for unexpected errors
  }
}

const logContribution = async ({
  userId,
  nodeId,
  action,
  statusEdited = null,
  valueEdited = null,
  nodeVersion,
  tradeId = null,
  goalEdited = null,
  scheduleEdited = null,
  inviteAction = null,
}) => {
  const validActions = [
    "create",
    "editStatus",
    "editValue",
    "prestige",
    "trade",
    "delete",
    "invite",
    "editSchedule",
    "editGoal",
    "transaction",
  ];

  if (!validActions.includes(action)) {
    throw new Error("Invalid action type");
  }

  if (!userId || !nodeId || !action || nodeVersion === undefined) {
    throw new Error("Missing required fields");
  }

  try {
    const newContribution = new Contribution({
      userId,
      nodeId,
      action,
      statusEdited,
      valueEdited,
      tradeId,
      nodeVersion,
      goalEdited,
      scheduleEdited,
      inviteAction,
      date: new Date(),
    });

    await newContribution.save();
  } catch (error) {
    console.error("Error logging contribution:", error);
    throw new Error(error.message || "Internal server error");
  }
};

module.exports = {
  findNodeById,
  logContribution,
  handleSchedule,
};
