import {
  logContribution,
  findNodeById,
  handleSchedule,
} from "../../db/utils.js";
// Energy: dynamic import, no-op if extension not installed
let useEnergy = async () => ({ energyUsed: 0 });
try { ({ useEnergy } = await import("../../extensions/energy/core.js")); } catch {}

async function editStatus({
  nodeId,
  status,
  version,
  isInherited,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const targetVersion = node.versions.find((v) => v.prestige === version);
  if (!targetVersion) throw new Error("Version not found");
  const VALID_STATUSES = ["active", "trimmed", "completed"];
  if (!VALID_STATUSES.includes(status)) {
    throw new Error("Invalid Status");
  }

  if (status === "completed") {
    isInherited = true;
  }
  const { energyUsed } = await useEnergy({
    userId,
    action: "editStatus",
  });

  // Update status
  targetVersion.status = status;
  await node.save();

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "editStatus",
    statusEdited: status,
    nodeVersion: version,
    energyUsed,
  });

  // Cascade if inherited
  if (isInherited) {
    await updateNodeStatusRecursively(
      node,
      status,
      version,
      userId,
      wasAi,
      aiChatId,
      sessionId,
    );
  }

  return {
    message: `Status updated to ${status} for node version ${version}${
      isInherited ? " and its children" : ""
    }`,
  };
}

async function updateNodeStatusRecursively(
  node,
  status,
  version,
  userId,
  wasAi,
  aiChatId = null,
  sessionId = null,
) {
  if (status === "divider") {
    const targetVersionIndex = node.versions.findIndex(
      (v) => v.prestige === version,
    );
    if (targetVersionIndex !== -1) {
      node.versions[targetVersionIndex].status = status;
      await node.save();
    }
    return;
  }

  if (["active", "trimmed", "completed"].includes(status)) {
    for (const childId of node.children) {
      const childNode = await findNodeById(childId);
      const targetChildVersionIndex = childNode.versions.findIndex(
        (v) => v.prestige === childNode.prestige,
      );

      if (targetChildVersionIndex !== -1) {
        childNode.versions[targetChildVersionIndex].status = status;
        await childNode.save();

        await logContribution({
          userId,
          nodeId: childNode._id,
          wasAi,
          aiChatId,
          sessionId,
          action: "editStatus",
          statusEdited: status,
          nodeVersion: targetChildVersionIndex,
        });

        await updateNodeStatusRecursively(
          childNode,
          status,
          version,
          userId,
          wasAi,
          aiChatId,
          sessionId,
        );
      } else {
        console.warn(`Version not found for child node ${childNode._id}`);
      }
    }
  }
}

export { editStatus };
