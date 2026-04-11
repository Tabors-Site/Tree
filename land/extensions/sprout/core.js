/**
 * Sprout Core
 *
 * Pending offer state, domain availability cache, and the scaffold action.
 * Sprout detects what the tree is missing and grows it from conversation.
 */

import log from "../../seed/log.js";
import { getExtension } from "../loader.js";

// ─────────────────────────────────────────────────────────────────────────
// PENDING OFFERS
// ─────────────────────────────────────────────────────────────────────────
// Map<userId, { domain, rootId, offeredAt }>
// Tracks the last domain offer per user so the confirmation flow survives
// clearHistory between converse calls.

const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

const _pending = new Map();

export function getPending(userId) {
  const entry = _pending.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.offeredAt > PENDING_TTL_MS) {
    _pending.delete(userId);
    return null;
  }
  return entry;
}

export function setPending(userId, { domain, rootId }) {
  _pending.set(userId, { domain, rootId, offeredAt: Date.now() });
}

export function clearPending(userId) {
  _pending.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// DOMAIN AVAILABILITY CACHE
// ─────────────────────────────────────────────────────────────────────────
// Brief cache so we don't query the DB on every single message.
// Map<userId, { domains, cachedAt }>

const CACHE_TTL_MS = 30 * 1000; // 30 seconds

const _domainCache = new Map();

export async function getUnscaffoldedDomains(userId) {
  const cached = _domainCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.domains;
  }

  const life = getExtension("life");
  if (!life?.exports) return [];

  const available = life.exports.getAvailableDomains();
  if (available.length === 0) return [];

  const rootId = await life.exports.findLifeRoot(userId);
  let scaffolded = [];
  if (rootId) {
    const domainNodes = await life.exports.getDomainNodes(rootId);
    scaffolded = Object.keys(domainNodes);
  }

  const unscaffolded = available.filter(d => !scaffolded.includes(d));
  _domainCache.set(userId, { domains: unscaffolded, cachedAt: Date.now() });
  return unscaffolded;
}

/**
 * Get domains the user HAS scaffolded (the inverse of getUnscaffoldedDomains).
 * Uses the same cache window so both calls in the same message are free.
 */
export async function getScaffoldedDomains(userId) {
  const life = getExtension("life");
  if (!life?.exports) return [];

  const rootId = await life.exports.findLifeRoot(userId);
  if (!rootId) return [];

  const domainNodes = await life.exports.getDomainNodes(rootId);
  return Object.keys(domainNodes);
}

/** Invalidate cache for a user after scaffolding changes. */
export function invalidateCache(userId) {
  _domainCache.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// SPROUT ACTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scaffold a domain into the user's Life tree.
 * Creates the Life root if it doesn't exist, adds the domain, rebuilds routing.
 */
export async function sproutDomain({ domain, userId }) {
  const life = getExtension("life");
  if (!life?.exports) throw new Error("Life extension not loaded");

  const available = life.exports.getAvailableDomains();
  if (!available.includes(domain)) {
    return {
      success: false,
      error: `Domain "${domain}" is not available. Available: ${available.join(", ")}`,
    };
  }

  // Find or create Life root
  let rootId = await life.exports.findLifeRoot(userId);
  if (!rootId) {
    const result = await life.exports.scaffoldRoot(userId);
    rootId = result.rootId;
    log.info("Sprout", `Created Life root ${rootId} for user ${userId}`);
  }

  // Check if already scaffolded
  const existing = await life.exports.getDomainNodes(rootId);
  if (existing[domain]) {
    clearPending(userId);
    invalidateCache(userId);
    return {
      success: true,
      alreadyExists: true,
      domain,
      nodeId: existing[domain].id,
      rootId,
      message: `${domain} is already set up.`,
    };
  }

  // Scaffold the domain
  const result = await life.exports.addDomain({ rootId, domain, userId });
  log.info("Sprout", `Scaffolded ${domain} under Life root ${rootId}`);

  // Rebuild routing index so the new domain is immediately routable
  try {
    const treeOrch = getExtension("tree-orchestrator");
    if (treeOrch?.exports?.rebuildIndexForRoot) {
      await treeOrch.exports.rebuildIndexForRoot(rootId);
      log.verbose("Sprout", `Rebuilt routing index for root ${rootId}`);
    } else {
      // Direct import fallback
      const { rebuildIndexForRoot } = await import("../tree-orchestrator/routingIndex.js");
      await rebuildIndexForRoot(rootId);
      log.verbose("Sprout", `Rebuilt routing index for root ${rootId} (direct import)`);
    }
  } catch (err) {
    log.warn("Sprout", `Failed to rebuild routing index: ${err.message}`);
  }

  // Add to navigation
  try {
    const nav = getExtension("navigation");
    if (nav?.exports?.addRoot) await nav.exports.addRoot(userId, rootId);
  } catch {}

  clearPending(userId);
  invalidateCache(userId);

  return {
    success: true,
    domain,
    nodeId: result.id,
    rootId,
    message: `${capitalize(domain)} tracking is now set up. Messages about ${domain} will route there automatically.`,
  };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
