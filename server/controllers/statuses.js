const { logContribution, findNodeById, handleSchedule } = require("../db/utils");

async function editStatus(req, res) {
  const { nodeId, status, version, isInherited } = req.body;
  const userId = req.userId;

  try {
    const node = await findNodeById(nodeId);
    if (!node) {
      return res
        .status(404)
        .json({ success: false, message: "Node not found" });
    }

    // Find the specific version of the node based on the version provided
    const targetVersion = node.versions.find((v) => v.prestige === version);
    if (!targetVersion) {
      return res
        .status(404)
        .json({ success: false, message: "Version not found" });
    }

    // Update the status of the specific version of the node
    targetVersion.status = status;
    await node.save(); // Save the updated node

    try {
      await logContribution({
        userId: userId,
        nodeId: nodeId,
        action: "editStatus",
        statusEdited: status,
        nodeVersion: version,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error logging contribution",
        error: error.message,
      });
    }

    if (isInherited) {
      await updateNodeStatusRecursively(node, status, version, userId);
    }


    res.json({
      success: true,
      message: `Status updated to ${status} for node version ${version} and its children`,
    });
  } catch (error) {
    console.error("Error updating node status:", error);
    res
      .status(500)
      .json({ success: false, message: "Error updating node status" });
  }
}

async function updateNodeStatusRecursively(node, status, version, userId) {
  // If the status is "divider", update the parent node and skip child updates
  if (status === "divider") {
    // Update the parent node status without modifying the children
    const targetVersionIndex = node.versions.findIndex(
      (v) => v.prestige === version
    );
    if (targetVersionIndex !== -1) {
      // Update the version status by index
      node.versions[targetVersionIndex].status = status;
      await node.save(); // Save the updated node
    }
  } else {
    // If the status is "active", "trimmed", or "completed", process children
    if (["active", "trimmed", "completed"].includes(status)) {
      // Iterate over children nodes and update them
      for (const childId of node.children) {
        const childNode = await findNodeById(childId);

        // Find the index of the version that matches the child's prestige
        const targetChildVersionIndex = childNode.versions.findIndex(
          (v) => v.prestige === childNode.prestige
        );

        // If a matching version is found, update its status
        if (targetChildVersionIndex !== -1) {
          childNode.versions[targetChildVersionIndex].status = status;
          await childNode.save(); // Save the updated child node

          try {
            await logContribution({
              userId: userId,
              nodeId: childNode._id,
              action: "editStatus",
              statusEdited: status,
              nodeVersion: targetChildVersionIndex,
            });
          } catch (error) {
            console.log({
              userId: userId,
              nodeId: childNode._id,
              action: "editStatus",
              statusEdited: status,
              nodeVersion: childNode.versions[targetChildVersionIndex].prestige,
            });
            return res.status(500).json({
              success: false,
              message: "Error logging contribution",
              error: error.message,
            });
          }
          await updateNodeStatusRecursively(childNode, status, version, userId); // Recursive call for child node
        } else {
          console.log(`Version not found for child node ${childNode._id}`);
        }
      }
    }
  }
}

async function addPrestigeToNode(node) {
  const currentVersion = node.versions.find(
    (v) => v.prestige === node.prestige
  );

  if (!currentVersion) {
    console.error("No version found for the current prestige level.");
    return;
  }

  currentVersion.status = "completed";

  // Ensure currentVersion.values is a Map, or convert it if it's an object
  const valuesMap =
    currentVersion.values instanceof Map
      ? currentVersion.values
      : new Map(Object.entries(currentVersion.values));

  const newValues = new Map(); // Create a Map for new version's values

  // Update globalValues and reset newValues
  for (const [key, value] of valuesMap) {
    node.globalValues[key] = (node.globalValues[key] || 0) + value;
    newValues.set(key, 0); // Reset the value to 0 for the new version
  }

  const newVersion = {
    prestige: node.prestige + 1,
    values: newValues, // Store as Map
    status: "active",
    dateCreated: new Date().toISOString(),
    schedule: await handleSchedule(currentVersion), // Update schedule or keep floating
    reeffectTime: currentVersion.reeffectTime, // Inherit from previous version
  };

  node.prestige++;
  node.versions.push(newVersion);

  await node
    .save()
    .then()
    .catch((err) => console.error("Error saving node:", err));
}

async function addPrestige(req, res) {
  const { nodeId } = req.body;
  const userId = req.userId;

  try {
    const node = await findNodeById(nodeId);

    if (node) {
      
      const targetNodeIndex = node.prestige;

      await addPrestigeToNode(node);

      await logContribution({
        userId: userId,
        nodeId: nodeId,
        action: "prestige",
        nodeVersion: targetNodeIndex, // Index of the version with prestige
      });

      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, message: "Node not found" });
    }
  } catch (error) {
    console.error("Error processing prestige:", error);
    res.status(500).json({ success: false, message: "An error occurred" });
  }
}

module.exports = {
  editStatus,
  addPrestige,
};
