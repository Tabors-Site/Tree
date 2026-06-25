#!/usr/bin/env node
// verify-grammar-rule-fold — the metacircular loop closes: parse() reads two grammar rules from the
// Word's fold instead of its hardcoded table. The rules: `owns` (two capture groups — proves the
// substitution path GENERALIZES) and `i-am` (the genesis verse — "in the beginning was the Word"
// made literal). Run: node seed/present/word/verify-grammar-rule-fold.mjs
//
// THE FLOOR BOUNDARY (state it so the proof is never mistaken for more): the rule's STRUCTURE (kind,
// the emitted node-shape) is LIFTED data, folded as a coin fact; the regex MATCHER is a host AXIOM
// behind a ref (a fn can't serialize as a fact). "Declared in Word for self-description, run by the
// kernel for behavior" (9.md §2 two-face). This proof lifts the grammar to fold DATA — it does NOT
// lift the parse logic, nor express the grammar as `.word` prose (both deferred).

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_grammar_rule_fold-" + process.pid);
process.env.PORT = "3871";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "grammar-rule-fold-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "grammar-rule-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "grammar-rule-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { getWord, bindWord, registerHostHandler } = await import(`${R}/seed/present/word/wordStore.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);

let pass = 0, fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const IAM_NODE = { kind: "act", verb: "name", act: "i-am", by: "I" };
const OWNS_NODE = { kind: "owns", subject: "Alice", of: "commons" };

console.log(`\n  verify-grammar-rule-fold (parse() reads owns + i-am from the fold; the metacircular loop closes)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1500));

  // 1. FOLDED AS DATA: both rule-words live on the chain as kind:"rule", with the right parse.ref and node.
  const iamW = await getWord("i-am-rule", "0");
  const ownsW = await getWord("owns-rule", "0");
  (iamW && iamW.kind === "rule" && iamW.parse?.ref === "rule:i-am" &&
   eq(iamW.node, { kind: "act", verb: "name", act: "i-am", by: "I" }))
    ? ok(`i-am-rule folded as kind:"rule" (parse.ref=rule:i-am, node deep-equals)`)
    : bad(`i-am-rule folded`, iamW);
  (ownsW && ownsW.kind === "rule" && ownsW.parse?.ref === "rule:owns" &&
   eq(ownsW.node, { kind: "owns", subject: "$1", of: "$2" }))
    ? ok(`owns-rule folded as kind:"rule" (parse.ref=rule:owns, node carries $1/$2)`)
    : bad(`owns-rule folded`, ownsW);

  // 2. BYTE-IDENTICAL OUTPUT: parse() emits the same node it always did — proving the capture-group
  //    substitution path ($1→Alice, $2→commons) works (what i-am alone could not prove).
  const iam = parse('I am "what?" I am.')[0];
  eq(iam, IAM_NODE) ? ok(`parse('I am "what?" I am.') → ${JSON.stringify(iam)} (byte-identical)`) : bad(`i-am parse`, iam);
  const owns = parse('Alice owns the commons.')[0];
  eq(owns, OWNS_NODE) ? ok(`parse('Alice owns the commons.') → ${JSON.stringify(owns)} ($1/$2 substituted)`) : bad(`owns parse`, owns);

  // 3. PROVENANCE — it came from the FOLD (decisive, no source edit): rebind owns-rule with an
  //    ALTERED node (add via:"fold"); re-parse and assert the node carries it. Only possible if
  //    control passed through the fold path (consulted BEFORE the hardcoded table). The fold-first
  //    ordering regression guard.
  registerHostHandler("rule:owns", (line) => line.match(/^(I|[A-Z][\w.-]*) owns? (?:the |a |an )?([\w.-]+)\.$/));
  await bindWord("owns-rule", { kind: "rule", parse: { ref: "rule:owns" }, node: { kind: "owns", subject: "$1", of: "$2", via: "fold" } }, { history: "0", skipIfUnchanged: true });
  const ownsVia = parse('Alice owns the commons.')[0];
  (ownsVia && ownsVia.via === "fold" && ownsVia.subject === "Alice" && ownsVia.of === "commons")
    ? ok(`rebound owns-rule with via:"fold" → parse carries it (control went through the fold, fold-first wins)`)
    : bad(`provenance via:"fold"`, ownsVia);
  // rebind to canonical; assert byte-identity again.
  await bindWord("owns-rule", { kind: "rule", parse: { ref: "rule:owns" }, node: { kind: "owns", subject: "$1", of: "$2" } }, { history: "0", skipIfUnchanged: true });
  eq(parse('Alice owns the commons.')[0], OWNS_NODE) ? ok(`rebound owns-rule to canonical → byte-identical again`) : bad(`canonical rebind`, parse('Alice owns the commons.')[0]);

  // 4. NO REGRESSION: a non-lifted top-level rule + an effect-rule line parse byte-identically — the
  //    hybrid left everything else untouched.
  const isSpace = parse('A music-room is a space.')[0];
  eq(isSpace, { kind: "is", subject: "music-room", isA: "space" }) ? ok(`non-lifted rule (is-a-space) untouched`) : bad(`is-a-space`, isSpace);
  // an effect-rule line lives inside a flow body; parse a minimal flow that exercises it.
  const flow = parse('When it is dawn:\n  the sun rises, and it becomes day.');
  (flow[0]?.kind === "flow" && flow[0]?.effects?.length === 1) ? ok(`effect-rule (flow body) untouched`) : bad(`flow body`, flow[0]);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
