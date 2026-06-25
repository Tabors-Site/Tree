#!/usr/bin/env node
// verify-descent — 9.md Phase 3-5: the seed self-describes and the descent CLOSES (self-hosting
// proof). Boots, then asserts: (1) pastOf is fold-derived (DECLARED_PAST filled from verbs.word,
// live — not a hardcoded map); (2) the concept words are folded WITH their axiom headers; (3) the
// axiom anchor classifies axiom vs theorem from the words' own `#` headers; (4) the descent symmetry
// guard passes — every concept is in the fold, grounds on declared words, and its host pointers
// resolve (kernel == word.word).
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_descent-" + process.pid);
process.env.PORT = "3853"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "descent-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "descent-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "descent-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const { pastOf, declarePast } = await import(`${R}/seed/present/word/verbTense.js`);
const { getAxiomAnchor, assertDescentSymmetry, CONCEPT_WORDS } = await import(`${R}/seed/present/word/axioms.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 280)); };
console.log("\n  verify-descent (9.md: the seed self-describes; the descent closes)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);

  // 1. pastOf is FOLD-derived: irregulars come from verbs.word (not a hardcode), and a NEW past
  //    declared at runtime resolves — proving DECLARED_PAST is a live fold, not a frozen map.
  const irregular = pastOf("see") === "saw" && pastOf("make") === "made" && pastOf("take") === "took";
  const regular = pastOf("grant") === "granted" && pastOf("connect") === "connected";
  declarePast("frobnicate", "frobnicated-XYZ");
  const live = pastOf("frobnicate") === "frobnicated-XYZ";
  (irregular && regular && live)
    ? ok(`pastOf is fold-derived: see→saw, make→made (from verbs.word), grant→granted (-ed rule), live declarePast resolves`)
    : bad("pastOf not fully fold-derived", { irregular, regular, live, see: pastOf("see") });

  // 2. The concept words are folded WITH their axiom headers (self-description landed on the chain).
  const see = getWordSync("see"), doW = getWordSync("do"), word = getWordSync("word");
  (see?.axiom && /bottoms out in the host/i.test(see.axiom) && doW?.says && /To do is to stamp/.test(doW.says) && word?.says && /A word is a word/.test(word.says))
    ? ok(`concept words folded with axiom + says (see.axiom names its host-bottom; do.says + word.says present)`)
    : bad("concept words not folded with headers", { seeAxiom: !!see?.axiom, doSays: !!doW?.says });

  // 3. The axiom anchor classifies axiom vs theorem from the words' OWN headers.
  const anchor = getAxiomAnchor(getWordSync);
  const byWord = Object.fromEntries(anchor.map((a) => [a.word, a]));
  const axiomsCorrect = byWord.see?.isAxiom && byWord.do?.isAxiom && byWord.being?.isAxiom && byWord.call?.isAxiom;
  const callDescends = byWord.call?.descendsFrom?.includes("do") && byWord.call?.descendsFrom?.includes("being");
  const allInFold = anchor.every((a) => a.inFold);
  (axiomsCorrect && callDescends && allInFold && anchor.length === CONCEPT_WORDS.length)
    ? ok(`axiom anchor: ${anchor.filter((a) => a.isAxiom).length} axioms / ${anchor.filter((a) => !a.isAxiom).length} theorems; call descends from do+being; all ${anchor.length} in fold`)
    : bad("axiom anchor classification wrong", { axiomsCorrect, callDescends, allInFold, n: anchor.length });

  // 4. The descent symmetry guard PASSES — kernel == word.word (descent closes, host pointers resolve).
  const sym = assertDescentSymmetry(getWordSync);
  sym.ok
    ? ok(`descent symmetry closes: kernel == word.word (${sym.axioms.length} axioms, ${sym.theorems.length} theorems, 0 issues)`)
    : bad(`descent symmetry has ${sym.issues.length} issue(s)`, sym.issues);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
