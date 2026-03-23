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
dotenv.config({ path: path.join(__dirname, "../.env") });

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

  console.log("\nMigration complete:");
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped (no versions): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Set default status: ${noVersions}`);

  await mongoose.disconnect();
  console.log("Disconnected.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
