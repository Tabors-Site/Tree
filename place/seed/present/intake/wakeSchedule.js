// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Cadence-driven moment requests. A being declares "I should have
// a moment every N ms" and I emit the SUMMON when the tick comes
// due. My third path for asking a being to have a moment, after
// direct being-to-being SUMMONs and DO-trigger fan-out
// (subscriptions.js). The moment itself is built the same way as
// any other moment; only the trigger differs.
//
// One registry, one tick. Each being keeping its own timer would
// multiply intervals across the process and lose visibility into
// who's scheduled to have moments. I walk a shared registry from
// one tick, stay cheap, and getStats() always says exactly what's
// pending.
//
// Two-mode neutrality. The default emitter writes wake SUMMONs as
// the I_AM (`<place>/<placeRoot>@I_AM`) — the subscriber declared
// the cadence, the I_AM holds the declaration and asks for the
// moment when the tick fires. A place that wants an embodied
// scheduler-being installs an extension that calls setEmitter()
// to swap in a Being-row-backed dispatcher; the registry shape
// doesn't change.
//
// Schedule shape:
//
//   {
//     id:            string,
//     beingId:       string,
//     intervalMs:    number,        // minimum 250ms
//     priority:      number,        // SUMMON priority; default BACKGROUND (4)
//     content:       any,           // payload of the wake SUMMON
//     nextFireMs:    number,        // when the next wake fires
//     lastFireMs:    number|null,
//     skipIfBacklog: boolean,       // skip when being already has
//                                    // unconsumed scheduled-wakes (default true)
//   }
//
// Cron-style scheduling and event-condition triggers ("when phase
// == awake") land later if a real caller needs them. Simple
// intervals cover everything we run today (scout, dreams,
// compression, peer-review).

import { randomUUID } from "crypto";
import log from "../../system/log.js";
import { summonByResolved } from "../../ibp/verbs.js";
import { getPlaceDomain } from "../../ibp/address.js";
import { getPlaceRootId } from "../../placeRoot.js";
import { I_AM } from "../../place/being/seedBeings.js";
import { iAmIdentity } from "../../place/being/placeBeings.js";

const MIN_INTERVAL_MS = 250;
const DEFAULT_TICK_MS = 1000;

// scheduleId -> schedule entry
const _registry = new Map();

// beingId -> Set<scheduleId>
const _byBeing = new Map();

let _tickHandle = null;
let _tickMs = DEFAULT_TICK_MS;
let _emitter = _defaultEmitter;

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Register a wake schedule for a being. Returns the schedule id.
 *
 * @param {string} beingId
 * @param {object} opts
 * @param {number} opts.intervalMs       wake cadence (>=250ms)
 * @param {number} [opts.priority]       SUMMON priority; default 4
 * @param {any}    [opts.content]        SUMMON content; default { kind: "scheduled-wake" }
 * @param {boolean}[opts.skipIfBacklog]  skip wake when being already has unconsumed scheduled-wake (default true)
 * @param {string} [opts.id]             caller-supplied stable id (so re-registers replace)
 * @returns {string} schedule id
 */
export function schedule(beingId, opts = {}) {
  if (!beingId || typeof beingId !== "string") {
    throw new Error("schedule requires beingId");
  }
  const intervalMs = Number(opts.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    throw new Error(
      `schedule.intervalMs must be a number >= ${MIN_INTERVAL_MS}`,
    );
  }

  const id = opts.id || randomUUID();
  // Idempotent re-register: if the id already exists, replace it.
  unschedule(id);

  const now = Date.now();
  const entry = {
    id,
    beingId: String(beingId),
    intervalMs,
    priority: Number.isFinite(opts.priority) ? Number(opts.priority) : 4,
    content:
      opts.content !== undefined ? opts.content : { kind: "scheduled-wake" },
    skipIfBacklog: opts.skipIfBacklog !== false,
    nextFireMs: now + intervalMs,
    lastFireMs: null,
  };

  _registry.set(id, entry);
  let beingSet = _byBeing.get(entry.beingId);
  if (!beingSet) {
    beingSet = new Set();
    _byBeing.set(entry.beingId, beingSet);
  }
  beingSet.add(id);

  log.verbose(
    "Schedule",
    `scheduled wake for being ${entry.beingId.slice(0, 8)} every ${intervalMs}ms ` +
      `(id=${id.slice(0, 8)})`,
  );
  return id;
}

/**
 * Remove one schedule. Returns true when something was removed.
 */
export function unschedule(scheduleId) {
  const entry = _registry.get(scheduleId);
  if (!entry) return false;
  _registry.delete(scheduleId);
  const beingSet = _byBeing.get(entry.beingId);
  if (beingSet) {
    beingSet.delete(scheduleId);
    if (beingSet.size === 0) _byBeing.delete(entry.beingId);
  }
  return true;
}

/**
 * Drop every schedule for a being. Called on being deletion.
 */
export function unscheduleAllForBeing(beingId) {
  if (!beingId) return 0;
  const beingSet = _byBeing.get(String(beingId));
  if (!beingSet) return 0;
  const ids = Array.from(beingSet);
  for (const id of ids) unschedule(id);
  return ids.length;
}

/**
 * Start the tick loop. Idempotent; calling twice keeps the existing
 * timer. Pass `{ tickMs }` to override the cadence (default 1s).
 */
export function startTickLoop({ tickMs } = {}) {
  if (Number.isFinite(tickMs) && tickMs >= MIN_INTERVAL_MS) {
    _tickMs = tickMs;
  }
  if (_tickHandle) return;
  _tickHandle = setInterval(() => {
    runOnce(Date.now()).catch((err) => {
      log.error("Schedule", `tick failed: ${err.message}`);
    });
  }, _tickMs);
  // Don't keep the process alive solely on the schedule tick — server
  // shutdown handles its own lifecycle. Space's unref makes setInterval
  // non-blocking for exit purposes.
  if (typeof _tickHandle.unref === "function") _tickHandle.unref();
  log.info("Schedule", `tick loop started (every ${_tickMs}ms)`);
}

// Stop the tick loop. Idempotent. Module-private — used by _resetAll
// during test teardown; not part of the public surface.
function stopTickLoop() {
  if (!_tickHandle) return;
  clearInterval(_tickHandle);
  _tickHandle = null;
  log.info("Schedule", "tick loop stopped");
}

/**
 * Run one tick manually. Used by the periodic loop and by tests.
 * Walks every registered schedule and fires wakes for schedules whose
 * nextFireMs has passed. Updates lastFireMs/nextFireMs on fire.
 *
 * @param {number} [nowMs]   override the clock (tests)
 * @returns {Promise<number>} number of wakes emitted
 */
export async function runOnce(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let fired = 0;
  for (const entry of _registry.values()) {
    if (entry.nextFireMs > now) continue;
    try {
      await _emitter(entry, now);
      fired++;
    } catch (err) {
      log.warn(
        "Schedule",
        `emit failed for schedule ${entry.id.slice(0, 8)} (being ${entry.beingId.slice(0, 8)}): ${err.message}`,
      );
    } finally {
      entry.lastFireMs = now;
      // Advance to the next interval beyond now. If many intervals
      // were missed (e.g. host slept), skip the catch-up: one wake is
      // enough; the being doesn't need to drown.
      const missed = Math.max(
        1,
        Math.floor((now - entry.nextFireMs) / entry.intervalMs) + 1,
      );
      entry.nextFireMs =
        now + (missed > 1 ? entry.intervalMs : entry.intervalMs);
      // Equivalent to: entry.nextFireMs = now + entry.intervalMs;
      // The branch is left explicit so future "preserve cadence even
      // after a long sleep" mode is a one-line change.
    }
  }
  return fired;
}

/**
 * Swap the default emitter. Used by the embodied scheduler-being
 * extension to route scheduled wakes through itself (Mode 1) instead
 * of the synthesized @I_AM sender (Mode 2).
 *
 * @param {function(entry, nowMs): Promise<void>} fn
 */
export function setEmitter(fn) {
  _emitter = typeof fn === "function" ? fn : _defaultEmitter;
}

/**
 * Restore the default code-flavored emitter.
 */
export function resetEmitter() {
  _emitter = _defaultEmitter;
}

/**
 * Diagnostic snapshot.
 */
export function getStats() {
  return {
    totalSchedules: _registry.size,
    beingsWithSchedules: _byBeing.size,
    tickRunning: !!_tickHandle,
    tickMs: _tickMs,
    emitter: _emitter === _defaultEmitter ? "default" : "custom",
  };
}

/**
 * For tests / teardown.
 */
export function _resetAll() {
  stopTickLoop();
  _registry.clear();
  _byBeing.clear();
  _emitter = _defaultEmitter;
  _tickMs = DEFAULT_TICK_MS;
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

async function _defaultEmitter(entry, nowMs) {
  // Every scheduled wake is a SUMMON emitted by the I_AM acting on
  // the subscriber's standing declaration. The from-stance is the
  // I_AM at the place root; the receiving role can inspect the
  // content payload to learn the cadence context.
  const spaceId = getPlaceRootId() || null;
  if (!spaceId) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)}: place root not initialized`,
    );
    return;
  }
  const identity = await iAmIdentity();
  if (!identity) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)}: I_AM identity not yet available`,
    );
    return;
  }
  const correlation = randomUUID();
  const sender = `${getPlaceDomain() || "place"}/${spaceId}@${I_AM}`;
  await summonByResolved({
    toBeingId: entry.beingId,
    inboxSpaceId: spaceId,
    identity,
    message: {
      from: sender,
      content: entry.content,
      correlation,
      rootCorrelation: correlation,
      priority: entry.priority,
      sentAt: new Date(nowMs).toISOString(),
    },
  });
}
