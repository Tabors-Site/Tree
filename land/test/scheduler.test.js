// TreeOS IBP — scheduler tests.
//
// The scheduler itself is small; the value of these tests is verifying
// the guarantees the design doc commits to: priority ordering on each
// pull, per-being serialization, abortable Summons, and clean state
// teardown after a Summon completes.
//
// We stub the inbox + Being + embodiment dependencies so the tests are
// fully in-memory and fast. Integration with the real inbox lands in
// Slice 3 (echo conversion end-to-end).
//
// Run: node --test land/test/scheduler.test.js

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mock } from "node:test";

// Module-mock the inbox primitives and the embodiment registry before
// the scheduler imports them. node:test's mock.module is ESM-friendly.
const fakeBucket = new Map(); // beingId -> array of entries (mutated by tests)
let fakeBeingRole = "echo";
let summonCalls = [];
let summonImpl = async (message, ctx) => ({ content: `default for ${message.correlation}` });

function freshBucket(beingId, entries) { fakeBucket.set(beingId, entries); }
function setSummonImpl(fn) { summonImpl = fn; summonCalls = []; }

mock.module("../seed/cognition/inbox.js", {
  namedExports: {
    pickNextEntry: async (spaceId, beingId) => {
      const bucket = fakeBucket.get(beingId) || [];
      let bestIdx = -1, bestPriority = Infinity;
      for (let i = 0; i < bucket.length; i++) {
        const e = bucket[i];
        if (!e || e.consumed || e.cancelledAt) continue;
        const p = Number.isFinite(e.priority) ? e.priority : 1;
        if (p < bestPriority) { bestPriority = p; bestIdx = i; }
      }
      if (bestIdx < 0) return null;
      return { entry: bucket[bestIdx], index: bestIdx };
    },
    markSummoned: async (spaceId, beingId, index) => {
      const bucket = fakeBucket.get(beingId) || [];
      if (bucket[index]) bucket[index].summonedAt = new Date().toISOString();
    },
    markInboxConsumed: async (spaceId, beingId, correlationIds) => {
      const bucket = fakeBucket.get(beingId) || [];
      const set = new Set(correlationIds);
      for (const e of bucket) {
        if (e && set.has(e.correlation)) {
          e.consumed = true;
          e.consumedAt = new Date().toISOString();
        }
      }
      return { consumed: set.size };
    },
    readInbox: async (spaceId, beingId, options = {}) => {
      const bucket = fakeBucket.get(beingId) || [];
      let entries = bucket;
      if (options.unconsumed) entries = entries.filter((e) => !e.consumed);
      return entries;
    },
  },
});

// Per-being operatingMode override. Tests put a beingId in this set
// to mark that being as human; everything else stays "agent".
const humanBeings = new Set();
function markHuman(beingId) { humanBeings.add(beingId); }

mock.module("../seed/models/being.js", {
  defaultExport: {
    findById: async (id) => ({
      _id:         id,
      username:    `user-${id}`,
      roles:       [fakeBeingRole],
      defaultRole: fakeBeingRole,
      operatingMode: humanBeings.has(id) ? "human" : "llm",
    }),
  },
});

// Mock the push channel so the human-cognition path can emit without
// booting the real WS server. Tests inspect `humanEmits` to verify
// being-room delivery.
const humanEmits = [];
mock.module("../seed/ibp/pushChannel.js", {
  namedExports: {
    IBP_EVENT: "ibp",
    pushIbp: (beingId, envelope) => {
      humanEmits.push({ room: `being:${beingId}`, event: "ibp", payload: envelope });
    },
    emitToBeing:             () => {},
    emitToBeingRoom:         () => {},
    emitNavigate:            () => {},
    getIO:                   () => null,
    getHttpServer:           () => null,
    registerSocketHandler:   () => {},
    unregisterSocketHandler: () => {},
    setPushChannel:          () => {},
    resetPushChannel:        () => {},
    hasPushChannel:          () => false,
  },
});

mock.module("../seed/being/roles/registry.js", {
  namedExports: {
    getRole: () => ({
      name: fakeBeingRole,
      permissions: ["see", "do", "summon"],
      respondMode: "async",
      triggerOn: ["message"],
      summon: async (message, ctx) => {
        summonCalls.push({ message, ctx });
        return summonImpl(message, ctx);
      },
    }),
  },
});

const { wake, abortCurrent, getCurrentRootCorrelation, attachHandoff, _resetAll, getStats } = await import("../seed/cognition/scheduler.js");

beforeEach(() => {
  _resetAll();
  fakeBucket.clear();
  summonCalls = [];
  summonImpl = async (message) => ({ content: `default for ${message.correlation}` });
  fakeBeingRole = "echo";
  humanBeings.clear();
  humanEmits.length = 0;
});
afterEach(() => _resetAll());

function makeEntry(correlation, priority = 1, extras = {}) {
  return {
    from: "treeos.ai/@asker",
    content: `c-${correlation}`,
    correlation,
    rootCorrelation: extras.rootCorrelation || correlation,
    priority,
    inReplyTo: extras.inReplyTo || null,
    attachments: [],
    sentAt: extras.sentAt || new Date().toISOString(),
    consumed: false,
    cancelledAt: null,
    summonedAt: null,
    ...extras,
  };
}

// Spin-wait helper: poll until predicate is true or budget elapses.
async function waitUntil(pred, budgetMs = 1000, stepMs = 5) {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

describe("scheduler — basic processing", () => {
  test("processes a single pending entry", async () => {
    freshBucket("being-1", [makeEntry("m1")]);
    wake("being-1", "node-1");
    const done = await waitUntil(() => summonCalls.length === 1);
    assert.equal(done, true);
    assert.equal(summonCalls[0].message.correlation, "m1");
    assert.equal(fakeBucket.get("being-1")[0].consumed, true);
  });

  test("drains a being's queue until empty", async () => {
    freshBucket("being-1", [
      makeEntry("m1"),
      makeEntry("m2"),
      makeEntry("m3"),
    ]);
    wake("being-1", "node-1");
    const done = await waitUntil(() => summonCalls.length === 3);
    assert.equal(done, true);
    const consumed = fakeBucket.get("being-1").every((e) => e.consumed);
    assert.equal(consumed, true);
  });
});

describe("scheduler — priority ordering", () => {
  test("higher-priority entry (lower number) runs first", async () => {
    // Append in low-priority-first order so the scheduler has to reorder.
    freshBucket("being-1", [
      makeEntry("m1-low",  4),   // BACKGROUND
      makeEntry("m2-high", 1),   // HUMAN
      makeEntry("m3-mid",  3),   // INTERACTIVE
    ]);
    wake("being-1", "node-1");
    const done = await waitUntil(() => summonCalls.length === 3);
    assert.equal(done, true);
    assert.deepEqual(
      summonCalls.map((c) => c.message.correlation),
      ["m2-high", "m3-mid", "m1-low"],
    );
  });

  test("same priority falls back to insertion order (oldest first)", async () => {
    freshBucket("being-1", [
      makeEntry("first",  2),
      makeEntry("second", 2),
      makeEntry("third",  2),
    ]);
    wake("being-1", "node-1");
    const done = await waitUntil(() => summonCalls.length === 3);
    assert.equal(done, true);
    assert.deepEqual(
      summonCalls.map((c) => c.message.correlation),
      ["first", "second", "third"],
    );
  });
});

describe("scheduler — per-being serialization", () => {
  test("does not run two Summons concurrently for the same being", async () => {
    let running = 0;
    let maxConcurrent = 0;
    setSummonImpl(async (msg) => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return { content: msg.correlation };
    });
    freshBucket("being-1", [makeEntry("a"), makeEntry("b"), makeEntry("c")]);
    wake("being-1", "node-1");
    await waitUntil(() => summonCalls.length === 3);
    assert.equal(maxConcurrent, 1, "expected strict per-being serialization");
  });

  test("runs different beings in parallel", async () => {
    const seenBeings = new Set();
    let concurrentBeings = 0;
    let maxConcurrent = 0;
    setSummonImpl(async (msg, ctx) => {
      concurrentBeings++;
      maxConcurrent = Math.max(maxConcurrent, concurrentBeings);
      seenBeings.add(ctx.toBeing._id);
      await new Promise((r) => setTimeout(r, 25));
      concurrentBeings--;
      return { content: msg.correlation };
    });
    freshBucket("being-A", [makeEntry("a1")]);
    freshBucket("being-B", [makeEntry("b1")]);
    wake("being-A", "node-1");
    wake("being-B", "node-2");
    await waitUntil(() => summonCalls.length === 2);
    assert.equal(seenBeings.size, 2);
    assert.equal(maxConcurrent, 2, "expected cross-being parallelism");
  });
});

describe("scheduler — cancellation", () => {
  test("skips entries cancelled before pickNextEntry sees them", async () => {
    freshBucket("being-1", [
      { ...makeEntry("doomed"),  cancelledAt: new Date().toISOString() },
      makeEntry("alive"),
    ]);
    wake("being-1", "node-1");
    await waitUntil(() => summonCalls.length === 1);
    assert.equal(summonCalls[0].message.correlation, "alive");
  });

  test("abortCurrent aborts the in-flight Summon", async () => {
    let abortedSignal = false;
    setSummonImpl(async (msg, ctx) => {
      ctx.signal.addEventListener("abort", () => { abortedSignal = true; });
      await new Promise((resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
        setTimeout(resolve, 500);
      });
      return { content: "should not reach" };
    });
    freshBucket("being-1", [makeEntry("long-running", 1, { rootCorrelation: "root-1" })]);
    wake("being-1", "node-1");

    await waitUntil(() => getCurrentRootCorrelation("being-1") === "root-1");
    const aborted = abortCurrent("being-1", "test cancel");
    assert.equal(aborted, true);

    await waitUntil(() => abortedSignal);
    assert.equal(abortedSignal, true);
    // Entry still gets marked consumed (abort is a finalization).
    await waitUntil(() => fakeBucket.get("being-1")[0].consumed);
    assert.equal(fakeBucket.get("being-1")[0].consumed, true);
  });

  test("abortCurrent on idle being is a no-op (returns false)", () => {
    assert.equal(abortCurrent("ghost"), false);
  });
});

describe("scheduler — handoff (response dispatch)", () => {
  test("onResponse fires with the constructed response entry", async () => {
    setSummonImpl(async () => ({ content: "hello back", summonId: "sum-42" }));
    freshBucket("being-1", [makeEntry("ask")]);
    let received = null;
    attachHandoff("being-1", "ask", {
      responseFromStance: "treeos.ai/@responder",
      onResponse: (entry) => { received = entry; },
    });
    wake("being-1", "node-1");
    await waitUntil(() => received !== null);
    assert.equal(received.from, "treeos.ai/@responder");
    assert.equal(received.content, "hello back");
    assert.equal(received.inReplyTo, "ask");
    assert.equal(received.summonId, "sum-42");
  });

  test("onError fires when summon throws (non-abort)", async () => {
    setSummonImpl(async () => { throw new Error("explode"); });
    freshBucket("being-1", [makeEntry("doomed")]);
    let received = null;
    attachHandoff("being-1", "doomed", {
      onError: (err) => { received = err; },
    });
    wake("being-1", "node-1");
    await waitUntil(() => received !== null);
    assert.equal(received.message, "explode");
  });
});

describe("scheduler — stats", () => {
  test("getStats reports running and currentRoot during a Summon", async () => {
    setSummonImpl(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { content: "ok" };
    });
    freshBucket("being-1", [makeEntry("m1", 1, { rootCorrelation: "root-x" })]);
    wake("being-1", "node-1");
    await waitUntil(() => getStats()["being-1"]?.running === true);
    assert.equal(getStats()["being-1"].currentRoot, "root-x");
    await waitUntil(() => getStats()["being-1"]?.running === false, 2000);
    assert.equal(getStats()["being-1"].currentRoot, null);
  });
});

describe("scheduler — human cognition", () => {
  test("human being: entry stays pending, role.summon not invoked, being-room emits", async () => {
    markHuman("being-h");
    freshBucket("being-h", [makeEntry("plan-approve", 1, { rootCorrelation: "root-h" })]);
    wake("being-h", "node-h");

    await waitUntil(() => humanEmits.length > 0);
    assert.equal(humanEmits[0].room, "being:being-h");
    assert.equal(humanEmits[0].event, "ibp");
    // Unified `ibp` envelope: { verb: "summon", payload: <inbox entry> }.
    assert.equal(humanEmits[0].payload.verb, "summon");
    assert.equal(humanEmits[0].payload.payload.correlation, "plan-approve");

    // The runLoop should have exited and role.summon should never have run.
    await waitUntil(() => getStats()["being-h"]?.running === false);
    assert.equal(summonCalls.length, 0);

    // Entry stays pending — humans consume by replying.
    assert.equal(fakeBucket.get("being-h")[0].consumed, false);
  });

  test("human being: re-wake on same node does not re-emit already-notified entries", async () => {
    markHuman("being-h");
    freshBucket("being-h", [makeEntry("once", 1)]);
    wake("being-h", "node-h");
    await waitUntil(() => humanEmits.length === 1);

    // Second wake at the same node with no new entries — should NOT re-emit.
    wake("being-h", "node-h");
    await waitUntil(() => getStats()["being-h"]?.running === false);
    assert.equal(humanEmits.length, 1);
  });

  test("human being: newly appended entry emits on next wake", async () => {
    markHuman("being-h");
    freshBucket("being-h", [makeEntry("first", 1)]);
    wake("being-h", "node-h");
    await waitUntil(() => humanEmits.length === 1);

    fakeBucket.get("being-h").push(makeEntry("second", 1));
    wake("being-h", "node-h");
    await waitUntil(() => humanEmits.length === 2);
    assert.equal(humanEmits[1].payload.payload.correlation, "second");
  });
});
