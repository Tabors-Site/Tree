/**
 * Learned vocabulary sidecar file helpers.
 *
 * The misroute extension auto-promotes vocabulary suggestions to a sidecar
 * JSON file inside the target extension's directory:
 *
 *   land/extensions/{extName}/vocabulary.learned.json
 *
 * The loader's `getVocabularyForExtension` reads this file and merges it
 * with the manifest's authored vocabulary. This means promoted entries
 * take effect after a routing index rebuild without touching manifest.js.
 *
 * Format:
 *   {
 *     "$schema": "vocabulary-learned-v1",
 *     "lastUpdated": "2026-04-12T...",
 *     "nouns": [
 *       {
 *         "pattern": "\\b(bill)\\b",
 *         "addedAt": "2026-04-12T...",
 *         "trigger": "5 misroutes from finance",
 *         "fromUserId": "..."
 *       }
 *     ],
 *     "verbs": [],
 *     "adjectives": []
 *   }
 *
 * The pattern is stored as a regex source string (not a RegExp instance)
 * because JSON can't serialize RegExp. The loader compiles them on read.
 */

import fs from "fs";
import path from "path";
import log from "../../seed/log.js";

const SCHEMA = "vocabulary-learned-v1";
const FILE_NAME = "vocabulary.learned.json";
const VALID_BUCKETS = new Set(["nouns", "verbs", "adjectives"]);

function emptyFile() {
  return {
    $schema: SCHEMA,
    lastUpdated: new Date().toISOString(),
    nouns: [],
    verbs: [],
    adjectives: [],
  };
}

/**
 * Read the learned file for an extension. Returns the parsed structure
 * or a fresh empty structure if missing/corrupt.
 */
export function readLearnedFile(extDir) {
  if (!extDir) return emptyFile();
  const filePath = path.join(extDir, FILE_NAME);
  try {
    if (!fs.existsSync(filePath)) return emptyFile();
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyFile();
    // Normalize buckets in case of partial files
    return {
      $schema: parsed.$schema || SCHEMA,
      lastUpdated: parsed.lastUpdated || new Date().toISOString(),
      nouns: Array.isArray(parsed.nouns) ? parsed.nouns : [],
      verbs: Array.isArray(parsed.verbs) ? parsed.verbs : [],
      adjectives: Array.isArray(parsed.adjectives) ? parsed.adjectives : [],
    };
  } catch (err) {
    log.warn("Misroute", `Failed to read learned file at ${filePath}: ${err.message}`);
    return emptyFile();
  }
}

/**
 * Write the learned file for an extension. Atomic-ish: write to temp, rename.
 * Returns true on success, false on failure.
 */
export function writeLearnedFile(extDir, data) {
  if (!extDir) return false;
  const filePath = path.join(extDir, FILE_NAME);
  const tmpPath = filePath + ".tmp";
  try {
    const normalized = {
      $schema: SCHEMA,
      lastUpdated: new Date().toISOString(),
      nouns: Array.isArray(data?.nouns) ? data.nouns : [],
      verbs: Array.isArray(data?.verbs) ? data.verbs : [],
      adjectives: Array.isArray(data?.adjectives) ? data.adjectives : [],
    };
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    log.error("Misroute", `Failed to write learned file at ${filePath}: ${err.message}`);
    try { fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
}

/**
 * Append a new pattern to the learned file's specified bucket.
 * Idempotent: if the same pattern already exists, returns false without
 * adding a duplicate.
 *
 * Returns:
 *   { added: true, file } on successful append
 *   { added: false, reason: "duplicate" | "invalid-bucket" | "write-failed" } otherwise
 */
export function appendLearnedPattern(extDir, bucket, entry) {
  if (!VALID_BUCKETS.has(bucket)) {
    return { added: false, reason: "invalid-bucket" };
  }
  if (!entry?.pattern) {
    return { added: false, reason: "missing-pattern" };
  }

  const file = readLearnedFile(extDir);
  const existing = file[bucket].find(e => e.pattern === entry.pattern);
  if (existing) {
    return { added: false, reason: "duplicate", file };
  }

  file[bucket].push({
    pattern: entry.pattern,
    addedAt: entry.addedAt || new Date().toISOString(),
    trigger: entry.trigger || "",
    fromUserId: entry.fromUserId || null,
  });

  if (!writeLearnedFile(extDir, file)) {
    return { added: false, reason: "write-failed" };
  }
  return { added: true, file };
}

/**
 * Remove a pattern from the learned file. Used by the revert action.
 *
 * Returns { removed: true | false, file }.
 */
export function removeLearnedPattern(extDir, bucket, pattern) {
  if (!VALID_BUCKETS.has(bucket)) {
    return { removed: false, reason: "invalid-bucket" };
  }
  const file = readLearnedFile(extDir);
  const before = file[bucket].length;
  file[bucket] = file[bucket].filter(e => e.pattern !== pattern);
  if (file[bucket].length === before) {
    return { removed: false, reason: "not-found", file };
  }
  if (!writeLearnedFile(extDir, file)) {
    return { removed: false, reason: "write-failed" };
  }
  return { removed: true, file };
}

/**
 * List all learned entries across all buckets for an extension.
 * Returns an array of { extName, bucket, pattern, addedAt, trigger, fromUserId }.
 */
export function listLearnedEntries(extDir, extName) {
  const file = readLearnedFile(extDir);
  const out = [];
  for (const bucket of ["nouns", "verbs", "adjectives"]) {
    for (const entry of file[bucket] || []) {
      out.push({
        extName,
        bucket,
        pattern: entry.pattern,
        addedAt: entry.addedAt,
        trigger: entry.trigger,
        fromUserId: entry.fromUserId,
      });
    }
  }
  return out;
}
