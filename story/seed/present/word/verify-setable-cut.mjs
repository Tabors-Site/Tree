#!/usr/bin/env node
// set-able / delete-able (the able-manager .word pair), LIVE via doVerb with ZERO stubs. WORD-SOLE:
// the .word control strand + the host see (author-live-able / remove-live-able) doing the manifest
// write + hot-register, reusing the SAME addManifestChild / registerAble the handlers called. Proves:
// set-able lands a do:set-able audit fact on {space, name}, hot-registers the able (getAble sees it),
// and delete-able removes it (getAble gone) + lands do:delete-able; the gates refuse (bad name, not
// registered). Acts as I. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_setable_cut-" + process.pid);
process.env.PORT = "3801";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "setable-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "setablecut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setablecut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { getAble } = await import(`${R}/seed/present/ables/registry.js`);
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
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    return { result: null, deltaF: sc.deltaF, refused: e };
  }
}
const factOf = (deltaF, act) => (deltaF || []).find((f) => f.act === act);

console.log(`\n  verify-setable-cut (REAL set-able / delete-able via doVerb → runOpWord)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
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
  const ABLE = "verifyable";

  resolveAbleWord("able-manager", "set-able") && resolveAbleWord("able-manager", "delete-able")
    ? ok("set-able.word / delete-able.word resolve through the bridge (self-registered)")
    : bad("resolve", "null");

  // ── 1. set-able → do:set-able on {space, name} + the able hot-registers ──
  const a = await doOp(target, "set-able", { name: ABLE, canDo: "greet\nwave" });
  const fa = factOf(a.deltaF, "set-able");
  fa && String(fa.of?.id) === ABLE && String(fa.of?.kind) === "space"
    ? ok(`set-able → do:set-able audit fact on {space, "${ABLE}"}`)
    : bad("set fact", a.refused?.message || (fa && { of: fa.of }) || a.result);
  a.result?.written === true && a.result?.hotRegistered === true
    ? ok(`result: written:true, hotRegistered:true`)
    : bad("set result", a.result);
  {
    const able = getAble(ABLE);
    able && able.origin === "live" && able.can?.some((e) => e.verb === "do" && e.word === "greet")
      ? ok(`@able-manager hot-registered "${ABLE}" (origin:live, canDo greet) — live without restart`)
      : bad("hot-register", able);
  }

  // ── 2. re-author (replace) → still one able, updated ──
  const a2 = await doOp(target, "set-able", { name: ABLE, canSee: "tree:something" });
  const able2 = getAble(ABLE);
  a2.result?.written === true && able2?.can?.some((e) => e.verb === "see")
    ? ok(`re-author "${ABLE}" → overwrites (canSee now present)`)
    : bad("re-author", a2.refused?.message || able2);

  // ── 3. refuse: bad name (not kebab-case) ──
  const b = await doOp(target, "set-able", { name: "Bad Name" });
  b.refused && /kebab-case/i.test(b.refused.message) && !factOf(b.deltaF, "set-able")
    ? ok(`set-able "Bad Name" → refuse "kebab-case", NO fact`)
    : bad("bad-name refuse", b.refused?.message || b.result);

  // ── 4. delete-able → do:delete-able + the able unregisters ──
  const c = await doOp(target, "delete-able", { name: ABLE });
  const fc = factOf(c.deltaF, "delete-able");
  fc && String(fc.of?.id) === ABLE
    ? ok(`delete-able → do:delete-able audit fact on {space, "${ABLE}"}`)
    : bad("delete fact", c.refused?.message || (fc && { of: fc.of }));
  getAble(ABLE) == null
    ? ok(`@able-manager unregistered "${ABLE}" (getAble gone)`)
    : bad("unregister", getAble(ABLE));

  // ── 5. refuse: delete a non-registered able ──
  const d = await doOp(target, "delete-able", { name: "nope-not-here" });
  d.refused && /not registered/i.test(d.refused.message) && !factOf(d.deltaF, "delete-able")
    ? ok(`delete-able "nope-not-here" → refuse "not registered", NO fact`)
    : bad("not-registered refuse", d.refused?.message || d.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
