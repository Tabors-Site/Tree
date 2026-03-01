import { logContribution, findNodeById, handleSchedule } from "../db/utils.js";
import { useEnergy } from "../core/energy.js";

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
    await updateNodeStatusRecursively(node, status, version, userId, wasAi, aiChatId, sessionId);
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

        await updateNodeStatusRecursively(childNode, status, version, userId, wasAi, aiChatId, sessionId);
      } else {
        console.warn(`Version not found for child node ${childNode._id}`);
      }
    }
  }
}

async function addPrestige({ nodeId, userId, wasAi, aiChatId = null, sessionId = null }) {
  console.log(nodeId);
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");

  const { energyUsed } = await useEnergy({
    userId,
    action: "prestige",
  });
  const targetNodeIndex = node.prestige;
  await addPrestigeToNode(node);

  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "prestige",
    nodeVersion: targetNodeIndex,
    energyUsed,
  });

  return { message: "Prestige added successfully." };
}

async function addPrestigeToNode(node) {
  const currentVersion = node.versions.find(
    (v) => v.prestige === node.prestige,
  );
  if (!currentVersion)
    throw new Error("No version found for current prestige level");

  currentVersion.status = "completed";

  const valuesMap =
    currentVersion.values instanceof Map
      ? currentVersion.values
      : new Map(Object.entries(currentVersion.values));

  const newValues = new Map();
  for (const key of valuesMap.keys()) {
    newValues.set(key, 0);
  }
  const goalsMap =
    currentVersion.goals instanceof Map
      ? currentVersion.goals
      : new Map(Object.entries(currentVersion.goals || {}));

  const newGoals = new Map();
  for (const [key, goal] of goalsMap.entries()) {
    newGoals.set(key, goal);
  }

  const newVersion = {
    prestige: node.prestige + 1,
    values: newValues,
    goals: newGoals,
    status: "active",
    dateCreated: new Date().toISOString(),
    schedule: await handleSchedule(currentVersion),
    reeffectTime: currentVersion.reeffectTime,
  };

  node.prestige++;
  node.versions.push(newVersion);
  await node.save();
}

export { editStatus, addPrestige };
