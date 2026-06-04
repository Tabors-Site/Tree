// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Attention, not dispatch.
//
// A subscription is a being's standing assignment of attention:
// "wake me when this happens at that position." When the watched
// event arrives, the being's prior request is what fires — the wake
// is a SELF-WAKE, not an external command. The SUMMON's asker and
// receiver are the same being. I_AM is the routing machinery, not
// the holder of the declaration; the being holds it (registry
// keyed by _byBeing).
//
// Under this framing there is no "Mode 1 vs Mode 2." Every wake is
// a being requesting a moment of itself. Direct SUMMONs are
// requests fired now; subscription wakes are requests fired when
// the watched event arrives; scheduled wakes are requests fired on
// a cadence. Same shape, different latencies.
//
// What this layer adds. Without it, substrate change is decoupled
// from beings that care about it; with it, beings can direct their
// attention at the substrate and have their own follow-up moments
// arrive naturally when the substrate moves. The being's act-chain
// reads cleanly as "moments this being attended to" — every wake
// row's beingIn IS the being.
//
// Subscription content carries a small envelope describing what
// changed; the receiving role's summon() decides whether the
// moment should actually act on it. The original DO actor (whoever
// fired the triggering write) lives in the SUMMON content as
// `actorBeingId`, not in `from` — the asker on the wire is always
// the subscriber.
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
import log from "../../seedReality/log.js";
import { getAncestorChain } from "../../materials/space/ancestorCache.js";
import { summonByResolved } from "../../ibp/verbs/summon.js";
import { getRealityDomain } from "../../ibp/address.js";
import { getSpaceRootId } from "../../sprout.js";

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

  // Durability shadow. The in-memory registry is the runtime
  // source of truth (hot-path, no-DB lookups in emitToSubscribers);
  // this write-through to SubscriptionRecord is what survives a
  // server restart, so a dance-floor planted before the restart
  // keeps its dancers attending after. The collection write is
  // fire-and-forget — failures are logged, the in-memory entry is
  // already live, the boot rehydrate is what would notice a
  // missing record (and re-register is idempotent on id).
  _persistSubscription(entry).catch((err) => {
    log.warn(
      "Subscriptions",
      `persistence write failed for ${id.slice(0, 8)}: ${err.message}`,
    );
  });

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
  // Durability: drop the persisted shadow so this subscription
  // doesn't rehydrate on next boot. Fire-and-forget.
  _removePersistedSubscription(subscriptionId).catch((err) => {
    log.warn(
      "Subscriptions",
      `persistence delete failed for ${subscriptionId.slice(0, 8)}: ${err.message}`,
    );
  });
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
 * Rehydrate the in-memory registry from the SubscriptionRecord
 * collection. Called once at boot (see genesis.js). The collection
 * is the durable shadow of every subscription that was ever
 * registered and not explicitly unsubscribed; walking it lets a
 * server come up with every being's prior attention restored.
 *
 * Returns the count rehydrated. Errors per-row are logged and
 * swallowed — one malformed record shouldn't strand the rest of
 * the dance.
 */
export async function rehydrateFromDb() {
  let SubscriptionRecord;
  try {
    SubscriptionRecord = (await import("../../models/subscriptionRecord.js")).default;
  } catch (err) {
    log.warn("Subscriptions", `rehydrate skipped: model load failed (${err.message})`);
    return 0;
  }
  let restored = 0;
  try {
    const rows = await SubscriptionRecord.find({}).lean();
    for (const row of rows) {
      try {
        // Direct in-memory write — bypass subscribe() so we don't
        // re-persist what we just read. The shape matches what
        // subscribe() would have produced; the boot rehydrate is
        // a registry restore, not a new declaration.
        const entry = {
          id: row._id,
          beingId: String(row.beingId),
          event: row.event,
          scope: row.scope,
          filter: row.filter || null,
          priority: Number.isFinite(row.priority) ? Number(row.priority) : 4,
          coalesceMs: Number.isFinite(row.coalesceMs) && row.coalesceMs > 0
            ? Number(row.coalesceMs)
            : 0,
        };
        let beingMap = _byBeing.get(entry.beingId);
        if (!beingMap) {
          beingMap = new Map();
          _byBeing.set(entry.beingId, beingMap);
        }
        beingMap.set(entry.id, entry);
        let eventSet = _byEvent.get(entry.event);
        if (!eventSet) {
          eventSet = new Set();
          _byEvent.set(entry.event, eventSet);
        }
        eventSet.add(entry.id);
        _index.set(entry.id, entry);
        restored++;
      } catch (rowErr) {
        log.warn(
          "Subscriptions",
          `skipping malformed record ${String(row?._id || "?").slice(0, 8)}: ${rowErr.message}`,
        );
      }
    }
  } catch (err) {
    log.warn("Subscriptions", `rehydrate query failed: ${err.message}`);
  }
  if (restored > 0) {
    log.info("Subscriptions", `rehydrated ${restored} subscription(s) from durable store`);
  }
  return restored;
}

// ────────────────────────────────────────────────────────────────
// Persistence helpers. Write-through to SubscriptionRecord. The
// in-memory registry is authoritative at runtime; this collection
// is the boot-rehydration source.
// ────────────────────────────────────────────────────────────────

async function _persistSubscription(entry) {
  const SubscriptionRecord = (await import("../../models/subscriptionRecord.js")).default;
  await SubscriptionRecord.updateOne(
    { _id: entry.id },
    {
      $set: {
        beingId:    entry.beingId,
        event:      entry.event,
        scope:      entry.scope,
        filter:     entry.filter,
        priority:   entry.priority,
        coalesceMs: entry.coalesceMs,
      },
      $setOnInsert: { _id: entry.id, createdAt: new Date() },
    },
    { upsert: true },
  );
}

async function _removePersistedSubscription(id) {
  const SubscriptionRecord = (await import("../../models/subscriptionRecord.js")).default;
  await SubscriptionRecord.deleteOne({ _id: id });
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
  // Subscriptions fan out from a fact that was just emitted on a
  // specific branch; the chain walk has to read that branch's view.
  // Caller threads payload.branch from the emitting moment.
  const branch = payload?.branch;

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
      const chain = await getAncestorChain(spaceId, branch);
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
 * Emit a SUMMON to every subscriber whose attention covers this
 * event. Called by substrate hook listeners; safe to call when no
 * subscribers match (cheap no-op).
 *
 * Each emission is a self-wake: the SUMMON's asker is the
 * subscribing being itself, at the position where the triggering
 * event happened. The original DO actor (whoever fired the
 * triggering write) is carried in the SUMMON content as
 * `actorBeingId` so the receiving role can distinguish "I caused
 * this" from "someone else's write reached my attention."
 *
 * @param {string} eventName
 * @param {object} payload
 * @param {object} [options]  reserved
 */
export async function emitToSubscribers(eventName, payload, options = {}) {
  const matches = await getMatchingSubscribers(eventName, payload);
  if (matches.length === 0) return 0;

  // Doctrine — attention, not dispatch.
  //
  // A subscription is the being's standing assignment of attention:
  // "wake me when this happens." When the watched event arrives, the
  // being's prior request is what fires. The wake is therefore a
  // SELF-WAKE — the asker and the receiver are the same being. I_AM
  // is the routing machinery, not the holder of the declaration.
  //
  // The original DO actor (whoever wrote the matter / fired the
  // quality) lives in the SUMMON content as `actorBeingId`; the
  // subscriber's act-chain (beingIn = subscriber) reads cleanly as
  // "moments this being attended to." Position carries where the
  // triggering DO happened.
  const realityDomain = getRealityDomain();
  if (!realityDomain) {
    log.debug(
      "Subscriptions",
      `skipping ${eventName}: reality domain not yet available`,
    );
    return 0;
  }
  const rootCorrelation = payload?.rootCorrelation || payload?.actId || null;

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
      // Self-wake: load the subscribing being's identity, build the
      // self-targeted sender stance. If the being is gone (deleted
      // mid-flight), drop the wake silently — its standing
      // declaration died with it.
      const subIdentity = await _loadSubscriberIdentity(sub.beingId);
      if (!subIdentity) {
        log.debug(
          "Subscriptions",
          `skipping ${eventName} → being ${sub.beingId.slice(0, 8)}: subscriber being not found`,
        );
        continue;
      }
      const subSpaceForStance = payload?.spaceId ? String(payload.spaceId) : targetSpace;
      const senderStance = `${realityDomain}/${subSpaceForStance}@${subIdentity.name}`;

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
          identity: subIdentity,
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
          identity: subIdentity,
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
    identity: ctx.identity || null,
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
    // Self-wake: the subscriber's identity was captured when the
    // coalesce window opened. Re-load on a stale-being check so a
    // mid-window delete drops the wake instead of summoning a
    // phantom.
    const identity = pending.identity
      ? (await _loadSubscriberIdentity(sub.beingId))
      : null;
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

/**
 * Load { beingId, name } for the subscribing being. Self-wakes need
 * this to mint the SUMMON as the being itself rather than as the
 * I_AM dispatcher. Returns null when the being is gone (deleted
 * mid-flight or between subscribe and fire); callers drop the wake
 * silently in that case.
 */
async function _loadSubscriberIdentity(beingId) {
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("being", String(beingId), "0");
    if (!slot?.state?.name) return null;
    return { beingId: String(slot.id), name: slot.state.name };
  } catch {
    return null;
  }
}

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

function _inboxNodeIdForSubscriber(sub, payload) {
  // Deliver to the subscriber's home position when known so the inbox
  // ends up at a single well-defined place per being. Fallback to the
  // event's spaceId (the affected space) and ultimately the place root.
  return (
    payload?.subscriberHomeId || payload?.spaceId || getSpaceRootId() || null
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
  // For afterQualityWrite / afterFieldWrite, surface the WRITTEN
  // VALUE so the receiving role can read it directly off the wake
  // without folding the matter / space / being. The drummer's tick
  // is the canonical case: the dancer wakes on
  // afterQualityWrite{field:"qualities.harmony.tick"} and needs the
  // tick number (`value.n`) to frame this beat. The target reference
  // (matterId / spaceId / actorBeingId) is still carried so a role
  // that wants the full fold can do it; this is just the inline read.
  if (payload?.field) out.field = String(payload.field);
  if (payload?.value !== undefined) out.value = payload.value;
  if (payload?.target?.kind && payload?.target?.id) {
    out.target = { kind: payload.target.kind, id: String(payload.target.id) };
  }
  return out;
}

function _scopeLabel(scope) {
  if (scope.everywhere) return "everywhere";
  if (scope.spaceId) return `space:${String(scope.spaceId).slice(0, 8)}`;
  if (scope.ancestor) return `ancestor:${String(scope.ancestor).slice(0, 8)}`;
  return "?";
}
