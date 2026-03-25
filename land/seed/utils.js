// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "./log.js";
import Contribution from "./models/contribution.js";
import Node from "./models/node.js";
import { getChatContext } from "./ws/chatTracker.js";
import { hooks } from "./hooks.js";

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
    chatId: inputChatId = null,
    sessionId: inputSessionId = null,
    action,
    // Core action data
    statusEdited,
    editName,
    editType,
    noteAction,
    updateChild,
    updateParent,
    branchLifecycle,
    // Federation
    wasRemote = false,
    homeLand = null,
    // Everything else goes to extensionData
    ...extensionRest
  } = params;

  // Let extensions modify contribution data via hook
  const hookData = { nodeId, action, userId, ...extensionRest };
  const hookResult = await hooks.run("beforeContribution", hookData);
  if (hookResult.cancelled) {
    throw new Error(`Contribution cancelled: ${hookResult.reason || "extension"}`);
  }

  if (!userId || !nodeId || !action) {
    throw new Error("Missing required fields");
  }

  let chatId = inputChatId;
  let sessionId = inputSessionId;

  if (wasAi && !chatId) {
    const ctx = getChatContext(userId);
    chatId = ctx.chatId;
    sessionId = ctx.sessionId;
  }

  // Build extension data from remaining params (includes energyUsed, nodeVersion, inviteAction, etc.)
  const extKeys = Object.keys(extensionRest).filter(k =>
    extensionRest[k] !== undefined && extensionRest[k] !== null
  );
  // Also include anything extensions added via hook
  for (const k of Object.keys(hookData)) {
    if (!["nodeId", "action", "userId"].includes(k) && hookData[k] !== undefined && hookData[k] !== null) {
      if (!extKeys.includes(k)) extKeys.push(k);
      extensionRest[k] = hookData[k];
    }
  }
  const extensionData = extKeys.length > 0
    ? Object.fromEntries(extKeys.map(k => [k, extensionRest[k]]))
    : undefined;

  try {
    // Build doc with only defined fields (avoids storing nulls in MongoDB)
    const doc = { userId, nodeId, action, date: new Date() };
    if (wasAi) doc.wasAi = true;
    if (chatId) doc.chatId = chatId;
    if (sessionId) doc.sessionId = sessionId;
    if (statusEdited) doc.statusEdited = statusEdited;
    if (editName) doc.editName = editName;
    if (editType) doc.editType = editType;
    if (noteAction) doc.noteAction = noteAction;
    if (updateChild) doc.updateChild = updateChild;
    if (updateParent) doc.updateParent = updateParent;
    if (branchLifecycle) doc.branchLifecycle = branchLifecycle;
    if (wasRemote) doc.wasRemote = true;
    if (homeLand) doc.homeLand = homeLand;
    if (extensionData) doc.extensionData = extensionData;

    const newContribution = new Contribution(doc);

    await newContribution.save();
  } catch (error) {
    log.error("DB", "Error logging contribution:", error);
    throw new Error(error.message || "Internal server error");
  }
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}

export { findNodeById, logContribution, escapeRegex, containsHtml };
