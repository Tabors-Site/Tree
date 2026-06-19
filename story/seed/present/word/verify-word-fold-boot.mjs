#!/usr/bin/env node
// Proves the boot fold (9.md Phase 2): `pastOf` reads verb pasts from the foundation WORDS
// (seed/words/word.word + verbs.word) via wordFold.js, not from the hardcoded map. `drop` was
// removed from the map and lives only in verbs.word, so it is the witness: droped before the
// fold (the bare -ed rule), dropped after (the Word, folded). No Mongo, no boot: pure functions.

import { pastOf } from "./verbTense.js";

const before = pastOf("drop");                 // not in the map → the -ed rule
const { foldWords } = await import("./wordFold.js");
const n = foldWords();                          // read the words, declarePast each
const after = pastOf("drop");

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}`));

console.log(`\n  verify-word-fold-boot (pastOf reads from the Word, not the map)\n`);
ok(before === "droped", `before the fold, drop has NO declared past → "${before}" (bare -ed rule)`);
ok(after === "dropped", `after the fold, drop → "${after}" — from verbs.word, not the hardcoded map`);
ok(pastOf("make") === "made", `make → made (re-declared from the words, idempotent)`);
ok(pastOf("see") === "saw", `see → saw (folded from the foundation words)`);
ok(n >= 8, `folded ${n} declared verb pasts from the foundation words`);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
