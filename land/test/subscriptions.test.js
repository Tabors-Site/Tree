// TreeOS IBP — subscription registry tests.
//
// Verifies the matching logic (scope variants, filters, dedup) plus
// the emit path's fan-out (each matching subscriber gets one SUMMON
// in their inbox + a scheduler wake). The ancestor-chain lookup and
// the inbox/scheduler are mocked so the tests stay DB-free.
//
// Run: node --test --experimental-test-module-mocks land/test/subscriptions.test.js

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mock } from "node:test";

// Configurable ancestor chain for the current test. Each entry is an
// id, ordered child→...→root. The mocked getAncestorChain returns
// objects with `_id` to mirror the real Mongoose lean() shape.
let fakeAncestorChain = [];

mock.module("../seed/tree/ancestorCache.js", {
  namedExports: {
    getAncestorChain: async (_nodeId) => fakeAncestorChain.map((id) => ({ _id: id })),
  },
});

// In-memory inbox + scheduler stubs. The emit helper exercises both.
const appendCalls = [];   // { nodeId, beingId, message }
const wakeCalls = [];     // { beingId, nodeId }

mock.module("../seed/scheduler/inbox.js", {
  namedExports: {
    appendToInbox: async (nodeId, beingId, message) => {
      appendCalls.push({ nodeId, beingId, message });
      return { messageId: message.correlation, sentAt: message.sentAt };
    },
  },
});

mock.module("../seed/scheduler/scheduler.js", {
  namedExports: {
    wake: (beingId, nodeId) => { wakeCalls.push({ beingId, nodeId }); },
  },
});

mock.module("../seed/addressing/address.js", {
  namedExports: { getLandDomain: () => "treeos.ai" },
});

mock.module("../seed/landRoot.js", {
  namedExports: { getLandRootId: () => "land-root-id" },
});

const {
  subscribe,
  unsubscribe,
  unsubscribeAllForBeing,
  getMatchingSubscribers,
  emitToSubscribers,
  getStats,
  _resetAll,
} = await import("../seed/scheduler/subscriptions.js");

beforeEach(() => {
  _resetAll();
  appendCalls.length = 0;
  wakeCalls.length = 0;
  fakeAncestorChain = [];
});
afterEach(() => _resetAll());

// ────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────

describe("subscribe — validation", () => {
  test("requires beingId", () => {
    assert.throws(() => subscribe(null, { event: "afterArtifact", scope: { everywhere: true } }), /beingId/);
  });

  test("requires event", () => {
    assert.throws(() => subscribe("b1", { scope: { everywhere: true } }), /event/);
  });

  test("requires scope with one of everywhere|nodeId|ancestor", () => {
    assert.throws(() => subscribe("b1", { event: "afterArtifact" }), /scope/);
    assert.throws(() => subscribe("b1", { event: "afterArtifact", scope: {} }), /scope/);
  });

  test("returns a subscription id", () => {
    const id = subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    assert.ok(typeof id === "string" && id.length > 0);
  });

  test("uses caller-supplied id when provided", () => {
    const id = subscribe("b1", { id: "fixed-id", event: "afterArtifact", scope: { everywhere: true } });
    assert.equal(id, "fixed-id");
  });
});

// ────────────────────────────────────────────────────────────────
// unsubscribe
// ────────────────────────────────────────────────────────────────

describe("unsubscribe", () => {
  test("removes a previously registered subscription", () => {
    const id = subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    assert.equal(unsubscribe(id), true);
    assert.equal(unsubscribe(id), false);
  });

  test("unknown id returns false", () => {
    assert.equal(unsubscribe("ghost"), false);
  });

  test("unsubscribeAllForBeing removes every subscription for a being", () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    subscribe("b1", { event: "afterStatusChange", scope: { nodeId: "n1" } });
    subscribe("b2", { event: "afterArtifact", scope: { everywhere: true } });
    assert.equal(unsubscribeAllForBeing("b1"), 2);
    assert.equal(getStats().beingsWithSubscriptions, 1);
  });
});

// ────────────────────────────────────────────────────────────────
// getMatchingSubscribers — scope variants
// ────────────────────────────────────────────────────────────────

describe("getMatchingSubscribers — scope", () => {
  test("everywhere matches any nodeId on the event", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    const matches = await getMatchingSubscribers("afterArtifact", { nodeId: "any-node" });
    assert.equal(matches.length, 1);
  });

  test("exact nodeId matches only the same id", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { nodeId: "target" } });
    assert.equal((await getMatchingSubscribers("afterArtifact", { nodeId: "target" })).length, 1);
    assert.equal((await getMatchingSubscribers("afterArtifact", { nodeId: "other" })).length, 0);
  });

  test("ancestor matches when payload.nodeId has scope.ancestor in its chain", async () => {
    fakeAncestorChain = ["leaf-id", "mid-id", "root-id"];
    subscribe("b1", { event: "afterArtifact", scope: { ancestor: "mid-id" } });
    const matches = await getMatchingSubscribers("afterArtifact", { nodeId: "leaf-id" });
    assert.equal(matches.length, 1);
  });

  test("ancestor matches when payload.nodeId IS the scope (self counts)", async () => {
    fakeAncestorChain = ["self-id", "parent-id"];
    subscribe("b1", { event: "afterArtifact", scope: { ancestor: "self-id" } });
    const matches = await getMatchingSubscribers("afterArtifact", { nodeId: "self-id" });
    assert.equal(matches.length, 1);
  });

  test("ancestor does not match when scope is outside the chain", async () => {
    fakeAncestorChain = ["leaf-id", "mid-id"];
    subscribe("b1", { event: "afterArtifact", scope: { ancestor: "unrelated" } });
    const matches = await getMatchingSubscribers("afterArtifact", { nodeId: "leaf-id" });
    assert.equal(matches.length, 0);
  });

  test("different events don't cross-fire", async () => {
    subscribe("b1", { event: "afterArtifact",     scope: { everywhere: true } });
    subscribe("b2", { event: "afterStatusChange", scope: { everywhere: true } });
    const matches = await getMatchingSubscribers("afterStatusChange", { nodeId: "n1" });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].beingId, "b2");
  });
});

// ────────────────────────────────────────────────────────────────
// getMatchingSubscribers — filter
// ────────────────────────────────────────────────────────────────

describe("getMatchingSubscribers — filter", () => {
  test("equality filter narrows matches", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      filter: { origin: "web" },
    });
    assert.equal((await getMatchingSubscribers("afterArtifact", { nodeId: "n1", origin: "web" })).length, 1);
    assert.equal((await getMatchingSubscribers("afterArtifact", { nodeId: "n1", origin: "ibp" })).length, 0);
  });

  test("array filter is any-of", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      filter: { origin: ["web", "filesystem"] },
    });
    assert.equal((await getMatchingSubscribers("afterArtifact", { nodeId: "n1", origin: "filesystem" })).length, 1);
    assert.equal((await getMatchingSubscribers("afterArtifact", { nodeId: "n1", origin: "ibp" })).length, 0);
  });

  test("dot-path filter reaches nested fields", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      filter: { "artifact.origin": "web" },
    });
    assert.equal(
      (await getMatchingSubscribers("afterArtifact", { nodeId: "n1", artifact: { origin: "web" } })).length,
      1,
    );
    assert.equal(
      (await getMatchingSubscribers("afterArtifact", { nodeId: "n1", artifact: { origin: "ibp" } })).length,
      0,
    );
  });
});

// ────────────────────────────────────────────────────────────────
// emitToSubscribers — fan-out
// ────────────────────────────────────────────────────────────────

describe("emitToSubscribers", () => {
  test("appends one SUMMON per matching subscriber and wakes each", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    subscribe("b2", { event: "afterArtifact", scope: { everywhere: true } });
    const emitted = await emitToSubscribers("afterArtifact", {
      nodeId: "n1",
      action: "add",
      artifact: { _id: "a1", origin: "web" },
    });
    assert.equal(emitted, 2);
    assert.equal(appendCalls.length, 2);
    assert.equal(wakeCalls.length, 2);
    const beings = new Set(appendCalls.map((c) => c.beingId));
    assert.deepEqual(beings, new Set(["b1", "b2"]));
  });

  test("envelope carries do-trigger intent + rendered content", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    await emitToSubscribers("afterArtifact", {
      nodeId: "n1",
      action: "add",
      artifact: { _id: "a1", origin: "web" },
    });
    const env = appendCalls[0].message;
    assert.equal(env.intent, "do-trigger");
    assert.equal(env.content.event, "afterArtifact");
    assert.equal(env.content.nodeId, "n1");
    assert.equal(env.content.action, "add");
    assert.equal(env.content.artifactId, "a1");
    assert.equal(env.content.artifactOrigin, "web");
    assert.ok(env.correlation, "correlation generated");
    assert.equal(env.priority, 4, "default priority is BACKGROUND");
  });

  test("custom intent + priority flow through", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      intent: "scout-wake",
      priority: 1,
    });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "add" });
    assert.equal(appendCalls[0].message.intent, "scout-wake");
    assert.equal(appendCalls[0].message.priority, 1);
  });

  test("sender is the doer when payload.beingId is set", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", beingId: "doer-99" });
    assert.match(appendCalls[0].message.from, /^treeos\.ai\/@<being:doer-99>$/);
  });

  test("sender falls back to @system when no doer", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    await emitToSubscribers("afterArtifact", { nodeId: "n1" });
    assert.equal(appendCalls[0].message.from, "treeos.ai/@system");
  });

  test("zero matches → zero emissions, returns 0", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { nodeId: "elsewhere" } });
    const emitted = await emitToSubscribers("afterArtifact", { nodeId: "n1" });
    assert.equal(emitted, 0);
    assert.equal(appendCalls.length, 0);
  });

  test("rootCorrelation propagated from payload when present", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", rootCorrelation: "root-x" });
    assert.equal(appendCalls[0].message.rootCorrelation, "root-x");
  });
});

// ────────────────────────────────────────────────────────────────
// Coalescing (batched delivery within a window)
// ────────────────────────────────────────────────────────────────

describe("coalesceMs — batching", () => {
  // Tight delay so tests run quickly. setTimeout-based; tests await
  // long enough for the window to expire + the async flush to land.
  const W = 30;

  test("coalesceMs=0 (default) emits immediately, one per event", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "add" });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "remove" });
    assert.equal(appendCalls.length, 2, "two events → two summons");
  });

  test("coalesceMs>0 defers emit and batches events landing in the window", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      coalesceMs: W,
    });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "add" });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "edit" });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "remove" });
    // Nothing emitted yet — still inside the window.
    assert.equal(appendCalls.length, 0);
    // Wait past the window.
    await new Promise((r) => setTimeout(r, W + 10));
    assert.equal(appendCalls.length, 1, "one batched summon");
    const env = appendCalls[0].message;
    assert.equal(env.content.event, "afterArtifact");
    assert.equal(env.content.coalesced, true);
    assert.equal(env.content.batchSize, 3);
    assert.equal(env.content.events.length, 3);
    assert.deepEqual(env.content.events.map((e) => e.action), ["add", "edit", "remove"]);
    assert.ok(env.content.firstAt, "firstAt timestamp present");
    assert.ok(env.content.lastAt, "lastAt timestamp present");
  });

  test("second batch opens after the first flushes", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      coalesceMs: W,
    });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "first" });
    await new Promise((r) => setTimeout(r, W + 10));
    // First batch flushed.
    assert.equal(appendCalls.length, 1);
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "second" });
    // Second window opens; nothing emitted yet.
    assert.equal(appendCalls.length, 1);
    await new Promise((r) => setTimeout(r, W + 10));
    assert.equal(appendCalls.length, 2);
    assert.equal(appendCalls[1].message.content.events[0].action, "second");
  });

  test("different subscriptions have independent coalesce windows", async () => {
    subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      coalesceMs: W,
    });
    subscribe("b2", {
      event: "afterArtifact",
      scope: { everywhere: true },
      coalesceMs: W,
    });
    await emitToSubscribers("afterArtifact", { nodeId: "n1" });
    await new Promise((r) => setTimeout(r, W + 10));
    assert.equal(appendCalls.length, 2, "each being got their own batched SUMMON");
    const beings = new Set(appendCalls.map((c) => c.beingId));
    assert.deepEqual(beings, new Set(["b1", "b2"]));
    // Each batch carried its own event (1 event each).
    for (const c of appendCalls) {
      assert.equal(c.message.content.batchSize, 1);
    }
  });

  test("coalesced and non-coalesced subscribers to same event don't interfere", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } }); // immediate
    subscribe("b2", { event: "afterArtifact", scope: { everywhere: true }, coalesceMs: W });
    await emitToSubscribers("afterArtifact", { nodeId: "n1", action: "add" });
    // b1 immediate, b2 pending.
    assert.equal(appendCalls.length, 1);
    assert.equal(appendCalls[0].beingId, "b1");
    assert.equal(appendCalls[0].message.content.coalesced, undefined, "non-coalesced has no coalesced flag");
    await new Promise((r) => setTimeout(r, W + 10));
    assert.equal(appendCalls.length, 2);
    assert.equal(appendCalls[1].beingId, "b2");
    assert.equal(appendCalls[1].message.content.coalesced, true);
  });

  test("unsubscribe during pending window cancels the emit", async () => {
    const id = subscribe("b1", {
      event: "afterArtifact",
      scope: { everywhere: true },
      coalesceMs: W,
    });
    await emitToSubscribers("afterArtifact", { nodeId: "n1" });
    assert.equal(getStats().pendingCoalesce, 1);
    unsubscribe(id);
    assert.equal(getStats().pendingCoalesce, 0, "pending state cleared on unsubscribe");
    await new Promise((r) => setTimeout(r, W + 10));
    assert.equal(appendCalls.length, 0, "no emit after unsubscribe");
  });

  test("_resetAll cancels pending coalesce timers", async () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true }, coalesceMs: W });
    await emitToSubscribers("afterArtifact", { nodeId: "n1" });
    assert.equal(getStats().pendingCoalesce, 1);
    _resetAll();
    assert.equal(getStats().pendingCoalesce, 0);
    await new Promise((r) => setTimeout(r, W + 10));
    assert.equal(appendCalls.length, 0);
  });
});

// ────────────────────────────────────────────────────────────────
// stats + introspection
// ────────────────────────────────────────────────────────────────

describe("getStats", () => {
  test("reports counts accurately", () => {
    subscribe("b1", { event: "afterArtifact", scope: { everywhere: true } });
    subscribe("b1", { event: "afterStatusChange", scope: { nodeId: "n1" } });
    subscribe("b2", { event: "afterArtifact", scope: { everywhere: true } });
    const stats = getStats();
    assert.equal(stats.totalSubscriptions, 3);
    assert.equal(stats.beingsWithSubscriptions, 2);
    assert.ok(stats.eventsWatched.includes("afterArtifact"));
    assert.ok(stats.eventsWatched.includes("afterStatusChange"));
    assert.equal(stats.pendingCoalesce, 0);
  });
});
