// Phase 2 demo: dry-run the cherub birth IR and print the facts it lays.
// Run:  node story/seed/present/word/demo.js
//
// This proves the evaluator walks the IR and produces the fact sequence. The
// Phase 2 gate is then to diff this sequence against the JS handler's deltaF for
// the same input (the real beingId hashes and the inherited-role / global grants
// that birthBeing lays internally fill in once form-being runs live).

import { evaluate } from "./evaluator.js";
import { cherubBirth } from "./cherub-birth.ir.js";

const ctx = {
  dryRun: true,
  history: "main",
  moment: { actId: "<actId>" },
  identity: { beingId: "Cherub", name: "cherub", nameId: "Cherub" },
  trigger: { name: "tabor", password: "hunter2" }, // the birth summon payload
  env: { iam: "I_AM" },
  bindings: { placeRoot: "<placeRoot>" }, // the story's root space, ambient
};

const facts = await evaluate(cherubBirth, ctx);

console.log(`\ncherub birth (dry-run) laid ${facts.length} facts:\n`);
for (const f of facts) {
  const t = f.target ? `${f.target.kind}:${f.target.id ?? ""}` : "";
  console.log(`  ${f.verb}:${f.action}  by ${f.beingId}  -> ${t}`);
}
console.log("");
