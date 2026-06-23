#!/usr/bin/env node
// verify-cognition-cut-live — the spacebar THROUGH the cognition path.
//
// A scripted being decides a 2-deed Word ("I make notebook. I make journal."). The cutover:
// runReactorMoment runs those deeds via runWordToStore — each its OWN moment to store — and the
// cognition-moment itself seals NOTHING (returns SEE). Proves: SEE + the chain grew by 2 (two
// distinct acts, one fact each), both spaces real in store. The cognition-moment is the decision;
// the deeds are the acts.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../../..");
const DB = "mongodb://localhost:27017/story_cognitioncut";
process.env.PORT = "3841"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "cogcut-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "cogcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "cogcut-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { setCurrentSpace, getCurrentSpace } = await import(`${R}/seed/materials/being/position.js`);
const { runReactorMoment } = await import(`${R}/seed/present/cognition/scripted/reactor.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const { default: Act } = await import(`${R}/seed/past/act/act.js`);
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-cognition-cut-live (a scripted being's Word → SEE + N deed-moments)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  let being = null;
  await withIAmAct("birth reactor being", async (m) => {
    const b = await birthBeing({ spec: { name: "reactorbeing", parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultAble: "global" }, identity: I_AM, moment: m, history: "0" });
    being = b.beingId;
  });
  await new Promise((r) => setTimeout(r, 800));
  const slot = await loadOrFold("being", String(being), "0");
  const position = slot?.position || slot?.state?.homeSpace || cherub.state?.homeSpace;

  // The being must stand somewhere: runReactorMoment → runWordToStore reads getCurrentSpace
  // internally (create-space raises under it). Place it if birth didn't.
  if (!getCurrentSpace(String(being))) {
    await withIAmAct("place reactor being", async (m) => { await setCurrentSpace(String(being), String(position), m); });
    await new Promise((r) => setTimeout(r, 400));
  }
  const here = getCurrentSpace(String(being));
  here ? ok(`being stands at a position (${String(here).slice(0, 8)})`) : bad(`getCurrentSpace set`, { position });

  // baseline AFTER all setup
  const actsBefore = await Act.countDocuments({ through: String(being) });
  const facetsBefore = await Fact.countDocuments({ act: "create-space", through: String(being) });

  // The scripted cognition: a trigger that fires on the complete face and decides a 2-deed Word.
  const triggers = [{ when: () => true, then: () => "I make notebook.\nI make journal." }];
  const innerFace = { position: { name: "home" }, able: "global", capabilities: { canDo: ["create-space"] }, blocks: [] };
  const res = await runReactorMoment(triggers, { able: { name: "global" }, moment: { innerFace }, beingId: String(being), username: "reactorbeing", history: "0" });
  await new Promise((r) => setTimeout(r, 1500));

  (res?.kind === "see")
    ? ok(`the cognition returned SEE — the cognition-moment seals nothing of its own`)
    : bad(`cognition kind === see`, res);

  const actsAfter = await Act.countDocuments({ through: String(being) });
  const facetsAfter = await Fact.countDocuments({ act: "create-space", through: String(being) });
  (actsAfter - actsBefore === 2)
    ? ok(`the chain GREW BY 2 acts (${actsBefore} → ${actsAfter}) — one moment per deed, no run-on`)
    : bad(`chain grew by 2`, { actsBefore, actsAfter });
  (facetsAfter - facetsBefore === 2)
    ? ok(`2 create-space facts landed under the being (the deeds reached store)`)
    : bad(`2 create-space facts`, { facetsBefore, facetsAfter });

  const facts = await Fact.find({ act: "create-space", through: String(being) }).select("actId").lean();
  const actIds = [...new Set(facts.map((f) => String(f.actId)))];
  (actIds.length >= 2)
    ? ok(`the deeds carry DISTINCT actIds — each its own moment, the spacebar held`)
    : bad(`distinct actIds`, { actIds });

  const nb = await findByName("space", "notebook", "0"); const jr = await findByName("space", "journal", "0");
  (nb && jr) ? ok(`both spaces (notebook, journal) exist in store`) : bad(`spaces in store`, { nb: !!nb, jr: !!jr });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
