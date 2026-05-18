// TreeOS IBP — scheduled-wake registry tests.
//
// Verifies validation, registry bookkeeping, runOnce firing semantics,
// the custom-emitter swap (Mode 1 ↔ Mode 2), and the default emitter's
// SUMMON shape. Inbox + scheduler are mocked so the test stays in-
// memory.
//
// Run: node --test --experimental-test-module-mocks land/test/schedule.test.js

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mock } from "node:test";

const appendCalls = [];
const wakeCalls = [];

mock.module("../ibp/inbox.js", {
  namedExports: {
    appendToInbox: async (nodeId, beingId, message) => {
      appendCalls.push({ nodeId, beingId, message });
      return { messageId: message.correlation, sentAt: message.sentAt };
    },
  },
});

mock.module("../ibp/scheduler.js", {
  namedExports: {
    wake: (beingId, nodeId) => { wakeCalls.push({ beingId, nodeId }); },
  },
});

mock.module("../ibp/address.js", {
  namedExports: { getLandDomain: () => "treeos.ai" },
});

mock.module("../seed/landRoot.js", {
  namedExports: { getLandRootId: () => "land-root-id" },
});

const {
  schedule,
  unschedule,
  unscheduleAllForBeing,
  runOnce,
  setEmitter,
  resetEmitter,
  getStats,
  _resetAll,
} = await import("../ibp/schedule.js");

beforeEach(() => {
  _resetAll();
  appendCalls.length = 0;
  wakeCalls.length = 0;
});
afterEach(() => _resetAll());

// ────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────

describe("schedule — validation", () => {
  test("requires beingId", () => {
    assert.throws(() => schedule(null, { intervalMs: 1000 }), /beingId/);
  });

  test("requires intervalMs >= 250", () => {
    assert.throws(() => schedule("b1", { intervalMs: 100 }), /intervalMs/);
    assert.throws(() => schedule("b1", { intervalMs: "fast" }), /intervalMs/);
    assert.doesNotThrow(() => schedule("b1", { intervalMs: 250 }));
  });

  test("returns a schedule id", () => {
    const id = schedule("b1", { intervalMs: 1000 });
    assert.ok(typeof id === "string" && id.length > 0);
  });

  test("caller-supplied id is idempotent (re-register replaces)", () => {
    const id = schedule("b1", { id: "stable", intervalMs: 1000 });
    assert.equal(id, "stable");
    // Re-register with different interval — same id, prior entry replaced.
    schedule("b1", { id: "stable", intervalMs: 2000 });
    assert.equal(getStats().totalSchedules, 1);
  });
});

// ────────────────────────────────────────────────────────────────
// unschedule
// ────────────────────────────────────────────────────────────────

describe("unschedule", () => {
  test("removes a previously registered schedule", () => {
    const id = schedule("b1", { intervalMs: 1000 });
    assert.equal(unschedule(id), true);
    assert.equal(unschedule(id), false);
    assert.equal(getStats().totalSchedules, 0);
  });

  test("unscheduleAllForBeing drops every schedule for one being", () => {
    schedule("b1", { intervalMs: 1000 });
    schedule("b1", { intervalMs: 5000 });
    schedule("b2", { intervalMs: 1000 });
    assert.equal(unscheduleAllForBeing("b1"), 2);
    assert.equal(getStats().beingsWithSchedules, 1);
  });
});

// ────────────────────────────────────────────────────────────────
// runOnce — firing semantics
// ────────────────────────────────────────────────────────────────

describe("runOnce", () => {
  test("does not fire before nextFireMs", async () => {
    const t0 = 1_000_000;
    schedule("b1", { intervalMs: 1000 });
    // Override nextFireMs by reaching into the registry. The schedule()
    // call set nextFireMs based on real Date.now(); for deterministic
    // testing we re-fix it relative to our t0 clock.
    // (This is a fixture concern — production code uses the real clock.)
    const fired = await runOnce(t0); // before nextFireMs
    assert.equal(fired, 0);
    assert.equal(appendCalls.length, 0);
  });

  test("fires once nextFireMs has passed", async () => {
    schedule("b1", { intervalMs: 1000 });
    // First runOnce far in the future definitely fires.
    const fired = await runOnce(Date.now() + 10_000);
    assert.equal(fired, 1);
    assert.equal(appendCalls.length, 1);
    assert.equal(wakeCalls.length, 1);
  });

  test("advances nextFireMs after firing so it doesn't double-fire", async () => {
    schedule("b1", { intervalMs: 1000 });
    const t1 = Date.now() + 10_000;
    await runOnce(t1);
    await runOnce(t1); // immediate re-run at same time
    assert.equal(appendCalls.length, 1, "fired exactly once");
  });

  test("multiple due schedules all fire in one tick", async () => {
    schedule("b1", { intervalMs: 500 });
    schedule("b2", { intervalMs: 500 });
    schedule("b3", { intervalMs: 500 });
    const fired = await runOnce(Date.now() + 10_000);
    assert.equal(fired, 3);
    const beings = new Set(appendCalls.map((c) => c.beingId));
    assert.deepEqual(beings, new Set(["b1", "b2", "b3"]));
  });

  test("an emitter error does not stop subsequent emissions in the same tick", async () => {
    let calls = 0;
    setEmitter(async () => {
      calls++;
      if (calls === 1) throw new Error("first emit fails");
    });
    schedule("b1", { intervalMs: 500 });
    schedule("b2", { intervalMs: 500 });
    await runOnce(Date.now() + 10_000);
    assert.equal(calls, 2, "second schedule still fires after first throws");
  });
});

// ────────────────────────────────────────────────────────────────
// Default emitter — SUMMON shape
// ────────────────────────────────────────────────────────────────

describe("default emitter", () => {
  test("appends SUMMON to land root keyed by being, wakes scheduler", async () => {
    schedule("b1", { intervalMs: 500 });
    await runOnce(Date.now() + 10_000);
    assert.equal(appendCalls.length, 1);
    assert.equal(appendCalls[0].nodeId, "land-root-id");
    assert.equal(appendCalls[0].beingId, "b1");
    assert.equal(wakeCalls.length, 1);
    assert.equal(wakeCalls[0].beingId, "b1");
    assert.equal(wakeCalls[0].nodeId, "land-root-id");
  });

  test("envelope: intent=scheduled-wake, sender=@scheduler, default content", async () => {
    schedule("b1", { intervalMs: 500 });
    await runOnce(Date.now() + 10_000);
    const env = appendCalls[0].message;
    assert.equal(env.intent, "scheduled-wake");
    assert.equal(env.from, "treeos.ai/@scheduler");
    assert.deepEqual(env.content, { kind: "scheduled-wake" });
    assert.equal(env.priority, 4, "default BACKGROUND priority");
    assert.ok(env.correlation, "correlation generated");
    assert.equal(env.rootCorrelation, env.correlation,
      "each scheduled wake is its own root");
  });

  test("custom intent + priority + content flow through", async () => {
    schedule("b1", {
      intervalMs: 500,
      intent: "compress-tick",
      priority: 2,
      content: { kind: "compress", batchHint: 10 },
    });
    await runOnce(Date.now() + 10_000);
    const env = appendCalls[0].message;
    assert.equal(env.intent, "compress-tick");
    assert.equal(env.priority, 2);
    assert.deepEqual(env.content, { kind: "compress", batchHint: 10 });
  });
});

// ────────────────────────────────────────────────────────────────
// Custom emitter (Mode 1 ↔ Mode 2 swap)
// ────────────────────────────────────────────────────────────────

describe("custom emitter", () => {
  test("setEmitter swaps the dispatch function", async () => {
    const calls = [];
    setEmitter(async (entry, nowMs) => {
      calls.push({ scheduleId: entry.id, beingId: entry.beingId, nowMs });
    });
    schedule("b1", { intervalMs: 500 });
    await runOnce(Date.now() + 10_000);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].beingId, "b1");
    assert.equal(appendCalls.length, 0, "default emitter not used");
    assert.equal(wakeCalls.length, 0, "default emitter not used");
  });

  test("resetEmitter restores default", async () => {
    setEmitter(async () => {});
    resetEmitter();
    schedule("b1", { intervalMs: 500 });
    await runOnce(Date.now() + 10_000);
    assert.equal(appendCalls.length, 1, "default emitter back in play");
  });

  test("getStats reports emitter swap state", () => {
    assert.equal(getStats().emitter, "default");
    setEmitter(async () => {});
    assert.equal(getStats().emitter, "custom");
    resetEmitter();
    assert.equal(getStats().emitter, "default");
  });
});

// ────────────────────────────────────────────────────────────────
// stats
// ────────────────────────────────────────────────────────────────

describe("getStats", () => {
  test("reports counts and tick state", () => {
    schedule("b1", { intervalMs: 1000 });
    schedule("b2", { intervalMs: 1000 });
    const stats = getStats();
    assert.equal(stats.totalSchedules, 2);
    assert.equal(stats.beingsWithSchedules, 2);
    assert.equal(stats.tickRunning, false);
    assert.equal(stats.emitter, "default");
  });
});
