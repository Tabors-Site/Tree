#!/usr/bin/env node
// verify-name-ops-fold . the NAME verb resolves its ops from the FOLD, not the NAME_OPS Map.
// (1) the five seed NAME ops fold at genesis as kind:"nameop" words named "name:<op>"; (2)
// resolveNameOpFromFold returns each handler (the dispatch's read); (3) the NAME_OPS object is now
// only the load-time registration buffer (every op it lists resolves from the fold); (4) a SYNTHETIC
// name op -- bound to the fold + its handler registered but ABSENT from NAME_OPS -- dispatches through
// nameVerb and lays its name:<op> fact, proving the dispatch is fold-driven, additively. The NAME
// twin of verify-dispatch-fold. (I_AM's own bootstrap name:declare is a raw emitFact in sprout.js,
// never a nameVerb call, so it predates and grounds this fold and is untouched by the cutover.)
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_nameopsfold";
process.env.PORT = "3832"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "nameopsfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "nameopsfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, registerHostHandler, resolveNameOpFromFold, getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const { getNameOp, listNameOpNames } = await import(`${R}/seed/ibp/nameOps.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-name-ops-fold (NAME resolves its ops from the fold, not the NAME_OPS Map)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  const expected = ["declare", "connect", "release", "set-password", "banish"];

  // (1) the five seed NAME ops folded at genesis as kind:"nameop" words named "name:<op>"
  const folded = expected.filter((op) => { const w = getWordSync(`name:${op}`); return w && w.kind === "nameop" && w.do?.ref; });
  (folded.length === expected.length)
    ? ok(`all 5 NAME ops folded as kind:"nameop" words (name:${expected.join(", name:")})`)
    : bad(`5 NAME ops folded`, { folded });

  // (2) resolveNameOpFromFold returns a runnable handler for each (bare op name -> namespaced word)
  const resolved = expected.filter((op) => typeof resolveNameOpFromFold(op)?.handler === "function");
  (resolved.length === expected.length)
    ? ok(`resolveNameOpFromFold returns a handler for all 5 (the dispatch's read)`)
    : bad(`all 5 resolve a handler`, { resolved });

  // (3) the NAME_OPS object is now only the registration buffer: every op it lists resolves from the fold
  const buffer = listNameOpNames();
  const agree = buffer.length === expected.length && buffer.every((op) => typeof resolveNameOpFromFold(op)?.handler === "function" && typeof getNameOp(op)?.handler === "function");
  (agree)
    ? ok(`NAME_OPS object (${buffer.length}) agrees with the fold (the demoted registration buffer)`)
    : bad(`Map<->fold agreement`, { buffer });

  // (4) a SYNTHETIC name op: bound to the fold + its handler registered, but ABSENT from NAME_OPS
  let ranFromFold = false;
  registerHostHandler("name-op:test-name-op", async () => { ranFromFold = true; return { nameId: String(I_AM) }; });
  await bindWord("name:test-name-op", { ownerExtension: "seed", kind: "nameop", do: { ref: "name-op:test-name-op" } });
  await new Promise((r) => setTimeout(r, 400));

  (!getNameOp("test-name-op"))
    ? ok(`"test-name-op" is absent from the NAME_OPS object (fold-only)`)
    : bad(`should be Map-absent`, "found in NAME_OPS");

  (typeof resolveNameOpFromFold("test-name-op")?.handler === "function")
    ? ok(`resolveNameOpFromFold resolves the synthetic op from the fold`)
    : bad(`synthetic resolves`, resolveNameOpFromFold("test-name-op"));

  // dispatch it through nameVerb: resolution misses the Map, reads the fold, runs the handler
  await withIAmAct("test the name fold op", async (moment) => {
    await nameVerb("test-name-op", {}, { moment, identity: { name: "i-am", beingId: String(I_AM), nameId: String(I_AM) }, currentHistory: "0" });
  });
  (ranFromFold === true)
    ? ok(`nameVerb ran the handler resolved from the FOLD (not the Map)`)
    : bad(`handler ran from fold`, { ranFromFold });

  // and it laid its name:test-name-op fact (the normal NAME auto-Fact path)
  const f = await pollFor(() => Fact.findOne({ verb: "name", act: "test-name-op" }).lean(), (v) => !!v);
  (f) ? ok(`the fold-driven NAME op laid its name:test-name-op fact (same audit path)`) : bad(`fact laid`, "no test-name-op fact");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
