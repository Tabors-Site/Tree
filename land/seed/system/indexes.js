// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The index floor every query stands on.
//
// Mongoose creates schema-declared indexes lazily (autoIndex). At
// genesis I verify the set explicitly and add the compound / partial
// indexes that don't fit a single schema declaration. Failures surface
// loudly so the operator knows when an index never materialized.
//
// Schema-declared indexes (see each model file) are NOT redeclared
// here; Mongoose owns those. This module covers what sits outside the
// schemas: cross-collection query patterns and compound keys.
//
// Extensions declare their own indexes through `ensureExtensionIndexes`
// (called by the loader during the wire phase). They cannot touch the
// kernel's collections, cannot enforce uniqueness on shared ones, and
// are capped per-extension to keep one runaway from degrading writes.

import log from "./log.js";
import mongoose from "mongoose";
import { getLandConfigValue } from "../landConfig.js";

function MAX_EXTENSION_INDEXES() {
  return Math.max(5, Math.min(Number(getLandConfigValue("maxExtensionIndexes")) || 20, 100));
}

/**
 * Additional kernel indexes — only those NOT already declared in a
 * model's schema. Each entry:
 *   collection : MongoDB collection name (matches the model's third arg)
 *   fields     : index key specification
 *   options    : index options (sparse / unique / partialFilterExpression)
 *
 * Schema-declared indexes are not duplicated here; Mongoose handles
 * those when autoIndex runs at model load.
 */
const REQUIRED_INDEXES = [
  // Spaces — .flow partition lookups (children of .flow keyed by date
  // string in `name`), and recency queries scoped to a tree root.
  { collection: "spaces", fields: { parent: 1, name: 1 } },
  { collection: "spaces", fields: { rootOwner: 1, dateCreated: -1 } },
  { collection: "spaces", fields: { parent: 1, seedSpace: 1 }, options: { sparse: true } },
];

/**
 * Kernel collection names. Extensions cannot create indexes on these.
 * Must match the third arg of each `mongoose.model(Name, Schema, COLL)`
 * call in seed/models/, or the default Mongoose pluralization where
 * the third arg is omitted.
 */
const KERNEL_COLLECTIONS = new Set([
  "spaces",                // Space (default pluralization of "Space")
  "beings",                // Being
  "matters",               // Matter
  "dids",                  // Did
  "summons",               // Summon
  "customllmconnections",  // LlmConnection (legacy collection name preserved)
]);

/**
 * Ensure required kernel indexes exist. Creates anything missing.
 * Schema-declared indexes are left to Mongoose's autoIndex.
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

  // Group required indexes by collection so we list each collection once.
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
      // listIndexes throws if the collection doesn't exist yet. Treat
      // that as "no existing indexes" — the createIndex call will
      // create the collection lazily.
      if (err?.codeName === "NamespaceNotFound" || /ns does not exist/.test(err.message)) {
        existing = [];
      } else {
        const msg = `Failed to list indexes on ${collName}: ${err.message}`;
        report.errors.push(msg);
        log.warn("Indexes", msg);
        continue;
      }
    }

    for (const idx of indexes) {
      try {
        const fieldKeys = Object.keys(idx.fields);
        const alreadyExists = existing.some((ex) => {
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
    log.verbose("Indexes", `all ${report.verified} kernel indexes verified`);
  }
  if (report.errors.length > 0) {
    log.warn("Indexes", `${report.errors.length} index error(s)`);
  }

  return report;
}

/**
 * Ensure extension-declared indexes exist. Called by the loader during
 * the wire phase. Header above describes the safety rails.
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
    log.warn("Indexes",
      `Extension ${extName} declares ${indexes.length} indexes (max ${maxIdx}). Excess skipped.`);
    indexes = indexes.slice(0, maxIdx);
  }

  for (const idx of indexes) {
    if (!idx.collection || typeof idx.collection !== "string") continue;
    if (!idx.fields || typeof idx.fields !== "object") continue;

    if (KERNEL_COLLECTIONS.has(idx.collection)) {
      log.warn("Indexes",
        `Extension ${extName} tried to create index on kernel collection "${idx.collection}". Rejected.`);
      continue;
    }

    // Strip any unique flag — extensions can't enforce uniqueness on a
    // collection they share with the kernel or with other extensions.
    const opts = { ...(idx.options || {}) };
    if (opts.unique) {
      log.warn("Indexes",
        `Extension ${extName} tried to create unique index on ${idx.collection}. Unique removed.`);
      delete opts.unique;
    }

    // Reject $-prefixed field keys — they'd be Mongo operators, not
    // field paths.
    const fieldKeys = Object.keys(idx.fields);
    if (fieldKeys.some((k) => k.startsWith("$"))) {
      log.warn("Indexes",
        `Extension ${extName} index on ${idx.collection} has $ operator in field key. Rejected.`);
      continue;
    }

    try {
      await db.collection(idx.collection).createIndex(idx.fields, opts);
      log.verbose("Indexes", `Extension ${extName}: ensured index on ${idx.collection}`);
    } catch (err) {
      log.warn("Indexes",
        `Extension ${extName} index failed on ${idx.collection}: ${err.message}`);
    }
  }
}
