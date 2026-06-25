#!/usr/bin/env node
// set-config / delete-config (the .word pair), LIVE via doVerb with ZERO stubs. These are 5D
// NAME-ACTS on the library reel (verb:"name"), NOT world do-facts — do.js's runOpWord routes them
// via word.factVerb:"name" to runOpNameAct, which lays the name-act on the acting Name's reel and
// runs configHostEnv's after-name-act cache refresh. Proves: the config-set/config-delete name-acts
// land on the library reel carrying { key, value } / { key }, getStoryConfigValue reflects them
// (read-after-write), and the gates refuse. Acts as I. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_config_cut-" + process.pid);
process.env.PORT = "3798";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "config-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "configcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "configcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { getStoryConfigValue } = await import(`${R}/seed/storyConfig.js`);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const { resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
};
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

async function doOp(target, op, params) {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, { identity: ident, moment: sc, currentHistory: "0" });
    return { result: res?.result ?? res, refused: null };
  } catch (e) {
    return { result: null, refused: e };
  }
}
// A library-reel name-act fact (verb:"name") with this act + key.
const nameFact = (act, key) =>
  factFindOne({ verb: "name", act, "of.kind": "library", "params.key": key });

console.log(`\n  verify-config-cut (REAL set/delete-config via doVerb → runOpNameAct)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const rootId = await poll(() => {
    try {
      return getSpaceRootId();
    } catch {
      return null;
    }
  });
  if (!rootId) {
    console.log("  FATAL: genesis failed (no story root)");
    process.exit(1);
  }
  const target = { kind: "space", id: String(rootId) };

  resolveAbleWord("config", "set-config") && resolveAbleWord("config", "delete-config")
    ? ok("set-config.word / delete-config.word resolve through the bridge (self-registered)")
    : bad("resolve", "null");

  // ── 1. set-config → a config-set NAME-ACT on the library reel + cache reflects it ──
  const a = await doOp(target, "set-config", { key: "myKey", value: "v1" });
  a.result && !a.refused ? ok(`set-config myKey=v1 → ok`) : bad("set", a.refused?.message || a.result);
  getStoryConfigValue("myKey") === "v1"
    ? ok(`getStoryConfigValue("myKey")="v1" (after-name-act cache refresh)`)
    : bad("read-after-write", getStoryConfigValue("myKey"));
  {
    const f = await nameFact("config-set", "myKey");
    f && f.verb === "name" && f.params?.value === "v1" && String(f.of?.kind) === "library"
      ? ok(`config-set NAME-ACT (verb:"name") on the library reel carries { key, value }`)
      : bad("name fact", f && { verb: f.verb, of: f.of, params: f.params });
  }

  // ── 2. re-set → cache updates ──
  await doOp(target, "set-config", { key: "myKey", value: "v2" });
  getStoryConfigValue("myKey") === "v2" ? ok(`re-set myKey=v2 → cache="v2"`) : bad("re-set", getStoryConfigValue("myKey"));

  // ── 3. delete-config → cache drops + a config-delete name-act ──
  const c = await doOp(target, "delete-config", { key: "myKey" });
  c.result && !c.refused ? ok(`delete-config myKey → ok`) : bad("delete", c.refused?.message);
  getStoryConfigValue("myKey") == null
    ? ok(`getStoryConfigValue("myKey")=null after delete`)
    : bad("post-delete read", getStoryConfigValue("myKey"));
  {
    const f = await nameFact("config-delete", "myKey");
    f && f.verb === "name" && String(f.of?.kind) === "library"
      ? ok(`config-delete NAME-ACT on the library reel carries { key }`)
      : bad("delete name fact", f && { verb: f.verb, of: f.of });
  }

  // ── 4. refuse: no key ──
  const d = await doOp(target, "set-config", { value: "x" });
  d.refused && /key.*required/i.test(d.refused.message)
    ? ok(`set-config no key → refuse "key is required"`)
    : bad("no-key refuse", d.refused?.message || d.result);

  // ── 5. refuse: no value ──
  const e = await doOp(target, "set-config", { key: "k2" });
  e.refused && /value.*required/i.test(e.refused.message)
    ? ok(`set-config no value → refuse "value is required"`)
    : bad("no-value refuse", e.refused?.message || e.result);

  // ── 6. I (internal) MAY write a protected key (seedVersion) ──
  const g = await doOp(target, "set-config", { key: "seedVersion", value: "9.9.9" });
  g.result && !g.refused && getStoryConfigValue("seedVersion") === "9.9.9"
    ? ok(`I writes protected key seedVersion (internal carve-out) → ok`)
    : bad("protected internal", g.refused?.message || getStoryConfigValue("seedVersion"));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
