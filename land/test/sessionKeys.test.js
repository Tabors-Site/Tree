// TreeOS Seed — session identity tests
// Run: node --test land/test/sessionKeys.test.js

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { resolvePipelineKey } from "../seed/llm/sessionKeys.js";

// ─────────────────────────────────────────────────────────────────────────
// resolvePipelineKey — runChat / OrchestratorRuntime stanceless pipeline
//
// Pipeline keys are namespaced under `pipeline:*` so they don't collide
// with ibpAddress (being-to-being conversation identity) or clientSessionId
// (transport identity). Used for background internal cognition where no
// addressee being exists.
// ─────────────────────────────────────────────────────────────────────────

describe("resolvePipelineKey", () => {
  const makeEphemeral = () => "UUID";

  test("explicit pipelineKey pass-through wins over scope", () => {
    const { key, persist } = resolvePipelineKey({
      pipelineKey: "pipeline:tree:r1:reflect",
      scope: "tree", purpose: "analyze",  // ignored
      beingId: "u1", rootId: "r1",
      makeEphemeral,
    });
    assert.equal(key, "pipeline:tree:r1:reflect");
    assert.equal(persist, true);
  });

  test("pass-through ephemeral key is non-persistent", () => {
    const { key, persist } = resolvePipelineKey({
      pipelineKey: "pipeline:ephemeral:abc",
      makeEphemeral,
    });
    assert.equal(key, "pipeline:ephemeral:abc");
    assert.equal(persist, false);
  });

  test("scope=tree + purpose builds pipeline:tree key", () => {
    const { key, persist } = resolvePipelineKey({
      scope: "tree", purpose: "reflect",
      beingId: "u1", rootId: "r1",
      makeEphemeral,
    });
    assert.equal(key, "pipeline:tree:r1:reflect");
    assert.equal(persist, true);
  });

  test("scope=tree with extra produces per-fork chain", () => {
    const { key } = resolvePipelineKey({
      scope: "tree", purpose: "analyze", extra: "security",
      beingId: "u1", rootId: "r1",
      makeEphemeral,
    });
    assert.equal(key, "pipeline:tree:r1:analyze:security");
  });

  test("scope=home + purpose builds pipeline:home key under beingId", () => {
    const { key } = resolvePipelineKey({
      scope: "home", purpose: "reflect",
      beingId: "u1",
      makeEphemeral,
    });
    assert.equal(key, "pipeline:home:u1:reflect");
  });

  test("scope=land + purpose builds pipeline:land key", () => {
    const { key } = resolvePipelineKey({
      scope: "land", purpose: "digest",
      makeEphemeral,
    });
    assert.equal(key, "pipeline:land:digest");
  });

  test("scope=tree without rootId throws", () => {
    assert.throws(
      () => resolvePipelineKey({ scope: "tree", purpose: "x", beingId: "u1", makeEphemeral }),
      /scope='tree' requires rootId and purpose/,
    );
  });

  test("scope=tree without purpose throws", () => {
    assert.throws(
      () => resolvePipelineKey({ scope: "tree", rootId: "r1", beingId: "u1", makeEphemeral }),
      /scope='tree' requires rootId and purpose/,
    );
  });

  test("scope=home without purpose throws", () => {
    assert.throws(
      () => resolvePipelineKey({ scope: "home", beingId: "u1", makeEphemeral }),
      /scope='home' requires/,
    );
  });

  test("scope=land without purpose throws", () => {
    assert.throws(
      () => resolvePipelineKey({ scope: "land", makeEphemeral }),
      /scope='land' requires purpose/,
    );
  });

  test("unknown scope throws", () => {
    assert.throws(
      () => resolvePipelineKey({ scope: "bogus", purpose: "x", makeEphemeral }),
      /unknown scope "bogus"/,
    );
  });

  test("default (no pipelineKey, no scope) produces ephemeral non-persistent key", () => {
    const { key, persist } = resolvePipelineKey({ makeEphemeral });
    assert.equal(key, "pipeline:ephemeral:UUID");
    assert.equal(persist, false);
  });

  test("default ephemeral is unique per call", () => {
    let counter = 0;
    const factory = () => `uuid-${++counter}`;
    const a = resolvePipelineKey({ makeEphemeral: factory });
    const b = resolvePipelineKey({ makeEphemeral: factory });
    assert.notEqual(a.key, b.key);
    assert.equal(a.persist, false);
    assert.equal(b.persist, false);
  });

  test("extra sanitizer strips disallowed characters", () => {
    const { key } = resolvePipelineKey({
      scope: "tree", purpose: "p", extra: "hello world/bad",
      beingId: "u", rootId: "r",
      makeEphemeral,
    });
    // spaces and slashes stripped, colons preserved
    assert.equal(key, "pipeline:tree:r:p:helloworldbad");
  });
});
