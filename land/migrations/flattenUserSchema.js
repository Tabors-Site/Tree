/**
 * One-time migration: Flatten User schema
 *
 * Moves extension-specific fields to user.metadata:
 *   - apiKeys -> metadata.apiKeys
 *   - profileType -> metadata.billing.profileType
 *   - planExpiresAt -> metadata.billing.planExpiresAt
 *   - availableEnergy -> metadata.energy.available
 *   - additionalEnergy -> metadata.energy.additional
 *   - storageUsage -> metadata.energy.storageUsage
 *   - llmAssignments -> metadata.userLlm.assignments
 *   - rawIdeaAutoPlace -> metadata.rawIdeas.autoPlace
 *
 * Usage:
 *   node land/migrations/flattenUserSchema.js
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

  const db = mongoose.connection.db;
  const usersCollection = db.collection("users");

  const totalUsers = await usersCollection.countDocuments();
  console.log(`Total users: ${totalUsers}`);

  const cursor = usersCollection.find({});
  let migrated = 0;
  let skipped = 0;

  for await (const user of cursor) {
    const metadata = user.metadata || {};

    let changed = false;

    // API Keys
    if (user.apiKeys && user.apiKeys.length > 0) {
      metadata.apiKeys = user.apiKeys;
      changed = true;
    }

    // profileType stays on schema (core auth)
    // planExpiresAt moves to metadata.billing
    if (user.planExpiresAt) {
      if (!metadata.billing) metadata.billing = {};
      metadata.billing.planExpiresAt = user.planExpiresAt;
      changed = true;
    }

    // Energy
    if (user.availableEnergy || user.additionalEnergy || user.storageUsage) {
      metadata.energy = {
        available: user.availableEnergy || { amount: 350, lastResetAt: new Date() },
        additional: user.additionalEnergy || { amount: 0, lastResetAt: new Date() },
        storageUsage: user.storageUsage || 0,
      };
      changed = true;
    }

    // LLM Assignments
    if (user.llmAssignments && (user.llmAssignments.main || user.llmAssignments.rawIdea)) {
      metadata.userLlm = {
        assignments: user.llmAssignments,
      };
      changed = true;
    }

    // Raw Idea Auto Place
    if (user.rawIdeaAutoPlace !== undefined) {
      metadata.rawIdeas = {
        autoPlace: user.rawIdeaAutoPlace,
      };
      changed = true;
    }

    if (changed) {
      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: { metadata },
          $unset: {
            apiKeys: "",
            planExpiresAt: "",
            availableEnergy: "",
            additionalEnergy: "",
            storageUsage: "",
            llmAssignments: "",
            rawIdeaAutoPlace: "",
          },
        },
      );
      migrated++;
    } else {
      skipped++;
    }
  }

  console.log(`\nMigration complete:`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped: ${skipped}`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
