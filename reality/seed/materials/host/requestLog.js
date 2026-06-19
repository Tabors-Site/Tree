// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The request stream, stamped. nodeServerTest Phase 1, the deliberate
// scale test: every HTTP request this process serves becomes a fact —
// the OS will stamp at this cadence constantly, so the Node story
// proves the stamper holds up now.
//
// Shape:
//   - Hot path (noteHttpRequest): bump in-memory counters, push to a
//     FIFO, kick the drainer. Synchronous, allocation-light, never
//     throws, never awaits. A response is never delayed by a fact.
//   - Drainer: rides the http-server being's serial act lane. Under
//     light load it stamps 1:1 — one request, one act, one
//     `http-request` fact on the request-log matter's reel (the pure
//     form of the test). When the backlog passes SOFT_BATCH_THRESHOLD
//     it folds up to BATCH_MAX entries into ONE act sealing ONE
//     `http-request-batch` fact carrying entries[] — the roster-batch
//     precedent from seedDelegates.js: never K facts on one reel in
//     one moment dressed as one act. Past HARD_CAP, entries drop and
//     the next drain stamps one honest `http-queue-overflow` fact.
//   - Facts target the long-lived `request-log` MATTER so the http
//     space's own reel stays lifecycle-only. The matter reducer
//     no-ops on these actions: the figure stays tiny, the facts are
//     the record. Live numbers come from the in-memory counters via
//     the `http-stats` SEE op, not from folds.
//   - Off switch: storyConfig `hostRequestFacts` (false stops
//     stamping immediately; counters keep counting).
//
// Privacy: the query string is stripped (it can carry tokens), the
// cookie token is decoded to a beingId at drain time and the token
// string itself never enters a fact. No headers, no bodies.

import log from "../../seedStory/log.js";
import { isDbHealthy } from "../../seedStory/dbConfig.js";
import { getStoryConfigValue } from "../../storyConfig.js";

const SOFT_BATCH_THRESHOLD = 100;
const BATCH_MAX = 50;
const HARD_CAP = 10000;
const COUNTER_EVERY = 1000;
const MAX_ROUTES = 200;

// Bound by host.js initHostRuntime.
let httpBeingId = null;
let httpSpaceId = null;
let requestLogMatterId = null;
let enqueue = null;

const queue = [];
let draining = false;
let droppedSinceLastStamp = 0;
let totalStamped = 0;
let lastCounterStampAt = 0;
let idleResolvers = [];

const counters = {
  since: null,
  total: 0,
  dropped: 0,
  bytes: 0,
  byStatusClass: { 2: 0, 3: 0, 4: 0, 5: 0 },
  byRoute: new Map(), // "METHOD /path/:id" -> count
};

export function bindHttpBeing(beingId, spaceId, matterId, enqueueBeingAct) {
  httpBeingId = beingId;
  httpSpaceId = spaceId;
  requestLogMatterId = matterId;
  enqueue = enqueueBeingAct;
  if (!counters.since) counters.since = new Date().toISOString();
}

// uuid/hex path segments collapse so the route map stays bounded.
function routeKey(method, path) {
  const norm = String(path)
    .split("/")
    .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d{4,}$/.test(seg) ? ":id" : seg))
    .join("/");
  return `${method} ${norm}`;
}

function bumpCounters(e) {
  counters.total++;
  const cls = Math.floor((e.status || 0) / 100);
  if (counters.byStatusClass[cls] !== undefined) counters.byStatusClass[cls]++;
  if (e.bytes) counters.bytes += e.bytes;
  const key = routeKey(e.method, e.path);
  if (counters.byRoute.has(key)) {
    counters.byRoute.set(key, counters.byRoute.get(key) + 1);
  } else if (counters.byRoute.size < MAX_ROUTES) {
    counters.byRoute.set(key, 1);
  } else {
    counters.byRoute.set("(other)", (counters.byRoute.get("(other)") || 0) + 1);
  }
}

// ── HOT PATH ────────────────────────────────────────────────────────
// Called from the express middleware on res "finish".
export function noteHttpRequest(entry) {
  try {
    bumpCounters(entry);
    if (!httpBeingId || !requestLogMatterId || !enqueue) return;
    if (getStoryConfigValue("hostRequestFacts") === false) return;
    if (queue.length >= HARD_CAP) {
      droppedSinceLastStamp++;
      counters.dropped++;
      return;
    }
    queue.push(entry);
    if (!draining) {
      draining = true;
      setImmediate(drain);
    }
  } catch {
    // Observation must never propagate into the response path.
  }
}

async function entryToFactParams(e) {
  let beingId = null;
  if (e.token) {
    try {
      const { decodeToken } = await import("../being/identity/credentials.js");
      const decoded = decodeToken(e.token);
      beingId = decoded?.beingId || null;
    } catch { /* anonymous */ }
  }
  return {
    method: e.method,
    path: String(e.path || "/").slice(0, 200),
    status: e.status,
    durationMs: e.durationMs,
    bytes: e.bytes ?? null,
    beingId,
  };
}

async function drain() {
  try {
    const { emitFact } = await import("../../past/fact/facts.js");
    while (queue.length > 0) {
      if (!isDbHealthy()) {
        // Pause; do not lose the queue. The hard cap bounds memory.
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      if (droppedSinceLastStamp > 0) {
        const dropped = droppedSinceLastStamp;
        droppedSinceLastStamp = 0;
        await enqueue(httpBeingId, "http: queue overflow", (ctx) =>
          emitFact({
            verb: "do", act: "drop",
            through: httpBeingId,
            of: { kind: "matter", id: requestLogMatterId },
            params: { dropped, at: new Date().toISOString() },
            actId: ctx.actId, branch: "0",
          }, ctx));
      }
      if (queue.length > SOFT_BATCH_THRESHOLD) {
        const batch = queue.splice(0, BATCH_MAX);
        const entries = [];
        for (const e of batch) entries.push(await entryToFactParams(e));
        await enqueue(httpBeingId, `http: batch of ${entries.length}`, (ctx) =>
          emitFact({
            verb: "do", act: "serve",
            through: httpBeingId,
            of: { kind: "matter", id: requestLogMatterId },
            params: { count: entries.length, entries },
            actId: ctx.actId, branch: "0",
          }, ctx));
        totalStamped += entries.length;
      } else {
        const e = queue.shift();
        const params = await entryToFactParams(e);
        await enqueue(httpBeingId, `http: ${params.method} ${params.path}`, (ctx) =>
          emitFact({
            verb: "do", act: "serve",
            through: httpBeingId,
            of: { kind: "matter", id: requestLogMatterId },
            params,
            actId: ctx.actId, branch: "0",
          }, ctx));
        totalStamped += 1;
      }
      if (totalStamped - lastCounterStampAt >= COUNTER_EVERY) {
        lastCounterStampAt = totalStamped;
        await stampRollingCounter();
      }
    }
  } catch (err) {
    log.warn("Host", `request-log drain: ${err.message}`);
  } finally {
    draining = false;
    if (queue.length > 0) {
      draining = true;
      setImmediate(drain);
    } else {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const r of resolvers) r();
    }
  }
}

// Every COUNTER_EVERY drained requests: one fold-visible rolling
// counter on the request-log matter's qualities.
async function stampRollingCounter() {
  const { doVerb } = await import("../../ibp/verbs/do.js");
  await enqueue(httpBeingId, `http: rolling counter ${totalStamped}`, (ctx) =>
    doVerb(
      { kind: "matter", id: requestLogMatterId },
      "set-matter",
      {
        field: "qualities.requestLog",
        value: { count: totalStamped, lastAt: new Date().toISOString() },
        merge: true,
      },
      { identity: { beingId: httpBeingId, name: "http-server" }, moment: ctx },
    ));
}

// ── lifecycle facts (target the http SPACE — its reel stays small) ──
export function noteHttpListening({ port } = {}) {
  try {
    if (!httpBeingId || !enqueue) return;
    enqueue(httpBeingId, `http: listening on :${port}`, async (ctx) => {
      const { emitFact } = await import("../../past/fact/facts.js");
      await emitFact({
        verb: "do", act: "open",
        through: httpBeingId,
        of: { kind: "space", id: httpSpaceId },
        // The port IS the listener's identity. Route lists are
        // middleware furniture; the moment is the fact's own date.
        params: { port: port ?? null },
        actId: ctx.actId, branch: "0",
      }, ctx);
    });
  } catch (err) {
    log.warn("Host", `noteHttpListening: ${err.message}`);
  }
}

export function noteHttpShutdown(signal) {
  try {
    if (!httpBeingId || !enqueue || !isDbHealthy()) return;
    enqueue(httpBeingId, `http: shutdown (${signal || "?"})`, async (ctx) => {
      const { emitFact } = await import("../../past/fact/facts.js");
      await emitFact({
        verb: "do", act: "close",
        through: httpBeingId,
        of: { kind: "space", id: httpSpaceId },
        params: {
          signal: signal || null,
          uptimeSec: Math.round(process.uptime()),
          totals: { requests: counters.total, dropped: counters.dropped },
        },
        actId: ctx.actId, branch: "0",
      }, ctx);
    });
  } catch (err) {
    log.warn("Host", `noteHttpShutdown: ${err.message}`);
  }
}

// ── live stats (the http-stats SEE op reads this; no facts) ─────────
export function getHttpStats() {
  const byRoute = [...counters.byRoute.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([route, count]) => ({ route, count }));
  return {
    since: counters.since,
    total: counters.total,
    stamped: totalStamped,
    dropped: counters.dropped,
    queueDepth: queue.length,
    bytes: counters.bytes,
    byStatusClass: { ...counters.byStatusClass },
    byRoute,
  };
}

// Tests + shutdown: resolves when the queue is empty and the drainer
// has gone idle, or after timeoutMs.
export function waitForIdle(timeoutMs = 30000) {
  if (queue.length === 0 && !draining) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    idleResolvers.push(() => { clearTimeout(t); resolve(); });
  });
}
