#!/usr/bin/env node
// verify-seedfold . the genesis fold runs at boot. seedFold declares the seed (verb pasts, concept
// .words, do-ops) onto the chain as I_AM coin facts in one moment. After boot, asking for a
// word folds it back: the seed declares itself. Also a regression check: a seedFold crash would
// stop the boot before the delegates, so reaching cherub proves it did not crash genesis.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_seedfold";
process.env.PORT = "3835"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "seedfold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "seedfold-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "seedfold-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { getWord } = await import(`${R}/seed/present/word/wordStore.js`);
const pollFor = async (fn, pred, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-seedfold (the seed declares itself at genesis)\n`);
try {
  const cherub = await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  if (!cherub) { console.log("  FATAL: genesis failed (boot did not reach the delegates)"); process.exit(1); }
  ok(`genesis completed past seedFold (boot reached the delegates, the fold did not crash it)`);

  // 1. a CONCEPT word folds back from the chain as {kind:"concept", says}
  const being = await pollFor(() => getWord("being"), (v) => v && v.kind === "concept");
  (being && being.kind === "concept" && /being/i.test(being.says || "")) ? ok(`concept "being" declared at genesis, folds back {kind:"concept", says}`) : bad(`concept fold`, being);

  // 2. an OP word folds back as {kind:"op", do.ref}
  const op = await pollFor(() => getWord("set-space"), (v) => v && v.kind === "op");
  (op && op.kind === "op" && op.do?.ref === "set-space") ? ok(`op "set-space" declared at genesis, folds back {kind:"op", do.ref}`) : bad(`op fold`, op);

  // 3. the root and a few of the descent are present (declare-before-use held)
  const word = await getWord("word");
  (word && word.kind === "concept") ? ok(`the root "word" declared too (the descent folded)`) : bad(`root word`, word);

  // 4. end to end: the world story reads the seed declaring itself, body and all
  const { assembleStory } = await import(`${R}/seed/present/book/assemble.js`);
  const story = JSON.stringify(await assembleStory("world", { branch: "0" }));
  (story.includes("spoke the word being") && /A being is a presence/.test(story))
    ? ok(`the story reads the seed: "spoke the word being: A being is a presence..."`)
    : bad(`story renders the seed`, story.includes("spoke the word") ? "name shown but body missing" : "no coin rendered in the story");

  // 5. completeness: every concept of the descent declared (not just spot-checks)
  const CONCEPTS = ["word", "iam", "base", "chain", "history", "story", "fold", "weave", "see", "do", "name", "being", "space", "matter", "be", "call", "can", "recall", "role", "roleflow"];
  let found = 0;
  for (const c of CONCEPTS) { const w = await getWord(c); if (w && w.kind === "concept") found++; }
  (found === CONCEPTS.length) ? ok(`all ${CONCEPTS.length} concept words declared (the full descent folded)`) : bad(`all concepts`, `${found}/${CONCEPTS.length}`);

  // 6. the do-ops declared into the fold alongside the concepts
  const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
  const opCount = await Fact.countDocuments({ verb: "do", act: "coin", history: "0", "params.binding.kind": "op" });
  (opCount > 30) ? ok(`${opCount} do-ops declared into the fold (the op set, beside the concepts)`) : bad(`op count`, opCount);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
