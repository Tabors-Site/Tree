#!/usr/bin/env node
// delete-pointer (delete-pointer.word), LIVE through the bridge with ZERO stubs. The
// set-pointer sibling. The CONTROL strand (caller / valid-name / non-reserved /
// .branches-resolved gates) is .word; the heaven read + the lone pointer-map set-space
// stay host. Proves: a pointer is removed (the .branches map drops it), an absent pointer
// is a no-op (alreadyAbsent), a reserved pointer is refused, and a bad name is refused —
// each with its exact code (refuse-code form). CALLER mode. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_delpointer_cut";
process.env.PORT = "3796";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "delpointer-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "delpointercut-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "delpointercut-src");
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
const drive = async (op, params) => {
  const sc = { actId: randomUUID(), actorAct: { branch: "0", by: "i-am" }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb({ kind: "being", id: String(cherub.id) }, op, params, { identity: ident, moment: sc });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
};

console.log(`\n  verify-deletepointer-cut (REAL delete-pointer op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  resolveRoleWord("branch-manager", "delete-pointer") ? ok(`delete-pointer.word resolves through the bridge`) : bad(`resolves`);

  // seed a pointer to delete
  await drive("set-pointer", { name: "release-x", canonical: "1a" });

  // ── 1. delete an existing pointer → deleted:true, the map drops it ──
  const d = await drive("delete-pointer", { name: "release-x" });
  d.result?.deleted === true && d.result?.name === "release-x" ? ok(`delete release-x → deleted:true`) : bad(`delete`, d.refused?.message || d.result);
  const map = await readPointers();
  !Object.prototype.hasOwnProperty.call(map || {}, "release-x") ? ok(`.branches map no longer has release-x`) : bad(`map`, map);

  // ── 2. delete an ABSENT pointer → no-op, alreadyAbsent (no fact) ──
  const d2 = await drive("delete-pointer", { name: "ghostptr" });
  d2.result?.deleted === false && d2.result?.alreadyAbsent === true && !(d2.deltaF || []).some((f) => f.act === "set-space")
    ? ok(`delete an ABSENT pointer → deleted:false, alreadyAbsent:true, NO set-space fact`)
    : bad(`absent`, d2.refused?.message || d2.result);

  // ── 3. delete a RESERVED pointer (#main) → refuse, exact code ──
  const d3 = await drive("delete-pointer", { name: "main" });
  d3.refused && /reserved/i.test(d3.refused.message) && d3.refused.code === "FORBIDDEN" ? ok(`delete "main" (reserved) → refuse "reserved" [FORBIDDEN]`) : bad(`reserved`, d3.refused?.message || d3.result);

  // ── 4. delete a structurally-invalid name → refuse, exact code ──
  const d4 = await drive("delete-pointer", { name: "1bad" });
  d4.refused && /invalid/i.test(d4.refused.message) && d4.refused.code === "INVALID_INPUT" ? ok(`delete "1bad" (invalid) → refuse "invalid" [INVALID_INPUT]`) : bad(`invalid`, d4.refused?.message || d4.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
