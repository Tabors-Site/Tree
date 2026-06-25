// Phase 3: the sun from real `.word` (the round-trip). Parse sun.word -> drive.
// Run:  node story/seed/present/word/examples/sun-word-demo.js
//
// Same wheel as sun-demo.js, but with NO hand-built IR: the program is the prose
// in sun.word, parsed by the grown parser (start / wheel phase / rider forms).
// Proves the parser reproduces the hand-built sun.ir and the engine runs it.

import { readFileSync } from "node:fs";
import { parse } from "../parser.js";
import { register, drive } from "../evaluator.js";

const source = readFileSync(new URL("./sun.word", import.meta.url), "utf8");
const ir = parse(source);
const started = ir.start?.sky ?? "dawn";
console.log(`\nparsed ${ir.length} clauses from sun.word (begins at ${started})\n`);

const ctx = {
  dryRun: true, history: "main", moment: { actId: "<actId>" },
  bindings: {}, deltaF: [], flows: [], state: { ...(ir.start || { sky: "dawn" }) }, maxTurns: 8, env: {},
};

register(ir, ctx);
await drive(ctx);

console.log(`the sun wheel from .word, ${ctx.turns} turns, no clock (started at ${started}):\n`);
for (const f of ctx.deltaF) {
  if (f.action === "water") console.log(`               ${f.beingId} waters the garden`);
  else console.log(`  ${f.beingId} ${f.action}s,  sky is now ${f._sets?.sky}`);
}
console.log("");
