#!/usr/bin/env node
// verify-word-to-store-live — the spacebar, to STORE, for real.
//
// A being speaks a Word of THREE deeds ("I make notebook. I make journal. I make ledger.").
// runWordToStore stamps each as its OWN moment to store, so the chain grows by 3: three acts,
// three distinct actIds, ONE create-space fact under each. Not 3 facts crammed into one act.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_wordtostore";
process.env.PORT = "3837"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "wordtostore-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "wordtostore-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "wordtostore-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(`${R}/seed/present/word/ableWordRegistry.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const { default: Act } = await import(`${R}/seed/past/act/act.js`);
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-word-to-store-live (a 3-deed Word → 3 moments → 3 commits)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  // Birth a being to speak the Word.
  let speaker = null;
  await withIAmAct("birth speaker", async (m) => {
    const b = await birthBeing({ spec: { name: "scribe", parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultAble: "global" }, identity: I_AM, moment: m, history: "0" });
    speaker = b.beingId;
  });
  await new Promise((r) => setTimeout(r, 1000));
  const slot = await loadOrFold("being", String(speaker), "0");
  const position = slot?.position || slot?.state?.homeSpace || cherub.state?.homeSpace;
  position ? ok(`speaker born, stands at a position (${String(position).slice(0, 8)})`) : bad("speaker has a position", { slot });

  // The Word: THREE complete deeds — three words, three spaces.
  const ir = parse("I make notebook.\nI make journal.\nI make ledger.");
  const actNodes = (Array.isArray(ir) ? ir : [ir]).filter((n) => n.kind === "act");
  actNodes.length === 3 ? ok(`the Word parsed to 3 acts (3 deeds)`) : bad("3 acts parsed", actNodes.map((n) => n.act));

  // BEFORE: the speaker's acts + create-space facts under it.
  const actsBefore = await Act.countDocuments({ through: String(speaker) });
  const facetsBefore = await Fact.countDocuments({ act: "create-space", through: String(speaker) });

  // RUN: each deed its own moment, to store.
  await runWordToStore(ir, { beingId: String(speaker), name: "scribe", history: "0", position: String(position) });
  await new Promise((r) => setTimeout(r, 1500));

  // AFTER: the chain grew by 3 acts; 3 create-space facts landed.
  const actsAfter = await Act.countDocuments({ through: String(speaker) });
  const facetsAfter = await Fact.countDocuments({ act: "create-space", through: String(speaker) });
  (actsAfter - actsBefore === 3)
    ? ok(`the chain GREW BY 3 acts (${actsBefore} → ${actsAfter}) — one moment per deed`)
    : bad(`chain grew by 3`, { actsBefore, actsAfter });
  (facetsAfter - facetsBefore === 3)
    ? ok(`3 create-space facts landed under the speaker`)
    : bad(`3 facts landed`, { facetsBefore, facetsAfter });

  // Each deed is its OWN act: the 3 facts carry 3 DISTINCT actIds, not one shared.
  const facts = await Fact.find({ act: "create-space", through: String(speaker) }).select("actId").lean();
  const actIds = [...new Set(facts.map((f) => String(f.actId)))];
  (actIds.length >= 3)
    ? ok(`the 3 facts carry 3 DISTINCT actIds — each deed its own moment, not a run-on`)
    : bad(`3 distinct actIds`, { actIds });

  // One act, one fact: each of those actIds frames exactly ONE fact.
  let allOne = true;
  for (const aid of actIds.slice(0, 3)) {
    const n = await Fact.countDocuments({ actId: aid });
    if (n !== 1) { allOne = false; break; }
  }
  allOne ? ok(`each act frames exactly ONE fact (one word, one commit)`) : bad("one fact per act", "an actId framed ≠ 1 fact");

  // The three spaces exist, by name (the deeds reached store, not just the chain).
  const names = ["notebook", "journal", "ledger"];
  let madeAll = true;
  for (const nm of names) { const s = await findByName("space", nm, "0"); if (!s) { madeAll = false; break; } }
  madeAll ? ok(`all three spaces (notebook, journal, ledger) exist in store`) : bad("three spaces in store", "a named space missing");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
