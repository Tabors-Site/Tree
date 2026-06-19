#!/usr/bin/env node
// credential-detach + credential-attach (the two pure-gate credential slices), LIVE
// through the bridge with ZERO stubs. detach is self-only (or I_AM); attach is
// being-parent-only (or I_AM). Both lay NO fact of their own — the detach/attach RECORD
// is the dispatcher's audit fact — so the .word only gates + returns. Proves the gates
// fire correctly (allow the right caller, refuse the wrong one with FORBIDDEN). Full
// begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_detachattach_cut";
process.env.PORT = "3795";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "detachattach-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "detachattachcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "detachattachcut-src");
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
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { resolveRoleWord, runRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { credentialHostEnv } = await import(`${R}/seed/materials/being/credentialHost.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};
const run = async (op, caller, target) => {
  const sc = { actId: randomUUID(), actorAct: { branch: "0", by: "i-am" }, identity: { beingId: String(caller) }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const ir = resolveRoleWord("credential", op);
    const { result } = await runRoleWord(ir, { moment: sc, branch: "0", trigger: { caller: String(caller), target: String(target), branch: "0" }, env: { host: credentialHostEnv() } });
    return { result, refused: null };
  } catch (e) { return { result: null, refused: e }; }
};

console.log(`\n  verify-creddetachattach-cut (detach + attach gates via the bridge)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  resolveRoleWord("credential", "credential-detach") ? ok(`credential-detach.word resolves`) : bad(`detach resolves`);
  resolveRoleWord("credential", "credential-attach") ? ok(`credential-attach.word resolves`) : bad(`attach resolves`);

  const victim = await birth("victim");      // parentBeingId = cherub
  const stranger = await birth("stranger");

  // ── detach: self-only ──
  const d1 = await run("credential-detach", victim, victim);
  d1.result?.detached === true && d1.result?.targetBeingId === String(victim) ? ok(`detach SELF (caller === target) → detached:true`) : bad(`detach self`, d1.refused?.message || d1.result);
  const d2 = await run("credential-detach", stranger, victim);
  d2.refused && /self-only/i.test(d2.refused.message) ? ok(`detach by a STRANGER → refuse "self-only" [code ${d2.refused.code}]`) : bad(`detach stranger`, d2.refused?.message || d2.result);

  // ── attach: being-parent-only (findBeingParent(victim) === cherub) ──
  const a1 = await run("credential-attach", cherub.id, victim);
  a1.result?.attached === true && a1.result?.targetBeingId === String(victim) ? ok(`attach by the BEING-PARENT (@cherub) → attached:true`) : bad(`attach parent`, a1.refused?.message || a1.result);
  const a2 = await run("credential-attach", stranger, victim);
  a2.refused && /being-parent-only/i.test(a2.refused.message) ? ok(`attach by a STRANGER → refuse "being-parent-only" [code ${a2.refused.code}]`) : bad(`attach stranger`, a2.refused?.message || a2.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
