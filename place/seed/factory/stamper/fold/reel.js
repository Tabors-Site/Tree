// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The live reel — the in-memory carry between this being's moments.
//
// A being doesn't persist itself across moments. But each moment
// needs to know what the recent moments looked like, or the
// LLM-being is born amnesiac every call. The reel is that thin
// strand of carry between moments on one presence lane: the last
// N messages, the role currently bound, the iteration count.
//
// Keyed by presenceKey — the lane the being is continuously
// present in. For being-to-being summons that's the IBP Address
// (stance::stance); for stanceless internal cognition it's the
// pipeline key. Two reaches into the same presence (same IBPA,
// two tabs) share one reel — the carry is the lane, not the
// device.
//
// What lives in a reel entry: `{ messages[], role, _lastActive }`.
// What does NOT live here: position state (rootId, currentSpace
// live in place/being/position.js keyed by Being, because a being
// has one position regardless of how many reaches sit in front of
// it). MCP cache, push fanout, etc. each have their own first-
// class identifier.
//
// What's stamped onto the reel forever (the historical record)
// lives on Stamp rows in Mongo. This file is only the LIVE carry
// across moments; once a presence goes idle past
// STALE_PRESENCE_MS, the in-memory entry evicts. The history on
// Mongo is forever; the live carry is just a tail.

import log from "../../../system/log.js";

// ─────────────────────────────────────────────────────────────────
// CARRY CONFIG
// ─────────────────────────────────────────────────────────────────

// How many recent messages a role switch carries across so the
// next role isn't born amnesiac. The system prompt rebuilds fresh
// each call; this is just the recent-turns echo, not memory.
let CARRY_MESSAGES = 4;
export function setCarryMessages(n) {
  CARRY_MESSAGES = Math.max(0, Number(n) || 4);
}
export function getCarryMessages() {
  return CARRY_MESSAGES;
}

// Hard cap on live reels. Beyond this, oldest by _lastActive evicts
// on next get so a runaway reach can't leak entries forever.
let MAX_PRESENCE_REELS = 50000;
export function setMaxPresenceReels(n) {
  MAX_PRESENCE_REELS = Math.max(100, Math.min(Number(n) || 50000, 500000));
}

// Idle-eviction window. A reel untouched for this long gets swept.
// The Mongo-side Stamp record is the durable history; this is
// just the live carry.
let STALE_PRESENCE_MS = 30 * 60 * 1000;
export function setStalePresenceMs(ms) {
  STALE_PRESENCE_MS = Math.max(60000, Math.min(Number(ms) || 1800000, 86400000));
}

// ─────────────────────────────────────────────────────────────────
// THE REEL MAP
// ─────────────────────────────────────────────────────────────────

const reels = new Map();

/**
 * Get or create the live reel keyed by presenceKey. For being-to-
 * being summons the key is the IBP Address; for stanceless internal
 * cognition it's the pipeline key. Two reaches that share the key
 * share the reel — switching tabs doesn't fork the lane. On miss,
 * creates a fresh entry; on overflow, evicts the oldest by
 * _lastActive.
 */
export function getReel(presenceKey) {
  if (!reels.has(presenceKey)) {
    if (reels.size >= MAX_PRESENCE_REELS) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [id, r] of reels) {
        if ((r._lastActive || 0) < oldestTime) {
          oldestTime = r._lastActive || 0;
          oldestKey = id;
        }
      }
      if (oldestKey) reels.delete(oldestKey);
    }
    reels.set(presenceKey, {
      // The role spec the moment is currently driven by. Null
      // until first switchRole. The role IS the unit of behavior.
      role: null,
      messages: [],
      _lastActive: Date.now(),
    });
  }
  const r = reels.get(presenceKey);
  r._lastActive = Date.now();
  return r;
}

/**
 * Resolve the presence key for this turn. Prefer the explicit lane
 * on ctx (IBP Address / pipeline key) when present; otherwise fall
 * back to the caller-supplied key (typically a transport reach).
 * Internal call sites route through here so two reaches sitting in
 * the same IBPA share one reel end to end.
 */
export function presenceKeyFor(ctx, fallback) {
  return ctx?.mcpCacheKey || fallback;
}

/**
 * Number of live reels currently held. Used by health probes /
 * diagnostics.
 */
export function getReelCount() {
  return reels.size;
}

// ─────────────────────────────────────────────────────────────────
// IDLE SWEEP
// ─────────────────────────────────────────────────────────────────
//
// Safety net: any reel idle past STALE_PRESENCE_MS gets dropped
// every 10 minutes so a leaked entry doesn't stick around. The
// durable history is in Mongo (Stamp rows); the live carry can
// evict freely.

setInterval(
  () => {
    const now = Date.now();
    let swept = 0;
    for (const [id, r] of reels) {
      if (now - (r._lastActive || 0) > STALE_PRESENCE_MS) {
        reels.delete(id);
        swept++;
      }
    }
    if (swept > 0) {
      log.debug(
        "Reel",
        `🧹 Swept ${swept} stale reel(s) (${reels.size} live)`,
      );
    }
  },
  10 * 60 * 1000,
).unref();
