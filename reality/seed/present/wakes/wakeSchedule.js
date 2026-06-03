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
// Attention, not dispatch. Every scheduled wake is a SELF-WAKE
// minted as the scheduled being itself, not as the I_AM. A being
// scheduling itself IS the act of attention; when the tick lands
// the being's own prior request fires. The from-stance is the
// being at the place root: `<reality>/<spaceRoot>@<being-name>`.
// A reality that wants a different routing model installs an
// extension that calls setEmitter() to swap in its own dispatcher;
// the registry shape doesn't change.
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
import log from "../../seedReality/log.js";
import { summonByResolved } from "../../ibp/verbs/summon.js";
import { getRealityDomain } from "../../ibp/address.js";
import { getSpaceRootId } from "../../sprout.js";

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

  // Durability shadow. Same pattern as SubscriptionRecord — the
  // in-memory registry is the hot-path tick dispatcher; this
  // write-through is what survives a restart so the drum keeps
  // beating across server lifecycles. Fire-and-forget per the
  // self-healing principle: a missed write just means this schedule
  // doesn't survive the next boot.
  _persistSchedule(entry).catch((err) => {
    log.warn(
      "Schedule",
      `persistence write failed for ${id.slice(0, 8)}: ${err.message}`,
    );
  });

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
  // Durability: drop the persisted shadow so this schedule doesn't
  // rehydrate on next boot. Fire-and-forget.
  _removePersistedSchedule(scheduleId).catch((err) => {
    log.warn(
      "Schedule",
      `persistence delete failed for ${scheduleId.slice(0, 8)}: ${err.message}`,
    );
  });
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
  log.verbose("Schedule", `tick loop started (every ${_tickMs}ms)`);
}

// Stop the tick loop. Idempotent. Module-private — used by _resetAll
// during test teardown; not part of the public surface.
function stopTickLoop() {
  if (!_tickHandle) return;
  clearInterval(_tickHandle);
  _tickHandle = null;
  log.verbose("Schedule", "tick loop stopped");
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
 * Swap the default emitter. The default mints each wake as the
 * scheduled being itself; an extension can swap in a different
 * dispatcher (e.g. one routing scheduled wakes through an embodied
 * scheduler-being that observes and re-emits) without changing the
 * schedule registry shape.
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
 * Rehydrate the in-memory registry from the ScheduleRecord
 * collection. Called once at boot (see genesis.js) so a server
 * coming back up still ticks for every being that had a standing
 * cadence — the dance-floor's drum keeps beating across restarts.
 *
 * `nextFireMs` is recomputed as `Date.now() + intervalMs` for each
 * restored entry — we don't try to honor the pre-restart phase,
 * just resume the cadence from now.
 *
 * Returns the count rehydrated.
 */
export async function rehydrateFromDb() {
  let ScheduleRecord;
  try {
    ScheduleRecord = (await import("../../models/scheduleRecord.js")).default;
  } catch (err) {
    log.warn("Schedule", `rehydrate skipped: model load failed (${err.message})`);
    return 0;
  }
  let restored = 0;
  try {
    const rows = await ScheduleRecord.find({}).lean();
    const now = Date.now();
    for (const row of rows) {
      try {
        const intervalMs = Number(row.intervalMs);
        if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
          log.warn(
            "Schedule",
            `skipping record ${String(row._id).slice(0, 8)}: invalid intervalMs`,
          );
          continue;
        }
        const entry = {
          id: row._id,
          beingId: String(row.beingId),
          intervalMs,
          priority: Number.isFinite(row.priority) ? Number(row.priority) : 4,
          content: row.content !== undefined ? row.content : { kind: "scheduled-wake" },
          skipIfBacklog: row.skipIfBacklog !== false,
          nextFireMs: now + intervalMs,
          lastFireMs: null,
        };
        _registry.set(entry.id, entry);
        let beingSet = _byBeing.get(entry.beingId);
        if (!beingSet) {
          beingSet = new Set();
          _byBeing.set(entry.beingId, beingSet);
        }
        beingSet.add(entry.id);
        restored++;
      } catch (rowErr) {
        log.warn(
          "Schedule",
          `skipping malformed record ${String(row?._id || "?").slice(0, 8)}: ${rowErr.message}`,
        );
      }
    }
  } catch (err) {
    log.warn("Schedule", `rehydrate query failed: ${err.message}`);
  }
  if (restored > 0) {
    log.info("Schedule", `rehydrated ${restored} schedule(s) from durable store`);
  }
  return restored;
}

// ────────────────────────────────────────────────────────────────
// Persistence helpers. Write-through to ScheduleRecord. The
// in-memory registry is authoritative at runtime; this collection
// is the boot-rehydration source.
// ────────────────────────────────────────────────────────────────

async function _persistSchedule(entry) {
  const ScheduleRecord = (await import("../../models/scheduleRecord.js")).default;
  await ScheduleRecord.updateOne(
    { _id: entry.id },
    {
      $set: {
        beingId:       entry.beingId,
        intervalMs:    entry.intervalMs,
        priority:      entry.priority,
        content:       entry.content,
        skipIfBacklog: entry.skipIfBacklog,
      },
      $setOnInsert: { _id: entry.id, createdAt: new Date() },
    },
    { upsert: true },
  );
}

async function _removePersistedSchedule(id) {
  const ScheduleRecord = (await import("../../models/scheduleRecord.js")).default;
  await ScheduleRecord.deleteOne({ _id: id });
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
  // Attention, not dispatch.
  //
  // A scheduled wake is the being's standing assignment of attention
  // to a cadence: "wake me every N ms." When the tick lands, the
  // being's prior request fires. The SUMMON's asker is the being
  // itself; this is a self-wake. I_AM does not hold the declaration;
  // the being's own schedule entry does (registry keyed by beingId).
  //
  // The receiving role inspects the content payload to learn the
  // cadence context; everything in it is what the being itself set
  // at schedule() time.
  const spaceId = getSpaceRootId() || null;
  if (!spaceId) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)}: place root not initialized`,
    );
    return;
  }
  const realityDomain = getRealityDomain();
  if (!realityDomain) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)}: reality domain not yet available`,
    );
    return;
  }
  // Load the scheduled being's identity so the wake mints as the
  // being itself. If the being is gone (deleted but its schedule
  // wasn't yet unregistered), drop the wake silently — the standing
  // declaration died with it.
  const identity = await _loadBeingIdentity(entry.beingId);
  if (!identity) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)}: scheduled being not found`,
    );
    return;
  }
  const correlation = randomUUID();
  const sender = `${realityDomain}/${spaceId}@${identity.name}`;
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

/**
 * Load { beingId, name } for the scheduled being. Self-wakes use
 * this in place of iAmIdentity so the SUMMON mints with the being
 * as asker. Returns null when the being is gone.
 */
async function _loadBeingIdentity(beingId) {
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("being", String(beingId), "0");
    if (!slot?.state?.name) return null;
    return { beingId: String(slot.id), name: slot.state.name };
  } catch {
    return null;
  }
}
