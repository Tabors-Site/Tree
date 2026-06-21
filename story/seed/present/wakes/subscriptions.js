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
// Storage. The chain is the truth, even for liveness.
//
// Every subscribe() stamps a `subscription-registered` fact on the
// subscriber's reel; every unsubscribe() stamps `subscription-cancelled`.
// The in-memory `_byBeing` / `_byEvent` / `_index` maps are a runtime
// projection — they make event-time dispatch O(1) — but the fact chain
// is the authoritative record of "what is this being attending to."
// Boot rehydrate folds the chain to rebuild the registry.
//
// Same doctrine as wakes-as-facts (wakeSchedule.js): per-being liveness
// rides on the being's own reel, not on a side-table. Histories inherit
// subscription state through reel-lineage automatically (a #1 history
// sees parent's subscriptions until a cancel-on-#1 lands). Clones can
// capture per-being subscriptions because they live on the being's
// chain — not in a separate persistence layer.

import { randomUUID } from "crypto";
import log from "../../seedStory/log.js";
import { getAncestorChain } from "../../materials/space/ancestorCache.js";
import { callByResolved } from "../../ibp/verbs/call.js";
import { getStoryDomain } from "../../ibp/address.js";
import { getSpaceRootId } from "../../sprout.js";
import { emitFact } from "../../past/fact/facts.js";

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
 * Register a subscription. Validates input, updates the in-memory
 * registry synchronously (so dispatch sees it on the next event), and
 * stamps a `subscription-registered` fact on the subscriber's reel
 * (the durable, history-aware record).
 *
 * The fact emit is awaited so callers inside a moment ride the same
 * ΔF and seal atomically with the surrounding act. Callers outside a
 * moment still await — the fact lands via sealFacts singleton.
 *
 * @param {string} beingId
 * @param {object} sub   shape per file header (event/scope/filter/priority/coalesceMs/id)
 * @param {object} opts
 * @param {string} opts.history        REQUIRED. Which history this subscription lives on.
 *                                     No silent default; pass "0" explicitly from
 *                                     genesis / seed-plant paths.
 * @param {object} [opts.moment]    in-flight act ctx; fact rides this ΔF
 * @param {string} [opts.actorBeingId] actor on the fact; defaults to the subscriber (self-subscribe)
 * @returns {Promise<string>} subscription id
 */
export async function subscribe(beingId, sub, opts = {}) {
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
  if (typeof opts.history !== "string" || !opts.history.length) {
    throw new Error(
      `subscribe requires opts.history (got ${JSON.stringify(opts.history)}). ` +
      `No silent default to main — pass "0" explicitly for genesis / seed paths.`,
    );
  }

  const id = sub.id || randomUUID();
  const beingIdStr = String(beingId);
  const entry = {
    id,
    beingId: beingIdStr,
    event: sub.event,
    scope: sub.scope,
    filter: sub.filter || null,
    priority: Number.isFinite(sub.priority) ? Number(sub.priority) : 4, // BACKGROUND
    coalesceMs:
      Number.isFinite(sub.coalesceMs) && sub.coalesceMs > 0
        ? Number(sub.coalesceMs)
        : 0,
  };

  // Idempotent re-subscribe: drop the prior runtime entry (if any).
  // The subscription-registered fact we emit below is the new truth.
  if (_index.has(id)) {
    _dropRegistryEntry(id);
  }

  // Stamp the fact. Per-reel append-lock serializes against any
  // concurrent unsubscribe of the same id.
  await emitFact({
    through: String(opts.actorBeingId || beingIdStr),
    history: opts.history,
    verb:    "do",
    act:     "subscription-registered",
    of:      { kind: "being", id: beingIdStr },
    params:  {
      subscriptionId: id,
      event:          entry.event,
      scope:          entry.scope,
      filter:         entry.filter,
      priority:       entry.priority,
      coalesceMs:     entry.coalesceMs,
    },
  }, opts.moment || null);

  _addRegistryEntry(entry);

  log.verbose(
    "Subscriptions",
    `subscribed ${entry.event} for being ${entry.beingId.slice(0, 8)} ` +
      `on #${opts.history} (scope=${_scopeLabel(entry.scope)}, id=${id.slice(0, 8)})`,
  );
  return id;
}

/**
 * Cancel a subscription on a history. Stamps a `subscription-cancelled`
 * fact on the subscriber's reel and drops the runtime entry.
 * Cancellations are per-history by design: cancelling on main does not
 * stop the inherited entry on #1, and cancelling on #1 does not stop
 * main. Returns true when something was removed from the runtime
 * registry (false if no live entry by that id).
 *
 * @param {string} subscriptionId
 * @param {object} opts
 * @param {string} opts.history        REQUIRED
 * @param {object} [opts.moment]    in-flight act ctx
 * @param {string} [opts.actorBeingId] defaults to the subscription's being
 * @returns {Promise<boolean>}
 */
export async function unsubscribe(subscriptionId, opts = {}) {
  if (typeof opts.history !== "string" || !opts.history.length) {
    throw new Error("unsubscribe requires opts.history");
  }
  const entry = _index.get(subscriptionId);
  if (!entry) return false;

  await emitFact({
    through: String(opts.actorBeingId || entry.beingId),
    history: opts.history,
    verb:    "do",
    act:     "subscription-cancelled",
    of:      { kind: "being", id: entry.beingId },
    params:  { subscriptionId },
  }, opts.moment || null);

  _dropRegistryEntry(subscriptionId);
  return true;
}

/**
 * Drop every subscription for a being. Used when a being is released
 * so the registry doesn't keep delivering to a phantom inbox. The
 * being's release fact is the substrate's record of "this being is
 * gone"; we don't emit per-subscription cancel facts because there's
 * no being-of-record left to attribute them to.
 *
 * Runtime-only cleanup.
 *
 * @param {string} beingId
 * @returns {number} count dropped
 */
export function unsubscribeAllForBeing(beingId) {
  if (!beingId) return 0;
  const beingMap = _byBeing.get(String(beingId));
  if (!beingMap) return 0;
  const ids = Array.from(beingMap.keys());
  for (const id of ids) _dropRegistryEntry(id);
  return ids.length;
}

// ────────────────────────────────────────────────────────────────
// Runtime registry helpers — used by subscribe / unsubscribe /
// rehydrateFromFacts. The registry is a projection of the fact
// chain; these helpers are how the projection updates.
// ────────────────────────────────────────────────────────────────

function _addRegistryEntry(entry) {
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
}

function _dropRegistryEntry(id) {
  const entry = _index.get(id);
  if (!entry) return false;
  _index.delete(id);
  const beingMap = _byBeing.get(entry.beingId);
  if (beingMap) {
    beingMap.delete(id);
    if (beingMap.size === 0) _byBeing.delete(entry.beingId);
  }
  const eventSet = _byEvent.get(entry.event);
  if (eventSet) {
    eventSet.delete(id);
    if (eventSet.size === 0) _byEvent.delete(entry.event);
  }
  // Clear any in-flight coalesce window. Batched events are dropped —
  // there's no inbox to deliver them to once the subscription is gone.
  const pending = _pendingCoalesce.get(id);
  if (pending) {
    try { clearTimeout(pending.timer); } catch {}
    _pendingCoalesce.delete(id);
  }
  return true;
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
 * Rehydrate the in-memory registry from the fact chain.
 *
 * For every live history (main + every non-deleted History row), walks
 * the subscription-registered / subscription-cancelled facts inherited
 * through reel-lineage and materializes one runtime entry per live
 * (subscriptionId, history) pair. Same shape as wakeSchedule's
 * rehydrateFromFacts.
 *
 * The chain is the truth. This function is its projector for the
 * dispatcher's runtime state. Boot calls it once; tests call it to
 * prove fold-from-genesis recovers attention identically to the live
 * registry.
 *
 * @returns {Promise<number>} count of subscriptions restored across all histories
 */
export async function rehydrateFromFacts() {
  let Fact, History;
  try {
    Fact = (await import("../../past/fact/fact.js")).default;
    History = (await import("../../materials/history/history.js")).default;
  } catch (err) {
    log.warn("Subscriptions", `rehydrate skipped: model load failed (${err.message})`);
    return 0;
  }

  // Enumerate live histories: main + every non-deleted History row.
  const MAIN = "0";
  const histories = [MAIN];
  try {
    const historyRows = await History.find({ deleted: { $ne: true } }, "_id").lean();
    for (const row of historyRows) {
      if (row._id !== MAIN) histories.push(row._id);
    }
  } catch (err) {
    log.warn("Subscriptions", `rehydrate history enumeration failed: ${err.message}`);
  }

  // One query pulls every subscription fact across every history.
  // Sorted by (date, seq) so cancellations within a history's lineage
  // take effect after the matching registration.
  const subFacts = await Fact.find({
    verb: "do",
    action: { $in: ["subscription-registered", "subscription-cancelled"] },
  }).sort({ date: 1, seq: 1 }).lean();

  // Lazy-load lineage walker only when we actually have facts.
  let isInLineage = null;
  if (subFacts.length > 0) {
    isInLineage = (await import("./wakeSchedule.js")).__isInHistoryLineageForTests
      || null;
  }

  let restored = 0;
  for (const history of histories) {
    const live = new Map();
    for (const fact of subFacts) {
      // Subscription facts target the being's own reel; we need the
      // history-lineage filter same as wakes use. Inline-check via
      // Fact.history matching the target history or any ancestor.
      if (!await _factInHistoryLineage(fact, history, History)) continue;
      const id = fact.params?.subscriptionId;
      if (!id) continue;
      if (fact.action === "subscription-registered") {
        live.set(id, _entryFromFact(fact));
      } else if (fact.action === "subscription-cancelled") {
        live.delete(id);
      }
    }
    for (const entry of live.values()) {
      if (entry) {
        _addRegistryEntry(entry);
        restored++;
      }
    }
  }

  if (restored > 0) {
    log.info(
      "Subscriptions",
      `rehydrated ${restored} subscription(s) from fact chain across ${histories.length} history(ies)`,
    );
  }
  return restored;
}

// Lightweight per-history lineage check. A fact lives in history B's
// view if it was stamped on B itself or on any ancestor up to genesis.
// Wakes use a more careful seq-aware walk that respects per-reel
// branchPoints; for subscriptions we don't need that level of
// precision at boot — subscription liveness is event-driven, not
// seq-replayed. Plain "stamped on this history or one of its
// ancestors" matches what `subscribe(history: "1a")` callers expect.
async function _factInHistoryLineage(fact, viewerHistory, History) {
  if (!fact.history || fact.history === viewerHistory) return true;
  if (viewerHistory === "0") return fact.history === "0";
  // Walk viewerHistory's parent chain.
  let cursor = viewerHistory;
  const visited = new Set();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    if (cursor === fact.history) return true;
    const row = await History.findById(cursor, "parent").lean();
    cursor = row?.parent || null;
  }
  return false;
}

function _entryFromFact(fact) {
  const p = fact.params || {};
  return {
    id:         p.subscriptionId,
    beingId:    String(fact.target?.id || fact.beingId),
    event:      p.event,
    scope:      p.scope,
    filter:     p.filter || null,
    priority:   Number.isFinite(p.priority) ? Number(p.priority) : 4,
    coalesceMs: Number.isFinite(p.coalesceMs) && p.coalesceMs > 0
                  ? Number(p.coalesceMs) : 0,
  };
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
  // specific history; the chain walk has to read that history's view.
  // Caller threads payload.history (the afterX hook payload key) from
  // the emitting moment.
  const history = payload?.history;

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
      const chain = await getAncestorChain(spaceId, history);
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
  const storyDomain = getStoryDomain();
  if (!storyDomain) {
    log.debug(
      "Subscriptions",
      `skipping ${eventName}: story domain not yet available`,
    );
    return 0;
  }
  const rootCorrelation = payload?.rootCorrelation || payload?.actId || null;
  // History rides on the triggering hook's payload (afterMatter,
  // afterQualityWrite, afterFieldWrite — all populate it from the
  // moment / fact that fired). The wake we emit lands on the SAME
  // history as the trigger; cross-history waking is forbidden by the
  // address bridge gate anyway. No fallback: if history is missing
  // the hook payload was malformed at the perimeter and we surface
  // it loud via callByResolved's MISSING_BRANCH throw.
  const history = payload?.history ?? null;

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
      const senderStance = `${storyDomain}/${subSpaceForStance}@${subIdentity.name}`;

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
          history,
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
          history,
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
//
// History rides explicitly as args.history (not via moment — this
// path runs from a hook handler, outside any enclosing moment). The
// triggering hook payload (afterMatter / afterQualityWrite / ...) put
// the history here; callByResolved threads it through to the fact.
// If history is null, callByResolved throws MISSING_BRANCH — that
// surfaces a perimeter threading gap rather than silently waking on
// main.
async function _emitOne({
  inboxSpaceId,
  toBeingId,
  priority,
  senderStance,
  content,
  rootCorrelation,
  identity,
  history,
}) {
  const correlation = randomUUID();
  await callByResolved({
    toBeingId,
    inboxSpaceId,
    identity,
    history,
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
    history: ctx.history || null,
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
      history: pending.history,
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
// (e.g. "content.mimeType" to match a matter's mime).
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
