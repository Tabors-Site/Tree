// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// canStarResolver.js . expand can* entries from descriptors into
// concrete options.
//
// The able's four can* lists (canSee / canDo / canSummon / canBe)
// describe what the being is licensed to dispatch through each verb.
// Most entries are concrete strings ("@operator", "set-config") or
// self-describing objects ({name, description}). Both pass through.
//
// Some entries are RELATIONSHIPS that resolve per-moment-per-being .
// "my parent in lineage", "the predecessor at this domain", "every
// being I minted". These cannot be hard-coded at able-design time
// because the answer depends on the current being and its history.
// This file is the resolver layer that expands such tokens.
//
// Entry shapes accepted:
//
//   "name"                      . concrete descriptor, used as-is
//   { name, description }        . self-describing, used as-is
//   { rel: "<token>" }           . resolved via registered rel-resolver
//   { pattern: "<glob>" }        . resolved via registered pattern-resolver
//   { resolver: "<key>", ... }   . resolved via a named resolver, any shape
//
// Resolvers are registered at boot. Today the registry is empty;
// every entry falls through as-is. As lineage, predecessor,
// child-list, and pattern-resolution land they plug in here without
// changing consumers or the able specs.
//
// Multi-step rituals (coronation, succession, able-chain) are NOT
// solved here. They are multiple moments, driven by the inbox /
// summon / reply / wake loop. This file only expands what's allowed
// for ONE moment.
//
// Cognition-agnostic. Lives in present/ables/ because the can*
// lists originate on the able spec; every cognition that consumes
// them (LLM prompt assembly, scripted introspection, innerFace
// capture) imports from here. Previously lived in cognition/llm/
// which was the wrong dependency direction.

import log from "../../seedStory/log.js";

// resolverKey -> async (entry, beingCtx) -> [resolvedEntry, ...]
const relResolvers = new Map();
const patternResolvers = new Map();
const namedResolvers = new Map();

/**
 * Register a resolver for `{ rel: "<token>" }` entries. The
 * resolver receives the original entry and a beingCtx (current
 * being row, position, able, summon history if needed) and returns
 * an array of resolved entries . each resolved entry is a string
 * stance / address / action / operation, or a `{name, description}`
 * object.
 *
 * Example future registrations:
 *   registerRelResolver("parent",  parentResolver)
 *   registerRelResolver("any-child", anyChildResolver)
 *   registerRelResolver("predecessor", predecessorResolver)
 */
export function registerRelResolver(token, resolverFn) {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("registerRelResolver: token must be a non-empty string");
  }
  if (typeof resolverFn !== "function") {
    throw new Error(`registerRelResolver(${token}): resolver must be a function`);
  }
  if (relResolvers.has(token)) {
    log.warn("CanStarResolver", `re-registering rel resolver for "${token}"`);
  }
  relResolvers.set(token, resolverFn);
}

/**
 * Register a resolver for `{ pattern: "<glob>" }` entries. Same
 * shape as rel resolvers; the resolver decides whether to treat the
 * pattern as a glob, a regex, or a path template.
 */
export function registerPatternResolver(key, resolverFn) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("registerPatternResolver: key must be a non-empty string");
  }
  if (typeof resolverFn !== "function") {
    throw new Error(`registerPatternResolver(${key}): resolver must be a function`);
  }
  if (patternResolvers.has(key)) {
    log.warn("CanStarResolver", `re-registering pattern resolver for "${key}"`);
  }
  patternResolvers.set(key, resolverFn);
}

/**
 * Register a named resolver for `{ resolver: "<key>", ... }`
 * entries. Use this when neither rel nor pattern fits the shape of
 * the relationship (e.g. an indexed lookup, a query against a
 * derived projection).
 */
export function registerNamedResolver(key, resolverFn) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("registerNamedResolver: key must be a non-empty string");
  }
  if (typeof resolverFn !== "function") {
    throw new Error(`registerNamedResolver(${key}): resolver must be a function`);
  }
  if (namedResolvers.has(key)) {
    log.warn("CanStarResolver", `re-registering named resolver for "${key}"`);
  }
  namedResolvers.set(key, resolverFn);
}

/**
 * Expand a can* list into concrete entries. Each entry is either
 * returned as-is (literal descriptor) or expanded via a registered
 * resolver (relationship token).
 *
 * Failures in a resolver are logged and the entry is dropped from
 * the expanded list (resolver miss never escalates to a broken
 * downstream — the being just does not see that token in this
 * moment's options).
 *
 * @param {Array<string|object>} entries . raw can* list from the able spec
 * @param {object} beingCtx              . { being, able, currentSpace, rootId, ... }
 * @returns {Promise<Array<string|object>>} . expanded list, same shapes consumers accept
 */
export async function resolveCanStar(entries, beingCtx = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const out = [];
  for (const entry of entries) {
    try {
      const expanded = await expandEntry(entry, beingCtx);
      for (const e of expanded) out.push(e);
    } catch (err) {
      log.warn(
        "CanStarResolver",
        `entry expand failed (${JSON.stringify(entry).slice(0, 80)}): ${err.message}`,
      );
    }
  }
  return out;
}

async function expandEntry(entry, beingCtx) {
  if (typeof entry === "string") return [entry];
  if (!entry || typeof entry !== "object") return [];

  if (typeof entry.rel === "string") {
    const fn = relResolvers.get(entry.rel);
    if (!fn) {
      log.debug("CanStarResolver", `no rel resolver for "${entry.rel}"; dropping entry`);
      return [];
    }
    const result = await fn(entry, beingCtx);
    return Array.isArray(result) ? result : [];
  }
  if (typeof entry.pattern === "string") {
    // No patternKind → the entry is a self-describing literal target
    // (e.g. {pattern: "@cherub", intent: "mate"}). Pass through; no
    // resolver lookup needed.
    if (!entry.patternKind) return [entry];
    const fn = patternResolvers.get(entry.patternKind);
    if (!fn) {
      log.debug("CanStarResolver", `no resolver for patternKind "${entry.patternKind}"; dropping entry`);
      return [];
    }
    const result = await fn(entry, beingCtx);
    return Array.isArray(result) ? result : [];
  }
  if (typeof entry.resolver === "string") {
    const fn = namedResolvers.get(entry.resolver);
    if (!fn) {
      log.debug("CanStarResolver", `no named resolver for "${entry.resolver}"; dropping entry`);
      return [];
    }
    const result = await fn(entry, beingCtx);
    return Array.isArray(result) ? result : [];
  }
  // Literal self-describing object . pass through.
  return [entry];
}
