import { findNodeById, logContribution } from "../db/utils.js";
import { useEnergy } from "../core/energy.js";

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

  const { energyUsed } = await useEnergy({
    userId,
    action: "editValue",
  });

  currentVersion.values.set(finalKey, value);

  await node.save();
  await logContribution({
    userId,
    nodeId,
    action: "editValue",
    valueEdited: { [finalKey]: value },
    nodeVersion: versionIndex,
    energyUsed,
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
  const { energyUsed } = await useEnergy({
    userId,
    action: "editGoal",
  });

  currentVersion.goals.set(finalKey, goal);

  await node.save();
  await logContribution({
    userId,
    nodeId,
    action: "editGoal",
    goalEdited: { [finalKey]: goal },
    nodeVersion: versionIndex,
    energyUsed,
  });

  return { message: "Goal updated successfully." };
}

function stripAutoPrefixFromObject(obj) {
  const out = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_auto__")) {
      const base = key.slice("_auto__".length);
      out[`AUTO_${base}`] = value; // ← system key preserved
    } else {
      out[key] = value; // ← user key preserved
    }
  }

  return out;
}

function mergeSummedValues(target, source) {
  if (!(source instanceof Map)) return;

  for (const [key, value] of source.entries()) {
    const numeric = Number(value);
    if (isNaN(numeric)) continue;

    const existingKey = findExistingKey(target, key);
    const finalKey = existingKey ?? key;

    target.set(finalKey, (target.get(finalKey) ?? 0) + numeric);
  }
}

function collectNodeVersionValues(node) {
  const sum = new Map();

  for (const version of node.versions || []) {
    if (!version?.values) continue;
    mergeSummedValues(sum, version.values);
  }

  return sum;
}

async function getGlobalValuesTreeAndFlat(rootNodeId) {
  const root = await findNodeById(rootNodeId);
  if (!root) throw new Error("Node not found");

  const flatTotals = new Map();

  async function build(node) {
    // 1️⃣ local raw values
    const localValues = collectNodeVersionValues(node);

    // 2️⃣ accumulated starts with local
    const accumulated = new Map(localValues);

    // 3️⃣ recurse children
    const children = [];
    for (const childId of node.children || []) {
      const child = await findNodeById(childId);
      if (!child) continue;

      const childResult = await build(child);
      children.push(childResult.node);

      // merge child accumulated raw values
      mergeSummedValues(accumulated, childResult.accumulated);
    }

    // 4️⃣ flat totals count local once
    mergeSummedValues(flatTotals, localValues);

    return {
      node: {
        nodeId: node._id.toString(),
        nodeName: node.name,

        // ✅ BOTH exposed
        localValues: stripAutoPrefixFromObject(Object.fromEntries(localValues)),
        totalValues: stripAutoPrefixFromObject(Object.fromEntries(accumulated)),

        children,
      },
      accumulated, // raw Map returned upward
    };
  }

  const { node: tree } = await build(root);

  return {
    flat: stripAutoPrefixFromObject(Object.fromEntries(flatTotals)),
    tree,
  };
}

export { setValueForNode, setGoalForNode, getGlobalValuesTreeAndFlat };
