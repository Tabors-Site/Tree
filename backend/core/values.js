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
function findExistingKey(map, incomingKey) {
  if (!map) return null;

  const lower = incomingKey.toLowerCase();

  for (const existingKey of map.keys()) {
    if (existingKey.toLowerCase() === lower) {
      return existingKey; // return the ORIGINAL stored key
    }
  }

  return null;
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

  const currentVersion = node.versions?.[versionIndex];
  if (!currentVersion) {
    throw new Error("Version index does not exist");
  }

  if (!currentVersion.values) {
    currentVersion.values = new Map();
  }

  // 🔑 CASE-INSENSITIVE CHECK
  const existingKey = findExistingKey(currentVersion.values, key);
  const finalKey = existingKey ?? key;

  currentVersion.values.set(finalKey, value);

  await node.save();
  await logContribution({
    userId,
    nodeId,
    action: "editValue",
    valueEdited: { [finalKey]: value },
    nodeVersion: versionIndex,
    tradeId: null,
  });

  return { message: "Value updated successfully." };
}

async function setGoalForNode({ nodeId, key, goal, version, userId }) {
  const versionIndex = Number(version);
  const numericGoal = Number(goal);

  if (isNaN(numericGoal) || (typeof goal === "string" && goal.includes("e"))) {
    throw new Error("Goal must be a valid number");
  }

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");

  const currentVersion = node.versions?.[versionIndex];
  if (!currentVersion) {
    throw new Error("Version index does not exist");
  }

  if (!currentVersion.goals) {
    currentVersion.goals = new Map();
  }

  // 🔑 CASE-INSENSITIVE CHECK
  const existingKey = findExistingKey(currentVersion.goals, key);
  const finalKey = existingKey ?? key;

  currentVersion.goals.set(finalKey, goal);

  await node.save();
  await logContribution({
    userId,
    nodeId,
    action: "editGoal",
    goalEdited: { [finalKey]: goal },
    nodeVersion: versionIndex,
    tradeId: null,
  });

  return { message: "Goal updated successfully." };
}

export { setValueForNode, setGoalForNode };
