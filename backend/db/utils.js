import Contribution from "./models/contribution.js";
import Node from "./models/node.js";

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
      return null;
    }
    return node;
  } catch (error) {
    console.error("Error finding node by UUID:", error);
    throw error;
  }
}
const logContribution = async ({
  userId,
  nodeId,
  action,
  statusEdited,
  valueEdited,
  scheduleEdited,
  inviteAction,
  noteAction,
  rawIdeaAction,
  updateParent,
  energyUsed = null,

  executeScript,
  editScript,
  updateChildNode,
  editNameNode,
  goalEdited,
  tradeId,
  nodeVersion,
  branchLifecycle,
  transactionMeta,
    purchaseMeta,

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
    "note",
    "updateParent",
    "executeScript",
    "editScript",
    "updateChildNode",
    "editNameNode",
    "rawIdea",
    "branchLifecycle",
    "purchase",
  ];

  if (!validActions.includes(action)) {
    throw new Error("Invalid action type");
  }

  if (!userId || !nodeId || !action || nodeVersion === undefined) {
    throw new Error("Missing required fields");
  }

  if (action === "transaction") {
    if (!transactionMeta) {
      throw new Error("transactionMeta is required for transaction actions");
    }

    const requiredTransactionFields = [
      "event",
      "side",
      "role",
      "versionSelf",
      "actorUserId",
    ];

    for (const field of requiredTransactionFields) {
      if (transactionMeta[field] === undefined) {
        throw new Error(`transactionMeta.${field} is required`);
      }
    }
  }

  if (action === "purchase") {
  if (!purchaseMeta) {
    throw new Error("purchaseMeta is required for purchase actions");
  }

  if (!purchaseMeta.stripeSessionId) {
    throw new Error("purchaseMeta.stripeSessionId is required");
  }
}

  try {
    const newContribution = new Contribution({
      userId,
      nodeId,
      action,
      energyUsed,

      statusEdited,
      valueEdited,
      tradeId,
      nodeVersion,
      goalEdited,
      scheduleEdited,
      inviteAction,
      noteAction,
      rawIdeaAction,
      updateParent,
      executeScript,
      editScript,
      updateChildNode,
      editNameNode,
      branchLifecycle,
      transactionMeta,
        purchaseMeta,

      date: new Date(),
    });

    await newContribution.save();
  } catch (error) {
    console.error("Error logging contribution:", error);
    throw new Error(error.message || "Internal server error");
  }
};

export { findNodeById, logContribution, handleSchedule };
