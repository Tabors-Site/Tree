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
// ── Wakes are facts ─────────────────────────────────────────────
//
// Scheduling is a world operation, not a being's act. SEE/DO/
// SUMMON/BE are what beings do; scheduling is the world's plumbing
// the way reel-heads are plumbing. So the public API is a substrate
// function (schedule, unschedule), not a verb. BUT the schedule
// state lives on the fact chain. wake-scheduled and wake-cancelled
// facts on the being's reel are the truth; this module's in-memory
// _registry is their runtime projection.
//
// The doctrinal claim: the chain is the truth of the world's
// LIVENESS, not just its STATE. Fold-from-genesis on any history
// reconstructs the scheduler that produced that history's facts.
// Histories inherit liveness for free through reel-lineage — the
// same mechanism that inherits state. No special "clone schedules
// at branch creation" step is needed.
//
// ── History axis ─────────────────────────────────────────────────
//
// Every schedule entry carries the history it ticks in. A dancer in
// main and the same dancer in #1 are two separate registry entries
// keyed by (scheduleId, history). Each fires onto its own history;
// each writes facts onto its own history's reels. A wake-scheduled
// fact on main BEFORE #1 was created is inherited by #1's lineage;
// a wake-cancelled fact on main AFTER #1 was created is past the
// branchPoint and does not affect #1.
//
// Schedule shape:
//
//   {
//     id:            string,
//     beingId:       string,
//     history:       string,
//     intervalMs:    number,           // minimum 250ms
//     priority:      number,           // SUMMON priority; default BACKGROUND (4)
//     content:       any,              // payload of the wake SUMMON
//     nextFireMs:    number,
//     lastFireMs:    number|null,
//     skipIfBacklog: boolean,
//   }
//
// Attention, not dispatch. Every scheduled wake is a SELF-WAKE
// minted as the scheduled being itself. A story that wants a
// different routing model installs an extension that calls
// setEmitter to swap in its own dispatcher; the registry shape
// doesn't change.

import { randomUUID } from "crypto";
import log from "../../seedStory/log.js";
import { callByResolved } from "../../ibp/verbs/call.js";
import { getStoryDomain } from "../../ibp/address.js";
import { getSpaceRootId } from "../../sprout.js";
import { emitFact } from "../../past/fact/facts.js";
import { MAIN } from "../../materials/history/histories.js";

const MIN_INTERVAL_MS = 250;
const DEFAULT_TICK_MS = 1000;

// Composite key. Same scheduleId on two histories = two entries.
function _key(scheduleId, history) {
  return `${scheduleId}:${history}`;
}

// `${scheduleId}:${history}` -> schedule entry
const _registry = new Map();

// beingId -> Set<registryKey>. Used by unscheduleAllForBeing.
const _byBeing = new Map();

let _tickHandle = null;
let _tickMs = DEFAULT_TICK_MS;
let _emitter = _defaultEmitter;

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Register a wake schedule for a being on a history. Returns the
 * schedule id.
 *
 * Emits a wake-scheduled fact on the being's reel for `opts.history`.
 * When opts.moment is present, the fact rides that act's ΔF and
 * commits at sealAct; otherwise it commits standalone via sealFacts.
 *
 * @param {string} beingId
 * @param {object} opts
 * @param {string} opts.history          REQUIRED. Which history this ticks in.
 *                                       No silent default; pass "0" explicitly
 *                                       from genesis / seed-plant paths.
 * @param {number} opts.intervalMs       wake cadence (>=250ms)
 * @param {number} [opts.priority]       SUMMON priority; default 4
 * @param {any}    [opts.content]        SUMMON content; default { kind: "scheduled-wake" }
 * @param {boolean}[opts.skipIfBacklog]  skip wake when being already has unconsumed scheduled-wake (default true)
 * @param {string} [opts.id]             caller-supplied stable id (re-registers replace)
 * @param {object} [opts.moment]      in-flight act ctx; fact rides this ΔF
 * @param {string} [opts.actorBeingId]   actor for the fact; default = scheduled being (self-act)
 * @returns {Promise<string>} schedule id
 */
export async function schedule(beingId, opts = {}) {
  if (!beingId || typeof beingId !== "string") {
    throw new Error("schedule requires beingId");
  }
  if (typeof opts.history !== "string" || !opts.history.length) {
    throw new Error(
      `schedule requires opts.history (got ${JSON.stringify(opts.history)}). ` +
      `No silent default to main . pass "0" explicitly for genesis / seed paths.`,
    );
  }
  const intervalMs = Number(opts.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
    throw new Error(
      `schedule.intervalMs must be a number >= ${MIN_INTERVAL_MS}`,
    );
  }

  const history = opts.history;
  const id = opts.id || randomUUID();
  const beingIdStr = String(beingId);

  // Idempotent re-register on this history. Drop the prior runtime
  // entry; the wake-scheduled fact we emit below is the new truth.
  _dropRegistryEntry(id, history);

  const params = {
    scheduleId:    id,
    intervalMs,
    priority:      Number.isFinite(opts.priority) ? Number(opts.priority) : 4,
    content:       opts.content !== undefined ? opts.content : { kind: "scheduled-wake" },
    skipIfBacklog: opts.skipIfBacklog !== false,
  };

  await emitFact({
    through: String(opts.actorBeingId || beingIdStr),
    history,
    verb:    "do",
    act:     "wake-scheduled",
    of:      { kind: "being", id: beingIdStr },
    params,
  }, opts.moment || null);

  const now = Date.now();
  _addRegistryEntry({
    id,
    beingId:       beingIdStr,
    history,
    intervalMs:    params.intervalMs,
    priority:      params.priority,
    content:       params.content,
    skipIfBacklog: params.skipIfBacklog,
    nextFireMs:    now + params.intervalMs,
    lastFireMs:    null,
  });

  log.verbose(
    "Schedule",
    `scheduled wake for being ${beingIdStr.slice(0, 8)} on #${history} every ${intervalMs}ms ` +
      `(id=${id.slice(0, 8)})`,
  );
  return id;
}

/**
 * Cancel a schedule on a history. Emits a wake-cancelled fact and
 * drops the runtime entry. Cancellations are per-history by design:
 * cancelling on main does not stop the inherited entry on #1, and
 * cancelling on #1 does not stop main.
 *
 * @param {string} scheduleId
 * @param {object} opts
 * @param {string} opts.history         REQUIRED
 * @param {object} [opts.moment]     in-flight act ctx
 * @param {string} [opts.actorBeingId]  defaults to the schedule's being
 * @returns {Promise<boolean>} true when something was removed
 */
export async function unschedule(scheduleId, opts = {}) {
  if (typeof opts.history !== "string" || !opts.history.length) {
    throw new Error("unschedule requires opts.history");
  }
  const history = opts.history;
  const entry = _registry.get(_key(scheduleId, history));
  if (!entry) return false;

  await emitFact({
    through: String(opts.actorBeingId || entry.beingId),
    history,
    verb:    "do",
    act:     "wake-cancelled",
    of:      { kind: "being", id: entry.beingId },
    params:  { scheduleId },
  }, opts.moment || null);

  _dropRegistryEntry(scheduleId, history);
  return true;
}

/**
 * Drop every schedule for a being across every history. Runtime-only
 * cleanup; no facts emitted. Called when a being is released . the
 * release fact is the substrate's record of "this being is gone."
 * A released being's wakes never fire (the identity lookup fails),
 * so the registry entries are just process overhead.
 */
export function unscheduleAllForBeing(beingId) {
  if (!beingId) return 0;
  const beingIdStr = String(beingId);
  const beingSet = _byBeing.get(beingIdStr);
  if (!beingSet) return 0;
  const keys = Array.from(beingSet);
  for (const key of keys) {
    _registry.delete(key);
  }
  _byBeing.delete(beingIdStr);
  return keys.length;
}

/**
 * Start the tick loop. Idempotent.
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
  if (typeof _tickHandle.unref === "function") _tickHandle.unref();
  log.verbose("Schedule", `tick loop started (every ${_tickMs}ms)`);
}

function stopTickLoop() {
  if (!_tickHandle) return;
  clearInterval(_tickHandle);
  _tickHandle = null;
  log.verbose("Schedule", "tick loop stopped");
}

/**
 * Run one tick. Walks every (scheduleId, history) entry and fires
 * wakes whose nextFireMs has passed. Each entry's emitter call
 * routes the SUMMON onto the entry's history.
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
        `emit failed for schedule ${entry.id.slice(0, 8)} on #${entry.history} ` +
        `(being ${entry.beingId.slice(0, 8)}): ${err.message}`,
      );
    } finally {
      entry.lastFireMs = now;
      entry.nextFireMs = now + entry.intervalMs;
    }
  }
  return fired;
}

export function setEmitter(fn) {
  _emitter = typeof fn === "function" ? fn : _defaultEmitter;
}

export function resetEmitter() {
  _emitter = _defaultEmitter;
}

/**
 * Rehydrate the in-memory registry from the fact chain.
 *
 * For every live history (main + every non-deleted History row), walks
 * the wake-scheduled / wake-cancelled facts inherited through the
 * history's reel-lineage and materializes one runtime entry per live
 * (scheduleId, history) pair.
 *
 * The chain is the truth. This function is its projector for the
 * scheduler's runtime state. Boot calls it once; tests call it to
 * prove fold-from-genesis recovers liveness identically to the live
 * registry.
 */
export async function rehydrateFromFacts() {
  let listLiveHistories, listByType, readReelBetween;
  try {
    ({ listLiveHistories } = await import("../../materials/history/histories.js"));
    ({ listByType } = await import("../../materials/projections.js"));
    ({ readReelBetween } = await import("../stamper/2-fold/foldEngine.js"));
  } catch (err) {
    log.warn("Schedule", `rehydrate skipped: curated layer load failed (${err.message})`);
    return 0;
  }

  // Cross-history enumeration of every live history. The history registry
  // is the file-backed history store; listLiveHistories (histories.js) is
  // the curated reader for "every non-deleted history row" (loadHistory is
  // single-row only).
  //
  // Enumerate live histories: main + every non-deleted history row.
  // Soft-deleted histories keep their facts in the chain but don't
  // tick. Undelete restores by rerunning rehydrate.
  const histories = [MAIN];
  try {
    const historyRows = await listLiveHistories();
    for (const row of historyRows) {
      if (row._id !== MAIN) histories.push(row._id);
    }
  } catch (err) {
    log.warn("Schedule", `rehydrate history enumeration failed: ${err.message}`);
  }

  // The old global verb/action scan + hand-rolled lineage walk are
  // replaced by the curated reel layer.
  // Wake facts ride the BEING reel (of:{kind:"being",id}), so for each live
  // history we enumerate that history's beings through the curated projection
  // layer (listByType, which already inherits the lineage with branchPoint
  // gating) and read each being's reel through the curated lineage-aware
  // reader (foldEngine.readReelBetween). readReelBetween resolves
  // (lineage, floors) and unions the parent prefix up to each branchPoint
  // with the history's own divergent tail — exactly the inheritance the
  // removed _isInHistoryLineage reproduced by hand, now done once in the
  // fold engine. Reels come back seq-ascending, so within a being's reel
  // schedule + cancel are totally ordered (cancel after its schedule).
  // ORDER, never the clock (623/12).
  const now = Date.now();
  let restored = 0;

  for (const history of histories) {
    let beings;
    try {
      beings = await listByType("being", history);
    } catch (err) {
      log.warn(
        "Schedule",
        `rehydrate being enumeration failed for #${history}: ${err.message}`,
      );
      continue;
    }
    const live = new Map();
    for (const occ of beings) {
      let reel;
      try {
        reel = await readReelBetween("being", occ.id, null, null, history);
      } catch (err) {
        log.warn(
          "Schedule",
          `rehydrate reel read failed for being ${String(occ.id).slice(0, 8)} ` +
            `on #${history}: ${err.message}`,
        );
        continue;
      }
      for (const fact of reel) {
        if (fact.verb !== "do") continue;
        const scheduleId = fact.params?.scheduleId;
        if (!scheduleId) continue;
        if (fact.act === "wake-scheduled") {
          const entry = _entryFromFact(fact, history, now);
          if (entry) live.set(scheduleId, entry);
        } else if (fact.act === "wake-cancelled") {
          live.delete(scheduleId);
        }
      }
    }
    for (const entry of live.values()) {
      _addRegistryEntry(entry);
      restored++;
    }
  }

  if (restored > 0) {
    log.info(
      "Schedule",
      `rehydrated ${restored} schedule(s) from fact chain across ${histories.length} history(ies)`,
    );
  }
  return restored;
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

/**
 * Test-only registry inspector. Returns a snapshot of every
 * (scheduleId, history) key currently live, plus the entry's shape
 * for cross-checking against fact-chain rehydration.
 */
export function _inspectRegistry() {
  const snapshot = {};
  for (const [key, entry] of _registry.entries()) {
    snapshot[key] = {
      id: entry.id,
      beingId: entry.beingId,
      history: entry.history,
      intervalMs: entry.intervalMs,
      priority: entry.priority,
      content: entry.content,
      skipIfBacklog: entry.skipIfBacklog,
    };
  }
  return snapshot;
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

function _addRegistryEntry(entry) {
  const key = _key(entry.id, entry.history);
  _registry.set(key, entry);
  let beingSet = _byBeing.get(entry.beingId);
  if (!beingSet) {
    beingSet = new Set();
    _byBeing.set(entry.beingId, beingSet);
  }
  beingSet.add(key);
}

function _dropRegistryEntry(scheduleId, history) {
  const key = _key(scheduleId, history);
  const entry = _registry.get(key);
  if (!entry) return;
  _registry.delete(key);
  const beingSet = _byBeing.get(entry.beingId);
  if (beingSet) {
    beingSet.delete(key);
    if (beingSet.size === 0) _byBeing.delete(entry.beingId);
  }
}

function _entryFromFact(fact, history, nowMs) {
  const params = fact.params || {};
  const intervalMs = Number(params.intervalMs);
  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) return null;
  // Wake facts ride the being reel as of:{kind:"being",id} — the
  // being-target id IS the scheduled being.
  const beingId = String(fact.of?.id || "");
  if (!beingId) return null;
  const scheduleId = params.scheduleId;
  if (!scheduleId) return null;
  return {
    id:            scheduleId,
    beingId,
    history,
    intervalMs,
    priority:      Number.isFinite(params.priority) ? Number(params.priority) : 4,
    content:       params.content !== undefined ? params.content : { kind: "scheduled-wake" },
    skipIfBacklog: params.skipIfBacklog !== false,
    nextFireMs:    nowMs + intervalMs,
    lastFireMs:    null,
  };
}

async function _defaultEmitter(entry, nowMs) {
  // Attention, not dispatch.
  //
  // A scheduled wake is the being's standing assignment of attention
  // to a cadence: "wake me every N ms." When the tick lands, the
  // being's prior request fires. The SUMMON's asker is the being
  // itself; this is a self-wake. The history the wake fires on is
  // the entry's history, so the resulting summon's fact lands on
  // that history's reels.
  const spaceId = getSpaceRootId() || null;
  if (!spaceId) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)} on #${entry.history}: ` +
      `place root not initialized`,
    );
    return;
  }
  const storyDomain = getStoryDomain();
  if (!storyDomain) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)} on #${entry.history}: ` +
      `story domain not yet available`,
    );
    return;
  }
  const identity = await _loadBeingIdentity(entry.beingId, entry.history);
  if (!identity) {
    log.debug(
      "Schedule",
      `skipping wake for being ${entry.beingId.slice(0, 8)} on #${entry.history}: ` +
      `scheduled being not found`,
    );
    return;
  }
  const correlation = randomUUID();
  const sender = `${storyDomain}/${spaceId}@${identity.name}`;
  await callByResolved({
    toBeingId:    entry.beingId,
    inboxSpaceId: spaceId,
    history:       entry.history,
    identity,
    message: {
      from:            sender,
      content:         entry.content,
      correlation,
      rootCorrelation: correlation,
      priority:        entry.priority,
      // No envelope wall-clock. A scheduled wake is a pure system tick with no
      // triggering fact of its own; callByResolved stamps the wake-call fact
      // downstream and the inbox fold orders on that fact's append ordinal
      // (ord). The fact's own `date` is the lone inert display witness. A fresh
      // wall-clock here (the old nowMs) would be a second clock the doctrine
      // bars; the wake's firing time lives on its schedule entry, not the row.
    },
  });
}

// Load { beingId, name } for the scheduled being on its history.
// Self-wakes mint with the being as asker; the identity lookup
// confirms the being still exists. Returns null when the being is
// gone (released or never created on this history).
async function _loadBeingIdentity(beingId, history) {
  try {
    const { loadOrFold } = await import("../../materials/projections.js");
    const slot = await loadOrFold("being", String(beingId), history);
    if (!slot?.state?.name) return null;
    return { beingId: String(slot.id), name: slot.state.name };
  } catch {
    return null;
  }
}
