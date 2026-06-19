#!/usr/bin/env node
// verify-dispatch-fold . the DO verb resolves an op from the FOLD, not the operations Map.
// bindWord an op + register its bundled handler by ref, then doVerb it: doVerb misses the Map,
// folds the word's declare-word facts, resolves the handler ref, and runs it through the normal
// gates and auto-Fact. Proves the fold drives behavior, additively (no existing op is touched).
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_dispatchfold";
process.env.PORT = "3831"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "dispatchfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "dispatchfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "dispatchfold-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, registerHostHandler } = await import(`${R}/seed/present/word/wordStore.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getOperation } = await import(`${R}/seed/ibp/operations.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-dispatch-fold (DO resolves an op from the fold, not the Map)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  // the bundled handler the host holds by ref (the code matter, seed side)
  let ranFromFold = false;
  registerHostHandler("seed:test-fold-op", async (ctx) => { ranFromFold = true; return { ok: true, echo: ctx.params?.x ?? null }; });

  // bind the word: a declare-word fact whose do-answer points at the ref. NOT in the operations Map.
  await bindWord("test-fold-op", { ownerExtension: "seed", do: { ref: "seed:test-fold-op" }, targets: ["being"], factAction: "test-fold-op" });
  await new Promise((r) => setTimeout(r, 500));

  // it is absent from the operations Map, so a successful DO proves the fold path ran
  (!getOperation("test-fold-op")) ? ok(`"test-fold-op" is absent from the operations Map (fold-only)`) : bad(`should be Map-absent`, "found in Map");

  // DO it through an I_AM act: doVerb misses the Map, folds the word, resolves the ref, runs it
  const iam = String(I_AM);
  const targetId = String(cherub.id ?? cherub._id);
  let result;
  await withIAmAct("test the fold op", async (moment) => {
    result = await doVerb(targetId, "test-fold-op", { x: 42 }, { moment, identity: { name: "i-am", beingId: iam, nameId: iam }, currentBranch: "0" });
  });
  (ranFromFold === true) ? ok(`doVerb ran the handler resolved from the FOLD (not the Map)`) : bad(`handler ran from fold`, { ranFromFold });
  (result && result.ok === true && result.echo === 42) ? ok(`the fold handler got ctx + returned its result (echo=42)`) : bad(`result`, result);

  // and it laid its fact through the normal do auto-Fact path (same audit as a Map op)
  const f = await pollFor(() => Fact.findOne({ verb: "do", act: "test-fold-op" }).lean(), (v) => !!v);
  (f) ? ok(`the fold-driven op laid its do:test-fold-op fact (same audit path)`) : bad(`fact laid`, "no test-fold-op fact");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
