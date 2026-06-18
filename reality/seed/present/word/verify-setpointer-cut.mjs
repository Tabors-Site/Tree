#!/usr/bin/env node
// set-pointer (branch-manager.word), LIVE through the bridge with ZERO stubs. The CONTROL
// strand (caller gate, name/canonical validation, .branches resolution) is .word; the two
// regex validators + the heaven reads (readPointers / findPointersSpaceId) + the lone
// set-space onto .branches qualities.pointers are host: escapes wired by branchManagerHost.
// Proves: a pointer publishes, the map folds, a re-point returns the prior, and the refuses
// carry their exact codes (refuse-code form, now flowing through evalRefuse). CALLER mode.
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_setpointer_cut";
process.env.PORT = "3791";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "setpointer-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "setpointercut-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setpointercut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { readPointers } = await import(`${R}/seed/materials/branch/branchRegistry.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
// drive the REAL set-pointer op via doVerb → the cut handler → branch-manager.word
async function setPointer(name, canonical) {
  const branch = "0";
  const sc = { actId: randomUUID(), actorAct: { branch, nameId: "i-am" }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb({ kind: "being", id: String(cherub.id) }, "set-pointer", { name, canonical }, { identity: ident, summonCtx: sc });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
}

console.log(`\n  verify-setpointer-cut (REAL set-pointer op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ir = resolveRoleWord("branch-manager", "set-pointer");
  ir ? ok(`branch-manager.word resolves through the bridge (self-registered)`) : bad(`resolves`, "null");

  // ── 1. set a new pointer → set:true, previous:null ──
  const a = await setPointer("release-v2", "1a2");
  a.result?.set === true && a.result?.name === "release-v2" && a.result?.canonical === "1a2" && a.result?.previous === null
    ? ok(`set release-v2 → 1a2 → set:true, previous:null`)
    : bad(`set`, a.refused?.message || a.result);

  // ── 2. one do:set-space fact at qualities.pointers ──
  (a.deltaF || []).some((f) => f.action === "set-space" && f.params?.field === "qualities.pointers" && f.params?.value?.["release-v2"] === "1a2")
    ? ok(`one do:set-space at qualities.pointers carrying release-v2→1a2 (the lone WORLD fact)`)
    : bad(`fact`, (a.deltaF || []).map((f) => `${f.action}:${f.params?.field}`));

  // ── 3. the .branches heaven map folds the pointer ──
  const map = await readPointers();
  map?.["release-v2"] === "1a2" ? ok(`.branches pointers folds release-v2 → 1a2`) : bad(`fold`, map);

  // ── 4. re-point → previous is the prior canonical ──
  const b = await setPointer("release-v2", "7b3");
  b.result?.set === true && b.result?.previous === "1a2" ? ok(`re-point release-v2 → 7b3 → previous:"1a2" (the merge read the prior)`) : bad(`re-point`, b.refused?.message || b.result);

  // ── 5. invalid name → refuse, exact code (refuse-code form flowing) ──
  const c = await setPointer("1bad", "0");
  c.refused && /invalid/i.test(c.refused.message) && !(c.deltaF || []).some((f) => f.action === "set-space")
    ? ok(`set "1bad" → refuse "invalid" [code ${c.refused.code}], NO fact`)
    : bad(`refuse name`, c.refused?.message || c.result);
  c.refused?.code === "INVALID_INPUT" ? ok(`refuse carries code INVALID_INPUT (refuse-code form end-to-end)`) : bad(`refuse code`, c.refused?.code);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
