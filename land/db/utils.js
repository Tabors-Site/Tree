import log from "../core/log.js";
import Contribution from "./models/contribution.js";
import Node from "./models/node.js";
import { getAiContributionContext } from "../ws/aiChatTracker.js";
import { hooks } from "../core/hooks.js";

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
    log.error("DB", "Error finding node by UUID:", error);
    throw error;
  }
}
const logContribution = async (params) => {
  const {
    userId,
    nodeId,
    wasAi = false,
    aiChatId: inputAiChatId = null,
    sessionId: inputSessionId = null,
    action,
    nodeVersion,
    energyUsed = null,
    // Core action data
    statusEdited,
    editNameNode,
    editType,
    noteAction,
    updateChildNode,
    updateParent,
    branchLifecycle,
    inviteAction,
    // Everything else goes to extensionData
    ...rest
  } = params;

  // Let extensions modify contribution data (e.g. prestige sets nodeVersion)
  const hookData = { nodeId, nodeVersion, action, userId };
  const hookResult = await hooks.run("beforeContribution", hookData);
  if (hookResult.cancelled) {
    throw new Error(`Contribution cancelled: ${hookResult.reason || "extension"}`);
  }
  const finalNodeVersion = hookData.nodeVersion ?? nodeVersion;

  if (!userId || !nodeId || !action || finalNodeVersion === undefined) {
    throw new Error("Missing required fields");
  }

  let aiChatId = inputAiChatId;
  let sessionId = inputSessionId;

  if (wasAi && !aiChatId) {
    const ctx = getAiContributionContext(userId);
    aiChatId = ctx.aiChatId;
    sessionId = ctx.sessionId;
  }

  // Build extension data from remaining params
  const extKeys = Object.keys(rest).filter(k =>
    !["wasRemote", "homeLand"].includes(k) && rest[k] !== undefined && rest[k] !== null
  );
  const extensionData = extKeys.length > 0
    ? Object.fromEntries(extKeys.map(k => [k, rest[k]]))
    : null;

  try {
    const newContribution = new Contribution({
      userId,
      nodeId,
      action,
      wasAi,
      aiChatId,
      sessionId,
      energyUsed,
      nodeVersion: finalNodeVersion,
      statusEdited,
      editNameNode,
      editType,
      noteAction,
      updateChildNode,
      updateParent,
      branchLifecycle,
      inviteAction,
      wasRemote: rest.wasRemote || false,
      homeLand: rest.homeLand || null,
      extensionData,
      date: new Date(),
    });

    await newContribution.save();
  } catch (error) {
    log.error("DB", "Error logging contribution:", error);
    throw new Error(error.message || "Internal server error");
  }
};

export { findNodeById, logContribution, handleSchedule };
