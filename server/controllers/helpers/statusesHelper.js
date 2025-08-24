const {
  logContribution,
  findNodeById,
  handleSchedule,
} = require("../../db/utils");

async function editStatusHelper({
  nodeId,
  status,
  version,
  isInherited,
  userId,
}) {
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");

  const targetVersion = node.versions.find((v) => v.prestige === version);
  if (!targetVersion) throw new Error("Version not found");

  // Update status
  targetVersion.status = status;
  await node.save();

  await logContribution({
    userId,
    nodeId,
    action: "editStatus",
    statusEdited: status,
    nodeVersion: version,
  });

  // Cascade if inherited
  if (isInherited) {
    await updateNodeStatusRecursively(node, status, version, userId);
  }

  return {
    message: `Status updated to ${status} for node version ${version}${
      isInherited ? " and its children" : ""
    }`,
  };
}

async function updateNodeStatusRecursively(node, status, version, userId) {
  if (status === "divider") {
    const targetVersionIndex = node.versions.findIndex(
      (v) => v.prestige === version
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
        (v) => v.prestige === childNode.prestige
      );

      if (targetChildVersionIndex !== -1) {
        childNode.versions[targetChildVersionIndex].status = status;
        await childNode.save();

        await logContribution({
          userId,
          nodeId: childNode._id,
          action: "editStatus",
          statusEdited: status,
          nodeVersion: targetChildVersionIndex,
        });

        await updateNodeStatusRecursively(childNode, status, version, userId);
      } else {
        console.warn(`Version not found for child node ${childNode._id}`);
      }
    }
  }
}

async function addPrestigeHelper({ nodeId, userId }) {
  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");

  const targetNodeIndex = node.prestige;
  await addPrestigeToNode(node);

  await logContribution({
    userId,
    nodeId,
    action: "prestige",
    nodeVersion: targetNodeIndex,
  });

  return { message: "Prestige added successfully." };
}

async function addPrestigeToNode(node) {
  const currentVersion = node.versions.find(
    (v) => v.prestige === node.prestige
  );
  if (!currentVersion)
    throw new Error("No version found for current prestige level");

  currentVersion.status = "completed";

  const valuesMap =
    currentVersion.values instanceof Map
      ? currentVersion.values
      : new Map(Object.entries(currentVersion.values));

  const newValues = new Map();
  for (const [key, value] of valuesMap) {
    node.globalValues[key] = (node.globalValues[key] || 0) + value;
    // Instead of setting to 0, preserve the current value or set to a default
    newValues.set(key, value); // Or whatever logic you need
  }

  const newVersion = {
    prestige: node.prestige + 1,
    values: newValues,
    status: "active",
    dateCreated: new Date().toISOString(),
    schedule: await handleSchedule(currentVersion),
    reeffectTime: currentVersion.reeffectTime,
  };

  node.prestige++;
  node.versions.push(newVersion);
  await node.save();
}

module.exports = {
  editStatusHelper,
  addPrestigeHelper,
};
