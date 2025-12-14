import Transaction from "../db/models/transaction.js";

async function getTransactions({ nodeId, version }) {
  if (!nodeId) {
    throw new Error("Missing required parameter: nodeId");
  }

  if (typeof version !== "number" || isNaN(version)) {
    throw new Error("Invalid or missing version: must be a number");
  }

  const transactions = await Transaction.find({
    $or: [
      { nodeAId: nodeId, versionAIndex: version },
      { nodeBId: nodeId, versionBIndex: version },
    ],
  })
    .populate("nodeAId")
    .populate("nodeBId")
    .lean()
    .exec();

  if (!transactions || transactions.length === 0) {
    return {
      message: `No transactions found for node ${nodeId} (version ${version})`,
      transactions: [],
    };
  }

  const normalized = transactions.map((tx) => {
    const isNodeA = String(tx.nodeAId?._id) === String(nodeId);

    return {
      ...tx,
      perspective: isNodeA ? "nodeA" : "nodeB",
      nodeVersion: version,
      counterparty: isNodeA ? tx.nodeBId : tx.nodeAId,
      valuesSent: isNodeA
        ? tx.valuesTraded?.nodeA ?? {}
        : tx.valuesTraded?.nodeB ?? {},
      valuesReceived: isNodeA
        ? tx.valuesTraded?.nodeB ?? {}
        : tx.valuesTraded?.nodeA ?? {},
    };
  });

  return {
    message: "Transactions retrieved successfully",
    transactions: normalized,
  };
}

export { getTransactions };
