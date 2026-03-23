/**
 * One-time migration: Flatten User schema
 *
 * Moves extension-specific fields to user.metadata:
 *   - apiKeys -> metadata.apiKeys
 *   - planExpiresAt -> metadata.billing.planExpiresAt
 *   - availableEnergy -> metadata.energy.available
 *   - additionalEnergy -> metadata.energy.additional
 *   - storageUsage -> metadata.energy.storageUsage
 *   - llmAssignments (non-main) -> metadata.userLlm.slots
 *   - llmAssignments.main -> llmDefault (stays on schema)
 *   - rawIdeaAutoPlace -> metadata.rawIdeas.autoPlace
 *   - email -> metadata.auth.email
 *   - htmlShareToken -> metadata.html.shareToken
 *   - resetPasswordToken -> metadata.auth.resetPasswordToken
 *   - resetPasswordExpiry -> metadata.auth.resetPasswordExpiry
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
    const $set = { metadata };
    const $unset = {};
    let changed = false;

    // API Keys
    if (user.apiKeys && user.apiKeys.length > 0) {
      metadata.apiKeys = user.apiKeys;
      $unset.apiKeys = "";
      changed = true;
    }

    // planExpiresAt -> metadata.billing
    if (user.planExpiresAt) {
      if (!metadata.billing) metadata.billing = {};
      metadata.billing.planExpiresAt = user.planExpiresAt;
      $unset.planExpiresAt = "";
      changed = true;
    }

    // Energy
    if (user.availableEnergy || user.additionalEnergy || user.storageUsage) {
      metadata.energy = {
        available: user.availableEnergy || { amount: 350, lastResetAt: new Date() },
        additional: user.additionalEnergy || { amount: 0, lastResetAt: new Date() },
        storageUsage: user.storageUsage || 0,
      };
      $unset.availableEnergy = "";
      $unset.additionalEnergy = "";
      $unset.storageUsage = "";
      changed = true;
    }

    // LLM Assignments: main -> llmDefault (core), others -> metadata.userLlm.slots
    if (user.llmAssignments) {
      if (user.llmAssignments.main) {
        $set.llmDefault = user.llmAssignments.main;
      }
      const slots = {};
      for (const [key, val] of Object.entries(user.llmAssignments)) {
        if (key !== "main" && val) slots[key] = val;
      }
      if (Object.keys(slots).length > 0) {
        if (!metadata.userLlm) metadata.userLlm = {};
        metadata.userLlm.slots = slots;
      }
      $unset.llmAssignments = "";
      changed = true;
    }

    // Raw Idea Auto Place
    if (user.rawIdeaAutoPlace !== undefined) {
      if (!metadata.rawIdeas) metadata.rawIdeas = {};
      metadata.rawIdeas.autoPlace = user.rawIdeaAutoPlace;
      $unset.rawIdeaAutoPlace = "";
      changed = true;
    }

    // Email -> metadata.auth.email
    if (user.email) {
      if (!metadata.auth) metadata.auth = {};
      metadata.auth.email = user.email;
      $unset.email = "";
      changed = true;
    }

    // HTML Share Token -> metadata.html.shareToken
    if (user.htmlShareToken) {
      if (!metadata.html) metadata.html = {};
      metadata.html.shareToken = user.htmlShareToken;
      $unset.htmlShareToken = "";
      changed = true;
    }

    // Reset Password -> metadata.auth
    if (user.resetPasswordToken) {
      if (!metadata.auth) metadata.auth = {};
      metadata.auth.resetPasswordToken = user.resetPasswordToken;
      metadata.auth.resetPasswordExpiry = user.resetPasswordExpiry;
      $unset.resetPasswordToken = "";
      $unset.resetPasswordExpiry = "";
      changed = true;
    }

    if (changed) {
      const update = { $set };
      if (Object.keys($unset).length > 0) update.$unset = $unset;
      await usersCollection.updateOne({ _id: user._id }, update);
      migrated++;
    } else {
      skipped++;
    }
  }

  console.log(`\nUser migration complete:`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped: ${skipped}`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
