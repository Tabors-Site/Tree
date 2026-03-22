import { findNodeById, logContribution } from "../../db/utils.js";
// Energy: dynamic import, no-op if extension not installed
let useEnergy = async () => ({ energyUsed: 0 });
try { ({ useEnergy } = await import("../../extensions/energy/core.js")); } catch {}

const SYSTEM_KEY_PREFIX = "_auto";
function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}
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
      "This key is reserved for system use and cannot be set by users",
    );
  }

  if (key.includes("\0") || key.includes("\n")) {
    throw new Error("Invalid key format");
  }

  // optional but recommended
  if (key.length > 128) {
    throw new Error("Key is too long");
  }
  if (containsHtml(key)) {
    throw new Error("Key cannot contain HTML tags");
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
const truncate6 = (n) => Math.trunc(n * 1e6) / 1e6;

async function setValueForNode({
  nodeId,
  key,
  value,
  version,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  key = assertUserWritableKey(key);
  if (key.length > 60) throw new Error("Title must be 60 characters or less");

  const versionIndex = Number(version);
  let numericValue = Number(value);

  if (
    isNaN(numericValue) ||
    (typeof value === "string" && value.includes("e"))
  ) {
    throw new Error("Value must be a valid number");
  }

  if (Math.abs(numericValue) > 10_000_000_000)
    throw new Error("Number must be less than 10 billion");
  numericValue = truncate6(numericValue);

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.isSystem) throw new Error("Cannot modify system nodes");

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

  currentVersion.values.set(finalKey, numericValue);

  await node.save();
  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "editValue",
    valueEdited: { [finalKey]: numericValue },
    nodeVersion: versionIndex,
    energyUsed,
  });

  return { message: "Value updated successfully." };
}

async function setGoalForNode({
  nodeId,
  key,
  goal,
  version,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  const versionIndex = Number(version);
  let numericGoal = Number(goal);

  key = assertUserWritableKey(key);
  if (key.length > 60) throw new Error("Title must be 60 characters or less");

  if (isNaN(numericGoal) || (typeof goal === "string" && goal.includes("e"))) {
    throw new Error("Goal must be a valid number");
  }
  if (Math.abs(numericGoal) > 10_000_000_000)
    throw new Error("Number must be less than 10 billion");
  numericGoal = truncate6(numericGoal);

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const currentVersion = node.versions?.[versionIndex];

  if (!currentVersion) {
    throw new Error("Version index does not exist");
  }
  if (!currentVersion.values) {
    throw new Error("Cannot set a goal without an existing value");
  }

  const valueKey = findExistingKey(currentVersion.values, key);
  if (!valueKey) {
    throw new Error("Goal must match an existing value");
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

  currentVersion.goals.set(finalKey, numericGoal);

  await node.save();
  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "editGoal",
    goalEdited: { [finalKey]: numericGoal },
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
