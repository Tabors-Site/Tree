const Node = require("../db/models/node");
const Transaction = require("../db/models/transaction");
const { logContribution } = require("../db/utils");

const getTransactions = async (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) {
    return res.status(400).json({ success: false, message: "nodeId is required." });
  }
  try {
    const transactions = await Transaction.find({
      $or: [{ nodeAId: nodeId }, { nodeBId: nodeId }],
    })
      .populate("nodeAId")
      .populate("nodeBId")
      .populate("versionAIndex")
      .populate("versionBIndex")
      .populate("valuesTraded.nodeA")
      .populate("valuesTraded.nodeB")
      .exec();

    return res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return res.status(500).json({ success: false, message: "Server error, could not fetch transactions." });
  }
};

const tradeValuesBetweenNodes = async (nodeAId, versionAIndex, valuesA, nodeBId, versionBIndex, valuesB, userId) => {
  const nodeA = await Node.findById(nodeAId);
  const nodeB = await Node.findById(nodeBId);

  if (!nodeA || !nodeB) {
    throw new Error("One or both nodes not found.");
  }

  const versionA = nodeA.versions[versionAIndex];
  const versionB = nodeB.versions[versionBIndex];

  if (!versionA || !versionB) {
    throw new Error("One or both versions not found.");
  }

  for (const [key, value] of Object.entries(valuesA)) {
    if ((versionA.values.get(key) || 0) < value) {
      throw new Error(`This node's version ${versionAIndex} has insufficient ${key}.`);
    }

    versionA.values.set(key, (versionA.values.get(key) || 0) - value);
    versionB.values.set(key, (versionB.values.get(key) || 0) + value);
  }

  for (const [key, value] of Object.entries(valuesB)) {
    if ((versionB.values.get(key) || 0) < value) {
      throw new Error(`The partnering node (version ${versionBIndex}) has insufficient ${key}.`);
    }

    versionB.values.set(key, (versionB.values.get(key) || 0) - value);
    versionA.values.set(key, (versionA.values.get(key) || 0) + value);
  }

  await nodeA.save();
  await nodeB.save();

  const transaction = new Transaction({
    nodeAId,
    nodeBId,
    versionAIndex,
    versionBIndex,
    valuesTraded: { nodeA: valuesA, nodeB: valuesB },
  });

  await transaction.save();

  //log for the node sending
  await logContribution({
    userId: userId,
    nodeId: nodeAId,
    action: "transaction",
    tradeId: transaction._id,
    nodeVersion: versionAIndex
  });

  //log for the node receiving
  await logContribution({
    userId: userId,
    nodeId: nodeBId,
    action: "transaction",
    tradeId: transaction._id,
    nodeVersion: versionBIndex
  });
};

const tradeValues = async (req, res) => {
  const { nodeAId, versionAIndex, valuesA, nodeBId, versionBIndex, valuesB } = req.body;
  const userId = req.userId;

  if (!nodeAId || versionAIndex === undefined || !valuesA || !nodeBId || versionBIndex === undefined || !valuesB) {
    return res.status(400).json({
      success: false,
      message: "Invalid request body. Ensure all required fields are provided.",
    });
  }

  try {
    await tradeValuesBetweenNodes(nodeAId, versionAIndex, valuesA, nodeBId, versionBIndex, valuesB, userId);
    return res.status(200).json({ success: true, message: "Trade completed successfully." });
  } catch (error) {
    console.error("Error during trade:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "An error occurred during the trade.",
    });
  }
};

module.exports = { getTransactions, tradeValues };
