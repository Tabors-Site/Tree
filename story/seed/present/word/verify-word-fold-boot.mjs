#!/usr/bin/env node
// Proves the boot fold (9.md Phase 2): `pastOf` reads verb pasts from the foundation WORDS
// (seed/words/word.word + verbs.word) via wordFold.js, not from a hardcoded map. The hardcoded
// map is now EMPTY, so every irregular is a witness: `make` is "maked" before the fold (the bare
// -ed rule) and "made" after (the Word, folded). No Mongo, no boot: pure functions.

import { pastOf } from "./verbTense.js";

const before = pastOf("make");                 // empty map → the bare -ed rule
const { foldWords } = await import("./wordFold.js");
const n = foldWords();                          // read the words, declarePast each
const after = pastOf("make");

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

console.log(`\n  verify-word-fold-boot (pastOf reads from the Word, not a map)\n`);
ok(before === "maked", `before the fold, make has NO declared past → "${before}" (bare -ed rule)`);
ok(after === "made", `after the fold, make → "${after}" — from verbs.word, not a hardcoded map`);
ok(pastOf("give") === "gave", `give → gave (folded from the foundation words)`);
ok(pastOf("see") === "saw", `see → saw (folded from the foundation words)`);
ok(n >= 8, `folded ${n} declared verb pasts from the foundation words`);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
