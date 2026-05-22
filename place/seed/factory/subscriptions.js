// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Where substrate change becomes a request for a moment. One of
// two paths that ask a being to have a moment when nothing
// directly summoned it; the other is a direct SUMMON from another
// being. When a DO lands at a position — matter write, status
// change, qualities write — my post-DO hooks emit SUMMONs to
// every subscriber whose interest covers the affected position
// and event shape. The SUMMON content carries a small envelope
// describing what changed; the receiving role's summon() decides
// whether the moment should actually act on it.
//
// Why this layer. Without it, anonymous code (DOs emitted without
// a being's perspective) is isolated from beings that care about
// the substrate it touches. With it, code-driven changes feed the
// same SUMMON-in-inbox mechanism as being-driven changes — the
// reel of moments stays whole. Mode 1 (a being requesting a
// moment) and Mode 2 (substrate change requesting a moment) reach
// subscribers identically.
//
// Subscription shape:
//
//   {
//     id:         string,
//     beingId:    string,
//     event:      "afterMatter"          // hook name
//               | "afterQualityWrite",  // status-like changes
//                                         // express here + a
//                                         // namespace filter
//     scope:      { everywhere: true }   // anywhere in the place
//               | { spaceId: <id> }       // exact match
//               | { ancestor: <id> },    // payload.spaceId descends from this
//     filter:     { <key>: <value> }     // payload field equality
//               | { <key>: [v1, v2] },   // any-of match
//     priority:   number,                // SUMMON priority (default BACKGROUND)
//     coalesceMs: number,                // 0 = immediate per event,
//                                         // N>0 = batch events in N-ms window
//                                         // into ONE SUMMON carrying
//                                         // content.events: [...]
//   }
//
// Storage. I keep the registry in memory; each extension that
// wires subscriptions re-registers at boot. A qualities-backed
// version on each being's home space (so boot rebuilds without
// re-running extension code) is on the roadmap; for now memory +
// extension-init re-registration is sufficient.

import { randomUUID } from "crypto";
import log from "../system/log.js";
import { getAncestorChain } from "../place/space/ancestorCache.js";
import { summonByResolved } from "../ibp/verbs.js";
import { getPlaceDomain } from "../ibp/address.js";
import { getPlaceRootId } from "../placeRoot.js";
import { I_AM } from "../place/being/seedBeings.js";
import { iAmIdentity } from "../place/being/placeBeings.js";

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
//     targetSpace:string                   // computed at first event
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
  if (!sub.scope.everywhere && !sub.scope.spaceId && !sub.scope.ancestor) {
    throw new Error(
      "subscription.scope must specify everywhere|spaceId|ancestor",
    );
  }

  const id = sub.id || randomUUID();
  const entry = {
    id,
    beingId: String(beingId),
    event: sub.event,
    scope: sub.scope,
    filter: sub.filter || null,
    priority: Number.isFinite(sub.priority) ? Number(sub.priority) : 4, // BACKGROUND
    coalesceMs:
      Number.isFinite(sub.coalesceMs) && sub.coalesceMs > 0
        ? Number(sub.coalesceMs)
        : 0,
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

  log.verbose(
    "Subscriptions",
    `subscribed ${entry.event} for being ${entry.beingId.slice(0, 8)} ` +
      `(scope=${_scopeLabel(entry.scope)}, id=${id.slice(0, 8)})`,
  );
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
    try {
      clearTimeout(pending.timer);
    } catch {}
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
 * @param {object} payload   the hook payload — must include `spaceId` when
 *                           subscriptions use scope.spaceId or scope.ancestor
 * @returns {Promise<Array<subscription>>}
 */
export async function getMatchingSubscribers(eventName, payload) {
  const eventSet = _byEvent.get(eventName);
  if (!eventSet || eventSet.size === 0) return [];

  const spaceId = payload?.spaceId ? String(payload.spaceId) : null;

  // Pre-compute the ancestor chain for the payload's space once per
  // call; reuse it across every ancestor-scoped subscription this
  // event fires for. Most events touch one space and have multiple
  // subscribers spread along its chain — caching here avoids re-
  // walking for each subscriber.
  let ancestorChainIds = null;
  async function ancestorIdSet() {
    if (ancestorChainIds !== null) return ancestorChainIds;
    if (!spaceId) {
      ancestorChainIds = new Set();
      return ancestorChainIds;
    }
    try {
      const chain = await getAncestorChain(spaceId);
      ancestorChainIds = new Set(
        (Array.isArray(chain) ? chain : [])
          .map((n) => String(n?._id))
          .filter(Boolean),
      );
      // The space itself counts as ancestor=self for scope.ancestor checks.
      ancestorChainIds.add(spaceId);
    } catch (err) {
      log.debug(
        "Subscriptions",
        `ancestor chain lookup failed for ${spaceId.slice(0, 8)}: ${err.message}`,
      );
      ancestorChainIds = new Set([spaceId]);
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
    if (sub.scope.spaceId && spaceId && String(sub.scope.spaceId) === spaceId) {
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
 * Sender is the doing being when payload.beingId is present, else
 * the I_AM's stance `<place>/@I_AM`. The receiver's role
 * template can inspect the sender to distinguish I_AM-emitted
 * events (substrate-internal triggers like .source sync) from
 * other-being-emitted ones (explicit acts by named beings).
 *
 * @param {string} eventName
 * @param {object} payload
 * @param {object} [options]  reserved
 */
export async function emitToSubscribers(eventName, payload, options = {}) {
  const matches = await getMatchingSubscribers(eventName, payload);
  if (matches.length === 0) return 0;

  // Every DO-trigger SUMMON is emitted by the I_AM acting on a
  // subscriber's standing declaration. The original DO actor lives
  // in the SUMMON's content payload (`actorBeingId`), not in
  // `from`. Position carries where the triggering DO happened.
  const identity = await iAmIdentity();
  if (!identity) {
    log.debug(
      "Subscriptions",
      `skipping ${eventName}: I_AM identity not yet available`,
    );
    return 0;
  }
  const senderStance = _senderStanceForPayload(payload);
  const rootCorrelation = payload?.rootCorrelation || payload?.summonId || null;

  let emitted = 0;
  for (const sub of matches) {
    try {
      const targetSpace = _inboxNodeIdForSubscriber(sub, payload);
      if (!targetSpace) {
        log.debug(
          "Subscriptions",
          `skipping ${eventName} → being ${sub.beingId.slice(0, 8)}: no resolvable inbox space`,
        );
        continue;
      }
      const eventContent = _renderTriggerContent(eventName, payload);
      if (sub.coalesceMs > 0) {
        // Coalescing path: append this event to the subscription's
        // pending batch. If no window is open, open one. When it
        // expires, ONE SUMMON fires with content.events = [...].
        _enqueueCoalesce(sub, {
          eventName,
          event: eventContent,
          senderStance,
          targetSpace,
          rootCorrelation,
        });
        emitted++;
      } else {
        await _emitOne({
          inboxSpaceId: targetSpace,
          toBeingId: sub.beingId,
          priority: sub.priority,
          senderStance,
          content: eventContent,
          rootCorrelation,
          identity,
        });
        emitted++;
      }
    } catch (err) {
      log.warn(
        "Subscriptions",
        `emit ${eventName} → being ${sub.beingId.slice(0, 8)} failed: ${err.message}`,
      );
    }
  }
  return emitted;
}

// Single-SUMMON delivery. The verb runs auth (the I_AM passes
// universally) and dispatches through the standard inbox + role
// path. There is no direct appendToInbox + wake bypass.
async function _emitOne({
  inboxSpaceId,
  toBeingId,
  priority,
  senderStance,
  content,
  rootCorrelation,
  identity,
}) {
  const correlation = randomUUID();
  await summonByResolved({
    toBeingId,
    inboxSpaceId,
    identity,
    message: {
      from: senderStance,
      content,
      correlation,
      rootCorrelation: rootCorrelation || correlation,
      priority,
      sentAt: new Date().toISOString(),
    },
  });
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
    events: [ctx.event],
    firstAt: Date.now(),
    senderStance: ctx.senderStance,
    targetSpace: ctx.targetSpace,
    rootCorrelation: ctx.rootCorrelation,
    eventName: ctx.eventName,
    timer: null,
  };
  pending.timer = setTimeout(() => {
    _flushCoalesce(sub).catch((err) => {
      log.warn(
        "Subscriptions",
        `flushCoalesce ${sub.id.slice(0, 8)} failed: ${err.message}`,
      );
    });
  }, sub.coalesceMs);
  if (typeof pending.timer.unref === "function") pending.timer.unref();
  _pendingCoalesce.set(sub.id, pending);
}

async function _flushCoalesce(sub) {
  const pending = _pendingCoalesce.get(sub.id);
  if (!pending) return;
  _pendingCoalesce.delete(sub.id);
  // Subscription removed mid-window: drop the batch silently.
  if (!_index.has(sub.id)) return;
  // Single SUMMON whose content carries the batch. Receivers know
  // `events` is a list when coalesceMs > 0 was configured.
  const content = {
    event: pending.eventName,
    coalesced: true,
    batchSize: pending.events.length,
    events: pending.events,
    firstAt: new Date(pending.firstAt).toISOString(),
    lastAt: new Date().toISOString(),
  };
  try {
    const identity = await iAmIdentity();
    if (!identity) return;
    await _emitOne({
      inboxSpaceId: pending.targetSpace,
      toBeingId: sub.beingId,
      priority: sub.priority,
      senderStance: pending.senderStance,
      content,
      rootCorrelation: pending.rootCorrelation,
      identity,
    });
  } catch (err) {
    log.warn(
      "Subscriptions",
      `coalesced emit ${pending.eventName} → being ${sub.beingId.slice(0, 8)} failed: ${err.message}`,
    );
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
// (e.g. "content.origin" to match a matter's origin).
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
  // Every kernel-emitted SUMMON has the I_AM as its asker. The
  // subscriber registered an interest; the I_AM holds that
  // declaration and emits the SUMMON when a matching DO fires.
  // The position carries where the DO happened, so the receiver
  // can see "the I_AM, standing at this space, is summoning you."
  // The original DO actor lives in the SUMMON's content payload as
  // `actorBeingId`; receivers that need to know who acted read it
  // from there.
  const domain = getPlaceDomain() || "place";
  const position = payload?.spaceId ? `/${payload.spaceId}` : "";
  return `${domain}${position}@${I_AM}`;
}

function _inboxNodeIdForSubscriber(sub, payload) {
  // Deliver to the subscriber's home position when known so the inbox
  // ends up at a single well-defined place per being. Fallback to the
  // event's spaceId (the affected space) and ultimately the place root.
  return (
    payload?.subscriberHomeId || payload?.spaceId || getPlaceRootId() || null
  );
}

function _renderTriggerContent(eventName, payload) {
  // Compact, predictable envelope the receiving role template parses.
  // Keep this stable — role templates will pattern-match on `event`
  // and the payload fields. Trim what's likely large (full matter
  // content) to references only.
  const out = { event: eventName };
  if (payload?.spaceId) out.spaceId = String(payload.spaceId);
  if (payload?.beingId) out.actorBeingId = String(payload.beingId);
  if (payload?.action) out.action = payload.action;
  if (payload?.matter?._id) out.matterId = String(payload.matter._id);
  if (payload?.matter?.origin) out.matterOrigin = payload.matter.origin;
  if (payload?.origin) out.origin = payload.origin;
  if (payload?.extName) out.extName = payload.extName;
  if (payload?.fromStatus) out.fromStatus = payload.fromStatus;
  if (payload?.toStatus) out.toStatus = payload.toStatus;
  if (payload?.timestamp) out.timestamp = payload.timestamp;
  else out.timestamp = new Date().toISOString();
  return out;
}

function _scopeLabel(scope) {
  if (scope.everywhere) return "everywhere";
  if (scope.spaceId) return `space:${String(scope.spaceId).slice(0, 8)}`;
  if (scope.ancestor) return `ancestor:${String(scope.ancestor).slice(0, 8)}`;
  return "?";
}
