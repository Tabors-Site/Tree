/**
 * Fitness Setup
 *
 * Scaffolds the fitness tree structure. Base scaffold creates Log, Program, History.
 * Modality scaffolders create Gym, Running, Home branches on demand.
 * Node creator functions let the AI (via tools) build the tree conversationally.
 *
 * No hardcoded programs. No hardcoded exercises. The AI and user decide the shape.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";

let _metadata = null;
let _Node = null;

export function setDeps({ metadata, Node }) {
  _metadata = metadata;
  _Node = Node;
}

// ── Base scaffold (Log, Program, History) ──

export async function scaffoldFitnessBase(rootId, userId) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const programNode = await createNode({ name: "Program", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  await _metadata.setExtMeta(logNode, "fitness", { role: "log" });
  await _metadata.setExtMeta(programNode, "fitness", { role: "program" });
  await _metadata.setExtMeta(historyNode, "fitness", { role: "history" });

  // Mode overrides: plan on root until setup complete, log on Log node
  await setNodeMode(rootId, "respond", "tree:fitness-plan");
  await setNodeMode(logNode._id, "respond", "tree:fitness-log");

  // Mark as initialized with base phase
  const rootNode = await _Node.findById(rootId);
  if (rootNode) {
    await _metadata.setExtMeta(rootNode, "fitness", {
      initialized: true,
      setupPhase: "scaffolded",
    });
  }

  // Wire food channel if food tree is a sibling
  await wireFoodChannel(rootId, logNode._id, userId);

  log.info("Fitness", `Base scaffold complete: Log, Program, History`);

  return {
    log: String(logNode._id),
    program: String(programNode._id),
    history: String(historyNode._id),
  };
}

// ── Modality scaffolders ──

export async function scaffoldGym(rootId, userId) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const gymNode = await createNode({ name: "Gym", parentId: rootId, userId });
  await _metadata.setExtMeta(gymNode, "fitness", { role: "modality", modality: "gym" });
  log.info("Fitness", "Gym modality scaffolded");
  return { id: String(gymNode._id), name: "Gym" };
}

export async function scaffoldRunning(rootId, userId) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const runningNode = await createNode({ name: "Running", parentId: rootId, userId });
  await _metadata.setExtMeta(runningNode, "fitness", { role: "modality", modality: "running" });

  // Running has fixed structure: Runs, PRs, Plan
  const runsNode = await createNode({ name: "Runs", parentId: runningNode._id, userId });
  const prsNode = await createNode({ name: "PRs", parentId: runningNode._id, userId });
  const planNode = await createNode({ name: "Plan", parentId: runningNode._id, userId });

  await _metadata.setExtMeta(runsNode, "fitness", {
    role: "exercise",
    valueSchema: { type: "distance-time", distanceUnit: "miles", timeUnit: "min" },
  });
  await _metadata.setExtMeta(prsNode, "fitness", {
    role: "exercise",
    valueSchema: { type: "prs" },
  });
  await _metadata.setExtMeta(planNode, "fitness", { role: "plan" });

  // Create Log -> Runs channel
  await createLogChannel(rootId, runsNode._id, "runs-log", userId);

  log.info("Fitness", "Running modality scaffolded: Runs, PRs, Plan");
  return { id: String(runningNode._id), name: "Running" };
}

export async function scaffoldHome(rootId, userId) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const homeNode = await createNode({ name: "Home", parentId: rootId, userId });
  await _metadata.setExtMeta(homeNode, "fitness", { role: "modality", modality: "home" });

  const routineNode = await createNode({ name: "Routine", parentId: homeNode._id, userId });
  await _metadata.setExtMeta(routineNode, "fitness", { role: "plan" });

  log.info("Fitness", "Home/bodyweight modality scaffolded");
  return { id: String(homeNode._id), name: "Home" };
}

// ── Node creators (called by AI tools during setup/modification) ──

export async function addGroupNode({ parentId, name, userId }) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const groupNode = await createNode({ name, parentId, userId });
  await _metadata.setExtMeta(groupNode, "fitness", { role: "group" });
  return { id: String(groupNode._id), name };
}

export async function addExerciseNode({
  groupId, name, exerciseType, unit, sets,
  startingValues, goals, progressionIncrement, progressionPath,
  rootId, userId,
}) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const exNode = await createNode({ name, parentId: groupId, userId });

  // Build value schema
  const valueSchema = { type: exerciseType || "weight-reps" };
  if (unit) valueSchema.unit = unit;
  if (sets) valueSchema.sets = sets;

  const fitnessMeta = {
    role: "exercise",
    history: [],
    valueSchema,
  };
  if (progressionIncrement) fitnessMeta.progressionIncrement = progressionIncrement;
  if (progressionPath) fitnessMeta.progressionPath = progressionPath;

  await _metadata.setExtMeta(exNode, "fitness", fitnessMeta);

  // Set initial values
  if (startingValues && typeof startingValues === "object") {
    await _metadata.batchSetExtMeta(exNode._id, "values", startingValues);
  }

  // Set goals
  if (goals && typeof goals === "object") {
    await _metadata.batchSetExtMeta(exNode._id, "goals", goals);
  }

  // Create Log -> exercise channel
  if (rootId) {
    await createLogChannel(rootId, exNode._id, name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-log", userId);
  }

  return { id: String(exNode._id), name };
}

export async function removeExerciseNode(exerciseNodeId, userId) {
  try {
    const { deleteNodeBranch } = await import("../../seed/tree/treeManagement.js");
    await deleteNodeBranch(exerciseNodeId, userId, true);
    return true;
  } catch (err) {
    log.warn("Fitness", `Remove exercise failed: ${err.message}`);
    return false;
  }
}

export async function completeSetup(rootId) {
  const rootNode = await _Node.findById(rootId);
  if (!rootNode) return;
  const existing = _metadata.getExtMeta(rootNode, "fitness") || {};
  await _metadata.setExtMeta(rootNode, "fitness", { ...existing, setupPhase: "complete" });
  // Switch from plan mode to coach mode now that setup is done
  await setNodeMode(rootId, "respond", "tree:fitness-coach");
  log.info("Fitness", "Setup phase complete, switched to coach mode");
}

export async function saveProfile(rootId, profile) {
  const rootNode = await _Node.findById(rootId);
  if (!rootNode) return;
  const existing = _metadata.getExtMeta(rootNode, "fitness") || {};
  await _metadata.setExtMeta(rootNode, "fitness", { ...existing, profile });
}

// ── Helpers ──

async function createLogChannel(rootId, targetNodeId, channelName, userId) {
  try {
    // Find the Log node
    const children = await _Node.find({ parent: rootId }).select("_id metadata").lean();
    let logNodeId = null;
    for (const c of children) {
      const meta = c.metadata instanceof Map ? c.metadata.get("fitness") : c.metadata?.fitness;
      if (meta?.role === "log") { logNodeId = String(c._id); break; }
    }
    if (!logNodeId) return;

    const { getExtension } = await import("../loader.js");
    const ch = getExtension("channels");
    if (ch?.exports?.createChannel) {
      await ch.exports.createChannel({
        sourceNodeId: logNodeId,
        targetNodeId: String(targetNodeId),
        channelName,
        direction: "outbound",
        userId,
      });
    }
  } catch (err) {
    log.verbose("Fitness", `Channel creation skipped: ${err.message}`);
  }
}

async function wireFoodChannel(rootId, logNodeId, userId) {
  try {
    const parent = await _Node.findById(rootId).select("parent").lean();
    if (!parent?.parent) return;
    const siblings = await _Node.find({ parent: parent.parent }).select("_id metadata").lean();
    for (const sib of siblings) {
      const sibMeta = sib.metadata instanceof Map ? sib.metadata.get("food") : sib.metadata?.food;
      if (sibMeta?.initialized) {
        const foodChildren = await _Node.find({ parent: sib._id }).select("_id metadata").lean();
        const dailyNode = foodChildren.find(c => {
          const fm = c.metadata instanceof Map ? c.metadata.get("food") : c.metadata?.food;
          return fm?.role === "daily";
        });
        if (dailyNode) {
          const { getExtension } = await import("../loader.js");
          const ch = getExtension("channels");
          if (ch?.exports?.createChannel) {
            await ch.exports.createChannel({
              sourceNodeId: String(logNodeId),
              targetNodeId: String(dailyNode._id),
              channelName: "fitness-food",
              direction: "bidirectional",
              filter: { tags: ["nutrition", "workout"] },
              userId,
            });
            log.info("Fitness", "Channel created: fitness-food (bidirectional with Food/Daily)");
          }
        }
        break;
      }
    }
  } catch (err) {
    log.verbose("Fitness", `Food channel not created: ${err.message}`);
  }
}
