// Phase 2 demo: the coupled sun/moon wheel turning with no clock.
// Run:  node story/seed/present/word/examples/sun-demo.js
//
// Validates the three engine capabilities: state/fold, watches over state, and
// the driver. The wheel turns because each phase writes the state the next phase
// waits on (coupling), and the gardener rides the day-state, never a timer.

import { register, drive } from "../evaluator.js";
import { sun, start } from "./sun.ir.js";

const ctx = {
  dryRun: true, history: "main", moment: { actId: "<actId>" },
  bindings: {}, deltaF: [], flows: [], state: { ...start }, maxTurns: 8, env: {},
};

register(sun, ctx);
await drive(ctx);

console.log(`\nthe sun wheel, ${ctx.turns} turns, no clock (started at ${start.sky}):\n`);
for (const f of ctx.deltaF) {
  if (f.action === "water") console.log(`               ${f.beingId} waters the garden`);
  else console.log(`  ${f.beingId} ${f.action}s,  sky is now ${f._sets?.sky}`);
}
console.log("");
