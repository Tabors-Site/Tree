// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Index Verification
 *
 * The kernel defines the indexes required for its query patterns.
 * On boot, after database connection and before anything else,
 * the kernel ensures those indexes exist. If they don't, it creates them.
 *
 * The ancestor cache solved depth. Indexes solve scale. Together the kernel
 * is fast at ten nodes and fast at ten million. Without indexes, the cache
 * just means you walk fast to a node and then wait forever for the query
 * at that node to return.
 *
 * Mongoose schema-level indexes (in model files) are declared but not guaranteed.
 * This module verifies them at boot and creates any that are missing.
 * It also covers indexes that don't map to a single schema field
 * (compound indexes, metadata path indexes, cross-collection concerns).
 */

import log from "../log.js";
import mongoose from "mongoose";
import { getLandConfigValue } from "../landConfig.js";

function MAX_EXTENSION_INDEXES() { return Math.max(5, Math.min(Number(getLandConfigValue("maxExtensionIndexes")) || 20, 100)); }

/**
 * Required kernel indexes. Each entry specifies:
 *   collection: MongoDB collection name (Mongoose pluralizes model names)
 *   fields: index key specification
 *   options: optional index options (unique, sparse, etc.)
 */
const REQUIRED_INDEXES = [
  // Node queries
  { collection: "nodes", fields: { parent: 1 }, options: {} },
  { collection: "nodes", fields: { systemRole: 1 }, options: { sparse: true } },
  { collection: "nodes", fields: { rootOwner: 1 }, options: {} },
  // .flow partition lookup (child nodes of .flow, queried by name which is a date string)
  { collection: "nodes", fields: { parent: 1, name: 1 }, options: {} },
  // Navigation queries: filter children by status at a given parent
  { collection: "nodes", fields: { parent: 1, status: 1 }, options: {} },
  // Tree-wide recency queries: find latest nodes per tree root
  { collection: "nodes", fields: { rootOwner: 1, dateCreated: -1 }, options: {} },
  // System node lookup within a parent (e.g., .extensions children)
  { collection: "nodes", fields: { parent: 1, systemRole: 1 }, options: { sparse: true } },

  // Note queries (notes loaded by nodeId on every context build and note CRUD)
  { collection: "notes", fields: { nodeId: 1, createdAt: -1 }, options: {} },

  // Contribution queries (audit trail by node and by user)
  { collection: "contributions", fields: { nodeId: 1, date: -1 }, options: {} },
  { collection: "contributions", fields: { userId: 1, date: -1 }, options: {} },
  { collection: "contributions", fields: { sessionId: 1 }, options: { sparse: true } },
  // Contribution lookup by chatId (finalizeChat collects contributions per chat)
  { collection: "contributions", fields: { chatId: 1 }, options: { sparse: true } },

  // User queries (login by username, already unique in schema but verify)
  { collection: "users", fields: { username: 1 }, options: { unique: true } },

  // AIChat queries (chat history by user, by session, by node)
  { collection: "aichats", fields: { userId: 1, "startMessage.time": -1 }, options: {} },
  { collection: "aichats", fields: { sessionId: 1, chainIndex: 1 }, options: {} },
  { collection: "aichats", fields: { "treeContext.targetNodeId": 1 }, options: { sparse: true } },
  // Chat retention cleanup: deleteMany by startMessage.time
  { collection: "aichats", fields: { "startMessage.time": 1 }, options: {} },
  // Mode zone queries
  { collection: "aichats", fields: { "aiContext.zone": 1 }, options: {} },

  // LLM connection queries (connections by user)
  { collection: "llmconnections", fields: { userId: 1 }, options: {} },
];

// Kernel collection names. Extension indexes cannot target these.
const KERNEL_COLLECTIONS = new Set([
  "nodes", "users", "notes", "contributions", "aichats", "llmconnections",
]);

/**
 * Ensure all required indexes exist. Creates missing ones.
 * Call after database connection, before anything else.
 *
 * Groups checks by collection to avoid redundant listIndexes calls.
 *
 * @returns {Promise<{ verified: number, created: number, errors: string[] }>}
 */
export async function ensureIndexes() {
  const report = { verified: 0, created: 0, errors: [] };
  const db = mongoose.connection.db;
  if (!db) {
    report.errors.push("Database not connected");
    return report;
  }

  // Group required indexes by collection
  const byCollection = new Map();
  for (const idx of REQUIRED_INDEXES) {
    if (!byCollection.has(idx.collection)) byCollection.set(idx.collection, []);
    byCollection.get(idx.collection).push(idx);
  }

  for (const [collName, indexes] of byCollection) {
    let existing;
    try {
      existing = await db.collection(collName).indexes();
    } catch (err) {
      const msg = `Failed to list indexes on ${collName}: ${err.message}`;
      report.errors.push(msg);
      log.warn("Indexes", msg);
      continue;
    }

    for (const idx of indexes) {
      try {
        const fieldKeys = Object.keys(idx.fields);
        const alreadyExists = existing.some(ex => {
          if (!ex.key) return false;
          const exKeys = Object.keys(ex.key);
          if (exKeys.length !== fieldKeys.length) return false;
          return fieldKeys.every((k, i) => exKeys[i] === k && ex.key[k] === idx.fields[k]);
        });

        if (alreadyExists) {
          report.verified++;
        } else {
          await db.collection(collName).createIndex(idx.fields, idx.options || {});
          report.created++;
          log.verbose("Indexes", `Created index on ${collName}: ${JSON.stringify(idx.fields)}`);
        }
      } catch (err) {
        const msg = `${collName} ${JSON.stringify(idx.fields)}: ${err.message}`;
        report.errors.push(msg);
        log.warn("Indexes", `Index verification failed: ${msg}`);
      }
    }
  }

  if (report.created > 0) {
    log.info("Indexes", `${report.verified} verified, ${report.created} created`);
  } else {
    log.verbose("Indexes", `All ${report.verified} indexes verified`);
  }

  if (report.errors.length > 0) {
    log.warn("Indexes", `${report.errors.length} index error(s)`);
  }

  return report;
}

/**
 * Ensure extension-declared indexes exist.
 * Called by the loader during the wire phase.
 *
 * Extensions cannot create indexes on kernel collections.
 * Capped at MAX_EXTENSION_INDEXES per extension.
 * Unique indexes are rejected (extensions cannot enforce uniqueness on shared collections).
 *
 * @param {Array<{ collection: string, fields: object, options?: object }>} indexes
 * @param {string} extName - for logging
 */
export async function ensureExtensionIndexes(indexes, extName) {
  if (!indexes || !Array.isArray(indexes) || indexes.length === 0) return;
  const db = mongoose.connection.db;
  if (!db) return;

  const maxIdx = MAX_EXTENSION_INDEXES();
  if (indexes.length > maxIdx) {
    log.warn("Indexes", `Extension ${extName} declares ${indexes.length} indexes (max ${maxIdx}). Excess skipped.`);
    indexes = indexes.slice(0, maxIdx);
  }

  for (const idx of indexes) {
    if (!idx.collection || typeof idx.collection !== "string") continue;
    if (!idx.fields || typeof idx.fields !== "object") continue;

    // Extensions cannot create indexes on kernel collections
    if (KERNEL_COLLECTIONS.has(idx.collection)) {
      log.warn("Indexes", `Extension ${extName} tried to create index on kernel collection "${idx.collection}". Rejected.`);
      continue;
    }

    // Extensions cannot create unique indexes (could break writes for other extensions)
    const opts = { ...(idx.options || {}) };
    if (opts.unique) {
      log.warn("Indexes", `Extension ${extName} tried to create unique index on ${idx.collection}. Unique removed.`);
      delete opts.unique;
    }

    // Validate field keys don't contain dangerous operators
    const fieldKeys = Object.keys(idx.fields);
    if (fieldKeys.some(k => k.startsWith("$"))) {
      log.warn("Indexes", `Extension ${extName} index on ${idx.collection} has $ operator in field key. Rejected.`);
      continue;
    }

    try {
      await db.collection(idx.collection).createIndex(idx.fields, opts);
      log.verbose("Indexes", `Extension ${extName}: ensured index on ${idx.collection}`);
    } catch (err) {
      log.warn("Indexes", `Extension ${extName} index failed on ${idx.collection}: ${err.message}`);
    }
  }
}
