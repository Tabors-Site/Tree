/**
 * Migration: Move legacy top-level User fields into metadata.
 *
 * The schema flatten moved apiKeys, energy, llmAssignments, etc. into
 * metadata with virtuals. Existing user documents still have these as
 * top-level fields. This migration moves them into metadata and unsets
 * the old fields.
 *
 * Run: node land/migrations/user-metadata.js
 * Safe to run multiple times (skips users already migrated).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/tree";

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to ${MONGODB_URI}`);

  const db = mongoose.connection.db;
  const users = db.collection("users");

  // Drop the old unique email index (email moved to metadata.email.address)
  try {
    await users.dropIndex("email_1");
    console.log("Dropped legacy email_1 index");
  } catch (e) {
    if (e.codeName !== "IndexNotFound") console.log("email_1 index:", e.message);
  }

  const cursor = users.find({});
  let migrated = 0;
  let skipped = 0;

  while (await cursor.hasNext()) {
    const user = await cursor.next();
    const $set = {};
    const $unset = {};
    let needsUpdate = false;

    // apiKeys: top-level array -> metadata.apiKeys
    if (Array.isArray(user.apiKeys) && user.apiKeys.length > 0) {
      const existing = user.metadata?.apiKeys || [];
      // Merge: keep metadata keys, add top-level keys that aren't already there
      const existingHashes = new Set((Array.isArray(existing) ? existing : []).map(k => k.keyHash));
      const merged = [...(Array.isArray(existing) ? existing : [])];
      for (const key of user.apiKeys) {
        if (!existingHashes.has(key.keyHash)) {
          merged.push(key);
        }
      }
      $set["metadata.apiKeys"] = merged;
      $unset["apiKeys"] = "";
      needsUpdate = true;
    }

    // availableEnergy: top-level -> metadata.energy.available
    if (user.availableEnergy !== undefined) {
      $set["metadata.energy.available"] = user.availableEnergy;
      $unset["availableEnergy"] = "";
      needsUpdate = true;
    }

    // additionalEnergy: top-level -> metadata.energy.additional
    if (user.additionalEnergy !== undefined) {
      $set["metadata.energy.additional"] = user.additionalEnergy;
      $unset["additionalEnergy"] = "";
      needsUpdate = true;
    }

    // storageUsage: top-level -> metadata.energy.storageUsage
    if (user.storageUsage !== undefined) {
      $set["metadata.energy.storageUsage"] = user.storageUsage;
      $unset["storageUsage"] = "";
      needsUpdate = true;
    }

    // llmAssignments: top-level -> metadata.llmAssignments
    if (user.llmAssignments !== undefined && user.llmAssignments !== null) {
      $set["metadata.llmAssignments"] = user.llmAssignments;
      $unset["llmAssignments"] = "";
      needsUpdate = true;
    }

    // rawIdeaAutoPlace: top-level -> metadata.rawIdeaAutoPlace
    if (user.rawIdeaAutoPlace !== undefined) {
      $set["metadata.rawIdeaAutoPlace"] = user.rawIdeaAutoPlace;
      $unset["rawIdeaAutoPlace"] = "";
      needsUpdate = true;
    }

    // customLlmConnection: top-level -> metadata.customLlmConnection
    if (user.customLlmConnection !== undefined && user.customLlmConnection !== null) {
      $set["metadata.customLlmConnection"] = user.customLlmConnection;
      $unset["customLlmConnection"] = "";
      needsUpdate = true;
    }

    // email + resetPasswordToken + resetPasswordExpiry -> metadata.email
    if ((user.email && typeof user.email === "string") || user.resetPasswordToken || user.resetPasswordExpiry) {
      const existing = user.metadata?.email || {};
      const emailObj = { ...existing };
      if (user.email && typeof user.email === "string") {
        emailObj.address = user.email;
        emailObj.verified = true;
        $unset["email"] = "";
      }
      if (user.resetPasswordToken) {
        emailObj.resetToken = user.resetPasswordToken;
        $unset["resetPasswordToken"] = "";
      }
      if (user.resetPasswordExpiry) {
        emailObj.resetExpiry = user.resetPasswordExpiry;
        $unset["resetPasswordExpiry"] = "";
      }
      $set["metadata.email"] = emailObj;
      needsUpdate = true;
    }

    // planExpiresAt: top-level -> metadata.billing.planExpiresAt (if billing extension owns it)
    if (user.planExpiresAt !== undefined && user.planExpiresAt !== null) {
      $set["metadata.billing.planExpiresAt"] = user.planExpiresAt;
      $unset["planExpiresAt"] = "";
      needsUpdate = true;
    }

    // htmlShareToken: top-level -> metadata.html.shareToken (html-rendering extension)
    if (user.htmlShareToken) {
      const existing = user.metadata?.html || {};
      $set["metadata.html"] = { ...existing, shareToken: user.htmlShareToken };
      $unset["htmlShareToken"] = "";
      needsUpdate = true;
    }

    if (needsUpdate) {
      const update = {};
      if (Object.keys($set).length) update.$set = $set;
      if (Object.keys($unset).length) update.$unset = $unset;
      await users.updateOne({ _id: user._id }, update);
      migrated++;
      console.log(`  Migrated: ${user.username} (${user._id})`);
    } else {
      skipped++;
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Already clean: ${skipped}`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
