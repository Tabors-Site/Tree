import Contribution from "../db/models/contribution.js";

async function getContributions({
  nodeId,
  version,
  limit,
  startDate,
  endDate,
}) {
  try {
    if (!nodeId) {
      throw new Error("Missing required parameter: nodeId");
    }

    if (typeof version !== "number" || isNaN(version)) {
      throw new Error("Invalid or missing version: must be a number");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
      throw new Error("Invalid limit: must be a positive number");
    }

    const query = { nodeId, nodeVersion: version };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    let contributionsQuery = Contribution.find(query)
      .populate("userId", "username")
      .populate("nodeId", "name")
      .populate("inviteAction.receivingId", "username")

      .sort({ date: -1 })
      .lean();

    if (typeof limit === "number") {
      contributionsQuery = contributionsQuery.limit(limit);
    }

    const contributions = await contributionsQuery;

    if (!contributions || contributions.length === 0) {
      return {
        message: `No contributions found for node ${nodeId} (version ${version})`,
        contributions: [],
      };
    }

    const enhancedContributions = contributions.map((contribution) => {
      let additionalInfo = null;

      switch (contribution.action) {
        case "editValue":
          additionalInfo = { valueEdited: contribution.valueEdited };
          break;
        case "editStatus":
          additionalInfo = { statusEdited: contribution.statusEdited };
          break;

        case "invite":
          additionalInfo = contribution.inviteAction
            ? {
                action: contribution.inviteAction.action,
                receivingUsername:
                  contribution.inviteAction.receivingId?.username ?? null,
              }
            : null;
          break;
        case "editSchedule":
          additionalInfo = { scheduleEdited: contribution.scheduleEdited };
          break;
        case "editGoal":
          additionalInfo = { goalEdited: contribution.goalEdited };
          break;

        case "note":
          additionalInfo = contribution.noteAction
            ? {
                action: contribution.noteAction.action,
                noteId: contribution.noteAction.noteId,
              }
            : null;
          break;
        case "updateParent":
          additionalInfo = contribution.updateParent
            ? {
                oldParentId: contribution.updateParent.oldParentId,
                newParentId: contribution.updateParent.newParentId,
              }
            : null;
          break;
        case "editScript":
          additionalInfo = contribution.editScript
            ? {
                scriptName: contribution.editScript.scriptName,
                contents: contribution.editScript.contents,
              }
            : null;
          break;
        case "updateChildNode":
          additionalInfo = contribution.updateChildNode
            ? {
                action: contribution.updateChildNode.action,
                childId: contribution.updateChildNode.childId,
              }
            : null;
          break;
        case "editNameNode":
          additionalInfo = contribution.editNameNode
            ? {
                oldName: contribution.editNameNode.oldName,
                newName: contribution.editNameNode.newName,
              }
            : null;
          break;

        default:
          additionalInfo = null;
      }

      return {
        ...contribution,
        username: contribution.userId?.username ?? null,
        nodeVersion: contribution.nodeVersion,
        additionalInfo,
      };
    });

    return {
      message: "Contributions retrieved successfully",
      contributions: enhancedContributions,
    };
  } catch (error) {
    throw error;
  }
}

async function getContributionsByUser(userId, limit, startDate, endDate) {
  try {
    if (!userId) {
      throw new Error("Missing required parameter: userId");
    }

    if (limit !== undefined && (typeof limit !== "number" || limit <= 0)) {
      throw new Error("Invalid limit: must be a positive number");
    }

    const query = { userId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    let contributionsQuery = Contribution.find(query)
      .populate("userId", "username")
      .populate("nodeId", "name")
      .populate("inviteAction.receivingId", "username")

      .sort({ date: -1 })
      .lean();

    if (typeof limit === "number") {
      contributionsQuery = contributionsQuery.limit(limit);
    }

    const contributions = await contributionsQuery;

    if (!contributions || contributions.length === 0) {
      return {
        message: `No contributions found for user ${userId}`,
        contributions: [],
      };
    }

   

    return {
      message: "User contributions retrieved successfully",
contributions,    };
  } catch (error) {
    throw error;
  }
}

export { getContributions, getContributionsByUser };
