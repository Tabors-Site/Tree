// TreeOS IBP — reply aggregator tests.
// Run: node --test land/test/replyAggregator.test.js

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { aggregate } from "../seed/cognition/replyAggregator.js";

describe("aggregate — basic gathering", () => {
  test("resolves when all expected correlations arrive", async () => {
    const agg = aggregate({ correlations: ["a", "b", "c"] });

    agg.notify({ inReplyTo: "a", content: "A" });
    agg.notify({ inReplyTo: "b", content: "B" });
    agg.notify({ inReplyTo: "c", content: "C" });

    const result = await agg.wait();
    assert.equal(result.timedOut, false);
    assert.equal(result.cancelled, false);
    assert.equal(result.replies.length, 3);
    // Replies arrive in the original correlations[] order, not arrival order.
    assert.deepEqual(result.replies.map((r) => r.content), ["A", "B", "C"]);
  });

  test("ignores replies whose inReplyTo doesn't match", async () => {
    const agg = aggregate({ correlations: ["a", "b"] });

    assert.equal(agg.notify({ inReplyTo: "unrelated", content: "X" }), false);
    assert.equal(agg.notify({ inReplyTo: "a", content: "A" }), true);
    assert.equal(agg.notify({ inReplyTo: "b", content: "B" }), true);

    const result = await agg.wait();
    assert.equal(result.replies.length, 2);
  });

  test("dedupes by correlation — first reply wins", async () => {
    const agg = aggregate({ correlations: ["a"] });

    assert.equal(agg.notify({ inReplyTo: "a", content: "first" }), true);
    assert.equal(agg.notify({ inReplyTo: "a", content: "second" }), false);

    const result = await agg.wait();
    assert.equal(result.replies[0].content, "first");
  });
});

describe("aggregate — minReplies (k-of-N)", () => {
  test("resolves at minReplies even if more correlations are open", async () => {
    const agg = aggregate({ correlations: ["a", "b", "c", "d"], minReplies: 2 });

    agg.notify({ inReplyTo: "b", content: "B" });
    agg.notify({ inReplyTo: "d", content: "D" });

    const result = await agg.wait();
    assert.equal(result.replies.length, 2);
    // Preserves correlations[] order, so B first then D (a/c never arrived).
    assert.deepEqual(result.replies.map((r) => r.content), ["B", "D"]);
  });

  test("minReplies > correlations clamps to correlations.length", async () => {
    const agg = aggregate({ correlations: ["a"], minReplies: 99 });
    agg.notify({ inReplyTo: "a", content: "A" });
    const result = await agg.wait();
    assert.equal(result.replies.length, 1);
  });
});

describe("aggregate — timeout", () => {
  test("settles with timedOut=true when timeout elapses with no replies", async () => {
    const agg = aggregate({ correlations: ["a", "b"], timeoutMs: 30 });
    const result = await agg.wait();
    assert.equal(result.timedOut, true);
    assert.equal(result.cancelled, false);
    assert.equal(result.replies.length, 0);
  });

  test("settles with timedOut=true and partial replies", async () => {
    const agg = aggregate({ correlations: ["a", "b", "c"], timeoutMs: 30 });
    agg.notify({ inReplyTo: "a", content: "A" });
    const result = await agg.wait();
    assert.equal(result.timedOut, true);
    assert.equal(result.replies.length, 1);
    assert.equal(result.replies[0].content, "A");
  });

  test("no timeout fires when all replies arrive in time", async () => {
    const agg = aggregate({ correlations: ["a"], timeoutMs: 1000 });
    agg.notify({ inReplyTo: "a", content: "A" });
    const result = await agg.wait();
    assert.equal(result.timedOut, false);
  });
});

describe("aggregate — abort", () => {
  test("manual abort() settles with cancelled=true", async () => {
    const agg = aggregate({ correlations: ["a", "b"] });
    setTimeout(() => agg.abort(), 5);
    const result = await agg.wait();
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
  });

  test("AbortSignal abort settles with cancelled=true", async () => {
    const controller = new AbortController();
    const agg = aggregate({ correlations: ["a", "b"], signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    const result = await agg.wait();
    assert.equal(result.cancelled, true);
  });

  test("already-aborted signal settles immediately on wait()", async () => {
    const controller = new AbortController();
    controller.abort();
    const agg = aggregate({ correlations: ["a"], signal: controller.signal });
    const result = await agg.wait();
    assert.equal(result.cancelled, true);
  });

  test("notify after settle returns false and does not mutate result", async () => {
    const agg = aggregate({ correlations: ["a", "b"] });
    agg.abort();
    const result = await agg.wait();
    assert.equal(result.replies.length, 0);
    // Late reply: rejected.
    assert.equal(agg.notify({ inReplyTo: "a", content: "late" }), false);
  });
});

describe("aggregate — matcher predicate", () => {
  test("matcher rejecting a reply leaves the correlation open", async () => {
    const agg = aggregate({
      correlations: ["a"],
      timeoutMs: 30,
      matcher: (reply) => reply.content?.startsWith("ok:"),
    });

    assert.equal(agg.notify({ inReplyTo: "a", content: "no" }), false);
    assert.equal(agg.notify({ inReplyTo: "a", content: "ok: done" }), true);

    const result = await agg.wait();
    assert.equal(result.timedOut, false);
    assert.equal(result.replies[0].content, "ok: done");
  });

  test("matcher that throws is caught and treated as non-match", async () => {
    const agg = aggregate({
      correlations: ["a"],
      timeoutMs: 30,
      matcher: () => { throw new Error("oops"); },
    });
    assert.equal(agg.notify({ inReplyTo: "a", content: "x" }), false);
    const result = await agg.wait();
    assert.equal(result.timedOut, true);
  });
});

describe("aggregate — invariants", () => {
  test("requires non-empty correlations", () => {
    assert.throws(() => aggregate({ correlations: [] }), /correlations/);
    assert.throws(() => aggregate({}), /correlations/);
  });

  test("multiple wait() calls return the same promise / payload", async () => {
    const agg = aggregate({ correlations: ["a"] });
    const p1 = agg.wait();
    const p2 = agg.wait();
    assert.equal(p1, p2);
    agg.notify({ inReplyTo: "a", content: "A" });
    const r1 = await p1;
    const r2 = await p2;
    assert.equal(r1, r2);
  });
});
