import Contribution from "../db/models/contribution.js";

import { getContributionsByUser as coreGetContributionsByUser } from "../core/contributions.js";

function getDateParams(req) {
  return {
    startDate: req.query.startDate ?? req.body.startDate,
    endDate: req.query.endDate ?? req.body.endDate,
  };
}
const getContributions = async (req, res) => {
  try {
    const nodeId = req.body.nodeId ?? req.query.nodeId;

    if (!nodeId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: nodeId",
      });
    }

    const limitRaw = req.body.limit ?? req.query.limit;
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const { startDate, endDate } = getDateParams(req);

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const query = { nodeId };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    let contributionsQuery = Contribution.find(query)
      .populate("userId", "username")
      .populate("nodeId")
      .populate("inviteAction.receivingId", "username")
      .populate({
        path: "tradeId",
        populate: { path: "nodeAId nodeBId", select: "name" },
      })
      .sort({ date: -1 });

    if (typeof limit === "number") {
      contributionsQuery = contributionsQuery.limit(limit);
    }

    const contributions = await contributionsQuery;

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
        default:
          additionalInfo = null;
      }

      return {
        ...contribution.toObject(),
        username: contribution.userId?.username ?? null,
        nodeVersion: contribution.nodeVersion,
        additionalInfo,
      };
    });

    res.status(200).json({
      success: true,
      contributions: enhancedContributions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};

async function getContributionsByUser(req, res) {
  try {
    const userId = req.body.userId || req.params.userId;

    const limitRaw = req.body.limit ?? req.query.limit;
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const { startDate, endDate } = getDateParams(req);

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const result = await coreGetContributionsByUser(
      userId,
      limit,
      startDate,
      endDate
    );

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
}

export { getContributions, getContributionsByUser };
