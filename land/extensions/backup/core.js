/**
 * Backup and Restore
 *
 * Reads kernel models directly (allowed for extensions). Knows Node, User, Note,
 * Contribution, AIChat. That's enough to export and import everything.
 *
 * Three modes:
 *   exportLand()    - Full backup. Every node, user, note, contribution. JSON file.
 *   snapshotLand()  - Lightweight. Tree structure + metadata only. No content, no history.
 *   importLand()    - Restore from export. Validates checksum, preserves all metadata.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import Note from "../../seed/models/note.js";
import Contribution from "../../seed/models/contribution.js";
import log from "../../seed/log.js";

let Chat = null;
try { Chat = (await import("../../seed/models/chat.js")).default; } catch {}

let seedVersion = "unknown";
try { seedVersion = (await import("../../seed/version.js")).SEED_VERSION; } catch {}

let getLandConfigValue = () => null;
try {
  const mod = await import("../../seed/landConfig.js");
  getLandConfigValue = mod.getLandConfigValue;
} catch {}

function normalizeDoc(doc) {
  if (doc.metadata instanceof Map) {
    doc.metadata = Object.fromEntries(doc.metadata);
  }
  return doc;
}

/**
 * Full land export.
 */
export async function exportLand(opts = {}) {
  const timestamp = new Date().toISOString();
  log.info("Backup", `Starting full export at ${timestamp}`);

  const nodes = await Node.find({}).lean();
  const users = await User.find({}).select("-password").lean();
  const notes = await Note.find({}).lean();

  const retentionDays = parseInt(getLandConfigValue("contributionRetentionDays") || "365", 10);
  const cutoff = retentionDays > 0
    ? new Date(Date.now() - retentionDays * 86400000)
    : new Date(0);
  const contributions = await Contribution.find({ date: { $gte: cutoff } }).lean();

  const data = {
    _backup: {
      version: 1,
      seedVersion,
      timestamp,
      landName: getLandConfigValue("LAND_NAME") || "Unknown",
    },
    nodes: nodes.map(normalizeDoc),
    users: users.map(normalizeDoc),
    notes,
    contributions,
  };

  const serialized = JSON.stringify(data);
  data._backup.checksum = crypto.createHash("sha256").update(serialized).digest("hex");
  data._backup.sizeBytes = Buffer.byteLength(serialized, "utf8");

  if (opts.outputPath) {
    const dir = path.dirname(opts.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(opts.outputPath, JSON.stringify(data, null, 2));
    log.info("Backup", `Full export: ${opts.outputPath} (${nodes.length} nodes, ${users.length} users, ${notes.length} notes)`);
    return { outputPath: opts.outputPath, nodes: nodes.length, users: users.length, notes: notes.length, contributions: contributions.length };
  }

  log.info("Backup", `Full export complete (${nodes.length} nodes, ${users.length} users, ${notes.length} notes)`);
  return data;
}

/**
 * Lightweight snapshot. Structure + metadata only.
 */
export async function snapshotLand(opts = {}) {
  const timestamp = new Date().toISOString();

  const nodes = await Node.find({}).select("_id name type status parent children rootOwner contributors systemRole metadata visibility dateCreated").lean();
  const users = await User.find({}).select("-password").lean();

  const data = {
    _backup: {
      version: 1,
      seedVersion,
      timestamp,
      type: "snapshot",
      landName: getLandConfigValue("LAND_NAME") || "Unknown",
    },
    nodes: nodes.map(normalizeDoc),
    users: users.map(normalizeDoc),
  };

  const serialized = JSON.stringify(data);
  data._backup.checksum = crypto.createHash("sha256").update(serialized).digest("hex");

  if (opts.outputPath) {
    const dir = path.dirname(opts.outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(opts.outputPath, JSON.stringify(data, null, 2));
    log.info("Backup", `Snapshot: ${opts.outputPath} (${nodes.length} nodes)`);
    return { outputPath: opts.outputPath, nodes: nodes.length, users: users.length };
  }

  return data;
}

/**
 * Restore a land from an export.
 */
export async function importLand(input) {
  let data;
  if (typeof input === "string") {
    if (!fs.existsSync(input)) throw new Error(`Backup file not found: ${input}`);
    const raw = fs.readFileSync(input, "utf8");
    data = JSON.parse(raw);
  } else {
    data = input;
  }

  if (!data?._backup?.version) {
    throw new Error("Invalid backup: missing _backup header");
  }

  // Validate checksum
  const savedChecksum = data._backup.checksum;
  if (savedChecksum) {
    const copy = JSON.parse(JSON.stringify(data));
    delete copy._backup.checksum;
    delete copy._backup.sizeBytes;
    const computed = crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
    if (computed !== savedChecksum) {
      throw new Error(`Checksum mismatch: backup may be corrupted`);
    }
  }

  log.info("Backup", `Restoring from ${data._backup.type || "full"} backup (seed ${data._backup.seedVersion}, ${data._backup.timestamp})`);

  // Drop existing data
  const mongoose = (await import("mongoose")).default;
  const db = mongoose.connection.db;
  for (const col of ["nodes", "users", "notes", "contributions"]) {
    try { await db.collection(col).deleteMany({}); } catch {}
  }

  const report = { nodes: 0, users: 0, notes: 0, contributions: 0 };

  if (data.nodes?.length > 0) {
    const docs = data.nodes.map(n => {
      if (n.metadata && typeof n.metadata === "object" && !(n.metadata instanceof Map)) {
        n.metadata = new Map(Object.entries(n.metadata));
      }
      return n;
    });
    await Node.insertMany(docs, { ordered: false });
    report.nodes = docs.length;
  }

  if (data.users?.length > 0) {
    const docs = data.users.map(u => {
      if (u.metadata && typeof u.metadata === "object" && !(u.metadata instanceof Map)) {
        u.metadata = new Map(Object.entries(u.metadata));
      }
      return u;
    });
    await User.insertMany(docs, { ordered: false });
    report.users = docs.length;
  }

  if (data.notes?.length > 0) {
    await Note.insertMany(data.notes, { ordered: false });
    report.notes = data.notes.length;
  }

  if (data.contributions?.length > 0) {
    await Contribution.insertMany(data.contributions, { ordered: false });
    report.contributions = data.contributions.length;
  }

  log.info("Backup",
    `Restore complete: ${report.nodes} nodes, ${report.users} users, ${report.notes} notes, ${report.contributions} contributions`
  );

  return report;
}

/**
 * List available backups in the backup directory.
 */
export function listBackups(backupPath = "./backups") {
  if (!fs.existsSync(backupPath)) return [];
  return fs.readdirSync(backupPath)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const full = path.join(backupPath, f);
      const stat = fs.statSync(full);
      return { file: f, path: full, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}
