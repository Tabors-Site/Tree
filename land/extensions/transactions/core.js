import Node from "../../seed/models/node.js";
import Contribution from "../../seed/models/contribution.js";

import Transaction from "./model.js";
import { logContribution } from "../../seed/tree/contributions.js";
import { resolveTreeAccess } from "../../seed/tree/treeAccess.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";

let useEnergy = async () => ({ energyUsed: 0 });
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

function getPolicy(node) {
  // Read from metadata first, fall back to schema field for migration period
  const meta = getExtMeta(node, "transactions");
  return meta.policy || node.transactionPolicy || "OWNER_ONLY";
}

function getPolicyFromLean(node) {
  // For .lean() results where metadata is a plain object
  const meta = node.metadata?.transactions || (node.metadata instanceof Map ? node.metadata.get("transactions") : null) || {};
  return meta.policy || node.transactionPolicy || "OWNER_ONLY";
}

function assertPositiveMap(map, label) {
  for (const [key, value] of map) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value for ${key}`);
    }
    if (value <= 0) {
      throw new Error(`${label} value for ${key} must be > 0`);
    }
  }
}
function assertNonNegativeTradeMap(input, label) {
  if (!input) return;

  // Case 1: Mongoose Map
  if (input instanceof Map) {
    for (const [key, value] of input.entries()) {
      validateValue(key, value, label);
    }
    return;
  }

  // Case 2: Plain object (from request body)
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      validateValue(key, value, label);
    }
    return;
  }

  throw new Error(`${label} values must be an object or Map`);
}

// Read node values from metadata (flat schema)
function getNodeValues(node) {
  return { ...getExtMeta(node, "values") };
}

// Write node values to metadata and save
async function setNodeValues(node, values) {
  await setExtMeta(node, "values", values);
  await node.save();
}

function hasTradeValues(input) {
  if (!input) return false;

  if (input instanceof Map) {
    return input.size > 0;
  }

  if (typeof input === "object") {
    return Object.keys(input).length > 0;
  }

  return false;
}

function validateValue(key, value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label} value for "${key}"`);
  }

  if (value < 0) {
    throw new Error(`Negative value not allowed for "${key}" on ${label}`);
  }

  if (value === 0) {
    throw new Error(`Zero value is not allowed for "${key}" on ${label}`);
  }
}

const ALLOWED_POLICIES = ["OWNER_ONLY", "ANYONE", "MAJORITY", "ALL"];

export async function setTransactionPolicy({ rootNodeId, policy, userId }) {
  if (!ALLOWED_POLICIES.includes(policy)) {
    throw new Error("Invalid transaction policy");
  }

  const root = await Node.findById(rootNodeId).select(
    "rootOwner parent metadata",
  );
  if (!root) {
    throw new Error("Root not found");
  }

  if (!root.rootOwner) {
    throw new Error("Not a root node");
  }

  if (root.rootOwner.toString() !== userId.toString()) {
    throw new Error("Only root owner can change transaction policy");
  }
  if (getPolicy(root) === policy) {
    throw new Error("This transaction policy is already set");
  }

  await setExtMeta(root, "transactions", { ...getExtMeta(root, "transactions"), policy });
  await root.save();

  return {
    rootId: rootNodeId,
    policy,
  };
}

const validateTransactionSides = ({ sideA, sideB }) => {
  const outsideCount =
    (sideA.kind === "OUTSIDE" ? 1 : 0) + (sideB.kind === "OUTSIDE" ? 1 : 0);

  if (outsideCount > 1) {
    throw new Error("Only one transaction side may be OUTSIDE.");
  }
};

export const createTransaction = async ({
  sideA,
  sideB,
  valuesA,
  valuesB,
  userId,
}) => {
  validateTransactionSides({ sideA, sideB });
  assertNonNegativeTradeMap(valuesA, "sideA");
  assertNonNegativeTradeMap(valuesB, "sideB");

  let nodeA = null;
  let nodeB = null;

  const hasA = hasTradeValues(valuesA);
  const hasB = hasTradeValues(valuesB);

  if (!hasA && !hasB) {
    throw new Error("Transaction must trade at least one value");
  }

  if (sideA.kind === "NODE") {
    nodeA = await Node.findById(sideA.nodeId);
    if (!nodeA) throw new Error("Node A not found");
  }

  if (sideB.kind === "NODE") {
    nodeB = await Node.findById(sideB.nodeId);
    if (!nodeB) throw new Error("Node B not found");
  }

  if (
    sideA.kind === "NODE" &&
    sideB.kind === "NODE" &&
    String(sideA.nodeId) === String(sideB.nodeId)
  ) {
    throw new Error("Transactions between the same node are not allowed");
  }

  if (sideA.kind === "NODE") {
    await resolveTreeAccess(sideA.nodeId, userId);
  }

  if (sideB.kind === "NODE") {
    await resolveTreeAccess(sideB.nodeId, userId);
  }

  const approvalGroups = await buildApprovalGroups({ sideA, sideB }, userId);

  const allResolved = approvalGroups.every((g) => g.resolved);

  const { energyUsed } = await useEnergy({
    userId,
    action: "transaction",
  });

  const transaction = await Transaction.create({
    sideA,
    sideB,
    versionAIndex: 0,
    versionBIndex: 0,
    valuesTraded: {
      sideA: valuesA,
      sideB: valuesB,
    },
    approvalGroups,
    status: allResolved ? "accepted" : "pending",
  });
  if (nodeA) {
    await logContribution({
      userId,
      nodeId: nodeA._id,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "created",
        side: "A",
        role: "proposer",
        counterpartyNodeId: nodeB?._id ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId: userId,
      },
      energyUsed,
    });
  }

  if (nodeB) {
    await logContribution({
      userId,
      nodeId: nodeB._id,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "created",
        side: "B",
        role: "counterparty",
        counterpartyNodeId: nodeA?._id ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId: userId,
      },
      energyUsed,
    });
  }

  if (transaction.status === "accepted") {
    await executeTransaction(transaction, userId);
  }

  return transaction;
};

export async function getTransactions({
  nodeId,
  version,
  includePending = false,
  userId,
}) {
  if (!nodeId) throw new Error("nodeId is required");

  const statusFilter = includePending
    ? { $in: ["pending", "accepted", "rejected"] }
    : "accepted";

  const txs = await Transaction.find({
    $or: [{ "sideA.nodeId": nodeId }, { "sideB.nodeId": nodeId }],
    status: statusFilter,
  })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  const formatted = [];

  for (const tx of txs) {
    const viewerApprovals = tx.approvalGroups.filter((g) =>
      g.eligibleApprovers.includes(String(userId)),
    );

    const viewerAlreadyApproved = viewerApprovals.some((g) =>
      g.approvals.some((a) => a.userId === String(userId)),
    );

    const canApprove =
      tx.status === "pending" &&
      viewerApprovals.length > 0 &&
      !viewerAlreadyApproved;

    const isA = tx.sideA?.nodeId === nodeId;
    const isB = tx.sideB?.nodeId === nodeId;

    if (!isA && !isB) continue;

    const selfSide = isA ? "A" : "B";
    const otherSide = isA ? "B" : "A";

    const selfVersion = 0;

    const counterpartyNodeId = tx[`side${otherSide}`]?.nodeId ?? null;

    const counterparty = counterpartyNodeId
      ? await Node.findById(counterpartyNodeId).select("name").lean()
      : null;

    const approvalSummary = tx.approvalGroups
      .map((g) => ({
        policy: g.policy,
        required: g.requiredApprovals,
        approved: g.approvals.length,
        resolved: g.resolved,
        isViewerGroup: g.eligibleApprovers.includes(String(userId)),
      }))
      .sort((a, b) => (b.isViewerGroup ? 1 : 0) - (a.isViewerGroup ? 1 : 0));
    formatted.push({
      _id: tx._id,
      createdAt: tx.createdAt,
      perspective: isA ? "nodeA" : "nodeB",
      canApprove,
      canDeny: canApprove,
      versionSelf: 0,
      versionCounterparty: 0,
      valuesSent: tx.valuesTraded[`side${selfSide}`] ?? {},
      valuesReceived: tx.valuesTraded[`side${otherSide}`] ?? {},
      counterparty,
      status: tx.status,
      approvalSummary,
    });
  }

  return {
    transactions: formatted,
  };
}

export async function executeTransaction(transaction, userId) {
  // 0) Basic guards
  if (!transaction) throw new Error("Transaction is required");

  if (transaction.executedAt) {
    throw new Error("Transaction already executed");
  }

  if (transaction.status !== "accepted") {
    throw new Error("Transaction is not accepted");
  }

  const { sideA, sideB, valuesTraded } =
    transaction;

  // 1) Normalize traded values
  const sideAObj =
    valuesTraded?.sideA instanceof Map
      ? Object.fromEntries(valuesTraded.sideA.entries())
      : (valuesTraded?.sideA ?? {});

  const sideBObj =
    valuesTraded?.sideB instanceof Map
      ? Object.fromEntries(valuesTraded.sideB.entries())
      : (valuesTraded?.sideB ?? {});

  assertPositiveMap(Object.entries(sideAObj), "sideA");
  assertPositiveMap(Object.entries(sideBObj), "sideB");

  // 2) Load nodes
  let nodeA = null;
  let nodeB = null;

  if (sideA?.kind === "NODE") {
    nodeA = await Node.findById(sideA.nodeId);
    if (!nodeA) throw new Error("Node A not found");
  }

  if (sideB?.kind === "NODE") {
    nodeB = await Node.findById(sideB.nodeId);
    if (!nodeB) throw new Error("Node B not found");
  }

  // 3) Validate versions
  // 4) Pre-check balances
  if (nodeA && nodeB) {
    const vA = getNodeValues(nodeA);
    const vB = getNodeValues(nodeB);

    for (const [k, v] of Object.entries(sideAObj)) {
      if ((vA[k] || 0) < v) {
        throw new Error(`Insufficient ${k} for node A`);
      }
    }

    for (const [k, v] of Object.entries(sideBObj)) {
      if ((vB[k] || 0) < v) {
        throw new Error(`Insufficient ${k} for node B`);
      }
    }
  }

  // 5) execution_started contributions
  if (nodeA) {
    await logContribution({
      userId,
      nodeId: nodeA._id,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "execution_started",
        side: "A",
        role: "sender",
        counterpartyNodeId: nodeB?._id ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId: userId,
      },
    });
  }

  if (nodeB) {
    await logContribution({
      userId,
      nodeId: nodeB._id,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "execution_started",
        side: "B",
        role: "receiver",
        counterpartyNodeId: nodeA?._id ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId: userId,
      },
    });
  }

  // 6) MUTATION + PERSISTENCE (ATOMIC)
  try {
    // NODE ↔ NODE
    if (nodeA && nodeB) {
      const vA = getNodeValues(nodeA);
      const vB = getNodeValues(nodeB);

      for (const [k, v] of Object.entries(sideAObj)) {
        vA[k] = (vA[k] || 0) - v;
        vB[k] = (vB[k] || 0) + v;
      }

      for (const [k, v] of Object.entries(sideBObj)) {
        vB[k] = (vB[k] || 0) - v;
        vA[k] = (vA[k] || 0) + v;
      }

      await setNodeValues(nodeA, vA);
      await setNodeValues(nodeB, vB);
    }

    // NODE ↔ OUTSIDE (A sends)
    if (nodeA && !nodeB) {
      const vA = getNodeValues(nodeA);
      for (const [k, v] of Object.entries(sideAObj)) {
        vA[k] = (vA[k] || 0) - v;
      }
      await setNodeValues(nodeA, vA);
    }

    // NODE ↔ OUTSIDE (B receives)
    if (!nodeA && nodeB) {
      const vB = getNodeValues(nodeB);
      for (const [k, v] of Object.entries(sideBObj)) {
        vB[k] = (vB[k] || 0) + v;
      }
      await setNodeValues(nodeB, vB);
    }

    transaction.executedAt = new Date();
    await transaction.save();
  } catch (err) {
    transaction.status = "rejected";
    await transaction.save();

    if (nodeA) {
      await logContribution({
        userId,
        nodeId: nodeA._id,
        action: "transaction",
        tradeId: transaction._id,
        nodeVersion: "0",
        transactionMeta: {
          event: "failed",
          side: "A",
          role: "sender",
          counterpartyNodeId: nodeB?._id ?? null,
          versionSelf: "0",
          versionCounterparty: "0",
          valuesSent: sideAObj,
          valuesReceived: sideBObj ?? {},
          failureReason: err.message,
          actorUserId: userId,
        },
      });
    }

    if (nodeB) {
      await logContribution({
        userId,
        nodeId: nodeB._id,
        action: "transaction",
        tradeId: transaction._id,
        nodeVersion: "0",
        transactionMeta: {
          event: "failed",
          side: "B",
          role: "receiver",
          counterpartyNodeId: nodeA?._id ?? null,
          versionSelf: "0",
          versionCounterparty: "0",
          valuesSent: sideBObj ?? {},
          valuesReceived: sideAObj ?? {},
          failureReason: err.message,
          actorUserId: userId,
        },
      });
    }

    throw err;
  }

  // 7) SUCCESS contributions
  if (nodeA) {
    await logContribution({
      userId,
      nodeId: nodeA._id,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "succeeded",
        side: "A",
        role: "sender",
        counterpartyNodeId: nodeB?._id ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        valuesSent: sideAObj,
        valuesReceived: sideBObj ?? {},
        actorUserId: userId,
      },
    });
  }

  if (nodeB) {
    await logContribution({
      userId,
      nodeId: nodeB._id,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "succeeded",
        side: "B",
        role: "receiver",
        counterpartyNodeId: nodeA?._id ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        valuesSent: sideBObj ?? {},
        valuesReceived: sideAObj ?? {},
        actorUserId: userId,
      },
    });
  }

  return transaction;
}

/**
 * Build approval groups for each NODE side
 */
export async function buildApprovalGroups({ sideA, sideB }, userId) {
  const approvalGroups = [];

  for (const side of [sideA, sideB]) {
    if (side.kind !== "NODE") continue;

    const access = await resolveTreeAccess(side.nodeId, userId);

    const rootNode = await Node.findById(access.rootId)
      .select("rootOwner contributors metadata")
      .lean()
      .exec();

    if (!rootNode) {
      throw new Error("Root node not found");
    }

    const owner = rootNode.rootOwner;
    const contributors = rootNode.contributors ?? [];
    const policy = getPolicyFromLean(rootNode);

    const members = [owner, ...contributors].map(String);

    let eligibleApprovers;
    let requiredApprovals;

    switch (policy) {
      case "OWNER_ONLY":
        eligibleApprovers = [String(owner)];
        requiredApprovals = 1;
        break;

      case "ANYONE":
        eligibleApprovers = members;
        requiredApprovals = 1;
        break;

      case "MAJORITY":
        eligibleApprovers = members;
        requiredApprovals = Math.ceil(members.length / 2);
        break;

      case "ALL":
        eligibleApprovers = members;
        requiredApprovals = members.length;
        break;

      default:
        throw new Error("Invalid transaction policy");
    }

    const approvals = [];

    // Proposer auto-approves if eligible
    if (eligibleApprovers.includes(String(userId))) {
      approvals.push({ userId: String(userId), approvedAt: new Date() });
    }

    approvalGroups.push({
      rootId: access.rootId,
      policy,
      eligibleApprovers,
      requiredApprovals,
      approvals,
      resolved: approvals.length >= requiredApprovals,
      side: side === sideA ? "A" : "B",
    });
  }

  return approvalGroups;
}

export async function applyApproval(transactionId, userId) {
  const transaction = await Transaction.findById(transactionId);
  const { sideA, sideB, valuesTraded } =
    transaction;

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  if (transaction.status !== "pending") {
    throw new Error("Transaction is not pending");
  }

  let approvedSomething = false;

  for (const group of transaction.approvalGroups) {
    if (group.resolved) continue;

    if (!group.eligibleApprovers.includes(String(userId))) {
      continue;
    }

    const alreadyApproved = group.approvals.some(
      (a) => a.userId === String(userId),
    );

    if (alreadyApproved) continue;

    group.approvals.push({
      userId: String(userId),
      approvedAt: new Date(),
    });

    await logContribution({
      userId,
      nodeId: group.side === "A" ? sideA.nodeId : sideB.nodeId,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event: "approved",
        side: group.side,
        role: "approver",
        counterpartyNodeId:
          group.side === "A"
            ? (sideB?.nodeId ?? null)
            : (sideA?.nodeId ?? null),
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId: userId,
      },
    });

    if (group.approvals.length >= group.requiredApprovals) {
      group.resolved = true;
    }

    approvedSomething = true;
  }

  if (!approvedSomething) {
    throw new Error("User is not eligible to approve this transaction");
  }

  await transaction.save();

  if (checkAllGroupsResolved(transaction)) {
    transaction.status = "accepted";
    await transaction.save();

    await logResolution(transaction, "accepted", userId);

    try {
      await executeTransaction(transaction, userId);
    } catch (err) {
      throw err;
    }
  }

  return transaction;
}

export async function denyTransaction(transactionId, userId) {
  const tx = await Transaction.findById(transactionId);
  if (!tx) throw new Error("Transaction not found");
  if (tx.status !== "pending") {
    throw new Error("Transaction is not pending");
  }

  let deniedSomething = false;

  for (const group of tx.approvalGroups) {
    if (group.resolved) continue;
    if (!group.eligibleApprovers.includes(String(userId))) continue;

    const alreadyApproved = group.approvals.some(
      (a) => a.userId === String(userId),
    );
    if (alreadyApproved) {
      throw new Error("User has already approved and cannot deny");
    }

    const alreadyDenied = group.denials?.some(
      (d) => d.userId === String(userId),
    );
    if (alreadyDenied) continue;

    // ✅ Store denial
    group.denials = group.denials || [];
    group.denials.push({
      userId: String(userId),
      deniedAt: new Date(),
    });

    deniedSomething = true;

    // ✅ Recompute group resolution
    if (checkGroupFailure(group)) {
      group.resolved = true;
    }

    // ✅ Log denial for BOTH sides (if NODE)
    if (tx.sideA.kind === "NODE") {
      await logContribution({
        userId,
        nodeId: tx.sideA.nodeId,
        action: "transaction",
        tradeId: tx._id,
        nodeVersion: "0",
        transactionMeta: {
          event: "denied",
          side: "A",
          role: "denier",
          counterpartyNodeId: tx.sideB?.nodeId ?? null,
          versionSelf: "0",
          versionCounterparty: "0",
          actorUserId: userId,
        },
      });
    }

    if (tx.sideB.kind === "NODE") {
      await logContribution({
        userId,
        nodeId: tx.sideB.nodeId,
        action: "transaction",
        tradeId: tx._id,
        nodeVersion: "0",
        transactionMeta: {
          event: "denied",
          side: "B",
          role: "denier",
          counterpartyNodeId: tx.sideA?.nodeId ?? null,
          versionSelf: "0",
          versionCounterparty: "0",
          actorUserId: userId,
        },
      });
    }
  }

  if (!deniedSomething) {
    throw new Error("User is not eligible to deny this transaction");
  }

  // ✅ Derive transaction status (NOT forced)
  const anyGroupFailed = tx.approvalGroups.some(checkGroupFailure);

  if (anyGroupFailed) {
    tx.status = "rejected";
    await logResolution(tx, "rejected", userId);
  }

  await tx.save();
  return tx;
}

async function logResolution(transaction, outcome, actorUserId) {
  const { sideA, sideB } = transaction;
  if (transaction.executedAt) return;

  const event =
    outcome === "accepted" ? "accepted_by_policy" : "rejected_by_policy";

  if (sideA.kind === "NODE") {
    await logContribution({
      userId: actorUserId,
      nodeId: sideA.nodeId,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event,
        side: "A",
        role: "system",
        counterpartyNodeId: sideB?.nodeId ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId,
      },
    });
  }

  if (sideB.kind === "NODE") {
    await logContribution({
      userId: actorUserId,
      nodeId: sideB.nodeId,
      action: "transaction",
      tradeId: transaction._id,
      nodeVersion: "0",
      transactionMeta: {
        event,
        side: "B",
        role: "system",
        counterpartyNodeId: sideA?.nodeId ?? null,
        versionSelf: "0",
        versionCounterparty: "0",
        actorUserId,
      },
    });
  }
}

function checkGroupFailure(group) {
  const denyCount = group.denials?.length ?? 0;
  const memberCount = group.eligibleApprovers.length;

  switch (group.policy) {
    case "OWNER_ONLY":
    case "ANYONE":
    case "ALL":
      return denyCount > 0;

    case "MAJORITY":
      return denyCount >= Math.ceil(memberCount / 2);

    default:
      return false;
  }
}

export function checkAllGroupsResolved(transaction) {
  if (!transaction.approvalGroups.length) return true;

  return transaction.approvalGroups.every((g) => g.resolved === true);
}

export async function getTransactionWithContributions(transactionId) {
  if (!transactionId) {
    throw new Error("transactionId is required");
  }

  const transaction = await Transaction.findById(transactionId).lean();
  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const contributions = await Contribution.find({
    tradeId: transactionId, // rename later if you migrate
  })
    .sort({ date: 1 })
    .populate({
      path: "userId",
      select: "_id username", // adjust fields as needed
    })
    .lean();

  return {
    transaction,
    contributions,
  };
}
