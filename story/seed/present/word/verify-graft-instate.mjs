#!/usr/bin/env node
// verify-graft-instate — a focused, CURRENT gate for the applyGraft reel-instate path (the core
// being extracted into past/reel/instateReel.js). Boots, captures a real being's reel, then
// applyGrafts it back into the SAME story: the being already exists, so this exercises the full
// gate ladder (scope → integrity → dedup → reel-divergence → branch-collision → verifyReel) with
// mode "idempotent" (0 new facts). A partial genesis-prefix re-apply does the same on a slice.
// If both stay green before AND after the extraction, applyGraft's reel path is byte-equivalent.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_graft_instate";
process.env.PORT = "3849"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "graftinst-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "graftinst-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "graftinst-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { getIAmBeingId } = await import(`${R}/seed/sprout.js`);
const { captureGraft, capturePartialGraft, applyGraft } = await import(`${R}/seed/materials/publish/graft.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240)); };
console.log("\n  verify-graft-instate (applyGraft reel-instate path)\n");
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const beingId = String(cherub.id);
  const operatorBeingId = getIAmBeingId();
  ok(`booted; target being cherub ${beingId.slice(0, 10)}…`);

  // 1. Capture the being's full reel, then re-apply into the same story → idempotent.
  const cap = await captureGraft({ beingId, capturedBy: operatorBeingId, returnOnly: true });
  const bundle = cap.bundle ?? cap;
  (bundle && Array.isArray(bundle.facts) && bundle.facts.length > 0)
    ? ok(`captureBeingGraft → ${bundle.facts.length} fact(s), ${(bundle.reelHeads || []).length} reelHead(s)`)
    : bad("captureBeingGraft produced no facts", { facts: bundle?.facts?.length });

  const res = await applyGraft(bundle, { operatorBeingId });
  (res && res.beingId === beingId && res.mode === "idempotent" && res.counts?.facts === 0 && res.verified)
    ? ok(`applyGraft re-apply: mode=${res.mode}, +${res.counts.facts} facts, verified=${JSON.stringify(res.verified)}`)
    : bad("applyGraft idempotent re-apply unexpected", res);

  // 1b. INSERT path: delete cherub's reel+act rows, then re-apply → mode "create" inserts them
  //     back verbatim and verifies. Exercises the landed[] insert + verifyReel + graftRoot.
  const Fact = (await import(`${R}/seed/past/fact/fact.js`)).default;
  const { default: Act } = await import(`${R}/seed/past/act/act.js`);
  const ReelHead = (await import(`${R}/seed/past/reel/reelHead.js`)).default;
  const { default: ActHead } = await import(`${R}/seed/past/act/actHead.js`);
  await Fact.deleteMany({ "of.kind": "being", "of.id": beingId });
  await Act.deleteMany({ through: beingId });
  await ReelHead.deleteMany({ id: beingId, type: "being" });
  await ActHead.deleteMany({ beingId });
  const ins = await applyGraft(bundle, { operatorBeingId });
  (ins && ins.mode === "create" && ins.counts?.facts === bundle.facts.length && ins.verified?.chain)
    ? ok(`applyGraft INSERT (after delete): mode=${ins.mode}, +${ins.counts.facts} facts, verified`)
    : bad("applyGraft insert/create unexpected", ins);

  // 2. A partial genesis-prefix slice captures a coherent sub-range. (Don't re-apply it into the
  //    full story — a slice's graftRoot is for the slice, not the full reel already present.)
  const part = await capturePartialGraft({ beingId, mechanism: "genesis-prefix", cutoffSeq: 2, capturedBy: operatorBeingId });
  const pBundle = part.bundle ?? part;
  (pBundle && Array.isArray(pBundle.facts) && pBundle.facts.length >= 1 && pBundle.facts.length <= 2)
    ? ok(`capturePartialGraft genesis-prefix → ${pBundle.facts.length}-fact slice (coherent)`)
    : bad("partial capture unexpected", { facts: pBundle?.facts?.length });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 5).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
