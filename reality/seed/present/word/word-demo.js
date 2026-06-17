// Phase 3 demo: parse a real `.word` file and run it.
// Run:  node reality/seed/present/word/word-demo.js
//
// This is the round-trip: prose (harmony.word) -> IR (parser) -> facts (evaluator).
// No hand-built IR; the program is the words.

import { readFileSync } from "node:fs";
import { parse } from "./parser.js";
import { evaluate, register, pump } from "./evaluator.js";

const source = readFileSync(new URL("./harmony.word", import.meta.url), "utf8");
const ir = parse(source);
console.log(`\nparsed ${ir.length} clauses from harmony.word\n`);

const ctx = {
  dryRun: true, branch: "main", summonCtx: { actId: "<actId>" },
  bindings: {}, deltaF: [], flows: [], beats: 0, maxBeats: 4, env: {},
};

register(ir, ctx);
// kick the pulse: the drummer's opening strike (a beat). After this the choq sustains.
await evaluate([{ kind: "act", verb: "do", op: "strike", by: "Drummer", of: { kind: "matter", id: "drum" }, event: "beat" }], ctx);
await pump(ctx);

console.log(`harmony from .word, ${ctx.beats} beats observed:\n`);
let beat = 0;
for (const f of ctx.deltaF) {
  if (f._event === "beat") {
    if (++beat > ctx.maxBeats) { console.log("  ... (the rhythm continues, unobserved)"); break; }
    console.log(`  beat ${beat}:  ${f.beingId} strikes the drum`);
  } else if (f.action === "step") {
    console.log(`           ${f.beingId} steps`);
  }
}
console.log("");
