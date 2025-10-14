const Contribution = require("../db/models/contribution");
const Transaction = require("../db/models/transaction");

const getContributions = async (req, res) => {
  const { nodeId } = req.body;

  try {
    const contributions = await Contribution.find({ nodeId })
      .populate("userId", "username")
      .populate("nodeId")
      .populate("inviteAction.receivingId", "username")
      .populate({
        path: "tradeId",
        populate: { path: "nodeAId nodeBId", select: "name" }, // Populate both node names
      })
      .sort({ date: -1 });

    const enhancedContributions = contributions.map((contribution) => {
      let additionalInfo = null;

      switch (contribution.action) {
        case "editValue":
          additionalInfo = { valueEdited: contribution.valueEdited };
          break;
        case "editStatus":
          additionalInfo = { statusEdited: contribution.statusEdited };
          break;
        case "trade":
          additionalInfo = { tradeId: contribution.tradeId };
          break;
        case "invite":
          additionalInfo = {
            inviteAction: contribution.inviteAction
              ? {
                  action: contribution.inviteAction.action,
                  receivingUsername: contribution.inviteAction.receivingId
                    ? contribution.inviteAction.receivingId.username
                    : null,
                }
              : null,
          };
          break;
        case "editSchedule":
          additionalInfo = { scheduleEdited: contribution.scheduleEdited };
          break;
        case "editGoal":
          additionalInfo = { goalEdited: contribution.goalEdited };
          break;
        case "transaction":
          additionalInfo = contribution.tradeId
            ? {
                nodeA: {
                  name: contribution.tradeId.nodeAId.name, // Node A's name
                  versionIndex: contribution.tradeId.versionAIndex, // Node A's version
                  valuesSent: contribution.tradeId.valuesTraded.nodeA, // Values sent by Node A
                },
                nodeB: {
                  name: contribution.tradeId.nodeBId.name, // Node B's name
                  versionIndex: contribution.tradeId.versionBIndex, // Node B's version
                  valuesSent: contribution.tradeId.valuesTraded.nodeB, // Values sent by Node B
                },
              }
            : null;
          break;
        default:
          additionalInfo = null;
      }

      return {
        ...contribution.toObject(),
        username: contribution.userId.username,
        additionalInfo,
        nodeVersion: contribution.nodeVersion,
      };
    });

    res
      .status(200)
      .json({ success: true, contributions: enhancedContributions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

module.exports = {
  getContributions,
};
