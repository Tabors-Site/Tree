import { findNodeById, logContribution } from "../db/utils.js";

const SYSTEM_KEY_PREFIX = "_auto";

function assertUserWritableKey(rawKey) {
  if (typeof rawKey !== "string") {
    throw new Error("Invalid key");
  }

  const key = rawKey.trim();

  if (!key.length) {
    throw new Error("Key cannot be empty");
  }

  if (key.startsWith(SYSTEM_KEY_PREFIX)) {
    throw new Error(
      "This key is reserved for system use and cannot be set by users"
    );
  }

  if (key.includes("\0") || key.includes("\n")) {
    throw new Error("Invalid key format");
  }

  // optional but recommended
  if (key.length > 128) {
    throw new Error("Key is too long");
  }

  return key;
}

async function setValueForNode({ nodeId, key, value, version, userId }) {
  key = assertUserWritableKey(key);

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
