#!/usr/bin/env node
// The word vocabulary as a FOLD of the chain (mirrors wakes-as-facts). Proves: declaring a
// word lays a permanent do:declare-word fact (every fact needs an ACTOR — I_AM for the seed
// vocabulary); resolveRoleWord reads the in-memory projection (sync, unchanged hot path);
// disabling lays a do:disable-word fact and the word stops resolving; a fresh rehydrate from
// the chain reproduces the disabled state (it's a fact, not memory); re-enabling restores it;
// the whole story stays permanent (nothing removed); and declareWordsToChain is idempotent.
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_fold";
process.env.PORT = "3799";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "wordfold-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "wordfold-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "wordfold-src");
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
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const reg = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const ROLE = "credential", OP = "credential-reset";
const wordFacts = () => Fact.find({ verb: "do", act: { $in: ["declare-word", "disable-word"] } }).sort({ date: 1, seq: 1 }).lean();

console.log(`\n  verify-word-fold (the word registry as a chain fold)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }

  // 1. the BOOT wiring auto-declared the seed vocabulary to the chain (poll — declareWordsToChain
  //    runs async after genesis). This is the landing: the registry IS a fold of the chain.
  const declared = await poll(async () => {
    const n = await Fact.countDocuments({ verb: "do", act: "declare-word" });
    return n >= 16 ? n : null;
  });
  declared ? ok(`boot auto-declared the seed vocabulary: ${declared} do:declare-word facts on the chain (no manual call)`) : bad(`boot declare`, "no declare-word facts on the chain");

  // 2. a known word's declaration is a REAL fact, and it has an actor (I_AM)
  const d1 = (await wordFacts()).find((f) => f.act === "declare-word" && f.params?.role === ROLE && f.params?.op === OP);
  d1 && String(d1.through) === String(I_AM) ? ok(`do:declare-word for ${ROLE}:${OP} on the chain, actor = I_AM`) : bad(`declare fact`, d1);

  // 3. resolveRoleWord reads the projection → an IR (declared + backed). Stays synchronous.
  reg.resolveRoleWord(ROLE, OP) ? ok(`resolveRoleWord(${ROLE},${OP}) → IR (declared + backed, sync)`) : bad(`resolve`, "null");

  // 4. DISABLE → a do:disable-word fact + resolveRoleWord goes null (acts fall through / refuse)
  await reg.disableWord(ROLE, OP, {});
  const afterDisable = reg.resolveRoleWord(ROLE, OP);
  const disFact = (await wordFacts()).find((f) => f.act === "disable-word" && f.params?.role === ROLE && f.params?.op === OP);
  !afterDisable && disFact ? ok(`disableWord → do:disable-word fact on the chain + resolveRoleWord → null`) : bad(`disable`, { resolved: !!afterDisable, disFact: !!disFact });

  // 5. REHYDRATE from the chain (simulate a restart) → the disable PERSISTS (it's a fact, not memory)
  await reg.rehydrateWordsFromFacts();
  !reg.resolveRoleWord(ROLE, OP) ? ok(`rehydrateWordsFromFacts → the disable persists (folded from the chain)`) : bad(`rehydrate persists disable`, "resolved");

  // 6. RE-ENABLE → resolveRoleWord restored (a fresh declare-word, the fold's last action wins)
  await reg.enableWord(ROLE, OP, {});
  reg.resolveRoleWord(ROLE, OP) ? ok(`enableWord → resolveRoleWord restored (fresh declare-word, last action wins)`) : bad(`enable`, "null");

  // 7. the whole STORY is permanent on the chain: declare → disable → declare (nothing removed)
  const story = (await wordFacts()).filter((f) => f.params?.role === ROLE && f.params?.op === OP).map((f) => f.act);
  story.join(",") === "declare-word,disable-word,declare-word"
    ? ok(`the vocabulary's whole story is permanent: declare → disable → declare (you DISABLE, never delete)`)
    : bad(`story`, story);

  // 8. idempotent: re-running declareWordsToChain lays 0 (every word already declared)
  const laid2 = await reg.declareWordsToChain({});
  laid2 === 0 ? ok(`declareWordsToChain idempotent (re-run laid 0 — all words already on the chain)`) : bad(`idempotent`, laid2);

  // 9. PER-BRANCH (V2): disable `move:move` on a real child branch only — off there, ON on main.
  //    This is the capability: an extension's words on in one branch, off in another.
  const { createBranch } = await import(`${R}/seed/materials/branch/branchCreation.js`);
  const made = await createBranch({ parent: "0", anchor: { atSeq: 1 }, createdBy: String(I_AM) });
  const BR = made.path;
  await reg.disableWord("move", "move", { branch: BR });
  const moveOnBranch = reg.resolveRoleWord("move", "move", BR);
  const moveOnMain = reg.resolveRoleWord("move", "move", "0");
  !moveOnBranch && moveOnMain ? ok(`move:move disabled on branch "${BR}" only → null on "${BR}", IR on main (on in one branch, off in another)`) : bad(`per-branch disable`, { onBranch: !!moveOnBranch, onMain: !!moveOnMain });

  // 10. rehydrate folds the per-branch state from the chain (by the disable fact's branch)
  await reg.rehydrateWordsFromFacts();
  !reg.resolveRoleWord("move", "move", BR) && reg.resolveRoleWord("move", "move", "0")
    ? ok(`rehydrate preserves per-branch state: "${BR}" off, main on (folded by the fact's branch)`)
    : bad(`per-branch rehydrate`, { onBranch: !!reg.resolveRoleWord("move", "move", BR), onMain: !!reg.resolveRoleWord("move", "move", "0") });

  // 11. re-enable on the branch → restored there too
  await reg.enableWord("move", "move", { branch: BR });
  reg.resolveRoleWord("move", "move", BR) ? ok(`enable move:move on "${BR}" → restored on "${BR}"`) : bad(`per-branch enable`, "null");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
