const Node = require("../db/models/node");
const { logContribution } = require("../db/utils");

const updateSchedule = async (req, res) => {
  const { nodeId, versionIndex, newSchedule, reeffectTime } = req.body;
  const userId = req.userId;

  // Validate inputs
  if (
    !nodeId ||
    versionIndex === undefined ||
    !newSchedule ||
    reeffectTime === undefined
  ) {
    return res.status(400).json({
      message:
        "nodeId, versionIndex, newSchedule, and reEffectTime are required.",
    });
  }

  if (reeffectTime > 1000000) {
    return res
      .status(400)
      .json({ message: "reeffect time must be below 1,000,000 hrs" });
  }

  try {
    // Find the node by ID
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ message: "Node not found." });
    }

    // Validate version index
    if (versionIndex < 0 || versionIndex >= node.versions.length) {
      return res.status(400).json({ message: "Invalid version index." });
    }

    // Format the new schedule date
    let formattedDate = new Date(newSchedule);

    // Update the schedule and reEffectTime for the specified version
    node.versions[versionIndex].schedule = formattedDate;
    node.versions[versionIndex].reeffectTime = reeffectTime;

    // Save the updated node
    await node.save();

    const scheduleEdited = {
      date: formattedDate,
      reeffectTime: reeffectTime,
    };

    // Log the contribution
    await logContribution({
      userId: userId,
      nodeId: nodeId,
      action: "editSchedule",
      nodeVersion: versionIndex, // Index of the version with prestige
      scheduleEdited: scheduleEdited,
    });

    return res.status(200).json({
      message: "Schedule and re-effect time updated successfully.",
      node,
    });
  } catch (error) {
    console.error("Error updating schedule:", error);
    return res
      .status(500)
      .json({ message: "Server error, could not update schedule." });
  }
};

module.exports = { updateSchedule };
