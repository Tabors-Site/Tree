// TreeOS Seed — session identity tests
// Run: node --test land/seed/llm/sessionKeys.test.js

import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildUserAiSessionKey,
  resolveInternalAiSessionKey,
} from "./sessionKeys.js";

// ─────────────────────────────────────────────────────────────────────────
// buildUserAiSessionKey — per-reach user session key
// ─────────────────────────────────────────────────────────────────────────

describe("buildUserAiSessionKey", () => {
  test("tree zone with device", () => {
    assert.equal(
      buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "cli" }),
      "user:u1:r1:cli",
    );
  });

  test("home zone with device", () => {
    assert.equal(
      buildUserAiSessionKey({ userId: "u1", zone: "home", device: "web" }),
      "user:u1:home:web",
    );
  });

  test("land zone with device", () => {
    assert.equal(
      buildUserAiSessionKey({ userId: "u1", zone: "land", device: "http" }),
      "user:u1:land:http",
    );
  });

  test("handle replaces device (explicit override)", () => {
    const k = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "cli", handle: "shared" });
    assert.equal(k, "user:u1:r1:shared");
    assert.ok(!k.includes("cli"), "handle should replace device, not append");
  });

  test("same handle from two devices produces one merged session", () => {
    // Invariant test — this is how cross-device merge works.
    const a = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "web", handle: "shared" });
    const b = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "cli", handle: "shared" });
    assert.equal(a, b, "same handle must produce the same key regardless of device");
  });

  test("gateway-composed device (colons preserved)", () => {
    assert.equal(
      buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "telegram:12345" }),
      "user:u1:r1:telegram:12345",
    );
  });

  test("canopy-proxied remote visitor device", () => {
    assert.equal(
      buildUserAiSessionKey({ userId: "owner", zone: "tree", rootId: "r1", device: "canopy:other-land.org:remote-u" }),
      "user:owner:r1:canopy:other-land.org:remote-u",
    );
  });

  test("two devices on same tree produce distinct keys (auto-decoupling)", () => {
    const dashboard = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "web" });
    const cli = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "cli" });
    assert.notEqual(dashboard, cli);
  });

  test("throws when userId missing", () => {
    assert.throws(
      () => buildUserAiSessionKey({ zone: "tree", rootId: "r1", device: "web" }),
      /userId required/,
    );
  });

  test("throws when zone missing", () => {
    assert.throws(
      () => buildUserAiSessionKey({ userId: "u1", rootId: "r1", device: "web" }),
      /zone required/,
    );
  });

  test("throws when tree zone missing rootId", () => {
    assert.throws(
      () => buildUserAiSessionKey({ userId: "u1", zone: "tree", device: "web" }),
      /zone='tree' requires rootId/,
    );
  });

  test("throws when unknown zone", () => {
    assert.throws(
      () => buildUserAiSessionKey({ userId: "u1", zone: "bogus", device: "web" }),
      /unknown zone "bogus"/,
    );
  });

  test("throws when both device and handle missing (loud failure, no silent default)", () => {
    // This guard catches any entry point that forgets to pass device.
    // Without it, all such traffic collapses into a shared `…:default` key.
    assert.throws(
      () => buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1" }),
      /device or handle required/,
    );
  });

  test("throws when device/handle sanitizes to empty", () => {
    assert.throws(
      () => buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "!!!" }),
      /reduced to empty after sanitization/,
    );
  });

  test("sanitizer strips disallowed characters but preserves colons, dots, and dashes", () => {
    assert.equal(
      buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "x/y\\z q:w-v.ext" }),
      "user:u1:r1:xyzq:w-v.ext",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveInternalAiSessionKey — runChat / OrchestratorRuntime resolver
// ─────────────────────────────────────────────────────────────────────────

describe("resolveInternalAiSessionKey", () => {
  const makeEphemeral = () => "UUID";

  test("aiSessionKey pass-through wins over scope", () => {
    const { key, persist } = resolveInternalAiSessionKey({
      aiSessionKey: "user:u1:r1:web",
      scope: "tree", purpose: "reflect",  // ignored
      userId: "u1", rootId: "r1",
      makeEphemeral,
    });
    assert.equal(key, "user:u1:r1:web");
    assert.equal(persist, true);
  });

  test("aiSessionKey starting with ephemeral: is non-persistent", () => {
    const { key, persist } = resolveInternalAiSessionKey({
      aiSessionKey: "ephemeral:abc",
      makeEphemeral,
    });
    assert.equal(key, "ephemeral:abc");
    assert.equal(persist, false);
  });

  test("scope=tree + purpose builds tree-internal key", () => {
    const { key, persist } = resolveInternalAiSessionKey({
      scope: "tree", purpose: "reflect",
      userId: "u1", rootId: "r1",
      makeEphemeral,
    });
    assert.equal(key, "tree-internal:r1:reflect");
    assert.equal(persist, true);
  });

  test("scope=tree with extra produces per-fork chain", () => {
    const { key } = resolveInternalAiSessionKey({
      scope: "tree", purpose: "analyze", extra: "security",
      userId: "u1", rootId: "r1",
      makeEphemeral,
    });
    assert.equal(key, "tree-internal:r1:analyze:security");
  });

  test("scope=home + purpose builds home-internal key under userId", () => {
    const { key } = resolveInternalAiSessionKey({
      scope: "home", purpose: "reflect",
      userId: "u1",
      makeEphemeral,
    });
    assert.equal(key, "home-internal:u1:reflect");
  });

  test("scope=land + purpose builds land-internal key (no userId/rootId)", () => {
    const { key } = resolveInternalAiSessionKey({
      scope: "land", purpose: "digest",
      makeEphemeral,
    });
    assert.equal(key, "land-internal:digest");
  });

  test("scope=tree without rootId throws", () => {
    assert.throws(
      () => resolveInternalAiSessionKey({ scope: "tree", purpose: "x", userId: "u1", makeEphemeral }),
      /scope='tree' requires rootId and purpose/,
    );
  });

  test("scope=tree without purpose throws", () => {
    assert.throws(
      () => resolveInternalAiSessionKey({ scope: "tree", rootId: "r1", userId: "u1", makeEphemeral }),
      /scope='tree' requires rootId and purpose/,
    );
  });

  test("scope=home without purpose throws", () => {
    assert.throws(
      () => resolveInternalAiSessionKey({ scope: "home", userId: "u1", makeEphemeral }),
      /scope='home' requires/,
    );
  });

  test("scope=land without purpose throws", () => {
    assert.throws(
      () => resolveInternalAiSessionKey({ scope: "land", makeEphemeral }),
      /scope='land' requires purpose/,
    );
  });

  test("unknown scope throws", () => {
    assert.throws(
      () => resolveInternalAiSessionKey({ scope: "bogus", purpose: "x", makeEphemeral }),
      /unknown scope "bogus"/,
    );
  });

  test("default (no aiSessionKey, no scope) produces ephemeral non-persistent key", () => {
    const { key, persist } = resolveInternalAiSessionKey({ makeEphemeral });
    assert.equal(key, "ephemeral:UUID");
    assert.equal(persist, false);
  });

  test("default ephemeral is unique per call", () => {
    let counter = 0;
    const factory = () => `uuid-${++counter}`;
    const a = resolveInternalAiSessionKey({ makeEphemeral: factory });
    const b = resolveInternalAiSessionKey({ makeEphemeral: factory });
    assert.notEqual(a.key, b.key);
    assert.equal(a.persist, false);
    assert.equal(b.persist, false);
  });

  test("extra sanitizer strips disallowed characters", () => {
    const { key } = resolveInternalAiSessionKey({
      scope: "tree", purpose: "p", extra: "hello world/bad",
      userId: "u", rootId: "r",
      makeEphemeral,
    });
    // spaces and slashes stripped, colons preserved
    assert.equal(key, "tree-internal:r:p:helloworldbad");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: the CLI-abort bug
// ─────────────────────────────────────────────────────────────────────────

describe("regression: per-device decoupling", () => {
  test("CLI and browser on same user+tree get different keys (no session sharing)", () => {
    const cli = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "cli" });
    const browser = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "web" });
    assert.notEqual(cli, browser);
    // This is the invariant that prevents the browser's `endSession` from
    // aborting the CLI's in-flight chat (and vice versa).
  });

  test("Two Telegram chats for same user+tree get different keys", () => {
    const chatA = buildUserAiSessionKey({ userId: "owner", zone: "tree", rootId: "r1", device: "telegram:111" });
    const chatB = buildUserAiSessionKey({ userId: "owner", zone: "tree", rootId: "r1", device: "telegram:222" });
    assert.notEqual(chatA, chatB);
  });

  test("Internal lane key never collides with user key (prefix guarantees isolation)", () => {
    const userKey = buildUserAiSessionKey({ userId: "u1", zone: "tree", rootId: "r1", device: "web" });
    const { key: internalKey } = resolveInternalAiSessionKey({
      scope: "tree", purpose: "reflect", userId: "u1", rootId: "r1",
      makeEphemeral: () => "x",
    });
    assert.ok(userKey.startsWith("user:"));
    assert.ok(internalKey.startsWith("tree-internal:"));
    assert.notEqual(userKey, internalKey);
  });
});
