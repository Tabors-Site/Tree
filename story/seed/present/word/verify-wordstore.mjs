#!/usr/bin/env node
// verify-wordstore . a word is a FOLD of declare-word facts, reconstructed like a Being.
// bindWord lays a declare-word fact; getWord folds it back into the descriptor. No registry.
// Proves: reconstruct, last-declaration-wins, disable (a new fact, not a delete), re-enable, composite.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_wordstore";
process.env.PORT = "3829"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "wordstore-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "wordstore-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "wordstore-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { bindWord, getWord, disableWord } = await import(`${R}/seed/present/word/wordStore.js`);
const pollFor = async (fn, pred, t = 12000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-wordstore (a word is a fold of declare-word facts, like a Being)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200));

  // 1. bind a word, ask for it back: the fold reconstructs the descriptor (do.ref + args)
  await bindWord("test-mail", { ownerExtension: "seed", do: { ref: "seed:test-mail" }, targets: ["being"], args: { to: { type: "string", required: true } } });
  const w1 = await pollFor(() => getWord("test-mail"), (v) => v && v.do?.ref === "seed:test-mail");
  (w1 && w1.do?.ref === "seed:test-mail" && w1.args?.to?.required === true)
    ? ok(`bound word reconstructs from the fold (do.ref + args, the way a Being folds)`) : bad(`reconstruct`, w1);

  // 2. re-bind with a change: the fold's last declaration wins
  await bindWord("test-mail", { ownerExtension: "seed", do: { ref: "seed:test-mail" }, targets: ["being"], args: { to: { type: "string", required: true }, cc: { type: "string" } } });
  const w2 = await pollFor(() => getWord("test-mail"), (v) => v && v.args?.cc);
  (w2 && w2.args?.cc?.type === "string") ? ok(`re-bind: the fold's last declaration wins (cc added)`) : bad(`last wins`, w2);

  // 3. disable: a new fact, the fold returns null (the declaration stays on the chain)
  await disableWord("test-mail");
  const w3 = await pollFor(() => getWord("test-mail"), (v) => v === null);
  (w3 === null) ? ok(`disable is a new fact: the fold returns null (not deleted)`) : bad(`disable`, w3);

  // 4. re-enable via a fresh declaration
  await bindWord("test-mail", { ownerExtension: "seed", do: { ref: "seed:test-mail" }, targets: ["being"] });
  const w4 = await pollFor(() => getWord("test-mail"), (v) => v && v.do?.ref);
  (w4 && w4.do?.ref === "seed:test-mail") ? ok(`re-declare re-enables (the fold's last action wins)`) : bad(`re-enable`, w4);

  // 5. a composite word: no handler, just a can[] grant-set; words stack
  await bindWord("test-user", { ownerExtension: "seed", can: [{ verb: "do", word: "test-mail" }, { verb: "see", word: "profile" }] });
  const w5 = await pollFor(() => getWord("test-user"), (v) => v && v.can?.length === 2);
  (w5 && Array.isArray(w5.can) && w5.can.length === 2 && w5.can[0].word === "test-mail")
    ? ok(`composite word folds back as a stack of granted words (no handler)`) : bad(`composite`, w5);

  // 6. idempotency: re-binding an unchanged word with skipIfUnchanged lays no redundant fact
  const r6 = await bindWord("test-mail", { ownerExtension: "seed", do: { ref: "seed:test-mail" }, targets: ["being"] }, { skipIfUnchanged: true });
  (r6 && r6.skipped === true) ? ok(`re-bind unchanged with skipIfUnchanged skips the declare (idempotent for the genesis fold)`) : bad(`dedup skip`, r6);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
