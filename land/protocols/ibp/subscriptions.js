// TreeOS IBP — DO-trigger subscription registry.
//
// One of two coexisting paths that wake beings (the other being direct
// being-to-being SUMMONs). When a DO action lands at a position — an
// artifact write, a status change, a metadata write — the substrate's
// post-DO hooks emit SUMMONs to every subscriber whose interest covers
// the affected position and event shape. The SUMMON's `intent` is
// `do-trigger`; the receiving being's role template interprets the
// content (a small envelope describing what changed) and decides
// whether to act.
//
// **Why this layer exists.** Without it, infrastructure code (Mode 2:
// pure DOs without a perspective) is isolated from beings that care
// about the substrate it touches. With it, code-driven changes feed
// the same SUMMON-in-inbox mechanism that being-driven changes use —
// the substrate's narrative stays whole. Both Mode 1 (being-emitted)
// and Mode 2 (code-emitted) DOs reach subscribers identically.
//
// **Subscription shape:**
//
//   {
//     id:            string,                  // generated when subscribe() returns
//     beingId:       string,                  // who gets summoned
//     event:         "afterArtifact"          // hook name to match
//                  | "afterStatusChange"
//                  | "afterMetadataWrite",
//     scope:         { everywhere: true }     // any node in the land
//                  | { nodeId: "<id>" }       // exact match
//                  | { ancestor: "<id>" },    // payload.nodeId has this ancestor
//     filter:        { <key>: <value> }       // payload field-equality, optional
//                  | { <key>: [v1, v2, ...] },// any-of match, optional
//     intent:        "do-trigger"             // SUMMON intent on emission
//                  | "<custom>",              //   (default: "do-trigger")
//     priority:      number,                  // SUMMON priority; default BACKGROUND (4)
//     coalesceMs:    number,                  // 0 (default) = immediate emit per event;
//                                             // N > 0 = batch matching events landing in
//                                             // an N-ms window into ONE SUMMON whose
//                                             // content carries content.events: [...]
//   }
//
// **Storage.** In-memory registry — subscriptions are re-registered
// at boot by each extension that wires them. Slice 6c will introduce
// a metadata-backed registry on each being's home node so boot can
// rebuild without re-running extension code; for now the in-memory
// registry plus extension-init re-registration is enough.

import { randomUUID } from "crypto";
import log from "../../seed/core/log.js";
import { getAncestorChain } from "../../seed/tree/ancestorCache.js";
import { appendToInbox } from "./inbox.js";
import { wake } from "./scheduler.js";
import { getLandDomain } from "./address.js";
import { getLandRootId } from "../../seed/landRoot.js";

// beingId -> Map<subscriptionId, subscription>
const _byBeing = new Map();

// event-name -> Set<subscriptionId>  (for fast event-time lookup)
const _byEvent = new Map();

// subscriptionId -> { beingId, sub }  (reverse index for unsubscribe)
const _index = new Map();

// Coalescing state, keyed by subscriptionId. Only present while a
// subscription has a pending coalesce-window open.
//
//   subscriptionId -> {
//     timer:       Timeout handle
//     events:      Array<payload-summary>  // collected within the window
//     firstAt:     ms                       // when the window opened
//     senderStance:string                   // computed at first event
//     targetNodeId:string                   // computed at first event
//     rootCorrelation:string|null
//     eventName:   string
//   }
const _pendingCoalesce = new Map();

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Register a subscription. Returns the subscription id (used for
 * unsubscribe). Validates the shape; throws on malformed input.
 *
 * @param {string} beingId
 * @param {object} sub  shape per file header
 * @returns {string} subscription id
 */
export function subscribe(beingId, sub) {
  if (!beingId || typeof beingId !== "string") {
    throw new Error("subscribe requires beingId");
  }
  if (!sub || typeof sub !== "object") {
    throw new Error("subscribe requires a subscription object");
  }
  if (typeof sub.event !== "string" || !sub.event) {
    throw new Error("subscription.event is required");
  }
  if (!sub.scope || typeof sub.scope !== "object") {
    throw new Error("subscription.scope is required");
  }
  if (!sub.scope.everywhere && !sub.scope.nodeId && !sub.scope.ancestor) {
    throw new Error("subscription.scope must specify everywhere|nodeId|ancestor");
  }

  const id = sub.id || randomUUID();
  const entry = {
    id,
    beingId:    String(beingId),
    event:      sub.event,
    scope:      sub.scope,
    filter:     sub.filter || null,
    intent:     sub.intent || "do-trigger",
    priority:   Number.isFinite(sub.priority) ? Number(sub.priority) : 4, // BACKGROUND
    coalesceMs: Number.isFinite(sub.coalesceMs) && sub.coalesceMs > 0 ? Number(sub.coalesceMs) : 0,
  };

  let beingMap = _byBeing.get(entry.beingId);
  if (!beingMap) {
    beingMap = new Map();
    _byBeing.set(entry.beingId, beingMap);
  }
  beingMap.set(id, entry);

  let eventSet = _byEvent.get(entry.event);
  if (!eventSet) {
    eventSet = new Set();
    _byEvent.set(entry.event, eventSet);
  }
  eventSet.add(id);

  _index.set(id, entry);

  log.verbose("Subscriptions",
    `subscribed ${entry.event} for being ${entry.beingId.slice(0, 8)} ` +
    `(scope=${_scopeLabel(entry.scope)}, id=${id.slice(0, 8)})`);
  return id;
}

/**
 * Remove one subscription. Returns true when something was removed.
 */
export function unsubscribe(subscriptionId) {
  const entry = _index.get(subscriptionId);
  if (!entry) return false;
  _index.delete(subscriptionId);
  const beingMap = _byBeing.get(entry.beingId);
  if (beingMap) {
    beingMap.delete(subscriptionId);
    if (beingMap.size === 0) _byBeing.delete(entry.beingId);
  }
  const eventSet = _byEvent.get(entry.event);
  if (eventSet) {
    eventSet.delete(subscriptionId);
    if (eventSet.size === 0) _byEvent.delete(entry.event);
  }
  // Clear any in-flight coalesce window. The batched events are
  // dropped — there's no inbox to deliver them to once the subscription
  // is gone.
  const pending = _pendingCoalesce.get(subscriptionId);
  if (pending) {
    clearTimeout(pending.timer);
    _pendingCoalesce.delete(subscriptionId);
  }
  return true;
}

/**
 * Drop every subscription for a being. Used when a being is deleted
 * so the registry doesn't keep delivering to a phantom inbox.
 */
export function unsubscribeAllForBeing(beingId) {
  if (!beingId) return 0;
  const beingMap = _byBeing.get(String(beingId));
  if (!beingMap) return 0;
  const ids = Array.from(beingMap.keys());
  for (const id of ids) unsubscribe(id);
  return ids.length;
}

/**
 * For tests / boot. Drop everything.
 */
export function _resetAll() {
  for (const pending of _pendingCoalesce.values()) {
    try { clearTimeout(pending.timer); } catch {}
  }
  _pendingCoalesce.clear();
  _byBeing.clear();
  _byEvent.clear();
  _index.clear();
}

/**
 * Diagnostic snapshot. Used by health-check / dashboard.
 */
export function getStats() {
  return {
    totalSubscriptions: _index.size,
    beingsWithSubscriptions: _byBeing.size,
    eventsWatched: Array.from(_byEvent.keys()),
    pendingCoalesce: _pendingCoalesce.size,
  };
}

/**
 * For an incoming event, return the list of matching subscriptions.
 * Walks ancestor chains when needed (cached via `getAncestorChain`).
 *
 * @param {string} eventName
 * @param {object} payload   the hook payload — must include `nodeId` when
 *                           subscriptions use scope.nodeId or scope.ancestor
 * @returns {Promise<Array<subscription>>}
 */
export async function getMatchingSubscribers(eventName, payload) {
  const eventSet = _byEvent.get(eventName);
  if (!eventSet || eventSet.size === 0) return [];

  const nodeId = payload?.nodeId ? String(payload.nodeId) : null;

  // Pre-compute the ancestor chain for the payload's node once per
  // call; reuse it across every ancestor-scoped subscription this
  // event fires for. Most events touch one node and have multiple
  // subscribers spread along its chain — caching here avoids re-
  // walking for each subscriber.
  let ancestorChainIds = null;
  async function ancestorIdSet() {
    if (ancestorChainIds !== null) return ancestorChainIds;
    if (!nodeId) {
      ancestorChainIds = new Set();
      return ancestorChainIds;
    }
    try {
      const chain = await getAncestorChain(nodeId);
      ancestorChainIds = new Set(
        (Array.isArray(chain) ? chain : []).map((n) => String(n?._id)).filter(Boolean),
      );
      // The node itself counts as ancestor=self for scope.ancestor checks.
      ancestorChainIds.add(nodeId);
    } catch (err) {
      log.debug("Subscriptions", `ancestor chain lookup failed for ${nodeId.slice(0, 8)}: ${err.message}`);
      ancestorChainIds = new Set([nodeId]);
    }
    return ancestorChainIds;
  }

  const matches = [];
  for (const id of eventSet) {
    const sub = _index.get(id);
    if (!sub) continue;
    if (!_matchesFilter(sub.filter, payload)) continue;

    if (sub.scope.everywhere) {
      matches.push(sub);
      continue;
    }
    if (sub.scope.nodeId && nodeId && String(sub.scope.nodeId) === nodeId) {
      matches.push(sub);
      continue;
    }
    if (sub.scope.ancestor) {
      const chain = await ancestorIdSet();
      if (chain.has(String(sub.scope.ancestor))) {
        matches.push(sub);
      }
      continue;
    }
  }
  return matches;
}

/**
 * Emit a DO-trigger SUMMON to every subscriber whose interest covers
 * this event. Called by substrate hook listeners; safe to call when
 * no subscribers match (cheap no-op). Each emission is appendToInbox
 * + wake — the receiving being's scheduler picks the SUMMON up in
 * its normal priority order.
 *
 * Sender is the doing being when payload.beingId is present, else a
 * synthetic system stance `<land>/@system`. The receiver's role
 * template can inspect the sender to distinguish code-driven
 * (anonymous) events from being-driven ones.
 *
 * @param {string} eventName
 * @param {object} payload
 * @param {object} [options]  reserved
 */
export async function emitToSubscribers(eventName, payload, options = {}) {
  const matches = await getMatchingSubscribers(eventName, payload);
  if (matches.length === 0) return 0;

  const senderStance = _senderStanceForPayload(payload);
  const rootCorrelation = payload?.rootCorrelation || payload?.summonId || null;

  let emitted = 0;
  for (const sub of matches) {
    try {
      const targetNodeId = _inboxNodeIdForSubscriber(sub, payload);
      if (!targetNodeId) {
        log.debug("Subscriptions",
          `skipping ${eventName} → being ${sub.beingId.slice(0, 8)}: no resolvable inbox node`);
        continue;
      }
      const eventContent = _renderTriggerContent(eventName, payload);
      if (sub.coalesceMs > 0) {
        // Coalescing path: append this event to the subscription's
        // pending batch. If no window is open, open one — when it
        // expires, ONE SUMMON fires with content.events = [...].
        _enqueueCoalesce(sub, {
          eventName,
          event:           eventContent,
          senderStance,
          targetNodeId,
          rootCorrelation,
        });
        // Counted as "handled" but the actual emit lands later.
        emitted++;
      } else {
        const correlation = randomUUID();
        await appendToInbox(targetNodeId, sub.beingId, {
          from:            senderStance,
          content:         eventContent,
          intent:          sub.intent,
          correlation,
          rootCorrelation: rootCorrelation || correlation,
          priority:        sub.priority,
          sentAt:          new Date().toISOString(),
        });
        wake(sub.beingId, targetNodeId);
        emitted++;
      }
    } catch (err) {
      log.warn("Subscriptions",
        `emit ${eventName} → being ${sub.beingId.slice(0, 8)} failed: ${err.message}`);
    }
  }
  return emitted;
}

// Open or extend a coalesce window for a subscription. Same-subscription
// events within the window batch into one SUMMON; different subscriptions
// each have their own window.
function _enqueueCoalesce(sub, ctx) {
  const existing = _pendingCoalesce.get(sub.id);
  if (existing) {
    existing.events.push(ctx.event);
    return;
  }
  const pending = {
    events:          [ctx.event],
    firstAt:         Date.now(),
    senderStance:    ctx.senderStance,
    targetNodeId:    ctx.targetNodeId,
    rootCorrelation: ctx.rootCorrelation,
    eventName:       ctx.eventName,
    timer:           null,
  };
  pending.timer = setTimeout(() => {
    _flushCoalesce(sub).catch((err) => {
      log.warn("Subscriptions", `flushCoalesce ${sub.id.slice(0, 8)} failed: ${err.message}`);
    });
  }, sub.coalesceMs);
  if (typeof pending.timer.unref === "function") pending.timer.unref();
  _pendingCoalesce.set(sub.id, pending);
}

async function _flushCoalesce(sub) {
  const pending = _pendingCoalesce.get(sub.id);
  if (!pending) return;
  _pendingCoalesce.delete(sub.id);
  // Verify the subscription is still registered. If it was removed
  // mid-window, drop the batch silently.
  if (!_index.has(sub.id)) return;
  const correlation = randomUUID();
  // Single SUMMON whose content carries the batch. Receivers know
  // `events` is a list when coalesceMs > 0 was configured.
  const content = {
    event:    pending.eventName,
    coalesced: true,
    batchSize: pending.events.length,
    events:    pending.events,
    firstAt:   new Date(pending.firstAt).toISOString(),
    lastAt:    new Date().toISOString(),
  };
  try {
    await appendToInbox(pending.targetNodeId, sub.beingId, {
      from:            pending.senderStance,
      content,
      intent:          sub.intent,
      correlation,
      rootCorrelation: pending.rootCorrelation || correlation,
      priority:        sub.priority,
      sentAt:          new Date().toISOString(),
    });
    wake(sub.beingId, pending.targetNodeId);
  } catch (err) {
    log.warn("Subscriptions",
      `coalesced emit ${pending.eventName} → being ${sub.beingId.slice(0, 8)} failed: ${err.message}`);
  }
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

function _matchesFilter(filter, payload) {
  if (!filter || typeof filter !== "object") return true;
  for (const [key, expected] of Object.entries(filter)) {
    const actual = _readPath(payload, key);
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

// Dot-path read so filters can reach into nested payload fields
// (e.g. "content.origin" to match an artifact's origin).
function _readPath(obj, path) {
  if (!obj || typeof obj !== "object" || !path) return undefined;
  if (!path.includes(".")) return obj[path];
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function _senderStanceForPayload(payload) {
  const domain = getLandDomain() || "land";
  // The doing being (if known) is the most informative sender. Code-
  // driven DOs (no beingId) land as the synthesized system stance.
  if (payload?.beingId) {
    // We don't have the doer's username synchronously here. Use the
    // beingId as a stable identifier in the stance; receiver-side
    // role templates can resolve to username if they need display.
    return `${domain}/@<being:${payload.beingId}>`;
  }
  return `${domain}/@system`;
}

function _inboxNodeIdForSubscriber(sub, payload) {
  // Deliver to the subscriber's home position when known so the inbox
  // ends up at a single well-defined place per being. Fallback to the
  // event's nodeId (the affected node) and ultimately the land root.
  return (
    payload?.subscriberHomeId
    || payload?.nodeId
    || getLandRootId()
    || null
  );
}

function _renderTriggerContent(eventName, payload) {
  // Compact, predictable envelope the receiving role template parses.
  // Keep this stable — role templates will pattern-match on `event`
  // and the payload fields. Trim what's likely large (full artifact
  // content) to references only.
  const out = { event: eventName };
  if (payload?.nodeId)          out.nodeId          = String(payload.nodeId);
  if (payload?.beingId)         out.actorBeingId    = String(payload.beingId);
  if (payload?.action)          out.action          = payload.action;
  if (payload?.artifact?._id)   out.artifactId      = String(payload.artifact._id);
  if (payload?.artifact?.origin) out.artifactOrigin = payload.artifact.origin;
  if (payload?.origin)          out.origin          = payload.origin;
  if (payload?.extName)         out.extName         = payload.extName;
  if (payload?.fromStatus)      out.fromStatus      = payload.fromStatus;
  if (payload?.toStatus)        out.toStatus        = payload.toStatus;
  if (payload?.timestamp)       out.timestamp       = payload.timestamp;
  else                          out.timestamp       = new Date().toISOString();
  return out;
}

function _scopeLabel(scope) {
  if (scope.everywhere) return "everywhere";
  if (scope.nodeId) return `node:${String(scope.nodeId).slice(0, 8)}`;
  if (scope.ancestor) return `ancestor:${String(scope.ancestor).slice(0, 8)}`;
  return "?";
}
