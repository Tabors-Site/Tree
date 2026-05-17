// TreeOS Seed — session identity tests
// Run: node --test land/test/sessionKeys.test.js

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildUserAiSessionKey,
  resolvePipelineKey,
} from "../seed/llm/sessionKeys.js";

// ─────────────────────────────────────────────────────────────────────────
// buildUserAiSessionKey — per-reach transport-session key
//
// After Slice 6: aiSessionKey identifies a transport reach (which tab /
// CLI / device). It's no longer the canonical conversation identifier
// (that's portalAddress now). The per-reach split below is what the
// in-flight registry uses for replay-on-reconnect bookkeeping.
// ─────────────────────────────────────────────────────────────────────────

describe("buildUserAiSessionKey", () => {
  test("tree zone with device", () => {
    assert.equal(
      buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "cli" }),
      "user:u1:r1:cli",
    );
  });

  test("home zone with device", () => {
    assert.equal(
      buildUserAiSessionKey({ beingId: "u1", zone: "home", device: "web" }),
      "user:u1:home:web",
    );
  });

  test("land zone with device", () => {
    assert.equal(
      buildUserAiSessionKey({ beingId: "u1", zone: "land", device: "http" }),
      "user:u1:land:http",
    );
  });

  test("handle replaces device (explicit override)", () => {
    const k = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "cli", handle: "shared" });
    assert.equal(k, "user:u1:r1:shared");
    assert.ok(!k.includes("cli"), "handle should replace device, not append");
  });

  test("same handle from two devices produces one merged transport key", () => {
    // Two reaches sharing a handle still merge — useful for tests, manual
    // multi-device coordination, etc. This is independent of the per-being
    // conversation merge that happens at the portalAddress layer.
    const a = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "web", handle: "shared" });
    const b = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "cli", handle: "shared" });
    assert.equal(a, b, "same handle must produce the same key regardless of device");
  });

  test("gateway-composed device (colons preserved)", () => {
    assert.equal(
      buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "telegram:12345" }),
      "user:u1:r1:telegram:12345",
    );
  });

  test("canopy-proxied remote reach device", () => {
    assert.equal(
      buildUserAiSessionKey({ beingId: "owner", zone: "tree", rootId: "r1", device: "canopy:other-land.org:remote-u" }),
      "user:owner:r1:canopy:other-land.org:remote-u",
    );
  });

  test("CLI and browser get distinct transport keys (replay bookkeeping)", () => {
    const dashboard = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "web" });
    const cli = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "cli" });
    assert.notEqual(dashboard, cli);
    // Transport keys split per-tab so the in-flight event buffer can
    // replay correctly when one tab disconnects mid-stream. The
    // conversation state (messages, mode) is keyed by portalAddress
    // and IS shared — that's a separate model.
  });

  test("missing beingId throws", () => {
    assert.throws(
      () => buildUserAiSessionKey({ zone: "tree", rootId: "r1", device: "web" }),
      /beingId required/,
    );
  });

  test("missing zone throws", () => {
    assert.throws(
      () => buildUserAiSessionKey({ beingId: "u1", rootId: "r1", device: "web" }),
      /zone required/,
    );
  });

  test("tree zone requires rootId", () => {
    assert.throws(
      () => buildUserAiSessionKey({ beingId: "u1", zone: "tree", device: "web" }),
      /zone='tree' requires rootId/,
    );
  });

  test("unknown zone throws", () => {
    assert.throws(
      () => buildUserAiSessionKey({ beingId: "u1", zone: "bogus", device: "web" }),
      /unknown zone/,
    );
  });

  test("missing device and handle throws", () => {
    assert.throws(
      () => buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1" }),
      /device or handle required/,
    );
  });

  test("device sanitizer rejects empty result", () => {
    assert.throws(
      () => buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "!!!" }),
      /reduced to empty/,
    );
  });

  test("device sanitizer keeps colons and dashes, strips spaces and slashes", () => {
    assert.equal(
      buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "x/y\\z q:w-v.ext" }),
      "user:u1:r1:xyzq:w-v.ext",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolvePipelineKey — runChat / OrchestratorRuntime stanceless pipeline
//
// After Slice 6: pipeline keys are explicitly namespaced under
// `pipeline:*` so they don't collide with portalAddress (being-to-being
// conversation identity) or aiSessionKey (transport identity). Used
// for background internal cognition where no addressee being exists.
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

// ─────────────────────────────────────────────────────────────────────────
// Namespace isolation invariants
// ─────────────────────────────────────────────────────────────────────────

describe("namespace isolation", () => {
  test("CLI and browser on same user+tree get different transport keys", () => {
    const cli = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "cli" });
    const browser = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "web" });
    assert.notEqual(cli, browser);
    // Different transport keys are correct: the in-flight event buffer
    // is per-tab so replay-on-disconnect works per-window. Conversation
    // state (messages, mode) is keyed by portalAddress at a higher
    // layer and IS shared between the tabs.
  });

  test("Two Telegram chats for same user+tree get different transport keys", () => {
    const chatA = buildUserAiSessionKey({ beingId: "owner", zone: "tree", rootId: "r1", device: "telegram:111" });
    const chatB = buildUserAiSessionKey({ beingId: "owner", zone: "tree", rootId: "r1", device: "telegram:222" });
    assert.notEqual(chatA, chatB);
  });

  test("Pipeline key never collides with transport key (prefix guarantees isolation)", () => {
    const userKey = buildUserAiSessionKey({ beingId: "u1", zone: "tree", rootId: "r1", device: "web" });
    const { key: pipelineKey } = resolvePipelineKey({
      scope: "tree", purpose: "reflect", beingId: "u1", rootId: "r1",
      makeEphemeral: () => "x",
    });
    assert.ok(userKey.startsWith("user:"));
    assert.ok(pipelineKey.startsWith("pipeline:"));
    assert.notEqual(userKey, pipelineKey);
  });
});
