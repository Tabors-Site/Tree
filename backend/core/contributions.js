import Contribution from "../db/models/contribution.js";

async function getContributions({ nodeId, version }) {
  try {
    if (!nodeId) {
      throw new Error("Missing required parameter: nodeId");
    }

    if (typeof version !== "number" || isNaN(version)) {
      throw new Error("Invalid or missing version: must be a number");
    }

    const query = { nodeId, nodeVersion: version };

    const contributions = await Contribution.find(query)
      .populate("userId", "username")
      .populate("nodeId", "name")
      .populate("inviteAction.receivingId", "username")
      .populate({
        path: "tradeId",
        populate: { path: "nodeAId nodeBId", select: "name" },
      })
      .sort({ date: -1 })
      .lean();

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
          additionalInfo = {
            valueEdited: contribution.valueEdited,
          };
          break;

        case "editStatus":
          additionalInfo = {
            statusEdited: contribution.statusEdited,
          };
          break;

        case "trade":
          additionalInfo = {
            tradeId: contribution.tradeId,
          };
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
          additionalInfo = {
            scheduleEdited: contribution.scheduleEdited,
          };
          break;

        case "editGoal":
          additionalInfo = {
            goalEdited: contribution.goalEdited,
          };
          break;

        case "transaction":
          additionalInfo = contribution.tradeId
            ? {
                nodeA: {
                  name: contribution.tradeId.nodeAId?.name,
                  versionIndex: contribution.tradeId.versionAIndex,
                  valuesSent: contribution.tradeId.valuesTraded?.nodeA,
                },
                nodeB: {
                  name: contribution.tradeId.nodeBId?.name,
                  versionIndex: contribution.tradeId.versionBIndex,
                  valuesSent: contribution.tradeId.valuesTraded?.nodeB,
                },
              }
            : null;
          break;
        case "note":
          additionalInfo = contribution.noteAction
            ? {
                action: contribution.noteAction.action, // "add" / "remove"
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
                action: contribution.updateChildNode.action, // "added" / "removed"
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

export { getContributions };
