/**
 * Recovery Core
 *
 * The tree grows toward health. Scaffold, parse check-ins, track substances,
 * detect patterns, manage taper schedules, archive history. The person is
 * always the agent. The tree is the mirror.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

// ── Dependencies ──

let _Node = null;
let _Note = null;
let _runChat = null;
let _metadata = null;
let _hooks = null;

export function configure({ Node, Note, runChat, metadata, hooks }) {
  _Node = Node;
  _Note = Note;
  _runChat = runChat;
  _metadata = metadata;
  _hooks = hooks;
}

// ── Roles ──

const ROLES = {
  LOG: "log",
  SUBSTANCE: "substance",
  SUBSTANCE_ITEM: "substance-item",
  DOSES: "doses",
  SCHEDULE: "schedule",
  FEELINGS: "feelings",
  CRAVINGS: "cravings",
  MOOD: "mood",
  ENERGY: "energy",
  PATTERNS: "patterns",
  JOURNAL: "journal",
  MILESTONES: "milestones",
  SUPPORT: "support",
  PROFILE: "profile",
  HISTORY: "history",
};

// ── Scaffold ──

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("Recovery core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const substanceNode = await createNode({ name: "Substance", parentId: rootId, userId });
  const feelingsNode = await createNode({ name: "Feelings", parentId: rootId, userId });
  const cravingsNode = await createNode({ name: "Cravings", parentId: feelingsNode._id, userId });
  const moodNode = await createNode({ name: "Mood", parentId: feelingsNode._id, userId });
  const energyNode = await createNode({ name: "Energy", parentId: feelingsNode._id, userId });
  const patternsNode = await createNode({ name: "Patterns", parentId: rootId, userId });
  const journalNode = await createNode({ name: "Journal", parentId: rootId, userId });
  const milestonesNode = await createNode({ name: "Milestones", parentId: rootId, userId });
  const supportNode = await createNode({ name: "Support", parentId: rootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  // Tag roles
  const tags = [
    [logNode, ROLES.LOG],
    [substanceNode, ROLES.SUBSTANCE],
    [feelingsNode, ROLES.FEELINGS],
    [cravingsNode, ROLES.CRAVINGS],
    [moodNode, ROLES.MOOD],
    [energyNode, ROLES.ENERGY],
    [patternsNode, ROLES.PATTERNS],
    [journalNode, ROLES.JOURNAL],
    [milestonesNode, ROLES.MILESTONES],
    [supportNode, ROLES.SUPPORT],
    [profileNode, ROLES.PROFILE],
    [historyNode, ROLES.HISTORY],
  ];

  for (const [node, role] of tags) {
    await _metadata.setExtMeta(node, "recovery", { role });
  }

  // Mode overrides
  await setNodeMode(rootId, "respond", "tree:recovery-log");
  await setNodeMode(logNode._id, "respond", "tree:recovery-log");
  await setNodeMode(journalNode._id, "respond", "tree:recovery-journal");
  await setNodeMode(patternsNode._id, "respond", "tree:recovery-reflect");

  // Mark initialized
  const root = await _Node.findById(rootId);
  if (root) await _metadata.setExtMeta(root, "recovery", { initialized: true });

  const ids = {};
  for (const [node, role] of tags) ids[role] = String(node._id);

  log.info("Recovery", `Scaffolded tree under ${rootId}`);
  return ids;
}

/**
 * Add a substance to track. Creates a child under /Substance with Schedule and Doses children.
 */
export async function addSubstance(rootId, substanceName, userId, config = {}) {
  const nodes = await findRecoveryNodes(rootId);
  if (!nodes?.substance) throw new Error("Recovery tree not scaffolded");

  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const substNode = await createNode({ name: substanceName, parentId: nodes.substance.id, userId });
  await _metadata.setExtMeta(substNode, "recovery", { role: ROLES.SUBSTANCE_ITEM, substanceName: substanceName.toLowerCase() });

  const scheduleNode = await createNode({ name: "Schedule", parentId: substNode._id, userId });
  await _metadata.setExtMeta(scheduleNode, "recovery", { role: ROLES.SCHEDULE, substance: substanceName.toLowerCase() });

  const dosesNode = await createNode({ name: "Doses", parentId: substNode._id, userId });
  await _metadata.setExtMeta(dosesNode, "recovery", { role: ROLES.DOSES, substance: substanceName.toLowerCase() });

  // Initialize dose values
  await _metadata.batchSetExtMeta(dosesNode._id, "values", {
    today: 0,
    target: config.startingTarget || 0,
    finalTarget: config.finalTarget || 0,
    yesterday: 0,
    streak: 0,
    longestStreak: 0,
    totalSlips: 0,
    lastSlip: null,
  });

  return { substance: String(substNode._id), schedule: String(scheduleNode._id), doses: String(dosesNode._id) };
}

// ── Find nodes ──

export async function findRecoveryNodes(rootId) {
  if (!_Node) return null;

  const result = {};
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();

  for (const child of children) {
    const meta = child.metadata instanceof Map ? child.metadata.get("recovery") : child.metadata?.recovery;
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }

  // Find Feelings children
  if (result.feelings) {
    const feelChildren = await _Node.find({ parent: result.feelings.id }).select("_id name metadata").lean();
    for (const fc of feelChildren) {
      const meta = fc.metadata instanceof Map ? fc.metadata.get("recovery") : fc.metadata?.recovery;
      if (meta?.role) result[meta.role] = { id: String(fc._id), name: fc.name };
    }
  }

  // Find Substance children (each substance has Doses and Schedule)
  if (result.substance) {
    result.substances = {};
    const substChildren = await _Node.find({ parent: result.substance.id }).select("_id name metadata").lean();
    for (const sc of substChildren) {
      const meta = sc.metadata instanceof Map ? sc.metadata.get("recovery") : sc.metadata?.recovery;
      if (meta?.substanceName) {
        const name = meta.substanceName;
        result.substances[name] = { id: String(sc._id), name: sc.name };
        // Find Doses and Schedule under this substance
        const subChildren = await _Node.find({ parent: sc._id }).select("_id name metadata").lean();
        for (const sub of subChildren) {
          const subMeta = sub.metadata instanceof Map ? sub.metadata.get("recovery") : sub.metadata?.recovery;
          if (subMeta?.role === ROLES.DOSES) result.substances[name].doses = String(sub._id);
          if (subMeta?.role === ROLES.SCHEDULE) result.substances[name].schedule = String(sub._id);
        }
      }
    }
  }

  return result;
}

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map ? root.metadata.get("recovery") : root.metadata?.recovery;
  return !!meta?.initialized;
}

// ── Parse check-in ──

export async function parseCheckIn(message, userId, username, rootId) {
  if (!_runChat) throw new Error("LLM not configured");

  const { answer } = await _runChat({
    userId,
    username,
    message,
    mode: "tree:recovery-log",
    rootId,
    slot: "recovery",
  });

  if (!answer) return null;
  return parseJsonSafe(answer);
}

// ── Record data ──

export async function recordDoses(nodes, substance, amount) {
  const sub = nodes.substances?.[substance.toLowerCase()];
  if (!sub?.doses) return;

  const dosesNode = await _Node.findById(sub.doses).select("metadata").lean();
  const values = dosesNode?.metadata instanceof Map ? dosesNode.metadata.get("values") : dosesNode?.metadata?.values;
  const target = values?.target || 0;
  const currentStreak = values?.streak || 0;

  await _metadata.incExtMeta(sub.doses, "values", "today", amount);

  // Check if this is a slip (over target)
  const newTotal = (values?.today || 0) + amount;
  if (target > 0 && newTotal > target) {
    await _metadata.batchSetExtMeta(sub.doses, "values", {
      streak: 0,
      totalSlips: (values?.totalSlips || 0) + 1,
      lastSlip: new Date().toISOString(),
    });
  }
}

export async function recordCraving(nodes, intensity, resisted, trigger) {
  if (!nodes.cravings) return;
  const node = await _Node.findById(nodes.cravings.id).select("metadata").lean();
  const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;

  const updates = {
    intensity_today: Math.max(values?.intensity_today || 0, intensity),
    triggers_today: (values?.triggers_today || 0) + 1,
  };
  if (resisted) updates.resisted_today = (values?.resisted_today || 0) + 1;

  await _metadata.batchSetExtMeta(nodes.cravings.id, "values", updates);
}

export async function recordMood(nodes, score) {
  if (!nodes.mood) return;
  await _metadata.batchSetExtMeta(nodes.mood.id, "values", { today_avg: score });
}

export async function recordEnergy(nodes, level) {
  if (!nodes.energy) return;
  await _metadata.batchSetExtMeta(nodes.energy.id, "values", { today: level });
}

// ── Milestones ──

const MILESTONE_DAYS = [1, 3, 7, 14, 21, 30, 60, 90, 100, 180, 365];

export async function checkMilestones(nodes, substance, streak) {
  if (!nodes.milestones || !_Note) return null;

  for (const day of MILESTONE_DAYS) {
    if (streak !== day) continue;

    const messages = {
      1: "First day on target.",
      3: "Three days. The hardest part is starting.",
      7: "One week.",
      14: "Two weeks. Building momentum.",
      21: "Three weeks. This is becoming a pattern. A good one.",
      30: "One month.",
      60: "Two months.",
      90: "Ninety days.",
      100: "Triple digits.",
      180: "Six months.",
      365: "One year.",
    };

    const text = `Day ${day}: ${messages[day] || `${day} days.`}`;

    try {
      const { createNote } = await import("../../seed/tree/notes.js");
      await createNote({
        nodeId: nodes.milestones.id,
        content: text,
        contentType: "text",
        userId: "SYSTEM",
      });
    } catch {}

    if (_hooks) {
      _hooks.run("recovery:milestone", { substance, day, streak, message: text }).catch(() => {});
    }

    return text;
  }
  return null;
}

// ── Daily reset ──

const lastReset = new Map();

export async function checkDailyReset(rootId) {
  if (!_Node) return;

  const today = new Date().toISOString().slice(0, 10);
  if (lastReset.get(rootId) === today) return;

  const nodes = await findRecoveryNodes(rootId);
  if (!nodes) return;

  // Build daily summary
  const summary = { date: today, substances: {}, feelings: {} };

  // Read substance data
  for (const [name, sub] of Object.entries(nodes.substances || {})) {
    if (!sub.doses) continue;
    const node = await _Node.findById(sub.doses).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (!values) continue;

    const doseToday = values.today || 0;
    const target = values.target || 0;
    const onTarget = target === 0 ? doseToday === 0 : doseToday <= target;
    const streak = values.streak || 0;

    summary.substances[name] = { doses: doseToday, target, onTarget, streak };

    // Update streak and yesterday
    const newStreak = onTarget ? streak + 1 : 0;
    const longestStreak = Math.max(values.longestStreak || 0, newStreak);
    await _metadata.batchSetExtMeta(sub.doses, "values", {
      yesterday: doseToday,
      today: 0,
      streak: newStreak,
      longestStreak,
    });

    // Check milestones
    if (newStreak > 0) {
      await checkMilestones(nodes, name, newStreak);
    }
  }

  // Read feelings
  if (nodes.cravings) {
    const node = await _Node.findById(nodes.cravings.id).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values) {
      summary.feelings.craving = {
        peak: values.intensity_today || 0,
        triggers: values.triggers_today || 0,
        resisted: values.resisted_today || 0,
      };
      // Update weekly avg and reset
      const weeklyAvg = values.intensity_weeklyAvg || values.intensity_today || 0;
      const newAvg = Math.round((weeklyAvg * 6 + (values.intensity_today || 0)) / 7 * 10) / 10;
      const totalResisted = (values.resisted_total || 0) + (values.resisted_today || 0);
      const totalTriggers = (values.triggers_total || 0) + (values.triggers_today || 0);
      await _metadata.batchSetExtMeta(nodes.cravings.id, "values", {
        intensity_today: 0,
        triggers_today: 0,
        resisted_today: 0,
        intensity_weeklyAvg: newAvg,
        resisted_total: totalResisted,
        triggers_total: totalTriggers,
        resisted_rate: totalTriggers > 0 ? Math.round((totalResisted / totalTriggers) * 100) / 100 : 0,
      });
    }
  }

  if (nodes.mood) {
    const node = await _Node.findById(nodes.mood.id).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values?.today_avg != null) {
      summary.feelings.mood = values.today_avg;
      const weeklyAvg = values.weeklyAvg || values.today_avg;
      const newAvg = Math.round((weeklyAvg * 6 + values.today_avg) / 7 * 10) / 10;
      await _metadata.batchSetExtMeta(nodes.mood.id, "values", {
        yesterday_avg: values.today_avg,
        today_avg: 0,
        weeklyAvg: newAvg,
      });
    }
  }

  if (nodes.energy) {
    const node = await _Node.findById(nodes.energy.id).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values?.today != null) {
      summary.feelings.energy = values.today;
      const weeklyAvg = values.weeklyAvg || values.today;
      const newAvg = Math.round((weeklyAvg * 6 + values.today) / 7 * 10) / 10;
      await _metadata.batchSetExtMeta(nodes.energy.id, "values", {
        yesterday: values.today,
        today: 0,
        weeklyAvg: newAvg,
      });
    }
  }

  // Archive to History
  if (nodes.history) {
    try {
      const { createNote } = await import("../../seed/tree/notes.js");
      await createNote({
        nodeId: nodes.history.id,
        content: JSON.stringify(summary),
        contentType: "text",
        userId: "SYSTEM",
      });
    } catch (err) {
      log.debug("Recovery", `History write failed: ${err.message}`);
    }
  }

  lastReset.set(rootId, today);
  log.verbose("Recovery", `Daily reset for ${rootId.slice(0, 8)}...`);
}

// ── Read state ──

export async function getStatus(rootId) {
  if (!_Node) return null;
  const nodes = await findRecoveryNodes(rootId);
  if (!nodes) return null;

  const status = { substances: {}, feelings: {}, streaks: {} };

  for (const [name, sub] of Object.entries(nodes.substances || {})) {
    if (!sub.doses) continue;
    const node = await _Node.findById(sub.doses).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values) {
      status.substances[name] = {
        today: values.today || 0,
        target: values.target || 0,
        onTarget: (values.target || 0) === 0 ? (values.today || 0) === 0 : (values.today || 0) <= (values.target || 0),
      };
      status.streaks[name] = {
        current: values.streak || 0,
        longest: values.longestStreak || 0,
        totalSlips: values.totalSlips || 0,
        lastSlip: values.lastSlip || null,
      };
    }
  }

  if (nodes.cravings) {
    const node = await _Node.findById(nodes.cravings.id).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values) {
      status.feelings.cravings = {
        intensity: values.intensity_today || 0,
        weeklyAvg: values.intensity_weeklyAvg || 0,
        resistRate: values.resisted_rate || 0,
      };
    }
  }

  if (nodes.mood) {
    const node = await _Node.findById(nodes.mood.id).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values) {
      status.feelings.mood = { today: values.today_avg || 0, weeklyAvg: values.weeklyAvg || 0 };
    }
  }

  if (nodes.energy) {
    const node = await _Node.findById(nodes.energy.id).select("metadata").lean();
    const values = node?.metadata instanceof Map ? node.metadata.get("values") : node?.metadata?.values;
    if (values) {
      status.feelings.energy = { today: values.today || 0, weeklyAvg: values.weeklyAvg || 0 };
    }
  }

  return status;
}

export async function getPatterns(rootId) {
  const nodes = await findRecoveryNodes(rootId);
  if (!nodes?.patterns || !_Note) return [];

  const notes = await _Note.find({ nodeId: nodes.patterns.id })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("content createdAt")
    .lean();

  return notes
    .map(n => { try { return JSON.parse(n.content); } catch { return null; } })
    .filter(Boolean);
}

export async function getMilestones(rootId) {
  const nodes = await findRecoveryNodes(rootId);
  if (!nodes?.milestones || !_Note) return [];

  const notes = await _Note.find({ nodeId: nodes.milestones.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .select("content createdAt")
    .lean();

  return notes.map(n => ({ text: n.content, date: n.createdAt }));
}

export async function getHistory(rootId, days = 7) {
  const nodes = await findRecoveryNodes(rootId);
  if (!nodes?.history || !_Note) return [];

  const notes = await _Note.find({ nodeId: nodes.history.id })
    .sort({ createdAt: -1 })
    .limit(days)
    .select("content")
    .lean();

  return notes
    .map(n => { try { return JSON.parse(n.content); } catch { return null; } })
    .filter(Boolean);
}
