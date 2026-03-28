/**
 * Food Core
 *
 * Parse food input, scaffold tree structure, deliver cascade signals,
 * daily reset, and macro reading. The tree does the orchestration.
 */

import log from "../../seed/log.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

// ── Dependencies (set by configure) ──

let _Node = null;
let _runChat = null;
let _hooks = null;

export function configure({ Node, runChat, hooks }) {
  _Node = Node;
  _runChat = runChat;
  _hooks = hooks;
}

// ── Food node roles ──

const ROLES = { LOG: "log", PROTEIN: "protein", CARBS: "carbs", FATS: "fats", DAILY: "daily" };

// ── Tree scaffold ──

/**
 * Create the food tree structure under a root node.
 * Returns the node IDs for each role.
 */
export async function scaffold(foodRootId, userId) {
  if (!_Node) throw new Error("Food core not configured");

  const { createNode } = await import("../../seed/tree/treeManagement.js");

  // Create the five child nodes
  const logNode = await createNode("Log", null, null, foodRootId, false, userId);
  const proteinNode = await createNode("Protein", null, null, foodRootId, false, userId);
  const carbsNode = await createNode("Carbs", null, null, foodRootId, false, userId);
  const fatsNode = await createNode("Fats", null, null, foodRootId, false, userId);
  const dailyNode = await createNode("Daily", null, null, foodRootId, false, userId);

  // Tag each node with its food role
  const nodes = [
    { node: logNode, role: ROLES.LOG },
    { node: proteinNode, role: ROLES.PROTEIN },
    { node: carbsNode, role: ROLES.CARBS },
    { node: fatsNode, role: ROLES.FATS },
    { node: dailyNode, role: ROLES.DAILY },
  ];

  for (const { node, role } of nodes) {
    await setExtMeta(node, "food", { role });
  }

  // Set mode overrides so chat at Log uses food-log, chat at Daily uses food-daily
  // Mode overrides: set on the food root (so parent classifiers find it)
  // and on Log/Daily nodes (so direct chat uses the right mode)
  await _Node.updateOne({ _id: foodRootId }, { $set: { "metadata.modes.respond": "tree:food-log" } });
  await _Node.updateOne({ _id: logNode._id }, { $set: { "metadata.modes.respond": "tree:food-log" } });
  await _Node.updateOne({ _id: dailyNode._id }, { $set: { "metadata.modes.respond": "tree:food-daily" } });

  // Create channels: Log -> each macro node
  try {
    const { getExtension } = await import("../loader.js");
    const channelsExt = getExtension("channels");
    if (channelsExt?.exports?.createChannel) {
      const create = channelsExt.exports.createChannel;
      await create({ sourceNodeId: String(logNode._id), targetNodeId: String(proteinNode._id), channelName: "protein-log", direction: "outbound", filter: { tags: ["protein"] }, userId });
      await create({ sourceNodeId: String(logNode._id), targetNodeId: String(carbsNode._id), channelName: "carbs-log", direction: "outbound", filter: { tags: ["carbs"] }, userId });
      await create({ sourceNodeId: String(logNode._id), targetNodeId: String(fatsNode._id), channelName: "fats-log", direction: "outbound", filter: { tags: ["fats"] }, userId });
      log.info("Food", "Channels created: protein-log, carbs-log, fats-log");
    } else {
      log.warn("Food", "Channels extension not available. Cascade routing will use direct delivery.");
    }
  } catch (err) {
    log.warn("Food", `Channel creation failed: ${err.message}. Using direct delivery.`);
  }

  // Mark root as initialized
  const rootNode = await _Node.findById(foodRootId);
  if (rootNode) {
    await setExtMeta(rootNode, "food", { initialized: true });
  }

  const ids = {
    log: String(logNode._id),
    protein: String(proteinNode._id),
    carbs: String(carbsNode._id),
    fats: String(fatsNode._id),
    daily: String(dailyNode._id),
  };

  // ── Fitness-Food channel ──
  // If fitness is a sibling (same parent tree), wire a bidirectional channel
  // so the food AI sees workouts and the fitness AI sees nutrition.
  try {
    const rootDoc = await _Node.findById(foodRootId).select("parent").lean();
    if (rootDoc?.parent) {
      const siblings = await _Node.find({ parent: rootDoc.parent }).select("_id metadata").lean();
      for (const sib of siblings) {
        const sibMeta = sib.metadata instanceof Map
          ? sib.metadata.get("fitness")
          : sib.metadata?.fitness;
        if (sibMeta?.initialized) {
          // Found fitness tree. Find its Log node.
          const fitChildren = await _Node.find({ parent: sib._id }).select("_id metadata").lean();
          const fitLog = fitChildren.find(c => {
            const fm = c.metadata instanceof Map ? c.metadata.get("fitness") : c.metadata?.fitness;
            return fm?.role === "log";
          });
          if (fitLog) {
            const { getExtension } = await import("../loader.js");
            const ch = getExtension("channels");
            if (ch?.exports?.createChannel) {
              await ch.exports.createChannel({
                sourceNodeId: String(dailyNode._id),
                targetNodeId: String(fitLog._id),
                channelName: "food-fitness",
                direction: "bidirectional",
                filter: { tags: ["nutrition", "workout"] },
                userId,
              });
              log.info("Food", "Channel created: food-fitness (bidirectional with Fitness/Log)");
            }
          }
          break;
        }
      }
    }
  } catch (err) {
    log.verbose("Food", `Fitness channel not created: ${err.message}`);
  }

  log.info("Food", `Scaffolded tree under ${foodRootId}: ${JSON.stringify(ids)}`);
  return ids;
}

/**
 * Find food child nodes by role under a root.
 */
export async function findFoodNodes(foodRootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: foodRootId }).select("_id name metadata").lean();
  const result = {};
  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("food")
      : child.metadata?.food;
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }
  return result;
}

/**
 * Check if the food tree is initialized.
 */
export async function isInitialized(foodRootId) {
  if (!_Node) return false;
  const root = await _Node.findById(foodRootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("food")
    : root.metadata?.food;
  return !!meta?.initialized;
}

// ── Food parsing ──

const PARSE_PROMPT = `You are a food intake parser. Parse the user's food input into structured macros.

Return ONLY JSON:
{
  "meal": "short description",
  "when": "breakfast" | "lunch" | "dinner" | "snack",
  "items": [
    { "name": "food name", "protein": grams, "carbs": grams, "fats": grams, "calories": number }
  ],
  "totals": { "protein": grams, "carbs": grams, "fats": grams, "calories": number }
}

Rules:
- Estimate nutritional values for common foods. Use typical serving sizes unless specified.
- If the user specifies a quantity (2 eggs, 1 cup rice), use that.
- Round to whole numbers.
- "when" defaults to the most likely meal based on time of day or context. If unclear, use "snack".
- Keep item names short and clear.`;

/**
 * Parse food input into structured macros via one LLM call.
 */
export async function parseFood(message, userId, username, rootId) {
  if (!_runChat) throw new Error("LLM not configured");

  const { answer } = await _runChat({
    userId,
    username,
    message,
    mode: "tree:food-log",
    rootId,
  });

  if (!answer) return null;

  const parsed = parseJsonSafe(answer);
  if (!parsed?.items?.length) {
    log.warn("Food", `Parse returned no items from: "${message}"`);
    return null;
  }

  // Ensure totals exist
  if (!parsed.totals) {
    parsed.totals = { protein: 0, carbs: 0, fats: 0, calories: 0 };
    for (const item of parsed.items) {
      parsed.totals.protein += item.protein || 0;
      parsed.totals.carbs += item.carbs || 0;
      parsed.totals.fats += item.fats || 0;
      parsed.totals.calories += item.calories || 0;
    }
  }

  return parsed;
}

// ── Cascade delivery ──

/**
 * Deliver macro signals to tracking nodes via channels or direct cascade.
 */
export async function deliverMacros(logNodeId, foodNodes, parsed, userId) {
  const { totals, meal, when } = parsed;

  // Try channels first
  let usedChannels = false;
  try {
    const { getExtension } = await import("../loader.js");
    const channelsExt = getExtension("channels");
    if (channelsExt?.exports?.deliverToChannels) {
      const { v4: uuid } = await import("uuid");
      const signalId = uuid();

      await channelsExt.exports.deliverToChannels(logNodeId, {
        protein: totals.protein,
        carbs: totals.carbs,
        fats: totals.fats,
        calories: totals.calories,
        meal: when || meal,
        source: meal,
        tags: ["protein", "carbs", "fats"],
      }, signalId, 0);

      usedChannels = true;
    }
  } catch (err) {
    log.warn("Food", `Channel delivery failed: ${err.message}`);
  }

  // Fallback: direct $inc on macro nodes
  if (!usedChannels && foodNodes) {
    if (foodNodes.protein && totals.protein > 0) {
      await _Node.updateOne(
        { _id: foodNodes.protein.id },
        { $inc: { "metadata.values.today": totals.protein } }
      );
    }
    if (foodNodes.carbs && totals.carbs > 0) {
      await _Node.updateOne(
        { _id: foodNodes.carbs.id },
        { $inc: { "metadata.values.today": totals.carbs } }
      );
    }
    if (foodNodes.fats && totals.fats > 0) {
      await _Node.updateOne(
        { _id: foodNodes.fats.id },
        { $inc: { "metadata.values.today": totals.fats } }
      );
    }
  }
}

/**
 * Handle an incoming cascade signal at a macro node.
 * Called from the onCascade hook when a food signal arrives.
 * Increments the today value atomically.
 */
export async function handleMacroCascade(node, payload) {
  if (!_Node) return;
  const meta = node.metadata instanceof Map
    ? node.metadata.get("food")
    : node.metadata?.food;
  if (!meta?.role) return;

  const role = meta.role;
  let amount = 0;

  if (role === "protein") amount = payload.protein || 0;
  else if (role === "carbs") amount = payload.carbs || 0;
  else if (role === "fats") amount = payload.fats || 0;
  else return;

  if (amount <= 0) return;

  await _Node.updateOne(
    { _id: node._id },
    { $inc: { "metadata.values.today": amount } }
  );

  log.verbose("Food", `${role}: +${amount}g (node ${String(node._id).slice(0, 8)}...)`);
}

// ── Daily reset ──

// Track last reset date per root to avoid double resets
const lastReset = new Map(); // rootId -> "YYYY-MM-DD"

/**
 * Check if a daily reset is needed and perform it.
 * Archives yesterday's totals to metadata.food.history[] on root.
 * Resets values.today to 0 on each macro node.
 */
export async function checkDailyReset(rootId) {
  if (!_Node) return;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (lastReset.get(rootId) === today) return;

  const foodNodes = await findFoodNodes(rootId);
  if (!foodNodes?.protein) return; // not scaffolded

  // Read current macro totals
  const macros = {};
  for (const role of ["protein", "carbs", "fats"]) {
    if (!foodNodes[role]) continue;
    const node = await _Node.findById(foodNodes[role].id).select("metadata").lean();
    if (!node) continue;
    const values = node.metadata instanceof Map
      ? node.metadata.get("values")
      : node.metadata?.values;
    macros[role] = values?.today || 0;
  }

  const hadData = macros.protein > 0 || macros.carbs > 0 || macros.fats > 0;

  // Archive yesterday's totals to root's food.history
  if (hadData) {
    const root = await _Node.findById(rootId);
    if (root) {
      const existing = getExtMeta(root, "food");
      const history = Array.isArray(existing.history) ? existing.history : [];
      history.push({
        date: lastReset.get(rootId) || new Date(Date.now() - 86400000).toISOString().slice(0, 10),
        protein: macros.protein,
        carbs: macros.carbs,
        fats: macros.fats,
      });
      // Cap at 90 days
      while (history.length > 90) history.shift();
      await setExtMeta(root, "food", { ...existing, history });
    }
  }

  // Reset today values on macro nodes
  for (const role of ["protein", "carbs", "fats"]) {
    if (!foodNodes[role]) continue;
    await _Node.updateOne(
      { _id: foodNodes[role].id },
      { $set: { "metadata.values.today": 0 } }
    );
  }

  lastReset.set(rootId, today);
  if (hadData) {
    log.verbose("Food", `Daily reset for ${rootId.slice(0, 8)}... (P:${macros.protein} C:${macros.carbs} F:${macros.fats})`);
  }
}

// ── Reading current state ──

/**
 * Read the full daily picture for a food tree.
 * Used by enrichContext on the Daily node and by the daily mode.
 */
export async function getDailyPicture(foodRootId) {
  if (!_Node) return null;

  const foodNodes = await findFoodNodes(foodRootId);
  if (!foodNodes) return null;

  const picture = { protein: {}, carbs: {}, fats: {} };

  for (const role of ["protein", "carbs", "fats"]) {
    if (!foodNodes[role]) continue;
    const node = await _Node.findById(foodNodes[role].id).select("metadata").lean();
    if (!node) continue;

    const values = node.metadata instanceof Map
      ? node.metadata.get("values")
      : node.metadata?.values;
    const goals = node.metadata instanceof Map
      ? node.metadata.get("goals")
      : node.metadata?.goals;

    picture[role] = {
      today: values?.today || 0,
      goal: goals?.today || 0,
    };
  }

  // Calculate calories (protein*4 + carbs*4 + fats*9)
  picture.calories = {
    today: (picture.protein.today * 4) + (picture.carbs.today * 4) + (picture.fats.today * 9),
    goal: (picture.protein.goal * 4) + (picture.carbs.goal * 4) + (picture.fats.goal * 9),
  };

  // Get profile from root
  const root = await _Node.findById(foodRootId).select("metadata").lean();
  const foodMeta = root?.metadata instanceof Map
    ? root.metadata.get("food")
    : root?.metadata?.food;
  if (foodMeta?.profile) picture.profile = foodMeta.profile;
  if (foodMeta?.history) picture.recentHistory = foodMeta.history.slice(-7);

  // Get recent meals from Log node
  if (foodNodes.log) {
    try {
      const Note = (await import("../../seed/models/note.js")).default;
      const recentNotes = await Note.find({ nodeId: foodNodes.log.id })
        .sort({ dateCreated: -1 })
        .limit(10)
        .select("content dateCreated")
        .lean();
      picture.recentMeals = recentNotes.map(n => ({
        text: typeof n.content === "string" ? n.content.slice(0, 200) : "",
        date: n.dateCreated,
      }));
    } catch {}
  }

  return picture;
}

// ── Setup helpers ──

/**
 * Save the user's food profile and set goals on macro nodes.
 */
export async function saveProfile(foodRootId, profile, foodNodes) {
  if (!_Node) return;

  // Save profile on root
  const root = await _Node.findById(foodRootId);
  if (root) {
    const existing = getExtMeta(root, "food");
    await setExtMeta(root, "food", { ...existing, profile, initialized: true });
  }

  // Set goals on macro nodes
  const goalMap = {
    protein: profile.proteinGoal,
    carbs: profile.carbsGoal,
    fats: profile.fatsGoal,
  };

  for (const [role, goal] of Object.entries(goalMap)) {
    if (!goal || !foodNodes[role]) continue;
    await _Node.updateOne(
      { _id: foodNodes[role].id },
      { $set: { "metadata.goals.today": goal, "metadata.values.today": 0 } }
    );
  }
}
