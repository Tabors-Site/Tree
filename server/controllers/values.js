const { findNodeById, logContribution } = require("../db/utils");

async function setValueForNode(req, res) {
  const { nodeId, key, value, version } = req.body;
  const userId = req.userId;
  const versionIndex = version.toString();
  const numericValue = Number(value);

  if (isNaN(numericValue) || numericValue==="e") {
    return res.status(400).json({ error: "Value must be a valid number" });
  }

  try {
    const node = await findNodeById(nodeId);
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    // Check if the versionIndex exists in the versions array
    if (node.versions[versionIndex] === undefined) {
      return res.status(404).json({ error: "Version index does not exist" });
    }

    const currentVersion = node.versions[versionIndex];

    // Ensure that the 'values' map is updated properly
    if (currentVersion) {
      currentVersion.values.set(key, value);
    } else {
      currentVersion.values = new Map();
      currentVersion.values.set(key, value);
    }

    await node.save();
    await logContribution({
      userId,
      nodeId,
      action: "editValue",
      status: null,
      valueEdited: { [key]: value },
      nodeVersion: versionIndex,
      tradeId: null,
    });

    res.status(200).json({ message: "Value updated successfully." });
  } catch (error) {
    console.error("Error setting value for node:", error);
    res.status(500).json({ error: "Failed to set value" });
  }
}

async function setGoalForNode(req, res) {
  const { nodeId, key, goal, version } = req.body;
  const userId = req.userId;
  const versionIndex = version.toString();
  const numericGoal = Number(goal);

  if (isNaN(numericGoal)) {
    return res.status(400).json({ error: "Goal must be a valid number" });
  }

  try {
    const node = await findNodeById(nodeId);
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    // Check if the versionIndex exists in the versions array
    if (node.versions[versionIndex] === undefined) {
      return res.status(404).json({ error: "Version index does not exist" });
    }

    const currentVersion = node.versions[versionIndex];

    // Ensure that the 'goals' map is updated properly
    if (currentVersion) {
      currentVersion.goals.set(key, goal);
    } else {
      currentVersion.goals = new Map();
      currentVersion.goals.set(key, goal);
    }

    await node.save();
    await logContribution({
      userId,
      nodeId,
      action: "editGoal",
      status: null,
      goalEdited: { [key]: goal },
      nodeVersion: versionIndex,
      tradeId: null,
    });

    res.status(200).json({ message: "Goal updated successfully." });
  } catch (error) {
    console.error("Error setting goal for node:", error);
    res.status(500).json({ error: "Failed to set goal" });
  }
}

module.exports = {
  setValueForNode,
  setGoalForNode,
};
