// TreeOS IBP — echo-through-substrate smoke test (Slice 3).
//
// Wires the REAL echoEmbodiment (imported directly from echo.js, not via
// the full registry — that drags bridge.js → conversation.js → Mongo)
// through the REAL scheduler. The inbox primitives and Being model are
// stubbed in-memory so the test stays fast and DB-free; the registry is
// stubbed to return the real echo embodiment when asked.
//
// What this proves about Slice 2 + 3:
//   - Echo's async path delivers a response through the scheduler.
//   - "place" intent produces no response but still gets consumed.
//   - Priority ordering applies with the real being.
//   - Multiple async sends from the same sender serialize correctly.
//
// Run: node --test --experimental-test-module-mocks place/test/echoSubstrate.test.js

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mock } from "node:test";
import { echoEmbodiment } from "../seed/cognition/roles/echo.js";

// Same inbox + Being stubs the scheduler.test.js uses. Kept local rather
// than shared so the two test files stay independently runnable.
const fakeBucket = new Map();

mock.module("../seed/cognition/inbox.js", {
  namedExports: {
    pickNextEntry: async (_nodeId, beingId) => {
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
    markSummoned: async (_nodeId, beingId, index) => {
      const bucket = fakeBucket.get(beingId) || [];
      if (bucket[index]) bucket[index].summonedAt = new Date().toISOString();
    },
    markInboxConsumed: async (_nodeId, beingId, correlationIds, opts = {}) => {
      const bucket = fakeBucket.get(beingId) || [];
      const set = new Set(correlationIds);
      for (const e of bucket) {
        if (e && set.has(e.correlation)) {
          e.consumed = true;
          e.consumedAt = new Date().toISOString();
          if (opts.responseId) e.responseId = opts.responseId;
          if (opts.summonId) e.summonId = opts.summonId;
        }
      }
      return { consumed: set.size };
    },
    readInbox: async (_nodeId, beingId, options = {}) => {
      const bucket = fakeBucket.get(beingId) || [];
      let entries = bucket;
      if (options.unconsumed) entries = entries.filter((e) => !e.consumed);
      return entries;
    },
  },
});

mock.module("../seed/models/being.js", {
  defaultExport: {
    findById: async (id) => ({
      _id:         id,
      username:    `user-${id}`,
      roles:       ["echo"],
      defaultRole: "echo",
    }),
  },
});

// Stub the registry to return the REAL echoEmbodiment. Importing the
// real registry.js would pull in bridge.js (which imports the LLM
// conversation layer and Mongo), defeating the no-DB premise.
mock.module("../seed/cognition/roles/registry.js", {
  namedExports: {
    getRole: (name) => name === "echo" ? echoEmbodiment : null,
  },
});

const { wake, attachHandoff, _resetAll } = await import("../seed/cognition/scheduler.js");

beforeEach(() => {
  _resetAll();
  fakeBucket.clear();
});
afterEach(() => _resetAll());

function makeEntry({ correlation, content = "hello", priority = 1 } = {}) {
  return {
    from:           "treeos.ai/@asker",
    content,
    correlation,
    rootCorrelation: correlation,
    priority,
    inReplyTo:      null,
    attachments:    [],
    sentAt:         new Date().toISOString(),
    consumed:       false,
    cancelledAt:    null,
    summonedAt:     null,
    consumedAt:     null,
    responseId:     null,
    summonId:       null,
  };
}

async function waitUntil(pred, budgetMs = 1000, stepMs = 5) {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

describe("echo through substrate — happy path", () => {
  test("produces an echo: <content> reply", async () => {
    fakeBucket.set("echo-1", [makeEntry({ correlation: "m1", content: "hello world" })]);
    let received = null;
    attachHandoff("echo-1", "m1", {
      responseFromStance: "treeos.ai/@echo",
      onResponse: (entry) => { received = entry; },
    });
    wake("echo-1", "node-1");
    await waitUntil(() => received !== null);
    assert.equal(received.content, "echo: hello world");
    assert.equal(received.inReplyTo, "m1");
    assert.equal(received.from, "treeos.ai/@echo");
    assert.equal(fakeBucket.get("echo-1")[0].consumed, true);
  });

  test("non-string content is JSON-stringified before echoing", async () => {
    fakeBucket.set("echo-1", [
      makeEntry({ correlation: "obj", content: { a: 1, b: [2, 3] } }),
    ]);
    let received = null;
    attachHandoff("echo-1", "obj", {
      responseFromStance: "treeos.ai/@echo",
      onResponse: (entry) => { received = entry; },
    });
    wake("echo-1", "node-1");
    await waitUntil(() => received !== null);
    assert.equal(received.content, `echo: ${JSON.stringify({ a: 1, b: [2, 3] })}`);
  });
});

// `place intent` retired 2026-05-18 — intents are no longer permission
// overlays at the envelope level; role.permissions handles that. Echo
// always produces a response now regardless of any intent string
// the sender attaches (intent is a free-form wake-source label only).

describe("echo through substrate — queue ordering", () => {
  test("priority ordering applies with the real being", async () => {
    fakeBucket.set("echo-1", [
      makeEntry({ correlation: "low",  content: "L", priority: 4 }),
      makeEntry({ correlation: "high", content: "H", priority: 1 }),
      makeEntry({ correlation: "mid",  content: "M", priority: 3 }),
    ]);
    const order = [];
    for (const id of ["low", "high", "mid"]) {
      attachHandoff("echo-1", id, {
        responseFromStance: "treeos.ai/@echo",
        onResponse: (entry) => { order.push(entry.inReplyTo); },
      });
    }
    wake("echo-1", "node-1");
    await waitUntil(() => order.length === 3);
    assert.deepEqual(order, ["high", "mid", "low"]);
  });

  test("same-being concurrent sends serialize and all complete", async () => {
    fakeBucket.set("echo-1", [
      makeEntry({ correlation: "a", content: "1" }),
      makeEntry({ correlation: "b", content: "2" }),
      makeEntry({ correlation: "c", content: "3" }),
    ]);
    const replies = [];
    for (const id of ["a", "b", "c"]) {
      attachHandoff("echo-1", id, {
        responseFromStance: "treeos.ai/@echo",
        onResponse: (entry) => { replies.push(entry.content); },
      });
    }
    wake("echo-1", "node-1");
    await waitUntil(() => replies.length === 3);
    assert.deepEqual(replies, ["echo: 1", "echo: 2", "echo: 3"]);
    assert.ok(fakeBucket.get("echo-1").every((e) => e.consumed));
  });
});
