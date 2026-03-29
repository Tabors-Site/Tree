/**
 * Fitness Setup
 *
 * Scaffolds the fitness tree structure. Creates muscle groups,
 * exercises, Log, Program, and History nodes. Sets initial values
 * and goals based on the user's training preference.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";

let _metadata = null;

export function setMetadata(metadata) {
  _metadata = metadata;
}

// ── Default programs ──

const PROGRAMS = {
  hypertrophy: {
    repMin: 8, repMax: 12, sets: 3,
    groups: {
      Chest: [
        { name: "Bench Press", weight: 95 },
        { name: "Incline DB Press", weight: 30 },
        { name: "Cable Flies", weight: 20 },
      ],
      Back: [
        { name: "Pull-ups", weight: 0 },
        { name: "Barbell Rows", weight: 95 },
        { name: "Lat Pulldown", weight: 100 },
      ],
      Legs: [
        { name: "Squats", weight: 135 },
        { name: "Romanian Deadlift", weight: 95 },
        { name: "Leg Press", weight: 180 },
      ],
      Shoulders: [
        { name: "OHP", weight: 65 },
        { name: "Lateral Raises", weight: 15 },
      ],
      Core: [
        { name: "Hanging Leg Raise", weight: 0 },
        { name: "Ab Wheel", weight: 0 },
      ],
      Additional: [
        { name: "Calves", weight: 50 },
        { name: "Neck Curls", weight: 10 },
        { name: "Forearm Curls", weight: 20 },
      ],
    },
    split4: [
      { day: 1, label: "Chest + Shoulders", groups: ["Chest", "Shoulders"] },
      { day: 2, label: "Back + Core", groups: ["Back", "Core"] },
      { day: 3, label: "Rest", groups: [] },
      { day: 4, label: "Legs + Additional", groups: ["Legs", "Additional"] },
      { day: 5, label: "Rest", groups: [] },
    ],
    split3: [
      { day: 1, label: "Push (Chest + Shoulders)", groups: ["Chest", "Shoulders"] },
      { day: 2, label: "Pull (Back + Core)", groups: ["Back", "Core"] },
      { day: 3, label: "Legs + Additional", groups: ["Legs", "Additional"] },
      { day: 4, label: "Rest", groups: [] },
    ],
    split5: [
      { day: 1, label: "Chest", groups: ["Chest"] },
      { day: 2, label: "Back", groups: ["Back"] },
      { day: 3, label: "Shoulders + Core", groups: ["Shoulders", "Core"] },
      { day: 4, label: "Legs", groups: ["Legs"] },
      { day: 5, label: "Additional", groups: ["Additional"] },
    ],
  },
};

// Use hypertrophy as default for strength and general too (just different rep ranges)
PROGRAMS.strength = { ...PROGRAMS.hypertrophy, repMin: 3, repMax: 6, sets: 5 };
PROGRAMS.general = { ...PROGRAMS.hypertrophy, repMin: 8, repMax: 15, sets: 3 };

/**
 * Scaffold the full fitness tree.
 *
 * @param {string} rootId - The fitness root node
 * @param {string} userId - The user
 * @param {object} options - { goal: "hypertrophy"|"strength"|"general", daysPerWeek: 3|4|5 }
 */
export async function scaffoldFitness(rootId, userId, options = {}) {
  const { createNode } = await import("../../seed/tree/treeManagement.js");
  const Node = (await import("../../seed/models/node.js")).default;

  const goal = options.goal || "hypertrophy";
  const days = options.daysPerWeek || 4;
  const program = PROGRAMS[goal] || PROGRAMS.hypertrophy;

  // Create utility nodes
  const logNode = await createNode("Log", null, null, rootId, false, userId);
  const programNode = await createNode("Program", null, null, rootId, false, userId);
  const historyNode = await createNode("History", null, null, rootId, false, userId);

  await _metadata.setExtMeta(logNode, "fitness", { role: "log" });
  await _metadata.setExtMeta(programNode, "fitness", { role: "program" });
  await _metadata.setExtMeta(historyNode, "fitness", { role: "history" });

  // Set mode overrides
  // Mode overrides: set on both the fitness root (so parent classifiers find it)
  // and the Log node (so direct chat at Log uses fitness mode)
  await setNodeMode(rootId, "respond", "tree:fitness-log");
  await setNodeMode(logNode._id, "respond", "tree:fitness-log");

  // Create muscle group nodes and exercises
  const channelPairs = [];
  for (const [groupName, exercises] of Object.entries(program.groups)) {
    const groupNode = await createNode(groupName, null, null, rootId, false, userId);
    await _metadata.setExtMeta(groupNode, "fitness", { role: "muscle-group" });

    for (const exercise of exercises) {
      const exNode = await createNode(exercise.name, null, null, groupNode._id, false, userId);
      await _metadata.setExtMeta(exNode, "fitness", { role: "exercise", history: [] });

      // Set initial values and goals
      const valFields = { weight: exercise.weight };
      const goalFields = {};
      for (let i = 1; i <= program.sets; i++) {
        valFields[`set${i}`] = 0;
        goalFields[`set${i}`] = program.repMax;
      }
      await _metadata.batchSetExtMeta(exNode._id, "values", valFields);
      await _metadata.batchSetExtMeta(exNode._id, "goals", goalFields);

      // Prepare channel creation (Log -> exercise)
      const channelName = exercise.name.toLowerCase().replace(/\s+/g, "-") + "-log";
      channelPairs.push({
        sourceNodeId: String(logNode._id),
        targetNodeId: String(exNode._id),
        channelName,
        direction: "outbound",
        userId,
      });
    }
  }

  // Create channels
  try {
    const { getExtension } = await import("../loader.js");
    const channelsExt = getExtension("channels");
    if (channelsExt?.exports?.createChannel) {
      for (const pair of channelPairs) {
        await channelsExt.exports.createChannel(pair);
      }
      log.info("Fitness", `Created ${channelPairs.length} channels`);
    }
  } catch (err) {
    log.warn("Fitness", `Channel creation failed: ${err.message}`);
  }

  // Write program schedule to Program node
  const splitKey = `split${days}`;
  const split = program[splitKey] || program.split4;
  const programContent = split.map(d =>
    d.groups.length > 0 ? `Day ${d.day}: ${d.label}` : `Day ${d.day}: Rest`
  ).join("\n");

  try {
    const { createNote } = await import("../../seed/tree/notes.js");
    await createNote({
      nodeId: String(programNode._id),
      content: `Program: ${goal}, ${days} days/week\n\n${programContent}`,
      contentType: "text",
      userId,
    });
  } catch {}

  // Mark root as initialized
  const rootNode = await Node.findById(rootId);
  if (rootNode) {
    await _metadata.setExtMeta(rootNode, "fitness", {
      initialized: true,
      goal,
      daysPerWeek: days,
      repRange: [program.repMin, program.repMax],
      defaultSets: program.sets,
    });
  }

  // ── Food-Fitness channel ──
  // If food is a sibling (same parent tree), wire a bidirectional channel
  // so the fitness AI sees nutrition and the food AI sees workouts.
  try {
    const parent = await Node.findById(rootId).select("parent").lean();
    if (parent?.parent) {
      const siblings = await Node.find({ parent: parent.parent }).select("_id metadata").lean();
      for (const sib of siblings) {
        const sibMeta = sib.metadata instanceof Map
          ? sib.metadata.get("food")
          : sib.metadata?.food;
        if (sibMeta?.initialized) {
          // Found food tree. Find its Daily node.
          const foodChildren = await Node.find({ parent: sib._id }).select("_id metadata").lean();
          const dailyNode = foodChildren.find(c => {
            const fm = c.metadata instanceof Map ? c.metadata.get("food") : c.metadata?.food;
            return fm?.role === "daily";
          });
          if (dailyNode) {
            const { getExtension } = await import("../loader.js");
            const ch = getExtension("channels");
            if (ch?.exports?.createChannel) {
              await ch.exports.createChannel({
                sourceNodeId: String(logNode._id),
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
    }
  } catch (err) {
    log.verbose("Fitness", `Food channel not created: ${err.message}`);
  }

  log.info("Fitness", `Scaffolded: ${goal}, ${days} days/week, ${channelPairs.length} exercises`);

  return {
    log: String(logNode._id),
    program: String(programNode._id),
    history: String(historyNode._id),
    exerciseCount: channelPairs.length,
  };
}
