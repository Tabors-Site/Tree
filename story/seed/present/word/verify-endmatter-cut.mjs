#!/usr/bin/env node
// end-matter — the COLLAPSE exemplar (23.md): one act → ONE fact → the reducer folds the rest.
// Was: endMatter (née deleteMatterAndFile) hand-stamped TWO do:set-matter facts (spaceId=DELETED,
// beingId=DELETED) — the 2-field-object false shape — on top of the dispatcher's do:end-matter audit.
// Now: end-matter lays exactly ONE fact (do:end-matter); the matter reducer DERIVES the two
// consequences (absent-from-space + unheld), and isGone tombstones the slot. The being only ever
// sees "delete matter"; no blob is touched (content-addressed; casSweep owns lifecycle).
// Proves: a REAL end-matter via doVerb lays one end-matter fact, zero set-matter facts, and the
// matter folds gone. Full begin.js boot. Scratch DB, wiped.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url"; import { randomUUID } from "crypto";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_endmatter_cut";
process.env.PORT = "3841"; process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "endmatter-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "endmattercut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "endmattercut-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(SCRATCH_DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };
const runOp = async (target, op, params) => {
  const sc = { actId: randomUUID(), actorAct: { history: "0", by: ident.nameId }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  try {
    const res = await doVerb(target, op, params, { identity: ident, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) { if (e && (e.name === "IbpError" || e.code)) return { result: null, deltaF: sc.deltaF, refused: e }; throw e; }
};

console.log(`\n  verify-endmatter-cut (end-matter = one act → one fact → the reducer folds the rest)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const rootSpace = String(getSpaceRootId());

  const c = await runOp({ kind: "space", id: rootSpace }, "create-matter", { name: "doomed.txt", content: "bye\n" });
  const mId = String(c.result?.matterId);
  mId ? ok(`seeded a matter (doomed.txt)`) : bad(`seed`, c.refused?.message);
  const target = { kind: "matter", id: mId };

  // ── end it ──
  const r = await runOp(target, "end-matter", {});
  const facts = r.deltaF || [];

  // ── 1. exactly ONE fact, and it is the do:end-matter act ──
  const endFacts = facts.filter((f) => f.act === "end-matter");
  const setFacts = facts.filter((f) => f.act === "set-matter");
  (facts.length === 1 && endFacts.length === 1 && setFacts.length === 0)
    ? ok(`end-matter lays exactly ONE fact (do:end-matter); zero set-matter facts (the false shape is gone)`)
    : bad(`one fact`, { count: facts.length, acts: facts.map((f) => f.act) });

  // ── 2. that fact targets the matter, attributed to the caller ──
  const ef = endFacts[0];
  (ef && ef.verb === "do" && ef.of?.kind === "matter" && String(ef.of?.id) === mId && String(ef.through) === String(I_AM))
    ? ok(`the do:end-matter fact: of {matter, matterId}, through = caller (the being's "delete matter")`)
    : bad(`fact shape`, ef ? { verb: ef.verb, of: ef.of, through: ef.through } : "no end fact");

  // ── 3. the reducer FOLDS the consequences: absent-from-space + unheld ──
  const slot = await loadOrFold("matter", mId, "0");
  const goneOrDeleted = !slot || slot.tombstoned === true || slot.state?.spaceId === "__DELETED__" || /deleted/i.test(String(slot.state?.spaceId));
  goneOrDeleted
    ? ok(`the matter folds GONE — the reducer derived the ended state from the one fact (spaceId=DELETED → isGone → tombstoned)`)
    : bad(`folds gone`, { tombstoned: slot?.tombstoned, spaceId: slot?.state?.spaceId, beingId: slot?.state?.beingId });

  // ── 4. it stops resolving by name (the tombstone freed the name index) ──
  const stillNamed = await findByName("matter", "doomed.txt", "0");
  (!stillNamed || String(stillNamed.id ?? stillNamed._id) !== mId)
    ? ok(`ended matter no longer resolves by name (name index freed)`)
    : bad(`name freed`, { stillNamed: stillNamed?.id });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
