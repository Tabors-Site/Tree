// Phase 3: the cherub birth flow from real `.word` (the round-trip).
// Run:  node reality/seed/present/word/cherub-word-demo.js
//
// Proves the multi-effect flow body AND the implicit-actor rule: the five acts
// are by I_AM, through Cherub (the mother); the being is the new Name's own; the
// father is Arrival. No hand-built IR; the program is cherub.word.

import { readFileSync } from "node:fs";
import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";

const source = readFileSync(new URL("../roles/cherub/cherub.word", import.meta.url), "utf8");
const ir = parse(source);
const flow = ir[0];

// cherub the being expresses I_AM (the reality root Name); the arriving Name is
// "tabor", making its first being "tabor-prime".
const ctx = {
  dryRun: true, branch: "main", summonCtx: { actId: "<actId>" },
  identity: { beingId: "Cherub", name: "cherub", nameId: "I_AM" },
  trigger: { name: "tabor-prime", password: "hunter2" },
  env: { iam: "I_AM" },
  bindings: { placeRoot: "<placeRoot>", ownerName: "tabor" },
};
const actor = (by) => (by === "I" ? ctx.identity.nameId : by); // rule 9: I -> the Name

console.log(`\nparsed cherub.word: one flow, ${flow.effects.length} effects (binds: ${flow.binds.join(", ")})`);
console.log(`the acts, with the actor surfaced (by the NAME, through the vessel):\n`);
for (const e of flow.effects) {
  const thr = e.through ? ` through ${e.through}` : "";
  const note = e.params?.trueName ? `  [being's trueName = ${e.params.trueName === "$ownerName" ? ctx.bindings.ownerName : e.params.trueName}]`
    : e.params?.value?.mother ? `  [mother ${e.params.value.mother}, father ${e.params.value.father}]` : "";
  console.log(`  ${e.verb}:${e.op}  by ${actor(e.by)}${thr}${note}`);
}

const facts = await evaluate(flow, ctx);
console.log(`\nlaid ${facts.length} facts (the 5-fact birth shape):`);
for (const f of facts) console.log(`  ${f.verb}:${f.action} -> ${f.target ? f.target.kind + ":" + (f.target.id ?? "") : ""}`);
console.log("");
