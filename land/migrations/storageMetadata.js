/**
 * Migration: Move storageUsage from metadata.energy to metadata.storage
 *
 * Before: user.metadata.energy.storageUsage = 1234
 * After:  user.metadata.storage.usageKB = 1234
 *
 * Run once after deploying the storage decoupling changes.
 * Safe to run multiple times (skips users already migrated).
 *
 * Usage: node land/migrations/storageMetadata.js
 */

import mongoose from "../seed/dbConfig.js";

const User = mongoose.model("User") || mongoose.model("User", new mongoose.Schema({}, { strict: false }));

async function migrate() {
  console.log("Starting storage metadata migration...");

  const users = await User.find({
    "metadata.energy.storageUsage": { $exists: true, $gt: 0 },
  }).select("_id username metadata");

  console.log(`Found ${users.length} user(s) with energy.storageUsage to migrate`);

  let migrated = 0;
  for (const user of users) {
    const energyMeta = user.metadata?.get?.("energy") || user.metadata?.energy || {};
    const storageMeta = user.metadata?.get?.("storage") || user.metadata?.storage || {};

    // Skip if already migrated
    if (storageMeta.usageKB > 0) {
      console.log(`  Skipping ${user.username} (already has storage.usageKB = ${storageMeta.usageKB})`);
      continue;
    }

    const usageKB = energyMeta.storageUsage || 0;
    if (usageKB <= 0) continue;

    await User.findByIdAndUpdate(user._id, {
      $set: { "metadata.storage.usageKB": usageKB },
      $unset: { "metadata.energy.storageUsage": "" },
    });

    migrated++;
    console.log(`  Migrated ${user.username}: ${usageKB} KB`);
  }

  console.log(`Done. Migrated ${migrated} user(s).`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
