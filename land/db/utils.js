import Contribution from "./models/contribution.js";
import Node from "./models/node.js";
import { getAiContributionContext } from "../ws/aiChatTracker.js";

async function handleSchedule(nodeVersion) {
  if (nodeVersion.schedule === null) {
    return nodeVersion.schedule; // No change for floating schedules
  } else {
    const currentSchedule = new Date(nodeVersion.schedule);
    const updatedSchedule = new Date(
      currentSchedule.getTime() + nodeVersion.reeffectTime * 60 * 60 * 1000,
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
  wasAi = false,
  aiChatId = null,
  sessionId = null,
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
  editType,
  goalEdited,
  tradeId,
  nodeVersion,
  branchLifecycle,
  transactionMeta,
  purchaseMeta,
  understandingMeta,
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
    "editType",
    "rawIdea",
    "branchLifecycle",
    "purchase",
    "understanding",
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
  // =====================================================
  if (action === "understanding") {
    if (!understandingMeta) {
      throw new Error(
        "understandingMeta is required for understanding actions",
      );
    }

    if (!understandingMeta.stage) {
      throw new Error("understandingMeta.stage is required");
    }

    if (!understandingMeta.understandingRunId) {
      throw new Error("understandingMeta.understandingRunId is required");
    }
  }

  // If this is an AI contribution but aiChatId wasn't explicitly provided
  // (e.g. MCP tool args get stripped by Zod schema validation), look it up
  // from the in-memory context map keyed by userId.
  if (wasAi && !aiChatId) {
    const ctx = getAiContributionContext(userId);
    aiChatId = ctx.aiChatId;
    sessionId = ctx.sessionId;
  }

  try {
    const newContribution = new Contribution({
      userId,
      nodeId,
      action,
      wasAi,
      aiChatId,
      sessionId,
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
      editType,
      branchLifecycle,
      transactionMeta,
      purchaseMeta,
      understandingMeta,
      date: new Date(),
    });

    await newContribution.save();
  } catch (error) {
    console.error("Error logging contribution:", error);
    throw new Error(error.message || "Internal server error");
  }
};

export { findNodeById, logContribution, handleSchedule };
