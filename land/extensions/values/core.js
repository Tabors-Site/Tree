// Services wired from init() via setServices()
let Node = null;
let logContribution = async () => {};
let useEnergy = async () => ({ energyUsed: 0 });
let _metadata = null;

export function setServices({ models, contributions, metadata }) {
  Node = models.Node;
  logContribution = contributions.logContribution;
  if (metadata) _metadata = metadata;
}
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

async function findNodeById(id) { return Node.findById(id).populate("children"); }

const SYSTEM_KEY_PREFIX = "_auto";

function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}

function assertUserWritableKey(rawKey) {
  if (typeof rawKey !== "string") throw new Error("Invalid key");
  const key = rawKey.trim();
  if (!key.length) throw new Error("Key cannot be empty");
  if (key.startsWith(SYSTEM_KEY_PREFIX)) throw new Error("This key is reserved for system use and cannot be set by users");
  if (key.includes("\0") || key.includes("\n")) throw new Error("Invalid key format");
  if (key.length > 128) throw new Error("Key is too long");
  if (containsHtml(key)) throw new Error("Key cannot contain HTML tags");
  return key;
}

function findExistingKey(obj, incomingKey) {
  if (!obj) return null;
  const lower = incomingKey.toLowerCase();
  const keys = obj instanceof Map ? obj.keys() : Object.keys(obj);
  for (const existingKey of keys) {
    if (existingKey.toLowerCase() === lower) return existingKey;
  }
  return null;
}

const truncate6 = (n) => Math.trunc(n * 1e6) / 1e6;

function getNodeValues(node) {
  return { ..._metadata.getExtMeta(node, "values") };
}

async function setNodeValues(node, values) {
  await _metadata.setExtMeta(node, "values", values);
}

function getNodeGoals(node) {
  return { ..._metadata.getExtMeta(node, "goals") };
}

async function setValueForNode({
  nodeId,
  key,
  value,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  key = assertUserWritableKey(key);
  if (key.length > 60) throw new Error("Title must be 60 characters or less");

  let numericValue = Number(value);
  if (isNaN(numericValue) || (typeof value === "string" && value.includes("e"))) {
    throw new Error("Value must be a valid number");
  }
  if (Math.abs(numericValue) > 10_000_000_000) throw new Error("Number must be less than 10 billion");
  numericValue = truncate6(numericValue);

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const values = getNodeValues(node);
  const existingKey = findExistingKey(values, key);
  const finalKey = existingKey ?? key;

  const { energyUsed } = await useEnergy({ userId, action: "editValue" });

  values[finalKey] = numericValue;
  await _metadata.setExtMeta(node, "values", values);

  await logContribution({
    userId, nodeId, wasAi, chatId, sessionId,
    action: "editValue",
    valueEdited: { [finalKey]: numericValue },
    nodeVersion: "0",
    energyUsed,
  });

  return { message: "Value updated successfully." };
}

async function setGoalForNode({
  nodeId,
  key,
  goal,
  userId,
  wasAi = false,
  chatId = null,
  sessionId = null,
}) {
  key = assertUserWritableKey(key);
  if (key.length > 60) throw new Error("Title must be 60 characters or less");

  let numericGoal = Number(goal);
  if (isNaN(numericGoal) || (typeof goal === "string" && goal.includes("e"))) {
    throw new Error("Goal must be a valid number");
  }
  if (Math.abs(numericGoal) > 10_000_000_000) throw new Error("Number must be less than 10 billion");
  numericGoal = truncate6(numericGoal);

  const node = await findNodeById(nodeId);
  if (!node) throw new Error("Node not found");
  if (node.systemRole) throw new Error("Cannot modify system nodes");

  const values = getNodeValues(node);
  const valueKey = findExistingKey(values, key);
  if (!valueKey) throw new Error("Goal must match an existing value");

  const goals = getNodeGoals(node);
  const existingKey = findExistingKey(goals, key);
  const finalKey = existingKey ?? key;

  const { energyUsed } = await useEnergy({ userId, action: "editGoal" });

  goals[finalKey] = numericGoal;
  await _metadata.setExtMeta(node, "goals", goals);

  await logContribution({
    userId, nodeId, wasAi, chatId, sessionId,
    action: "editGoal",
    goalEdited: { [finalKey]: numericGoal },
    nodeVersion: "0",
    energyUsed,
  });

  return { message: "Goal updated successfully." };
}

function stripAutoPrefixFromObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_auto__")) {
      out[`AUTO_${key.slice("_auto__".length)}`] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function mergeSummedValues(target, source) {
  const entries = source instanceof Map ? source.entries() : Object.entries(source);
  for (const [key, value] of entries) {
    const numeric = Number(value);
    if (isNaN(numeric)) continue;
    const existingKey = findExistingKey(target, key);
    const finalKey = existingKey ?? key;
    target[finalKey] = (target[finalKey] ?? 0) + numeric;
  }
}

function collectNodeValues(node) {
  const values = getNodeValues(node);
  return values;
}

async function getGlobalValuesTreeAndFlat(rootNodeId) {
  const root = await findNodeById(rootNodeId);
  if (!root) throw new Error("Node not found");

  const flatTotals = {};

  async function build(node) {
    const localValues = collectNodeValues(node);
    const accumulated = { ...localValues };

    const children = [];
    for (const childId of node.children || []) {
      const child = await findNodeById(childId);
      if (!child) continue;

      const childResult = await build(child);
      children.push(childResult.node);
      mergeSummedValues(accumulated, childResult.accumulated);
    }

    mergeSummedValues(flatTotals, localValues);

    return {
      node: {
        nodeId: node._id.toString(),
        nodeName: node.name,
        localValues: stripAutoPrefixFromObject(localValues),
        totalValues: stripAutoPrefixFromObject(accumulated),
        children,
      },
      accumulated,
    };
  }

  const { node: tree } = await build(root);

  return {
    flat: stripAutoPrefixFromObject(flatTotals),
    tree,
  };
}

export {
  setValueForNode,
  setGoalForNode,
  getGlobalValuesTreeAndFlat,
  getNodeValues,
  setNodeValues,
  getNodeGoals,
  stripAutoPrefixFromObject,
  collectNodeValues,
  findExistingKey,
};
