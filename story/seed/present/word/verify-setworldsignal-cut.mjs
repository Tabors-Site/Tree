#!/usr/bin/env node
// set-world-signal (able-manager.word), LIVE through the bridge with ZERO stubs. The
// CONTROL strand (the two kebab gates + the not-initialized guard) is .word; the
// validators + the value coercion + the story-root set-space emit are host: escapes
// wired by able-managerHost.js. Proves: a signal publishes to the story root
// (qualities.world.<ns>.<key>, one do:set-space fact, value coerced) and the kebab
// refusal. CALLER mode (no `through`) — the publish attributes to the actor. Full
// begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_worldsignal_cut-" + process.pid);
process.env.PORT = "3790";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "worldsignal-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "worldsignalcut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "worldsignalcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined)
    console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
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
const getPath = (o, p) =>
  p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

// drive the REAL set-world-signal op via doVerb → the cut handler → able-manager.word
async function publish(namespace, key, value) {
  const branch = "0";
  const sc = {
    actId: randomUUID(),
    actorAct: { branch, history: branch, by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(
      { kind: "space", id: String(getSpaceRootId()) },
      "set-world-signal",
      { namespace, key, value },
      { identity: ident, moment: sc, currentHistory: "0" },
    );
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
}

console.log(
  `\n  verify-setworldsignal-cut (REAL set-world-signal op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  await poll(() => findByName("being", "cherub", "0")); // genesis settled
  const ir = resolveAbleWord("able-manager", "set-world-signal");
  ir
    ? ok(`able-manager.word resolves through the bridge (self-registered)`)
    : bad(`resolves`, "null");

  // ── 1. publish a signal → published, value coerced ──
  const p = await publish("harmony", "tick.alive", "true");
  p.result?.published === true &&
  p.result?.namespace === "harmony" &&
  p.result?.key === "tick.alive" &&
  p.result?.value === true
    ? ok(
        `publish harmony/tick.alive="true" → published:true, value coerced to boolean true`,
      )
    : bad(`publish`, p.refused?.message || p.result);

  // ── 2. exactly one do:set-space fact at the world field ──
  const sig = (p.deltaF || []).filter(
    (f) =>
      f.act === "set-space" &&
      f.params?.field === "qualities.world.harmony.tick.alive",
  );
  sig.length === 1 && sig[0].params?.value === true
    ? ok(
        `one do:set-space fact at qualities.world.harmony.tick.alive = true (the lone WORLD fact)`,
      )
    : bad(
        `fact`,
        (p.deltaF || []).map((f) => `${f.act}:${f.params?.field}`),
      );

  // ── 3. the story root folds the signal ──
  const root = await loadOrFold("space", String(getSpaceRootId()), "0");
  getPath(root?.state, "qualities.world.harmony.tick.alive") === true
    ? ok(`story root folds qualities.world.harmony.tick.alive === true`)
    : bad(`fold`, getPath(root?.state, "qualities.world.harmony"));

  // ── 4. a non-kebab namespace → refuse, no fact ──
  const r = await publish("Bad NS", "k", "1");
  r.refused &&
  /kebab-case/i.test(r.refused.message) &&
  !(r.deltaF || []).some((f) => f.act === "set-space")
    ? ok(`publish "Bad NS" → refuse "must be kebab-case", NO fact`)
    : bad(`refuse`, r.refused?.message || r.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
