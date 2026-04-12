/**
 * Personal vocabulary layer (Layer 3).
 *
 * Per-user vocabulary stored in user.metadata.personalVocab. This is the
 * tightest scope of routing vocabulary: applies only to messages from this
 * specific user. The misroute extension promotes suggestions here when they
 * cross a low threshold (PERSONAL_PROMOTE_THRESHOLD), giving each user their
 * own routing memory without affecting anyone else in the land.
 *
 * Storage shape (lives on User.metadata.personalVocab):
 *
 *   {
 *     "fitness": {
 *       "nouns": [
 *         {
 *           "pattern": "\\b(?:bill|bills)\\b",
 *           "addedAt": "2026-04-12T...",
 *           "trigger": "2 misroutes from finance",
 *           "count": 2
 *         }
 *       ],
 *       "verbs": [],
 *       "adjectives": []
 *     },
 *     "food": { ... }
 *   }
 *
 * Cache: in-process Map keyed by userId. Compiled RegExp arrays per extension.
 * Invalidated on writes. 5-minute TTL on reads to handle external mutations.
 */

import log from "../../seed/log.js";
import User from "../../seed/models/user.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

const _cache = new Map(); // userId -> { compiled: { extName: {nouns, verbs, adjectives}}, loadedAt }
const TTL_MS = 5 * 60 * 1000;
const VALID_BUCKETS = new Set(["nouns", "verbs", "adjectives"]);

function compileEntry(entry) {
  if (!entry?.pattern || typeof entry.pattern !== "string") return null;
  try { return new RegExp(entry.pattern, "i"); } catch { return null; }
}

function compileBucket(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const e of arr) {
    const re = compileEntry(e);
    if (re) out.push(re);
  }
  return out;
}

function compileVocab(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [extName, buckets] of Object.entries(raw)) {
    if (!buckets || typeof buckets !== "object") continue;
    result[extName] = {
      nouns: compileBucket(buckets.nouns),
      verbs: compileBucket(buckets.verbs),
      adjectives: compileBucket(buckets.adjectives),
    };
  }
  return result;
}

/**
 * Load and compile a user's personal vocabulary across all extensions.
 * Cached for TTL_MS. Returns { extName: { nouns, verbs, adjectives } } as
 * RegExp arrays, or {} if the user has no personal vocab.
 *
 * Use this when scoring messages: pass the entire object to queryIndexScored,
 * which slices the right extension at score time.
 */
export async function getPersonalVocabularyForUser(userId) {
  if (!userId) return {};
  const cached = _cache.get(String(userId));
  if (cached && Date.now() - cached.loadedAt < TTL_MS) {
    return cached.compiled;
  }
  try {
    const user = await User.findById(userId).select("metadata").lean();
    if (!user) return {};
    const raw = user.metadata instanceof Map
      ? user.metadata.get("personalVocab")
      : user.metadata?.personalVocab;
    const compiled = compileVocab(raw);
    _cache.set(String(userId), { compiled, loadedAt: Date.now() });
    return compiled;
  } catch (err) {
    log.debug("Misroute", `personal vocab load failed: ${err.message}`);
    return {};
  }
}

/**
 * Append a pattern to a user's personal vocabulary. Idempotent.
 * Invalidates the cache so the next routing call sees the new pattern.
 */
export async function appendPersonalPattern(userId, extName, bucket, entry) {
  if (!userId || !extName) return { added: false, reason: "missing-params" };
  if (!VALID_BUCKETS.has(bucket)) return { added: false, reason: "invalid-bucket" };
  if (!entry?.pattern) return { added: false, reason: "missing-pattern" };

  try {
    const user = await User.findById(userId);
    if (!user) return { added: false, reason: "user-not-found" };

    const current = getUserMeta(user, "personalVocab") || {};
    if (!current[extName]) current[extName] = { nouns: [], verbs: [], adjectives: [] };
    if (!Array.isArray(current[extName][bucket])) current[extName][bucket] = [];

    const existing = current[extName][bucket].find(e => e.pattern === entry.pattern);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeen = new Date().toISOString();
      setUserMeta(user, "personalVocab", current);
      await user.save();
      _cache.delete(String(userId));
      return { added: false, reason: "duplicate-incremented" };
    }

    current[extName][bucket].push({
      pattern: entry.pattern,
      addedAt: entry.addedAt || new Date().toISOString(),
      trigger: entry.trigger || "",
      count: 1,
    });

    setUserMeta(user, "personalVocab", current);
    await user.save();
    _cache.delete(String(userId));
    return { added: true };
  } catch (err) {
    log.error("Misroute", `appendPersonalPattern failed: ${err.message}`);
    return { added: false, reason: "write-failed" };
  }
}

/**
 * Remove a pattern from a user's personal vocabulary.
 */
export async function removePersonalPattern(userId, extName, bucket, pattern) {
  if (!userId || !extName || !VALID_BUCKETS.has(bucket) || !pattern) {
    return { removed: false, reason: "invalid-params" };
  }
  try {
    const user = await User.findById(userId);
    if (!user) return { removed: false, reason: "user-not-found" };

    const current = getUserMeta(user, "personalVocab") || {};
    if (!current[extName]?.[bucket]) return { removed: false, reason: "not-found" };

    const before = current[extName][bucket].length;
    current[extName][bucket] = current[extName][bucket].filter(e => e.pattern !== pattern);
    if (current[extName][bucket].length === before) {
      return { removed: false, reason: "not-found" };
    }

    setUserMeta(user, "personalVocab", current);
    await user.save();
    _cache.delete(String(userId));
    return { removed: true };
  } catch (err) {
    log.error("Misroute", `removePersonalPattern failed: ${err.message}`);
    return { removed: false, reason: "write-failed" };
  }
}

/**
 * List all personal vocabulary entries for a user, flattened across extensions.
 * Returns an array of { extName, bucket, pattern, addedAt, trigger, count }.
 */
export async function listPersonalEntries(userId) {
  if (!userId) return [];
  try {
    const user = await User.findById(userId).select("metadata").lean();
    if (!user) return [];
    const raw = user.metadata instanceof Map
      ? user.metadata.get("personalVocab")
      : user.metadata?.personalVocab;
    if (!raw || typeof raw !== "object") return [];
    const out = [];
    for (const [extName, buckets] of Object.entries(raw)) {
      if (!buckets || typeof buckets !== "object") continue;
      for (const bucket of ["nouns", "verbs", "adjectives"]) {
        for (const entry of buckets[bucket] || []) {
          out.push({
            extName,
            bucket,
            pattern: entry.pattern,
            addedAt: entry.addedAt,
            trigger: entry.trigger,
            count: entry.count || 1,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Invalidate the cache for a specific user. Called by writers and revert.
 * Public so other extensions or admin tooling can force a reload after
 * external metadata edits.
 */
export function invalidatePersonalVocabCache(userId) {
  if (userId) _cache.delete(String(userId));
}
