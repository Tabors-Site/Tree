import { findNodeById, logContribution } from "../db/utils.js";

async function setValueForNode({ nodeId, key, value, version, userId }) {
  const versionIndex = Number(version);
  const numericValue = Number(value);

  if (
    isNaN(numericValue) ||
    (typeof value === "string" && value.includes("e"))
  ) {
    throw new Error("Value must be a valid number");
  }

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");

  if (node.versions[versionIndex] === undefined) {
    throw new Error("Version index does not exist");
  }

  const currentVersion = node.versions[versionIndex];

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

  return { message: "Value updated successfully." };
}

async function setGoalForNode({ nodeId, key, goal, version, userId }) {
  const versionIndex = version.toString();
  const numericGoal = Number(goal);

  if (isNaN(numericGoal) || (typeof goal === "string" && goal.includes("e"))) {
    throw new Error("Goal must be a valid number");
  }

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");

  if (node.versions[versionIndex] === undefined) {
    throw new Error("Version index does not exist");
  }

  const currentVersion = node.versions[versionIndex];

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

  return { message: "Goal updated successfully." };
}

export { setValueForNode, setGoalForNode };
