// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The host, represented. nodeServerTest Phase 1.
//
// The running machine — the HTTP listener and the WebSocket pool —
// surfaced through the same protocol as everything else: two heaven
// spaces under ./host, two scripted beings homed in them, and matter
// for the live state. Fully FACT-BACKED: every lifecycle event here is
// a real act by a real being sealing real facts (the opposite of
// ./source's disk-fold exception). If the primitives can describe
// their own runtime, they can describe a kernel's — that is the test
// this module runs.
//
// Division of labor:
//   host.js        — resolved ids, readiness, per-being serial act
//                    lanes, the WebSocket connection lifecycle, the
//                    boot reconcile sweep.
//   requestLog.js  — the per-request HTTP fact pipeline (queue,
//                    drainer, batching, live counters).
//
// Transports call ONLY the note* functions. They are synchronous,
// they never throw, and they no-op until initHostRuntime has run —
// observation must never break a response, a socket, or boot.
//
// Per-being serial lanes: act identities are content-addressed off
// the being's act head (assign reads ActHead, seal advances it), so
// two concurrent moments on one being would race the head. Every act
// attributed to a host being rides that being's single lane.

import log from "../../seedStory/log.js";
import { withBeingFact } from "../../sprout.js";
import { HEAVEN_SPACE } from "../space/heavenSpaces.js";
import { isDbHealthy } from "../../seedStory/dbConfig.js";
import { getStoryConfigValue } from "../../storyConfig.js";

// ── module state ────────────────────────────────────────────────────
let ready = false;
let shuttingDown = false;
const ids = {
  httpSpace: null, wsSpace: null,
  httpBeing: null, wsBeing: null,
  requestLogMatter: null,
};
const socketMatter = new Map(); // socketId -> matterId (live registry)
const lanes = new Map();        // beingId  -> tail Promise (serial act lanes)

function identityFor(kind) {
  if (kind === "http")  return { beingId: ids.httpBeing,  name: "http-server" };
  if (kind === "ws")    return { beingId: ids.wsBeing,    name: "websocket-pool" };
  return null;
}

// ── the serial act lane ─────────────────────────────────────────────
// One writer per being's act head. Errors are caught per act so one
// failed stamp never poisons the lane. Callers may ignore the return
// (fire-and-forget) or await it (init, tests, shutdown flush).
export function enqueueBeingAct(beingId, label, fn) {
  const prev = lanes.get(beingId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => withBeingFact(beingId, label, "0", fn))
    .catch((err) => log.warn("Host", `${label}: ${err.message}`));
  lanes.set(beingId, next);
  return next;
}

export function isHostReady() { return ready; }
export function getHostIds() { return { ...ids }; }

// ── init (called once from genesis, after grants exist) ────────────
export async function initHostRuntime() {
  const { findByHeavenSpace, findByName } = await import("../projections.js");

  const httpSlot  = await findByHeavenSpace(HEAVEN_SPACE.HOST_HTTP, "0");
  const wsSlot    = await findByHeavenSpace(HEAVEN_SPACE.HOST_WEBSOCKET, "0");
  const httpB  = await findByName("being", "http-server", "0");
  const wsB    = await findByName("being", "websocket-pool", "0");

  if (!httpSlot || !wsSlot || !httpB || !wsB) {
    log.warn("Host", "host spaces or beings missing — host facts disabled this boot (notifiers stay no-ops).");
    return;
  }
  ids.httpSpace = String(httpSlot.id);
  ids.wsSpace = String(wsSlot.id);
  ids.httpBeing = String(httpB.id);
  ids.wsBeing = String(wsB.id);

  // The request-log matter: the long-lived aggregate the request
  // stream lands on, so the http SPACE's own reel stays
  // lifecycle-only and folds on the space stay cheap.
  await ensureRequestLogMatter();

  // Sweep stale connection matter. Sockets do not survive the
  // process: every live-looking connection row at boot belongs to
  // the previous process and gets ended now, by the pool, one act
  // each — the chain records the cleanup like everything else.
  await reconcileStaleConnections();

  const { bindHttpBeing } = await import("./requestLog.js");
  bindHttpBeing(ids.httpBeing, ids.httpSpace, ids.requestLogMatter, enqueueBeingAct);

  ready = true;
  log.info("Host", "the machine sees itself: ./host is live (http, websocket).");
}

async function ensureRequestLogMatter() {
  // Curated matter-at-space read: the request-log matter is the one row
  // at the http space named "request-log". listMattersAt does the
  // history-lineage union + tombstone exclusion (the old tombstoned:{$ne}
  // guard) and returns the matter's own name; filter to it.
  const { listMattersAt } = await import("../matter/matters.js");
  const atSpace = await listMattersAt(ids.httpSpace, { history: "0", limit: Infinity });
  const existing = atSpace.find((m) => m.name === "request-log");
  if (existing) { ids.requestLogMatter = String(existing.matterId); return; }

  const { doVerb } = await import("../../ibp/verbs/do.js");
  await enqueueBeingAct(ids.httpBeing, "http: create request-log", async (ctx) => {
    const res = await doVerb(
      { kind: "space", id: ids.httpSpace },
      "create-matter",
      {
        name: "request-log",
        type: "generic",
        content: null,
        qualities: { requestLog: { count: 0, since: new Date().toISOString() } },
      },
      { identity: identityFor("http"), moment: ctx },
    );
    ids.requestLogMatter = String(res.matterId);
  });
  if (!ids.requestLogMatter) {
    throw new Error("request-log matter did not materialize");
  }
}

// Exported for tests: end every non-deleted connection matter whose
// socket is not in the live registry (at boot the registry is empty,
// so ALL rows are stale).
export async function reconcileStaleConnections() {
  const { doVerb } = await import("../../ibp/verbs/do.js");
  // Curated matter-at-space read: every live (non-tombstoned) connection
  // matter at the ws space. listMattersAt carries the history-lineage union
  // + tombstone exclusion the old tombstoned:{$ne} guard did; limit:Infinity
  // so the whole boot sweep is reconciled (a previous process may leave more
  // than the default page of stale rows). Filter to type "connection".
  const { listMattersAt } = await import("../matter/matters.js");
  const atSpace = await listMattersAt(ids.wsSpace, { history: "0", limit: Infinity });
  const rows = atSpace.filter((m) => m.type === "connection");
  const liveMatterIds = new Set(socketMatter.values());
  let swept = 0;
  for (const row of rows) {
    if (liveMatterIds.has(String(row.matterId))) continue;
    swept++;
    enqueueBeingAct(ids.wsBeing, `ws reconcile: stale ${row.name || row.matterId.slice(0, 8)}`, (ctx) =>
      doVerb(
        { kind: "matter", id: String(row.matterId) },
        "end-matter",
        {},
        { identity: identityFor("ws"), moment: ctx },
      ));
  }
  if (swept > 0) {
    await lanes.get(ids.wsBeing);
    log.info("Host", `swept ${swept} stale connection row(s) from the previous process.`);
  }
  return swept;
}

// ── websocket notifiers ─────────────────────────────────────────────
export function noteSocketConnected({ socketId, beingId, name, history } = {}) {
  try {
    if (!ready || shuttingDown || !socketId) return;
    if (getStoryConfigValue("hostConnectionFacts") === false) return;
    if (!isDbHealthy()) return;
    const qualities = {
      connection: {
        // World-meaningful identity only: which socket (the pool's
        // join key), who it carries, where it's seated. Client kind /
        // instance are runtime hints the pool reads off the live
        // socket object, never off the row — they stay out of facts.
        socketId,
        beingId: beingId || null,
        name: name || null,
        history: history || "0",
        connectedAt: new Date().toISOString(),
        // No token, no raw IP — connection rows are visible matter.
      },
    };
    enqueueBeingAct(ids.wsBeing, `ws connect: ${name || "anon"} (${socketId.slice(0, 8)})`, async (ctx) => {
      const { doVerb } = await import("../../ibp/verbs/do.js");
      const res = await doVerb(
        { kind: "space", id: ids.wsSpace },
        "create-matter",
        // Full socketId: matter names are unique per kind per history
        // (the projections name index), and truncated ids collide.
        { name: `conn-${socketId}`, type: "connection", content: null, qualities },
        { identity: identityFor("ws"), moment: ctx },
      );
      socketMatter.set(socketId, String(res.matterId));
    });
  } catch (err) {
    log.warn("Host", `noteSocketConnected: ${err.message}`);
  }
}

export function noteSocketHistoryRebound({ socketId, history } = {}) {
  try {
    if (!ready || shuttingDown || !socketId) return;
    const matterId = socketMatter.get(socketId);
    if (!matterId || !isDbHealthy()) return;
    enqueueBeingAct(ids.wsBeing, `ws rebind: ${socketId.slice(0, 8)} -> #${history}`, async (ctx) => {
      const { doVerb } = await import("../../ibp/verbs/do.js");
      await doVerb(
        { kind: "matter", id: matterId },
        "set-matter",
        { field: "qualities.connection.history", value: history },
        { identity: identityFor("ws"), moment: ctx },
      );
    });
  } catch (err) {
    log.warn("Host", `noteSocketHistoryRebound: ${err.message}`);
  }
}

export function noteSocketDisconnected({ socketId, reason } = {}) {
  try {
    if (!socketId) return;
    const matterId = socketMatter.get(socketId);
    socketMatter.delete(socketId);
    // During shutdown the disconnect storm stays unstamped; the next
    // boot's reconcile sweep owns those rows.
    if (!ready || shuttingDown || !matterId || !isDbHealthy()) return;
    enqueueBeingAct(ids.wsBeing, `ws disconnect: ${socketId.slice(0, 8)} (${reason || "?"})`, async (ctx) => {
      const { doVerb } = await import("../../ibp/verbs/do.js");
      await doVerb(
        { kind: "matter", id: matterId },
        "end-matter",
        {},
        { identity: identityFor("ws"), moment: ctx },
      );
    });
  } catch (err) {
    log.warn("Host", `noteSocketDisconnected: ${err.message}`);
  }
}

// ── shutdown ────────────────────────────────────────────────────────
export function beginHostShutdown() { shuttingDown = true; }

export async function flushHostLanes(timeoutMs = 1500) {
  const tails = [...lanes.values()];
  if (tails.length === 0) return;
  await Promise.race([
    Promise.allSettled(tails),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}
