/**
 * One-time migration: Flatten Node schema
 *
 * Moves data from versions[prestige] array to flat fields:
 *   - versions[prestige].status -> node.status
 *   - versions[prestige].values -> metadata.values
 *   - versions[prestige].goals -> metadata.goals
 *   - versions[prestige].schedule -> metadata.schedule
 *   - versions[prestige].reeffectTime -> metadata.reeffectTime
 *   - Full versions array -> metadata.prestige.history (if prestige > 0)
 *   - node.prestige -> metadata.prestige.current
 *
 * Safe to run multiple times (skips nodes already migrated).
 * Does NOT delete old fields (Mongoose ignores them since they're removed from schema).
 *
 * Usage:
 *   node land/migrations/flattenSchema.js
 *
 *   Or with custom MongoDB URI:
 *   MONGO_URI=mongodb://localhost:27017/treeos node land/migrations/flattenSchema.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/treeos";

async function migrate() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  // Use raw collection to access fields removed from schema
  const db = mongoose.connection.db;
  const nodesCollection = db.collection("nodes");

  const totalNodes = await nodesCollection.countDocuments();
  console.log(`Total nodes: ${totalNodes}`);

  // Find nodes that have the old versions array
  const cursor = nodesCollection.find({
    versions: { $exists: true, $ne: null, $not: { $size: 0 } }
  });

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for await (const node of cursor) {
    try {
      const prestige = node.prestige || 0;
      const versions = node.versions || [];

      if (versions.length === 0) {
        skipped++;
        continue;
      }

      // Get current version data
      const currentVersion = versions[prestige] || versions[versions.length - 1] || {};

      // Build metadata updates
      const metadata = node.metadata || {};

      // Values and goals
      const values = currentVersion.values;
      const goals = currentVersion.goals;

      if (values && (values instanceof Map ? values.size > 0 : Object.keys(values).length > 0)) {
        const valObj = values instanceof Map ? Object.fromEntries(values) : values;
        metadata.values = valObj;
      }

      if (goals && (goals instanceof Map ? goals.size > 0 : Object.keys(goals).length > 0)) {
        const goalObj = goals instanceof Map ? Object.fromEntries(goals) : goals;
        metadata.goals = goalObj;
      }

      // Schedule
      if (currentVersion.schedule) {
        metadata.schedule = currentVersion.schedule;
      }

      if (currentVersion.reeffectTime) {
        metadata.reeffectTime = currentVersion.reeffectTime;
      }

      // Prestige history (only if prestige > 0)
      if (prestige > 0) {
        const history = [];
        for (let i = 0; i < versions.length; i++) {
          if (i === prestige) continue; // skip current, it's now the flat state
          const v = versions[i];
          history.push({
            version: i,
            status: v.status || "completed",
            values: v.values instanceof Map ? Object.fromEntries(v.values) : (v.values || {}),
            goals: v.goals instanceof Map ? Object.fromEntries(v.goals) : (v.goals || {}),
            schedule: v.schedule || null,
            reeffectTime: v.reeffectTime || 0,
            archivedAt: v.dateCreated || new Date().toISOString(),
          });
        }

        metadata.prestige = {
          current: prestige,
          history,
        };
      }

      // Flatten status
      const status = currentVersion.status || "active";

      // Update the node
      const updateOp = {
        $set: {
          status,
          metadata,
        },
        $unset: {
          versions: "",
          prestige: "",
        },
      };

      // Add dateCreated if the current version has it
      if (currentVersion.dateCreated) {
        updateOp.$set.dateCreated = currentVersion.dateCreated;
      }

      await nodesCollection.updateOne({ _id: node._id }, updateOp);
      migrated++;

      if (migrated % 100 === 0) {
        console.log(`  Migrated ${migrated} nodes...`);
      }
    } catch (err) {
      console.error(`  Error migrating node ${node._id}: ${err.message}`);
      errors++;
    }
  }

  // Also handle nodes that have versions but it's empty, or no versions at all
  // These just need status set if missing
  const noVersions = await nodesCollection.countDocuments({
    $or: [
      { versions: { $exists: false } },
      { versions: { $size: 0 } },
      { versions: null },
    ],
    status: { $exists: false },
  });

  if (noVersions > 0) {
    console.log(`Setting default status on ${noVersions} nodes without versions...`);
    await nodesCollection.updateMany(
      {
        $or: [
          { versions: { $exists: false } },
          { versions: { $size: 0 } },
          { versions: null },
        ],
        status: { $exists: false },
      },
      { $set: { status: "active" } },
    );
  }

  // ── Phase 2: Move visibility, dreamTime, lastDreamAt to metadata ──
  console.log("\nPhase 2: Moving visibility, dreamTime, lastDreamAt to metadata...");

  // Visibility -> metadata.visibility.level
  const visNodes = await nodesCollection.countDocuments({
    visibility: { $exists: true, $ne: null },
  });
  if (visNodes > 0) {
    const visCursor = nodesCollection.find({ visibility: { $exists: true, $ne: null } });
    let visCount = 0;
    for await (const node of visCursor) {
      const meta = node.metadata || {};
      meta.visibility = { level: node.visibility || "private" };
      await nodesCollection.updateOne(
        { _id: node._id },
        { $set: { metadata: meta }, $unset: { visibility: "" } },
      );
      visCount++;
    }
    console.log(`  Moved visibility for ${visCount} nodes`);
  }

  // dreamTime + lastDreamAt -> metadata.dreams
  const dreamNodes = await nodesCollection.countDocuments({
    $or: [
      { dreamTime: { $exists: true, $ne: null } },
      { lastDreamAt: { $exists: true, $ne: null } },
    ],
  });
  if (dreamNodes > 0) {
    const dreamCursor = nodesCollection.find({
      $or: [
        { dreamTime: { $exists: true, $ne: null } },
        { lastDreamAt: { $exists: true, $ne: null } },
      ],
    });
    let dreamCount = 0;
    for await (const node of dreamCursor) {
      const meta = node.metadata || {};
      if (!meta.dreams) meta.dreams = {};
      if (node.dreamTime) meta.dreams.dreamTime = node.dreamTime;
      if (node.lastDreamAt) meta.dreams.lastDreamAt = node.lastDreamAt;
      await nodesCollection.updateOne(
        { _id: node._id },
        { $set: { metadata: meta }, $unset: { dreamTime: "", lastDreamAt: "" } },
      );
      dreamCount++;
    }
    console.log(`  Moved dreamTime/lastDreamAt for ${dreamCount} nodes`);
  }

  // LLM assignments: default -> llmDefault, rest -> metadata.llm.slots
  const llmNodes = await nodesCollection.countDocuments({
    llmAssignments: { $exists: true, $ne: null },
  });
  if (llmNodes > 0) {
    const llmCursor = nodesCollection.find({ llmAssignments: { $exists: true, $ne: null } });
    let llmCount = 0;
    for await (const node of llmCursor) {
      const assignments = node.llmAssignments || {};
      const $set = {};
      if (assignments.default) {
        $set.llmDefault = assignments.default;
      }
      const slots = {};
      for (const [key, val] of Object.entries(assignments)) {
        if (key !== "default" && val) slots[key] = val;
      }
      if (Object.keys(slots).length > 0) {
        const meta = node.metadata || {};
        if (!meta.llm) meta.llm = {};
        meta.llm.slots = slots;
        $set.metadata = meta;
      }
      await nodesCollection.updateOne(
        { _id: node._id },
        { $set, $unset: { llmAssignments: "" } },
      );
      llmCount++;
    }
    console.log(`  Moved llmAssignments for ${llmCount} nodes`);
  }

  // ── Phase 3: Move transactionPolicy, scripts to metadata ──
  console.log("\nPhase 3: Moving transactionPolicy, scripts to metadata...");

  // transactionPolicy -> metadata.transactions.policy
  const tpNodes = await nodesCollection.countDocuments({
    transactionPolicy: { $exists: true },
  });
  if (tpNodes > 0) {
    const tpCursor = nodesCollection.find({ transactionPolicy: { $exists: true } });
    let tpCount = 0;
    for await (const node of tpCursor) {
      const meta = node.metadata || {};
      if (!meta.transactions) meta.transactions = {};
      meta.transactions.policy = node.transactionPolicy;
      await nodesCollection.updateOne(
        { _id: node._id },
        { $set: { metadata: meta }, $unset: { transactionPolicy: "" } },
      );
      tpCount++;
    }
    console.log(`  Moved transactionPolicy for ${tpCount} nodes`);
  }

  // scripts -> metadata.scripts
  const scriptNodes = await nodesCollection.countDocuments({
    scripts: { $exists: true, $ne: null, $not: { $size: 0 } },
  });
  if (scriptNodes > 0) {
    const sCursor = nodesCollection.find({ scripts: { $exists: true, $ne: null, $not: { $size: 0 } } });
    let sCount = 0;
    for await (const node of sCursor) {
      const meta = node.metadata || {};
      meta.scripts = node.scripts;
      await nodesCollection.updateOne(
        { _id: node._id },
        { $set: { metadata: meta }, $unset: { scripts: "" } },
      );
      sCount++;
    }
    console.log(`  Moved scripts for ${sCount} nodes`);
  }

  // Clean up stale top-level prestige field (numeric, already moved to metadata.prestige)
  const stalePrestige = await nodesCollection.countDocuments({
    prestige: { $exists: true, $type: "number" },
  });
  if (stalePrestige > 0) {
    const pCursor = nodesCollection.find({ prestige: { $exists: true, $type: "number" } });
    let pCount = 0;
    for await (const node of pCursor) {
      const meta = node.metadata || {};
      if (!meta.prestige) {
        meta.prestige = { current: node.prestige || 0, history: [] };
      }
      await nodesCollection.updateOne(
        { _id: node._id },
        { $set: { metadata: meta }, $unset: { prestige: "", versions: "" } },
      );
      pCount++;
    }
    console.log(`  Cleaned stale prestige for ${pCount} nodes`);
  }

  console.log("\nNode migration complete:");
  console.log(`  Phase 1 (versions): ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
  console.log(`  Phase 1 (default status): ${noVersions}`);
  console.log(`  Phase 2 (visibility): ${visNodes}`);
  console.log(`  Phase 2 (dreams): ${dreamNodes}`);
  console.log(`  Phase 2 (llmAssignments): ${llmNodes}`);
  console.log(`  Phase 3 (transactionPolicy): ${tpNodes}`);
  console.log(`  Phase 3 (scripts): ${scriptNodes}`);
  console.log(`  Phase 3 (stale prestige): ${stalePrestige}`);

  await mongoose.disconnect();
  console.log("Disconnected.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
