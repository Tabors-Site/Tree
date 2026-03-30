/**
 * Food Core
 *
 * Parse food input, scaffold tree structure, deliver cascade signals,
 * daily reset, and macro reading. The tree does the orchestration.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

// ── Dependencies (set by configure) ──

let _Node = null;
let _runChat = null;
let _metadata = null;
let _Note = null;

export function configure({ Node, Note, runChat, metadata }) {
  _Node = Node;
  _Note = Note;
  _runChat = runChat;
  _metadata = metadata;
}

// ── Food node roles ──

const ROLES = {
  LOG: "log", PROTEIN: "protein", CARBS: "carbs", FATS: "fats",
  DAILY: "daily", MEALS: "meals", PROFILE: "profile", HISTORY: "history",
};

// ── Tree scaffold ──

/**
 * Create the food tree structure under a root node.
 * Returns the node IDs for each role.
 */
export async function scaffold(foodRootId, userId) {
  if (!_Node) throw new Error("Food core not configured");

  const { createNode } = await import("../../seed/tree/treeManagement.js");

  // Create core child nodes
  const logNode = await createNode({ name: "Log", parentId: foodRootId, userId });
  const proteinNode = await createNode({ name: "Protein", parentId: foodRootId, userId });
  const carbsNode = await createNode({ name: "Carbs", parentId: foodRootId, userId });
  const fatsNode = await createNode({ name: "Fats", parentId: foodRootId, userId });
  const dailyNode = await createNode({ name: "Daily", parentId: foodRootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: foodRootId, userId });
  const historyNode = await createNode({ name: "History", parentId: foodRootId, userId });

  // Create Meals subtree for pattern tracking
  const mealsNode = await createNode({ name: "Meals", parentId: foodRootId, userId });
  const breakfastNode = await createNode({ name: "Breakfast", parentId: mealsNode._id, userId });
  const lunchNode = await createNode({ name: "Lunch", parentId: mealsNode._id, userId });
  const dinnerNode = await createNode({ name: "Dinner", parentId: mealsNode._id, userId });
  const snacksNode = await createNode({ name: "Snacks", parentId: mealsNode._id, userId });

  // Tag each node with its food role
  const nodes = [
    { node: logNode, role: ROLES.LOG },
    { node: proteinNode, role: ROLES.PROTEIN },
    { node: carbsNode, role: ROLES.CARBS },
    { node: fatsNode, role: ROLES.FATS },
    { node: dailyNode, role: ROLES.DAILY },
    { node: profileNode, role: ROLES.PROFILE },
    { node: historyNode, role: ROLES.HISTORY },
    { node: mealsNode, role: ROLES.MEALS },
  ];

  for (const { node, role } of nodes) {
    await _metadata.setExtMeta(node, "food", { role });
  }

  // Tag meal slot children
  for (const [node, slot] of [[breakfastNode, "breakfast"], [lunchNode, "lunch"], [dinnerNode, "dinner"], [snacksNode, "snack"]]) {
    await _metadata.setExtMeta(node, "food", { role: "meal", mealSlot: slot });
  }

  // Set mode overrides
  await setNodeMode(foodRootId, "respond", "tree:food-log");
  await setNodeMode(logNode._id, "respond", "tree:food-log");
  await setNodeMode(dailyNode._id, "respond", "tree:food-review");

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

  // Mark root as initialized (base phase: scaffold done, profile not yet set)
  const rootNode = await _Node.findById(foodRootId);
  if (rootNode) {
    await _metadata.setExtMeta(rootNode, "food", { initialized: true, setupPhase: "base" });
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
    if (meta?.role) {
      result[meta.role] = { id: String(child._id), name: child.name };
    } else {
      // Unadopted node: no food role yet. Track it so the AI can adopt it.
      if (!result._unadopted) result._unadopted = [];
      result._unadopted.push({ id: String(child._id), name: child.name });
    }
  }
  // Find meal slot children under Meals node
  if (result.meals) {
    const mealChildren = await _Node.find({ parent: result.meals.id }).select("_id name metadata").lean();
    result.mealSlots = {};
    for (const mc of mealChildren) {
      const meta = mc.metadata instanceof Map ? mc.metadata.get("food") : mc.metadata?.food;
      if (meta?.mealSlot) result.mealSlots[meta.mealSlot] = { id: String(mc._id), name: mc.name };
    }
  }
  return result;
}

/**
 * Adopt a node into the food tree as a tracked metric.
 * Sets metadata.food.role and optionally a daily goal.
 */
export async function adoptNode(nodeId, role, goal) {
  if (!_metadata || !_Node) throw new Error("Metadata service not configured");
  const node = await _Node.findById(nodeId);
  if (!node) throw new Error("Node not found");
  await _metadata.setExtMeta(node, "food", { role });
  if (goal != null && goal > 0) {
    await _metadata.setExtMeta(node, "goals", { today: goal });
  }
  log.info("Food", `Adopted node ${String(nodeId).slice(0, 8)} as "${role}"${goal ? ` (goal: ${goal}g)` : ""}`);
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

export async function getSetupPhase(foodRootId) {
  if (!_Node) return null;
  const root = await _Node.findById(foodRootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("food")
    : root.metadata?.food;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

// ── Food parsing ──

// ── Meal slot detection ──

/**
 * Determine which meal slot a food entry belongs to.
 * Keyword override takes priority over time-based detection.
 */
export function detectMealSlot(message, when) {
  if (when) {
    const w = when.toLowerCase();
    if (w === "breakfast") return "breakfast";
    if (w === "lunch") return "lunch";
    if (w === "dinner" || w === "supper") return "dinner";
    if (w === "snack") return "snack";
  }
  const lower = (message || "").toLowerCase();
  if (/\bbreakfast\b/.test(lower)) return "breakfast";
  if (/\blunch\b/.test(lower)) return "lunch";
  if (/\b(dinner|supper)\b/.test(lower)) return "dinner";
  if (/\bsnack\b/.test(lower)) return "snack";
  // Time-based fallback
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 14) return "lunch";
  if (hour < 17) return "snack";
  return "dinner";
}

/**
 * Write a meal note to the appropriate Meals/{slot} child node.
 */
export async function writeMealNote(foodNodes, mealSlot, summary, userId) {
  if (!foodNodes?.mealSlots?.[mealSlot]) return;
  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    await createNote({
      nodeId: foodNodes.mealSlots[mealSlot].id,
      content: summary,
      contentType: "text",
      userId,
    });
  } catch (err) {
    log.debug("Food", `Meal note write failed: ${err.message}`);
  }
}

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
    slot: "food",
  });

  if (!answer) return null;

  const parsed = parseJsonSafe(answer);
  if (!parsed?.items?.length) {
    log.warn("Food", `Parse returned no items from: "${message}"`);
    return null;
  }

  // Ensure totals exist (sum all numeric fields from items dynamically)
  if (!parsed.totals) {
    parsed.totals = {};
    for (const item of parsed.items) {
      for (const [key, val] of Object.entries(item)) {
        if (key === "name" || typeof val !== "number") continue;
        parsed.totals[key] = (parsed.totals[key] || 0) + val;
      }
    }
  }

  return parsed;
}

// ── Cascade delivery ──

/**
 * Deliver macro signals to tracking nodes via channels or direct cascade.
 */
export async function deliverMacros(logNodeId, foodNodes, parsed) {
  const { totals, meal, when } = parsed;

  // Try channels first
  let usedChannels = false;
  try {
    const { getExtension } = await import("../loader.js");
    const channelsExt = getExtension("channels");
    if (channelsExt?.exports?.deliverToChannels) {
      const { v4: uuid } = await import("uuid");
      const signalId = uuid();

      const payload = { meal: when || meal, source: meal, tags: [] };
      for (const [key, val] of Object.entries(totals)) {
        if (typeof val === "number") { payload[key] = val; payload.tags.push(key); }
      }
      await channelsExt.exports.deliverToChannels(logNodeId, payload, signalId, 0);

      usedChannels = true;
    }
  } catch (err) {
    log.warn("Food", `Channel delivery failed: ${err.message}`);
  }

  // Always do direct increment as well (channels may not have routes set up yet)
  // Route to ALL metric nodes dynamically (protein, carbs, fats, sugar, fiber, etc.)
  if (foodNodes) {
    const STRUCTURAL = ["log", "daily", "meals", "profile", "history", "mealSlots"];
    for (const [role, info] of Object.entries(foodNodes)) {
      if (STRUCTURAL.includes(role) || !info?.id) continue;
      const amount = totals[role] || 0;
      if (amount > 0) {
        await _metadata.incExtMeta(info.id, "values", "today", amount);
      }
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
  const STRUCTURAL = ["log", "daily", "meals", "profile", "history"];
  if (STRUCTURAL.includes(role)) return;

  // Match cascade payload key to node role (protein->protein, sugar->sugar, etc.)
  const amount = payload[role] || 0;

  if (amount <= 0) return;

  await _metadata.incExtMeta(node, "values", "today", amount);

  log.verbose("Food", `${role}: +${amount}g (node ${String(node._id).slice(0, 8)}...)`);
}

// ── Daily reset ──

// Track last reset date per root to avoid double resets
const lastReset = new Map(); // rootId -> "YYYY-MM-DD"

/**
 * Check if a daily reset is needed and perform it.
 * Archives yesterday's totals as a note on the History node.
 * Calculates weekly averages. Resets values.today to 0 on each macro node.
 */
export async function checkDailyReset(rootId) {
  if (!_Node) return;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (lastReset.get(rootId) === today) return;

  // Check persisted reset date (survives server restarts)
  const root = await _Node.findById(rootId).select("metadata").lean();
  const foodMeta = root?.metadata instanceof Map ? root.metadata.get("food") : root?.metadata?.food;
  if (foodMeta?.lastResetDate === today) {
    lastReset.set(rootId, today);
    log.debug("Food", `Daily reset skipped (already reset today) for ${String(rootId).slice(0, 8)}`);
    return;
  }
  log.verbose("Food", `Daily reset firing for ${String(rootId).slice(0, 8)} (lastResetDate=${foodMeta?.lastResetDate}, today=${today})`);

  const foodNodes = await findFoodNodes(rootId);
  if (!foodNodes) return;

  // Discover all metric roles (anything that isn't structural)
  const STRUCTURAL = ["log", "daily", "meals", "profile", "history", "mealSlots"];
  const metricRoles = Object.keys(foodNodes).filter(r => !STRUCTURAL.includes(r) && foodNodes[r]?.id);
  if (metricRoles.length === 0) return;

  // Read current totals and goals for all metric nodes
  const macros = {};
  const goals = {};
  for (const role of metricRoles) {
    const node = await _Node.findById(foodNodes[role].id).select("metadata").lean();
    if (!node) continue;
    const values = node.metadata instanceof Map ? node.metadata.get("values") : node.metadata?.values;
    const goalMeta = node.metadata instanceof Map ? node.metadata.get("goals") : node.metadata?.goals;
    macros[role] = values?.today || 0;
    goals[role] = goalMeta?.today || 0;
  }

  const hadData = metricRoles.some(r => macros[r] > 0);

  // Archive yesterday's totals as a note on the History node
  if (hadData && foodNodes.history) {
    try {
      const date = lastReset.get(rootId) || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const p = macros.protein || 0, c = macros.carbs || 0, f = macros.fats || 0;
      const calories = (p * 4) + (c * 4) + (f * 9);
      const summary = { date, calories };
      // Include all tracked metrics and their hit status
      for (const role of metricRoles) {
        summary[role] = macros[role] || 0;
        if (goals[role] > 0) {
          summary[`hit${role.charAt(0).toUpperCase() + role.slice(1)}Goal`] = macros[role] >= goals[role];
        }
      }
      const { createNote } = await import("../../seed/tree/notes.js");
      await createNote({
        nodeId: foodNodes.history.id,
        content: JSON.stringify(summary),
        contentType: "text",
        userId: "SYSTEM",
      });
    } catch (err) {
      log.debug("Food", `History note write failed: ${err.message}`);
    }
  }

  // Reset all metric nodes and calculate weekly averages
  const resetMetrics = async (withAverages, days) => {
    for (const role of metricRoles) {
      if (!foodNodes[role]) continue;
      if (withAverages && days?.length > 0) {
        const avg = Math.round(days.reduce((s, d) => s + (d[role] || 0), 0) / days.length);
        const hitKey = `hit${role.charAt(0).toUpperCase() + role.slice(1)}Goal`;
        const hitCount = days.filter(d => d[hitKey]).length;
        const hitRate = Math.round((hitCount / days.length) * 100) / 100;
        await _metadata.batchSetExtMeta(foodNodes[role].id, "values", { today: 0, weeklyAvg: avg, weeklyHitRate: hitRate });
      } else {
        await _metadata.batchSetExtMeta(foodNodes[role].id, "values", { today: 0 });
      }
    }
  };

  if (foodNodes.history && _Note) {
    try {
      const recentNotes = await _Note.find({ nodeId: foodNodes.history.id })
        .sort({ createdAt: -1 }).limit(7).select("content").lean();
      const days = recentNotes.map(n => { try { return JSON.parse(n.content); } catch { return null; } }).filter(Boolean);
      await resetMetrics(days.length > 0, days);
    } catch (err) {
      log.debug("Food", `Weekly average calculation failed: ${err.message}`);
      await resetMetrics(false);
    }
  } else {
    await resetMetrics(false);
  }

  lastReset.set(rootId, today);

  // Persist reset date so server restarts don't re-zero today's data
  try {
    const rootNode = await _Node.findById(rootId);
    if (rootNode) {
      const existing = _metadata.getExtMeta(rootNode, "food") || {};
      await _metadata.setExtMeta(rootNode, "food", { ...existing, lastResetDate: today });
      log.verbose("Food", `Persisted lastResetDate=${today} for ${String(rootId).slice(0, 8)}`);
    }
  } catch (err) {
    log.warn("Food", `Failed to persist reset date: ${err.message}`);
  }

  if (hadData) {
    const macroStr = metricRoles.map(r => `${r}:${macros[r] || 0}`).join(" ");
    log.verbose("Food", `Daily reset for ${rootId.slice(0, 8)}... (${macroStr})`);
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

  const CORE_MACROS = ["protein", "carbs", "fats"];
  const STRUCTURAL_ROLES = ["log", "daily", "meals", "profile", "history"];
  const picture = {};

  // Discover all metric nodes (core macros + any user-created ones like sugar, fiber)
  // Structural roles (log, daily, meals, etc.) are skipped. Everything else is a metric.
  const valueRoles = [];
  for (const [role, info] of Object.entries(foodNodes)) {
    if (role === "mealSlots" || !info?.id || STRUCTURAL_ROLES.includes(role)) continue;
    const node = await _Node.findById(info.id).select("metadata").lean();
    if (!node) continue;
    const values = node.metadata instanceof Map ? node.metadata.get("values") : node.metadata?.values;
    const goals = node.metadata instanceof Map ? node.metadata.get("goals") : node.metadata?.goals;
    picture[role] = {
      today: values?.today || 0,
      goal: goals?.today || 0,
      weeklyAvg: values?.weeklyAvg || 0,
      weeklyHitRate: values?.weeklyHitRate || 0,
      name: info.name,
      isCoreMacro: CORE_MACROS.includes(role),
    };
    valueRoles.push(role);
  }

  // Calculate calories from core macros (protein*4 + carbs*4 + fats*9)
  const p = picture.protein || {};
  const c = picture.carbs || {};
  const f = picture.fats || {};
  picture.calories = {
    today: ((p.today || 0) * 4) + ((c.today || 0) * 4) + ((f.today || 0) * 9),
    goal: ((p.goal || 0) * 4) + ((c.goal || 0) * 4) + ((f.goal || 0) * 9),
  };
  picture._valueRoles = valueRoles;

  // Get profile from Profile node
  if (foodNodes.profile && _Note) {
    try {
      const profileNote = await _Note.findOne({ nodeId: foodNodes.profile.id })
        .sort({ createdAt: -1 })
        .select("content")
        .lean();
      if (profileNote?.content) {
        try { picture.profile = JSON.parse(profileNote.content); } catch { picture.profile = null; }
      }
    } catch {}
  }
  // Fallback: read from root metadata (legacy)
  if (!picture.profile) {
    const root = await _Node.findById(foodRootId).select("metadata").lean();
    const foodMeta = root?.metadata instanceof Map ? root.metadata.get("food") : root?.metadata?.food;
    if (foodMeta?.profile) picture.profile = foodMeta.profile;
  }

  // Get history from History node notes
  if (foodNodes.history) {
    try {
      const Note = _Note || (await import("../../seed/models/note.js")).default;
      const historyNotes = await Note.find({ nodeId: foodNodes.history.id })
        .sort({ createdAt: -1 })
        .limit(7)
        .select("content")
        .lean();
      picture.recentHistory = historyNotes
        .map(n => { try { return JSON.parse(n.content); } catch { return null; } })
        .filter(Boolean);
    } catch {}
  }

  // Get recent meals from Log node
  if (foodNodes.log) {
    try {
      const Note = _Note || (await import("../../seed/models/note.js")).default;
      const recentNotes = await Note.find({ nodeId: foodNodes.log.id })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("content createdAt")
        .lean();
      picture.recentMeals = recentNotes.map(n => ({
        text: typeof n.content === "string" ? n.content.slice(0, 200) : "",
        date: n.createdAt,
      }));
    } catch (err) {
      log.warn("Food", `Meal query failed: ${err.message}`);
    }
  }

  // Get meals by slot (Breakfast, Lunch, Dinner, Snacks)
  if (foodNodes.mealSlots) {
    picture.mealsBySlot = {};
    const Note = _Note || (await import("../../seed/models/note.js")).default;
    for (const [slot, node] of Object.entries(foodNodes.mealSlots)) {
      try {
        const notes = await Note.find({ nodeId: node.id })
          .sort({ createdAt: -1 })
          .limit(5)
          .select("content createdAt")
          .lean();
        if (notes.length > 0) {
          picture.mealsBySlot[slot] = notes.map(n => ({
            text: typeof n.content === "string" ? n.content.slice(0, 150) : "",
            date: n.createdAt,
          }));
        }
      } catch {}
    }
  }

  return picture;
}

// ── Setup helpers ──

/**
 * Save the user's food profile and set goals on macro nodes.
 */
export async function saveProfile(foodRootId, profile, foodNodes) {
  if (!_Node) return;

  // Write profile as a note on the Profile node
  if (foodNodes?.profile) {
    try {
      const { createNote } = await import("../../seed/tree/notes.js");
      await createNote({
        nodeId: foodNodes.profile.id,
        content: JSON.stringify(profile),
        contentType: "text",
        userId: "SYSTEM",
      });
    } catch (err) {
      log.debug("Food", `Profile note write failed: ${err.message}`);
    }
  }

  // Mark setup as complete (profile saved = setup done)
  const root = await _Node.findById(foodRootId);
  if (root) {
    const existing = _metadata.getExtMeta(root, "food") || {};
    await _metadata.setExtMeta(root, "food", { ...existing, setupPhase: "complete" });
  }

  // Set goals on all metric nodes that have a matching goal in the profile
  // Supports both legacy keys (proteinGoal) and dynamic keys (sugarGoal, fiberGoal, etc.)
  const STRUCTURAL = ["log", "daily", "meals", "profile", "history", "mealSlots", "_unadopted"];
  for (const [role, info] of Object.entries(foodNodes)) {
    if (STRUCTURAL.includes(role) || !info?.id) continue;
    // Check for role-specific goal: proteinGoal, sugarGoal, etc.
    const goalKey = `${role}Goal`;
    const goal = profile[goalKey];
    if (goal) {
      await _metadata.batchSetExtMeta(info.id, "goals", { today: goal });
      await _metadata.batchSetExtMeta(info.id, "values", { today: 0 });
    }
  }
}
