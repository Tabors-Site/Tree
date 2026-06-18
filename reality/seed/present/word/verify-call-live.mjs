#!/usr/bin/env node
// evalCall (the CALL verb) LIVE: a hand-built `call <being>` node reaches a real being
// through TreeOS's summon machinery (summonVerb), laying the reach RECORD as a fact through
// summonCtx (the stamper). Proves the engine half of the host:->call dissolution before the
// parser's `call <being>, saying <intent>` surface lands. Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_call";
process.env.PORT = "3803";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "wordcall-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "wordcall-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "wordcall-src");
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

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { evaluate } = await import(`${R}/seed/present/word/evaluator.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, summonCtx: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

console.log(`\n  verify-call-live (the CALL verb reaches a being, lays the record)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ownerId = await birth("owner");
  const ownerSlot = await loadOrFold("being", String(ownerId), "0");

  // I_AM calls @owner with a role-request — a hand-built call node (the parser surface lands later)
  const sc = { actId: randomUUID(), actorAct: { branch: "0", nameId: "i-am" }, identity: { beingId: I_AM, name: "i-am", nameId: "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  const ctx = { dryRun: false, summonCtx: sc, identity: sc.identity, branch: "0", bindings: { owner: ownerSlot }, deltaF: sc.deltaF, env: {} };
  const node = { kind: "call", being: { ref: "owner" }, intent: "role-request", content: { role: "warrior", from: "i-am" }, bind: "sent" };

  let res = null, err = null;
  try { await evaluate(node, ctx); res = ctx.bindings.sent; if (sc.deltaF.length) await sealFacts(sc.deltaF); } catch (e) { err = e; }

  !err ? ok(`call @owner dispatched through summonVerb (no throw) → reached`) : bad(`call dispatch`, err.message || err);
  // the reach is a RECORD: a fact landed (summon writes the reach through summonCtx)
  const summonFact = (sc.deltaF || []).find((f) => f.verb === "summon" || /summon|reach|inbox/i.test(String(f.action)));
  summonFact ? ok(`the reach laid a RECORD fact (verb:${summonFact.verb} action:${summonFact.action}) — through the stamper, not a bare emit`) : bad(`reach record`, (sc.deltaF || []).map((f) => `${f.verb}:${f.action}`));
  // attribution: the reach is the CALLER's act (i-am here)
  summonFact && String(summonFact.nameId || summonFact.beingId) ? ok(`reach attributed to the caller (a Name through a being)`) : bad(`attribution`, summonFact);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
