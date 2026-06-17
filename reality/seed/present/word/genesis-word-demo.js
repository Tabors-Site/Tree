// Phase 3: genesis from real `.word` — the creation narrative as a fact chain.
// Run:  node reality/seed/present/word/genesis-word-demo.js
//
// Parses genesis.word (I_AM's first acts) and runs the sequence. Rendered
// forward from the root, the facts ARE the creation story (1.md). No hand-built
// IR; the program is the words. Dry-run: the host bootstrap (withIAmAct, the
// real chain genesis in sprout.js) stays — this proves the WORLD strand parses
// and lays the right acts in order.

import { readFileSync } from "node:fs";
import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";

const ir = parse(readFileSync(new URL("./genesis.word", import.meta.url), "utf8"));
console.log(`\nparsed ${ir.length} acts from genesis.word (the creation narrative)\n`);

const ctx = {
  dryRun: true, branch: "main", summonCtx: { actId: "<genesis>" },
  identity: { nameId: "I_AM", name: "I_AM" }, env: { iam: "I_AM" }, bindings: {},
};

const facts = await evaluate(ir, ctx);
console.log(`genesis from .word laid ${facts.length} facts (the chain, rendered forward):\n`);
for (const f of facts) {
  const t = f.target ? ` -> ${f.target.kind}:${f.target.id ?? ""}` : "";
  console.log(`  ${f.verb}:${f.action}  by ${f.beingId}${t}`);
}
console.log("");
