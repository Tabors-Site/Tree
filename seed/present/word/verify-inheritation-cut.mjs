#!/usr/bin/env node
// grant-inheritation / revoke-inheritation (the .word pair), LIVE via doVerb with ZERO stubs. The
// CONTROL strand (the `name`-required gate + the return) is .word; the acting-Name resolve, the
// grantable-Name check, and the authority gate are the host see-op resolve-inheritation
// (inheritationHost.js). Proves: each lands ONE do:<op> fact carrying params.name on the POSITION
// being's reel, and the refuses carry their messages/codes. Acts as I (universal authority).
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_inheritation_cut-" + process.pid);
process.env.PORT = "3796";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "inherit-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "inheritcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "inheritcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
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

console.log(
  `\n  verify-inheritation-cut (REAL grant/revoke-inheritation via doVerb → runOpWord)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub being)");
    process.exit(1);
  }
  // A declared Name to grant to: cherub's trueName (declared at genesis, non-banished).
  const cslot = await loadOrFold("being", String(cherub.id), "0");
  const grantee = cslot?.state?.trueName || null;
  if (!grantee) {
    console.log("  FATAL: cherub has no trueName to use as a declared grantee");
    process.exit(1);
  }
  const position = { kind: "being", id: String(cherub.id) };

  resolveAbleWord("inheritation", "grant-inheritation") &&
  resolveAbleWord("inheritation", "revoke-inheritation")
    ? ok("grant/revoke-inheritation.word resolve through the bridge (self-registered)")
    : bad("resolve", "null");

  // ── 1. grant → one do:grant-inheritation fact, params.name = grantee, on the position reel ──
  const a = await doOp(position, "grant-inheritation", { name: grantee });
  const fa = factOf(a.deltaF, "grant-inheritation");
  fa && fa.params?.name === grantee && String(fa.of?.id) === String(cherub.id)
    ? ok(`grant → do:grant-inheritation { name } on the position being's reel`)
    : bad("grant fact", a.refused?.message || { fact: fa && { name: fa.params?.name, of: fa.of }, result: a.result });
  a.result?.grantedBy === "i-am" || a.result?.grantedBy === String(I)
    ? ok(`result.grantedBy = the acting Name (i-am)`)
    : bad("grantedBy", a.result?.grantedBy);

  // ── 2. revoke → one do:revoke-inheritation fact, params.name = grantee ──
  const b = await doOp(position, "revoke-inheritation", { name: grantee });
  const fb = factOf(b.deltaF, "revoke-inheritation");
  fb && fb.params?.name === grantee && String(fb.of?.id) === String(cherub.id)
    ? ok(`revoke → do:revoke-inheritation { name } on the position being's reel`)
    : bad("revoke fact", b.refused?.message || { fact: fb && { name: fb.params?.name, of: fb.of } });

  // ── 3. refuse: grant with no name ──
  const c = await doOp(position, "grant-inheritation", {});
  c.refused && /requires params\.name/i.test(c.refused.message) && !factOf(c.deltaF, "grant-inheritation")
    ? ok(`grant with no name → refuse "requires params.name", NO fact`)
    : bad("no-name refuse", c.refused?.message || c.result);

  // ── 4. refuse: grant to a non-declared Name ──
  const d = await doOp(position, "grant-inheritation", { name: "not-a-real-declared-name" });
  d.refused && /not a declared Name/i.test(d.refused.message) && !factOf(d.deltaF, "grant-inheritation")
    ? ok(`grant to undeclared Name → refuse "not a declared Name", NO fact`)
    : bad("undeclared refuse", d.refused?.message || d.result);

  // ── 5. revoke with no name still refuses (the .word gate, before the authority read) ──
  const e = await doOp(position, "revoke-inheritation", {});
  e.refused && /requires params\.name/i.test(e.refused.message) && !factOf(e.deltaF, "revoke-inheritation")
    ? ok(`revoke with no name → refuse "requires params.name", NO fact`)
    : bad("revoke no-name refuse", e.refused?.message || e.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
